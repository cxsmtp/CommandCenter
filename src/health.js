/**
 * Self-correction and the health checks behind Settings → System.
 *
 * Every minute the watchdog looks at the server and fixes what it can by itself:
 *   - tenant reading stalled (no read finished for three intervals while tenants are due): the reader is restarted;
 *   - memory above CC_MAX_RSS_MB (default 1536) three minutes running: a clean restart (with the launcher);
 *   - the event loop blocked for seconds: recorded, so a slow spot shows up before people feel it.
 * Anything it cannot fix (a backup that failed, the disk filling up, a damaged record with no good copy, the audit
 * chain broken) is shown as a check with what to do.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const MINUTE = 60_000;

export class Watchdog {
  #o;
  #timer = null;
  #loop = monitorEventLoopDelay({ resolution: 50 });
  #highMemory = 0;
  #lastReads = -1;
  #lastProgressAt = Date.now();
  corrections = [];
  maxLoopMs = 0;

  /**
   * @param {object} o
   * @param {import('./monitor.js').Monitor} o.monitor
   * @param {() => void} o.restart   a clean restart (only when launched)
   * @param {boolean} o.launched
   */
  constructor(o) {
    this.#o = { maxRssMb: Number(process.env.CC_MAX_RSS_MB) || 1536, ...o };
  }

  start() {
    this.#loop.enable();
    this.#timer = setInterval(() => this.tick(), MINUTE);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
    this.#loop.disable();
  }

  #note(what, action) {
    this.#o.onNote?.(what, action);
    this.corrections.unshift({ at: new Date().toISOString(), what, action });
    this.corrections.length = Math.min(this.corrections.length, 50);
    console.error(`Watchdog: ${what} — ${action}`);
  }

  tick(now = Date.now()) {
    const { monitor } = this.#o;
    // Reading tenants
    const load = monitor.load();
    if (load.reads !== this.#lastReads || !load.tenants) {
      this.#lastReads = load.reads;
      this.#lastProgressAt = now;
    } else if (now - this.#lastProgressAt > 3 * load.intervalMinutes * MINUTE + 5 * MINUTE) {
      this.#note(`No tenant read finished for ${Math.round((now - this.#lastProgressAt) / MINUTE)} minutes`, 'restarted the tenant reader');
      monitor.stop();
      monitor.start();
      this.#lastProgressAt = now;
    }
    // Memory
    const rssMb = process.memoryUsage().rss / 1048576;
    this.#highMemory = rssMb > this.#o.maxRssMb ? this.#highMemory + 1 : 0;
    if (this.#highMemory >= 3) {
      this.#highMemory = 0;
      if (this.#o.launched) {
        this.#note(`Memory at ${Math.round(rssMb)} MB for 3 minutes (limit ${this.#o.maxRssMb})`, 'restarting cleanly');
        this.#o.restart();
      } else this.#note(`Memory at ${Math.round(rssMb)} MB for 3 minutes (limit ${this.#o.maxRssMb})`, 'no launcher here to restart: start with npm start or the container image');
    }
    // Event loop
    const maxMs = this.#loop.max / 1e6;
    this.#loop.reset();
    if (maxMs > this.maxLoopMs) this.maxLoopMs = Math.round(maxMs);
    if (maxMs > 2000) this.#note(`The server was blocked for ${(maxMs / 1000).toFixed(1)} s`, 'recorded');
  }
}

/** The checks, worst first: { key, label, level: ok | warn | bad, text, fix }. */
/** The integrity health check: changed files are bad; a checked install is genuine; the image's own version is the image's. */
export function integrityCheck(integrity, version) {
  if (!integrity) return null;
  const c = (level, text, fix = '') => ({ key: 'integrity', label: 'Software integrity', level, text, fix });
  if (integrity.checked && !integrity.ok) return c('bad', `Files changed since this version was installed: ${integrity.changed.slice(0, 5).join(', ')}${integrity.changed.length > 5 ? '…' : ''}.`, 'Install the version again (Settings → Update & recovery), or go back to the previous one. If nobody here changed them, treat the server as compromised.');
  if (integrity.checked) return c('ok', `Genuine: every file of ${version} matches what was installed (checked ${new Date(integrity.at).toISOString().slice(11, 16)} UTC).`);
  return c('ok', `${version} is the container image’s own version: its files are the image’s, checked when it was built.`);
}

