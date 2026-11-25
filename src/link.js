/**
 * Linked apps: one sign-in for Kendra and the FTR Credits Command Center. The same file is in both apps.
 *
 * Someone signed in to one app opens the other already signed in, as the same person (their email): by its link in
 * the menu, or by opening it directly (it asks the other app, which answers at once when they are signed in there).
 *
 *   A pass  "v1.<payload>.<signature>": who (email, name), from which app to which, when it expires (60 s), and a
 *           one-time number; signed with HMAC-SHA256 and the key both apps share. Base64url, so it fits in a link.
 *   Trust   only the key an Admin set on both sides (made by one app, pasted in the other). A pass for another app,
 *           expired, used before or not signed with the key is refused. Nobody is created by it: the person must
 *           already have an account, turned on, in the app they arrive at.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PASS_TTL_MS = 60_000;
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (key, data) => createHmac('sha256', Buffer.from(String(key), 'utf8')).update(data).digest();

/** A new shared key: 32 random bytes. */
export const newLinkKey = () => randomBytes(32).toString('base64url');

/** A pass from one app to the other for this person. */
export function makePass({ key, from, to, email = '', name = '', purpose = 'signin', now = Date.now(), ttl = PASS_TTL_MS }) {
  if (!key || String(key).length < 32) throw new Error('The linked apps have no shared key.');
  const payload = b64(JSON.stringify({ v: 1, iss: from, aud: to, p: purpose, email: String(email).toLowerCase(), name: String(name).slice(0, 120), exp: now + ttl, n: randomBytes(12).toString('base64url') }));
  return `v1.${payload}.${b64(sign(key, `v1.${payload}`))}`;
}

/**
 * Who the pass is for, when it is genuine, meant for this app (`me`), from the other (`from`), unexpired and not used
 * before (`used`: a Map of one-time numbers to their expiry, kept by the caller). Throws a plain reason otherwise.
 */
export function readPass(pass, { key, me, from, used, purpose = 'signin', now = Date.now() }) {
  const m = /^v1\.([A-Za-z0-9_-]{10,2000})\.([A-Za-z0-9_-]{43})$/.exec(String(pass ?? ''));
  if (!m || !key) throw new Error('The sign-in link is not valid.');
  const want = sign(key, `v1.${m[1]}`);
  const got = Buffer.from(m[2], 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error('The sign-in link was not made with this app’s shared key.');
  let p;
  try {
    p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('The sign-in link is not valid.');
  }
  if (p.v !== 1 || p.aud !== me || p.iss !== from) throw new Error('The sign-in link is meant for another app.');
  // A sign-in pass opens no directory, and a directory pass signs nobody in.
  if ((p.p ?? 'signin') !== purpose) throw new Error('The pass is meant for something else.');
  if (!(p.exp > now) || p.exp > now + 5 * PASS_TTL_MS) throw new Error('The sign-in link has expired: open the app again from the menu.');
  if (!p.n || used?.has(p.n)) throw new Error('The sign-in link was used already.');
  if (used) {
    used.set(p.n, p.exp);
    for (const [n, exp] of used) if (exp < now) used.delete(n);
  }
  const email = String(p.email ?? '').toLowerCase();
  if (purpose === 'signin' && !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('The sign-in link names nobody.');
  return { email, name: String(p.name ?? '') };
}

/** A path inside this app to land on: same site only ("/…", never "//host" or a full address). */
export const safePath = (p) => {
  const s = String(p ?? '/');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && !/[\r\n]/.test(s) ? s.slice(0, 500) : '/';
};

/** The other app's address, checked: https (or http on this machine), no path tricks. */
export function cleanPartnerUrl(url) {
  const s = String(url ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    throw Object.assign(new Error('The other app’s address is not a web address.'), { status: 400 });
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw Object.assign(new Error('The other app’s address must be https.'), { status: 400 });
  if (u.username || u.password || u.search || u.hash) throw Object.assign(new Error('Give only the other app’s address, like https://ftr.company.com.'), { status: 400 });
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** A page that moves on at once (so a SameSite=Strict cookie set or needed here is sent with the next request). */
export const movePage = (target, title = 'Signing in…', message = '') => {
  const to = String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const say = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${message ? 6 : 0};url=${to}"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark"><title>${say(title)}</title><style>
:root{--bg:#f4f6fb;--card:#fff;--ink:#141a2b;--muted:#5b6478;--line:#e3e7ef;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f1a;--card:#121828;--ink:#eef1f8;--muted:#98a2b8;--line:#232c40;--accent:#7aa2ff}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 12px 40px rgba(20,26,43,.08)}
.ring{width:36px;height:36px;margin:0 auto 18px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--accent);animation:spin .8s linear infinite}
.stop{width:36px;height:36px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-weight:700}
h1{font-size:18px;font-weight:600;margin:0 0 6px}p{margin:0 0 14px;color:var(--muted)}a{color:var(--accent);text-decoration:none;font-weight:500}a:hover{text-decoration:underline}
@keyframes spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.ring{animation:none}}
</style></head><body><main>${message ? '<div class="stop">i</div>' : '<div class="ring" aria-hidden="true"></div>'}<h1>${say(title)}</h1>${message ? `<p>${say(message)}</p>` : '<p>One moment…</p>'}<a href="${to}">Continue</a></main></body></html>`;
};
