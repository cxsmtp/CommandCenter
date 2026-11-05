/**
 * The audit log: every change to settings, people, roles, the catalogue and the software itself, with who made
 * it and when. Each entry carries the hash of the one before (SHA-256), so a removed or edited line shows.
 */
import { createHash } from 'node:crypto';
import { text } from './db.js';

const KEEP = 10_000;

export class Audit {
  #db;
  constructor(db) {
    this.#db = db;
  }

  record(actor, type, what, detail = {}) {
    const all = this.#db.read('audit', []);
    const prev = all.length ? all[all.length - 1].hash : '';
    const entry = { at: new Date().toISOString(), by: actor?.id ?? '', byName: actor?.name ?? (actor ? '' : 'CommandCenter'), type: text(type, 30), what: text(what, 400), detail };
    entry.hash = createHash('sha256').update(prev + JSON.stringify(entry)).digest('hex');
    all.push(entry);
    this.#db.write('audit', all.slice(-KEEP));
    return entry;
  }

  list({ type = '', limit = 200 } = {}) {
    return this.#db.read('audit', []).filter((e) => !type || e.type === type).slice(-limit).reverse();
  }

  /** True when every entry still chains to the one before (the oldest kept entries start the chain). */
  verify() {
    const all = this.#db.read('audit', []);
    for (let i = 1; i < all.length; i += 1) {
      const { hash, ...rest } = all[i];
      if (createHash('sha256').update(all[i - 1].hash + JSON.stringify(rest)).digest('hex') !== hash) return { ok: false, brokenAt: all[i].at };
    }
    return { ok: true, entries: all.length };
  }
}
