/**
 * Backups: a copy of the data folder's own records, taken by itself every few hours, before every update and restore,
 * and on request. Each one is checked after it is taken (every record opened with the key, every file's checksum
 * written to its manifest), so a backup that could not be restored is known the day it is made, not the day it is
 * needed.
 *
 *   - The records are already encrypted; the key is never put in a backup. Keep the key (CC_SECRET / CC_SECRET_FILE,
 *     or data/secret.key) somewhere else: a backup cannot be read without it, by anyone.
 *   - CC_BACKUP_DIR (a mounted network share, another disk): every backup is copied there too, so losing the server's
 *     disk does not lose the backups.
 *   - Kept: every automatic backup of the last 2 days, then one a day for 30 days; the last 5 taken before an update
 *     or a restore; the last 10 taken by hand.
 *   - Not copied: the tenant snapshots (Checkmarx One is the source of truth; they are read again within minutes),
 *     the app versions, other backups, temporary and damaged files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Vault } from './vault.js';

const SKIP_TOP = new Set(['app', 'backups', 'snapshots', 'secret.key']);
const SKIP_FILE = /\.(tmp|prev)$|\.damaged-\d+$/;
const DAY = 86_400_000;

export class Backups {
  #dir;
  #vault;
  #offsite;
  #timer = null;
  lastError = null;

  constructor({ dataDir, vault = null, offsiteDir = process.env.CC_BACKUP_DIR || '' }) {
    this.#dir = dataDir;
    this.#vault = vault ?? new Vault(dataDir);
    this.#offsite = offsiteDir;
  }

  get root() {
    return path.join(this.#dir, 'backups');
  }

  get offsite() {
    return this.#offsite || null;
  }

  /** Take one now; returns its name. Throws when it could not be written. */
  take(label = 'manual', { version = '' } = {}) {
    const at = new Date();
    const name = `${at.toISOString().replace(/[:.]/g, '-')}-${String(label).replace(/[^\w.-]+/g, '_')}`;
    const dest = path.join(this.root, name);
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    const files = {};
    const copy = (from, to, rel = '') => {
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if ((!rel && SKIP_TOP.has(entry.name)) || SKIP_FILE.test(entry.name)) continue;
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
          copy(src, dst, r);
        } else if (entry.isFile()) {
          fs.copyFileSync(src, dst);
          files[r] = { size: fs.statSync(dst).size, sha256: sha256(dst) };
        }
      }
    };
    copy(this.#dir, dest);
    const check = this.#check(dest, files);
    const manifest = { app: 'Meridian', at: at.toISOString(), label, version, key: this.#vault.fingerprint, files, verified: check.ok, problems: check.problems };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 1), { mode: 0o600 });
    if (this.#offsite) {
      try {
        fs.cpSync(dest, path.join(this.#offsite, name), { recursive: true });
        this.#prune(this.#offsite);
      } catch (error) {
        this.lastError = { at: at.toISOString(), message: `Copy to ${this.#offsite} failed: ${error.message}` };
      }
    }
    this.#prune(this.root);
    return name;
  }

  /** Every record opens with the key and every file matches its checksum. */
  #check(dir, files) {
    const problems = [];
    for (const [rel, f] of Object.entries(files)) {
      const file = path.join(dir, rel);
      try {
        if (sha256(file) !== f.sha256) throw new Error('checksum differs');
        if (/\.(json|html)$/.test(rel)) {
          const plain = this.#vault.decrypt(fs.readFileSync(file));
          if (rel.endsWith('.json')) JSON.parse(plain.toString('utf8'));
        }
      } catch (error) {
        problems.push(`${rel}: ${error.message}`);
      }
    }
    return { ok: !problems.length, problems: problems.slice(0, 20) };
  }

  /** Check an existing backup again (e.g. before restoring it). */
  verify(name) {
    const dir = this.#path(name);
    const m = this.manifest(name);
    if (!m) return { ok: false, problems: ['No manifest: taken by an older version, cannot be checked.'] };
    if (m.key !== this.#vault.fingerprint) return { ok: false, problems: [`Taken with another key (${m.key}); this server uses ${this.#vault.fingerprint}.`] };
    return this.#check(dir, m.files);
  }

  manifest(name) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.#path(name), 'manifest.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  #path(name) {
    if (!/^[\w.-]+$/.test(String(name))) throw Object.assign(new Error('No such backup.'), { status: 404 });
    const dir = path.join(this.root, name);
    if (!fs.existsSync(dir)) throw Object.assign(new Error('No such backup.'), { status: 404 });
    return dir;
  }

  list() {
    let names = [];
    try {
      names = fs.readdirSync(this.root).sort().reverse();
    } catch {}
    return names.map((name) => {
      const m = this.manifest(name);
      const files = m ? Object.values(m.files) : [];
      return {
        name,
        at: m?.at ?? null,
        label: m?.label ?? name.replace(/^[\dT-]+Z-/, ''),
        version: m?.version ?? '',
        files: files.length,
        bytes: files.reduce((n, f) => n + f.size, 0),
        verified: m ? m.verified : null,
        problems: m?.problems ?? [],
        sameKey: m ? m.key === this.#vault.fingerprint : null,
        offsite: this.#offsite ? fs.existsSync(path.join(this.#offsite, name)) : null,
      };
    });
  }

  /**
   * Put a backup's records back. A backup of the data as it is now is taken first, so a restore can be undone.
   * The records in memory are stale afterwards: the caller restarts the server.
   */
  restore(name, { version = '' } = {}) {
    const dir = this.#path(name);
    const check = this.verify(name);
    if (!check.ok) throw Object.assign(new Error(`This backup cannot be restored: ${check.problems.join('; ')}`), { status: 409 });
    const undo = this.take('before-restore', { version });
    const m = this.manifest(name);
    for (const rel of Object.keys(m.files)) {
      const dst = path.join(this.#dir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
      const tmp = `${dst}.restore.tmp`;
      fs.copyFileSync(path.join(dir, rel), tmp);
      fs.renameSync(tmp, dst);
    }
    return { restored: name, undo };
  }

  /** Every `hours`, an automatic backup (and one at start when the last is older than that). */
  start({ hours = Number(process.env.CC_BACKUP_HOURS) || 6, version = '' } = {}) {
    const every = Math.max(1, hours) * 3_600_000;
    const tick = () => {
      const last = this.list().find((b) => b.label === 'auto');
      if (last?.at && Date.now() - Date.parse(last.at) < every - 60_000) return;
      try {
        this.take('auto', { version });
        this.lastError = null;
      } catch (error) {
        this.lastError = { at: new Date().toISOString(), message: error.message };
        console.error(`Automatic backup failed: ${error.message}`);
      }
    };
    setTimeout(tick, 30_000).unref();
    this.#timer = setInterval(tick, Math.min(every, 3_600_000));
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
  }

  /** Free space on the data volume, when the platform says (for the health checks). */
  freeBytes() {
    try {
      const s = fs.statfsSync(this.#dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }

  #prune(root) {
    let names;
    try {
      names = fs.readdirSync(root).sort().reverse();
    } catch {
      return;
    }
    const now = Date.now();
    const keep = new Set();
    const days = new Set();
    const counts = {};
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.*)$/.exec(name);
      if (!m) {
        keep.add(name);
        continue;
      }
      const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
      const label = m[6];
      if (label === 'auto') {
        if (now - at < 2 * DAY) keep.add(name);
        else if (now - at < 30 * DAY && !days.has(m[1])) {
          days.add(m[1]);
          keep.add(name);
        }
        continue;
      }
      const kind = label.startsWith('before-') ? 'before' : 'manual';
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (counts[kind] <= (kind === 'before' ? 5 : 10)) keep.add(name);
    }
    for (const name of names) if (!keep.has(name)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
