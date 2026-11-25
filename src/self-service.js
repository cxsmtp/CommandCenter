/**
 * What people do for themselves, as in the FTR command center:
 *   links     one-time email links: "Forgot your password?" and joining with a work address. The secret goes after # in
 *             the link (never sent to a server or in a Referer); only its SHA-256 is kept, with the address, the kind
 *             and the expiry (30 minutes). A newer link replaces the older one; a used one is gone.
 *   help      support cases and enhancement requests, kept here and emailed to the address the Admin chose.
 *   brand     the app's name line, logo and browser icon (images kept here, up to 200 KB).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fail, text } from './db.js';

export const LINK_TTL_MS = 30 * 60_000;
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

export class Links {
  #db;
  constructor(db) {
    this.#db = db;
  }
  #all() {
    const now = Date.now();
    return this.#db.read('links', []).filter((l) => l.exp > now);
  }
  /** At most three links an hour for one address and kind. */
  maySend(kind, email) {
    return this.#db.read('links', []).filter((l) => l.kind === kind && l.email === email && Date.now() - l.at < 3600_000).length < 3;
  }
  issue(kind, email, extra = {}) {
    const token = randomBytes(32).toString('base64url');
    const at = Date.now();
    // Expired links go; the history of the last hour stays for the limit; an older live link of the same kind is replaced.
    const keep = this.#db.read('links', []).filter((l) => Date.now() - l.at < 3600_000).map((l) => (l.kind === kind && l.email === email ? { ...l, exp: 0 } : l));
    keep.push({ id: randomUUID(), kind, email, hash: sha(token), at, exp: at + LINK_TTL_MS, ...extra });
    this.#db.write('links', keep);
    return { token, exp: at + LINK_TTL_MS };
  }
  check(kind, token) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token ?? ''))) return null;
    return this.#all().find((l) => l.kind === kind && l.hash === sha(token)) ?? null;
  }
  consume(token) {
    const h = sha(token);
    this.#db.write('links', this.#db.read('links', []).map((l) => (l.hash === h ? { ...l, exp: 0 } : l)));
  }
}

/** Support cases and enhancement requests. */
export class Help {
  #db;
  constructor(db) {
    this.#db = db;
  }
  add(user, { kind, subject, details }) {
    const s = text(subject, 160);
    const d = text(details, 6000);
    if (!s) throw fail(400, 'Say in a line what it is about.');
    if (!d) throw fail(400, 'Describe it: what you did, what you expected, what happened.');
    const row = { id: randomUUID(), at: new Date().toISOString(), kind: kind === 'idea' ? 'idea' : 'case', subject: s, details: d, by: user.id, byName: user.name, byEmail: user.email, mailed: null, error: '' };
    const all = this.#db.read('help', []);
    all.push(row);
    this.#db.write('help', all.slice(-2000));
    return row;
  }
  mark(id, patch) {
    const all = this.#db.read('help', []);
    const r = all.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    this.#db.write('help', all);
    return r;
  }
  list({ userId = null } = {}) {
    return this.#db.read('help', []).filter((r) => !userId || r.by === userId).reverse().slice(0, 200);
  }
}

/** The logo and browser icon: an image sent as a data: address (PNG, JPEG, SVG or WebP, up to 200 KB). */
export function imageFrom(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|svg\+xml|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw fail(400, 'Choose a PNG, JPEG, SVG or WebP image.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 200 * 1024) throw fail(400, 'The image is larger than 200 KB.');
  // An SVG with script or event handlers is refused: it is shown on every page.
  if (m[1] === 'image/svg+xml' && /<script|\son\w+\s*=|javascript:/i.test(bytes.toString('utf8'))) throw fail(400, 'That SVG has script in it.');
  return { type: m[1], b64: m[2], at: new Date().toISOString() };
}

/** "j***@acme.com": enough to recognise an address, not to learn it. */
export const maskEmail = (e) => String(e).replace(/^(.)[^@]*(@.*)$/, '$1***$2');
