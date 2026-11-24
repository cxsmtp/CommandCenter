/**
 * Storage: one JSON file per collection in the data folder, encrypted (see vault.js), written atomically and flushed
 * to disk, with the previous copy kept beside it. Sized for a team's worth of opportunities (hundreds), where a
 * database would only add moving parts.
 *
 * Self-repair: a collection that cannot be read (damaged, cut short, changed by hand) is restored from its previous
 * copy, else from the newest backup that holds it; each repair is recorded and shown under Settings → System.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from './vault.js';

export const fail = (status, message) => Object.assign(new Error(message), { status });
export const text = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
export const dateOnly = (v) => {
  const s = text(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) ? s : '';
};
export const isoOrNull = (v) => (v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
export const httpUrl = (v) => {
  const s = text(v, 2000);
  if (!s) return '';
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
};
export const email = (v) => {
  const s = text(v, 254).toLowerCase();
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s) ? s : '';
};

const CRITICAL = new Set(['users', 'opportunities', 'settings']);
/** A problem with the data itself: restarting will not help, so the launcher waits and never rolls back (exit 78). */
export const STATE_EXIT = 78;
export function stateError(message) {
  return Object.assign(new Error(message), { code: 'STATE', exitCode: STATE_EXIT });
}

export class Db {
  #dir;
  #cache = new Map();
  #vault;
  /** Repairs made since the start: { name, from, at, error }. */
  repairs = [];

  constructor(dir) {
    this.#dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#vault = new Vault(dir);
    this.#guardKey();
  }

  /**
   * The data's key must be the key the data was written with. If it is not (CC_SECRET missing or changed, a lost
   * secret.key), nothing could be read and Meridian would start empty with a new Admin: it refuses to start instead.
   */
  #guardKey() {
    const mark = path.join(this.#dir, 'key.fingerprint');
    const users = path.join(this.#dir, 'users.json');
    let known = '';
    try {
      known = fs.readFileSync(mark, 'utf8').trim();
    } catch {}
    if (known && known !== this.#vault.fingerprint) throw stateError(`The encryption key is not the one this data was written with (expected key ${known}, got ${this.#vault.fingerprint} from ${this.#vault.source}). Start Meridian with its original key: the same CC_SECRET, CC_SECRET_FILE or data/secret.key as before. Nothing was changed.`);
    if (!known && fs.existsSync(users)) {
      // Data from before the fingerprint was kept: the key must at least open the accounts.
      try {
        this.#vault.readJson(users);
      } catch {
        let opened = false;
        try {
          this.#vault.readJson(`${users}.prev`);
          opened = true;
        } catch {}
        if (!opened) throw stateError(`The encryption key (${this.#vault.source}) cannot open this data's accounts. Start Meridian with its original key: the same CC_SECRET, CC_SECRET_FILE or data/secret.key as before. Nothing was changed.`);
      }
    }
    if (!known) fs.writeFileSync(mark, `${this.#vault.fingerprint}\n`, { mode: 0o600 });
  }

  get dir() {
    return this.#dir;
  }

  get vault() {
    return this.#vault;
  }

  read(name, fallback) {
    if (this.#cache.has(name)) return this.#cache.get(name);
    const file = path.join(this.#dir, `${name}.json`);
    let value = fallback;
    if (fs.existsSync(file)) {
      try {
        value = this.#vault.readJson(file);
      } catch (error) {
        value = this.#repair(name, file, error, fallback);
      }
    }
    this.#cache.set(name, value);
    return value;
  }

  #repair(name, file, error, fallback) {
    const candidates = [[`${file}.prev`, 'its previous copy']];
    try {
      const root = path.join(this.#dir, 'backups');
      for (const b of fs.readdirSync(root).sort().reverse()) candidates.push([path.join(root, b, `${name}.json`), `backup ${b}`]);
    } catch {}
    for (const [from, label] of candidates) {
      try {
        const value = this.#vault.readJson(from);
        fs.copyFileSync(file, `${file}.damaged-${Date.now()}`);
        this.#vault.writeFile(file, JSON.stringify(value), { keepPrevious: false });
        this.repairs.push({ name, from: label, at: new Date().toISOString(), error: String(error.message).slice(0, 200) });
        console.error(`Repaired ${name}.json from ${label} (${error.message})`);
        return value;
      } catch {}
    }
    this.repairs.push({ name, from: null, at: new Date().toISOString(), error: String(error.message).slice(0, 200) });
    // Accounts, POVs and settings are never replaced by an empty list: Meridian stops and says why instead.
    if (CRITICAL.has(name)) throw stateError(`${name}.json cannot be read and no good copy was found (its previous copy and every backup were tried): ${error.message}. Restore a backup of the data folder, or put ${name}.json back. Nothing was changed.`);
    console.error(`Could not read ${name}.json and found no good copy (${error.message}); it was set aside.`);
    try {
      fs.renameSync(file, `${file}.damaged-${Date.now()}`);
    } catch {}
    return fallback;
  }

  write(name, value) {
    this.#cache.set(name, value);
    this.#vault.writeFile(path.join(this.#dir, `${name}.json`), JSON.stringify(value));
  }

  /** Forget what is held in memory (after a restore). */
  reload() {
    this.#cache.clear();
  }

  seal(plain) {
    return this.#vault.seal(plain);
  }

  open(sealed) {
    return this.#vault.open(sealed);
  }
}
