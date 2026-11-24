/**
 * Keeping Meridian up without anyone watching (after CxMissionZero's hands-off running):
 *
 *   - one server per data folder (instance lock): a second copy on the same data refuses to start;
 *   - start-up checks: half-saved files from a crash are cleared, low disk space is said loudly;
 *   - the Admins are emailed when a health check goes bad and stays bad, when it is working again, and when the
 *     server corrected something by itself (at most every 6 hours for those), so nobody has to look.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stateError } from './db.js';

// ——— One server per data folder ———
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/** Take the data folder; refuses when another live server holds it. Returns a release function. */
export function lockDataDir(dataDir, { staleMs = 30_000 } = {}) {
  const file = path.join(dataDir, 'instance.lock');
  const me = { pid: process.pid, host: os.hostname(), at: Date.now() };
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sameHost = held.host === me.host;
    const fresh = Date.now() - held.at < staleMs;
    if (held.pid !== me.pid && fresh && (!sameHost || alive(held.pid))) {
      throw stateError(`Another Meridian (pid ${held.pid} on ${held.host}) is using this data folder. Two servers on one data folder would damage it: stop the other one first.`);
    }
  } catch (e) {
    if (e.code === 'STATE') throw e;
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const beat = () => {
    try {
      fs.writeFileSync(file, JSON.stringify({ ...me, at: Date.now() }), { mode: 0o600 });
    } catch {}
  };
  beat();
  const timer = setInterval(beat, 10_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    try {
      if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === me.pid) fs.rmSync(file, { force: true });
    } catch {}
  };
}

// ——— Start-up checks ———
/** Clear what a crash left half-written, and say when the disk is nearly full. Returns notes for the log. */
export function preflight(dataDir) {
  const notes = [];
  const cutoff = Date.now() - 10 * 60_000;
  const sweep = (dir, depth = 0) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3 && !['backups', 'app'].includes(e.name)) sweep(p, depth + 1);
      else if (e.isFile() && /\.\d+\.[0-9a-f]+\.tmp$|\.tmp$/.test(e.name)) {
        try {
          if (fs.statSync(p).mtimeMs < cutoff) {
            fs.rmSync(p, { force: true });
            notes.push(`removed a half-saved file left by a crash: ${path.relative(dataDir, p)}`);
          }
        } catch {}
      }
    }
  };
  sweep(dataDir);
  try {
    const s = fs.statfsSync(dataDir);
    const free = s.bavail * s.bsize;
    if (free < 200 * 1048576) notes.push(`only ${Math.round(free / 1048576)} MB free on the data volume: saving may fail; give it more space`);
  } catch {}
  return notes;
}

/** Is this Node.js new enough for a release ("engines": { "node": ">=22" })? */
export function nodeSatisfies(range, version = process.versions.node) {
  const m = /(\d+)(?:\.(\d+))?/.exec(String(range ?? ''));
  if (!m) return true;
  const [maj, min] = version.split('.').map(Number);
  const need = [Number(m[1]), Number(m[2] ?? 0)];
  return maj > need[0] || (maj === need[0] && min >= need[1]);
}

// ——— Telling the Admins ———
export class AdminAlerts {
  #o;
  #timer = null;

  /**
   * @param {object} o
   * @param {() => Array} o.checks       healthChecks(...)
   * @param {() => Array} o.corrections  the watchdog's corrections
   * @param {object} o.mailer
   * @param {() => string[]} o.admins    email addresses of the Admins
   * @param {object} o.db                where the alert state is kept (survives restarts)
   * @param {string} o.org
   */
  constructor(o) {
    this.#o = o;
  }

  start(everyMs = 5 * 60_000) {
    this.#timer = setInterval(() => this.tick().catch(() => {}), everyMs);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
  }

