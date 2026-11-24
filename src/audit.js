/**
 * The audit log of changes, in words: settings, people, roles, the catalogue, templates, opportunities, emails,
 * Salesforce, the software itself. Written to the audit trail (trail.js), which keeps it for good, chained and
 * encrypted. Entries from the earlier audit.json are brought into the trail once, in their order.
 */
import { text } from './db.js';

export class Audit {
  #db;
  #trail;
  constructor(db, trail) {
    this.#db = db;
    this.#trail = trail;
    const old = db.read('audit', []);
    if (old.length && trail.importOld(old)) db.write('audit', []);
  }

  record(actor, type, what, detail = {}, { opp = null } = {}) {
    return this.#trail.change({
      by: actor?.id ?? '',
      byName: actor?.name ?? (actor ? '' : 'Meridian'),
      role: actor?.role ?? '',
      type: text(type, 30),
      what: text(what, 400),
      ...(opp ? { opp: opp.id, customer: opp.customer } : {}),
      detail,
    });
  }

  list({ type = '', limit = 200 } = {}) {
    return this.#trail.query('changes', { match: (r) => !type || r.type === type, limit }).records;
  }

  /** Whether every kept change still chains to the one before it. */
  verify() {
    const v = this.#trail.verify('changes');
    return { ok: v.ok, entries: v.records, from: v.from, brokenAt: v.brokenAt, reason: v.reason };
  }
}