export function healthChecks({ db, backups, monitor, audit, updater, watchdog, version, certValidTo = null, drill = null, integrity = null }) {
  const out = [];
  const add = (key, label, level, text, fix = '') => out.push({ key, label, level, text, fix });

  // Encryption
  const v = db.vault;
  if (v.source.startsWith('key file')) add('key', 'Encryption', 'warn', `All data is encrypted (AES-256). The key is a file in the data folder (key ${v.fingerprint}).`, 'Set CC_SECRET_FILE to a secret mounted from outside the data volume, so a copy of the disk or of a backup is unreadable on its own. Keep a copy of the key in your password vault.');
  else add('key', 'Encryption', 'ok', `All data is encrypted (AES-256), with the key from ${v.source} (key ${v.fingerprint}).`);

  // The software: the files running are the ones installed
  const sw = integrityCheck(integrity, version);
  if (sw) out.push(sw);

  // Backups
  const list = backups.list();
  const auto = list.find((b) => b.label === 'auto');
  const hours = Number(process.env.CC_BACKUP_HOURS) || 6;
  if (backups.lastError) add('backup', 'Backups', 'bad', `The last backup failed: ${backups.lastError.message}`, 'Check the free space and that the backup folder is writable.');
  else if (!auto) add('backup', 'Backups', 'warn', 'No automatic backup yet (the first is taken a minute after start).');
  else if (Date.now() - Date.parse(auto.at) > 2 * hours * 3_600_000) add('backup', 'Backups', 'bad', `The newest automatic backup is from ${auto.at}.`, 'Look at the server log for the reason.');
  else if (auto.verified === false) add('backup', 'Backups', 'bad', `The newest backup did not pass its check: ${auto.problems.slice(0, 2).join('; ')}`);
  else add('backup', 'Backups', 'ok', `${list.length} kept, the newest checked and readable (${new Date(auto.at).toUTCString().slice(5, 22)} UTC). Every ${hours} h.`);
  if (!backups.offsite) add('offsite', 'Copy off the server', 'warn', 'Backups are only on this server’s disk.', 'Set CC_BACKUP_DIR to a mounted share or another disk: each backup is copied there too.');
  else if (auto && auto.offsite === false) add('offsite', 'Copy off the server', 'bad', `The newest backup is not in ${backups.offsite}.`, 'Check the share is mounted and writable.');
  else add('offsite', 'Copy off the server', 'ok', `Each backup is also copied to ${backups.offsite}.`);

  // Disk
  const free = backups.freeBytes();
  if (free !== null) {
    const gb = free / 1073741824;
    add('disk', 'Disk', gb < 0.5 ? 'bad' : gb < 2 ? 'warn' : 'ok', `${gb.toFixed(1)} GB free on the data volume.`, gb < 2 ? 'Give the data volume more space; demo videos and backups need room.' : '');
  }

  // Records
  const repairs = db.repairs;
  const lost = repairs.filter((r) => !r.from);
  if (lost.length) add('records', 'Records', 'bad', `${lost.map((r) => r.name).join(', ')} could not be read and no good copy was found; set aside as .damaged.`, 'Restore a backup from the list below.');
  else if (repairs.length) add('records', 'Records', 'warn', `Repaired by itself: ${repairs.map((r) => `${r.name} (from ${r.from})`).join(', ')}.`, 'Nothing to do; worth a look if it happens again.');
  else add('records', 'Records', 'ok', 'Every record read cleanly.');

  // Audit chain
  const chain = audit.verify();
  add('audit', 'Audit log', chain.ok ? 'ok' : 'bad', chain.ok ? `${chain.entries} ${chain.entries === 1 ? "entry" : "entries"}, the chain intact.` : `The chain is broken at the entry of ${chain.brokenAt}: an entry was changed or removed.`, chain.ok ? '' : 'Find out who had access to the data folder.');

  // Tenant reading
  const load = monitor.load();
  add('reading', 'Reading tenants', load.failing > Math.max(2, load.tenants * 0.2) ? 'warn' : 'ok', `${load.tenants} tenants every ${load.intervalMinutes} min · ${load.reading} reading, ${load.queued} queued · ${load.failing} failing.`, load.failing ? 'The failing ones are listed on the portfolio with the reason.' : '');

  // Watchdog
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  const recent = watchdog.corrections.filter((c) => Date.now() - Date.parse(c.at) < 86_400_000);
  add('server', 'Server', recent.length ? 'warn' : 'ok', `Version ${version} · ${mem} MB · longest pause ${watchdog.maxLoopMs} ms${recent.length ? ` · corrected ${recent.length}× today: ${recent[0].what} (${recent[0].action})` : ''}.`);

  // The HTTPS certificate (one of your own; the self-signed one renews itself)
  if (certValidTo) {
    const days = Math.floor((Date.parse(certValidTo) - Date.now()) / 86_400_000);
    add('cert', 'HTTPS certificate', days < 7 ? 'bad' : days < 30 ? 'warn' : 'ok', days < 0 ? `The certificate expired ${-days} days ago: browsers refuse the site.` : `The certificate is valid for ${days} more days (until ${new Date(certValidTo).toISOString().slice(0, 10)}).`, days < 30 ? 'Replace TLS_CERT_FILE and TLS_KEY_FILE with a renewed certificate, then restart.' : '');
  }

  // The weekly restore drill
  if (drill) {
    const days = Math.floor((Date.now() - Date.parse(drill.at)) / 86_400_000);
    add('drill', 'Restore drill', !drill.ok ? 'bad' : days > 8 ? 'warn' : 'ok', drill.ok ? `${drill.message} (${days ? `${days} days ago` : 'today'})` : drill.message, drill.ok ? '' : 'Check the newest backup below, and that the encryption key is the one the data was written with.');
  }

  // The server's clock (sign-ins, certificates and the audit trail depend on it)
  const skew = updater.status().clockSkewMs;
  if (skew != null && Math.abs(skew) > 5 * 60_000) add('clock', 'Clock', 'warn', `The server’s clock is ${Math.round(Math.abs(skew) / 60_000)} minutes ${skew > 0 ? 'ahead' : 'behind'}.`, 'Turn on time sync on the host (timedatectl set-ntp true).');

  // Updates
  const u = updater.status();
  if (u.lastFailure) add('update', 'Updates', 'warn', `Version ${u.lastFailure.version} failed to start and was rolled back by itself.`, 'It will not be tried again automatically; check its release notes.');
  else if (u.checkError) add('update', 'Updates', 'warn', `Cannot see the releases: ${u.checkError}`, u.token ? 'Check the token can read the repository, and the network allows api.github.com.' : 'Set CC_UPDATE_TOKEN to a read-only GitHub token.');
  else if (!u.auto.enabled) add('update', 'Updates', 'warn', `Auto-update is off${u.updateAvailable ? `; version ${u.available[0].version} is waiting` : ''}.`, 'Turn it on below to stay on the newest version.');
  else add('update', 'Updates', 'ok', `${u.updateAvailable ? `Version ${u.available[0].version} found; installing.` : 'On the newest version.'} Checked every ${u.auto.everyMinutes} minutes.`);

  const rank = { bad: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