  async tick(now = Date.now()) {
    const { db, mailer } = this.#o;
    const st = db.read('alerts', null) ?? { checks: {}, correctionsMailedAt: 0, lastCorrection: '' };
    const mails = [];
    for (const c of this.#o.checks()) {
      const prev = st.checks[c.key] ?? { level: 'ok', bad: 0, mailed: false };
      const bad = c.level === 'bad';
      const next = { level: c.level, bad: bad ? prev.bad + 1 : 0, mailed: prev.mailed, text: c.text };
      // Bad on two checks in a row: tell them once. Back to fine after that: tell them it works again.
      if (bad && next.bad >= 2 && !prev.mailed) {
        mails.push(`Needs attention — ${c.label}: ${c.text}${c.fix ? `\nWhat to do: ${c.fix}` : ''}`);
        next.mailed = true;
      }
      if (!bad && prev.mailed) {
        mails.push(`Working again — ${c.label}: ${c.text}`);
        next.mailed = false;
      }
      st.checks[c.key] = next;
    }
    const corr = this.#o.corrections();
    if (corr[0] && corr[0].at !== st.lastCorrection && now - (st.correctionsMailedAt ?? 0) > 6 * 3_600_000) {
      const fresh = corr.filter((x) => !st.lastCorrection || x.at > st.lastCorrection).slice(0, 5);
      mails.push(`Fixed by itself — ${fresh.map((x) => `${x.what} (${x.action})`).join('; ')}`);
      st.correctionsMailedAt = now;
      st.lastCorrection = corr[0].at;
    }
    db.write('alerts', st);
    const to = this.#o.admins();
    if (!mails.length || !to.length || !mailer.configured) return { sent: 0, mails };
    await mailer.send({ to: to.join(', '), subject: `${this.#o.org}: ${mails.length === 1 ? mails[0].split(' — ')[0] : `${mails.length} things about the server`}`, body: `${mails.join('\n\n')}\n\nSettings → System shows every check.\n— Meridian` });
    return { sent: 1, mails };
  }
}

// ——— The code that runs is the code that was installed ———

const MANIFEST = '.meridian-files.json';

/** Every file of an installed version, with its SHA-256 (the data folder never lives there). */
export function fingerprintDir(dir) {
  const files = {};
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!rel && (e.name === MANIFEST || e.name === 'data')) continue;
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) files[r] = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return files;
}

/** Written when a version is installed. */
export function writeManifest(dir) {
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ at: new Date().toISOString(), files: fingerprintDir(dir) }), { mode: 0o600 });
}

/** Checked before a version is started: { ok, checked, changed: [files] }. A version without a manifest is trusted. */
export function verifyManifest(dir) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch {
    return { ok: true, checked: false, changed: [] };
  }
  const now = fingerprintDir(dir);
  const changed = [...new Set([...Object.keys(m.files), ...Object.keys(now)])].filter((f) => m.files[f] !== now[f]);
  return { ok: !changed.length, checked: true, changed: changed.slice(0, 20) };
}

// ——— A server log that never fills the disk ———
export class ErrorLog {
  #file;
  #max;
  constructor(dataDir, { maxBytes = 10 * 1048576, keep = 3 } = {}) {
    this.#file = path.join(dataDir, 'logs', 'server.log');
    this.#max = maxBytes;
    this.keep = keep;
  }

  get file() {
    return this.#file;
  }

  write(kind, message) {
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true, mode: 0o700 });
      try {
        if (fs.statSync(this.#file).size > this.#max) {
          for (let i = this.keep - 1; i >= 1; i -= 1) if (fs.existsSync(`${this.#file}.${i}`)) fs.renameSync(`${this.#file}.${i}`, `${this.#file}.${i + 1}`);
          fs.renameSync(this.#file, `${this.#file}.1`);
          fs.rmSync(`${this.#file}.${this.keep + 1}`, { force: true });
        }
      } catch {}
      fs.appendFileSync(this.#file, `${new Date().toISOString()} ${kind} ${String(message).replace(/\s+/g, ' ').slice(0, 2000)}\n`, { mode: 0o600 });
    } catch {}
  }

  tail(lines = 100) {
    try {
      return fs.readFileSync(this.#file, 'utf8').trim().split('\n').slice(-lines);
    } catch {
      return [];
    }
  }
}
