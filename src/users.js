/**
 * People, the reporting tree and what each role may do.
 *
 * The tree: VP → Leaders → Team leads → Associates (each person has one manager). What someone can SEE is their own
 * work and everything below them in the tree (an Admin sees everything). What they can DO is their role's
 * permissions, which an Admin can change (Settings → Roles & permissions).
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { fail, text, email as cleanEmail } from './db.js';

export const ROLES = {
  admin: { label: 'Admin', level: 0 },
  vp: { label: 'VP', level: 1 },
  leader: { label: 'Leader', level: 2 },
  team_lead: { label: 'Team lead', level: 3 },
  associate: { label: 'Associate (SE)', level: 4 },
};

export const PERMISSIONS = {
  'opps.create': 'Create opportunities',
  'opps.edit.team': 'Edit the opportunities of people below them',
  'opps.reassign': 'Reassign an opportunity to someone else below them',
  'tenant.logs': 'Download scan logs and troubleshooting bundles',
  'ai.run': 'Run AI Triage and AI Remediation on a POV tenant (within its credit pool)',
  'credits.allocate': 'Set the credit pool of POVs in their team',
  'mail.send': 'Send email from Kendra',
  'users.manage': 'Add and edit people below them',
  'catalog.manage': 'Edit the capability catalogue and its Checkmarx One mapping',
  'templates.manage': 'Make success criteria templates for their team (or everyone)',
  'audit.view': 'See the audit trail: every change and every request by them and their team',
  'settings.manage': 'Change server settings (email server, refresh, defaults)',
  'roles.manage': 'Change what each role may do',
};

/** The permissions there were before roles recorded which ones they had seen. */
const OLD_PERMISSIONS = ['opps.create', 'opps.edit.team', 'opps.reassign', 'tenant.logs', 'ai.run', 'credits.allocate', 'mail.send', 'users.manage', 'catalog.manage', 'settings.manage', 'roles.manage'];

export const DEFAULT_MATRIX = {
  vp: ['opps.create', 'opps.edit.team', 'opps.reassign', 'tenant.logs', 'ai.run', 'credits.allocate', 'mail.send', 'users.manage', 'catalog.manage', 'templates.manage', 'audit.view'],
  leader: ['opps.create', 'opps.edit.team', 'opps.reassign', 'tenant.logs', 'ai.run', 'credits.allocate', 'mail.send', 'users.manage', 'catalog.manage', 'templates.manage', 'audit.view'],
  team_lead: ['opps.create', 'opps.edit.team', 'opps.reassign', 'tenant.logs', 'ai.run', 'credits.allocate', 'mail.send', 'users.manage', 'templates.manage'],
  associate: ['opps.create', 'tenant.logs', 'ai.run', 'mail.send'],
};

const SESSION_MS = 12 * 3600e3;
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(String(password), Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

export const passwordProblem = (p) => (String(p ?? '').length < 10 ? 'Use at least 10 characters for the password.' : '');

export class Users {
  #db;
  #sessions = new Map();
  #dirty = false;
  #timer = null;
  sessionMs = SESSION_MS;
  // However active, a sign-in lasts at most this long.
  static MAX_SESSION_MS = 30 * 86_400_000;

  constructor(db) {
    this.#db = db;
    // Sessions are kept (encrypted, like everything else) so that a restart, an update or a crash signs nobody out.
    const now = Date.now();
    for (const [k, v] of Object.entries(db.read('sessions', {}) ?? {})) if (v?.userId && v.exp > now && (v.created ?? now) + Users.MAX_SESSION_MS > now) this.#sessions.set(k, v);
    this.#timer = setInterval(() => this.flush(), 30_000);
    this.#timer.unref?.();
  }

  /** Save the sessions now (sign-in, sign-out and shutdown save at once; a session's renewal within 30 s). */
  flush(force = false) {
    if (!this.#dirty && !force) return;
    const now = Date.now();
    const out = {};
    for (const [k, v] of this.#sessions) if (v.exp > now) out[k] = v;
    try {
      this.#db.write('sessions', out);
      this.#dirty = false;
    } catch {}
  }

  stop() {
    clearInterval(this.#timer);
    this.flush(true);
  }

  get sessionCount() {
    return this.#sessions.size;
  }

  #all() {
    return this.#db.read('users', []);
  }

  #save(list) {
    this.#db.write('users', list);
  }

  /** The first start: an Admin, with the password printed once in the server log (or CC_ADMIN_PASSWORD). */
  ensureAdmin() {
    if (this.#all().length) return null;
    const password = process.env.CC_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
    const admin = { id: randomUUID(), email: cleanEmail(process.env.CC_ADMIN_EMAIL) || 'admin@meridian.local', name: 'Administrator', role: 'admin', managerId: null, title: '', active: true, password: hashPassword(password), mustChangePassword: !process.env.CC_ADMIN_PASSWORD, prefs: {}, createdAt: new Date().toISOString() };
    this.#save([admin]);
    return { email: admin.email, password };
  }

  list() {
    return this.#all().map(publicUser);
  }

  get(id) {
    const u = this.#all().find((x) => x.id === id);
    return u ? publicUser(u) : null;
  }

  /** Everyone below `id` in the tree (not including them). */
  descendants(id) {
    const all = this.#all();
    const out = new Set();
    const walk = (mid) => {
      for (const u of all) if (u.managerId === mid && !out.has(u.id)) {
        out.add(u.id);
        walk(u.id);
      }
    };
    walk(id);
    return out;
  }

  /** The people `viewer` can see: themselves and everyone below (everyone, for an Admin). */
  visibleIds(viewer) {
    if (!viewer) return new Set();
    if (viewer.role === 'admin') return new Set(this.#all().map((u) => u.id));
    return new Set([viewer.id, ...this.descendants(viewer.id)]);
  }

  /** Is `target` below `viewer` (or the viewer themselves, when `self`)? */
  isBelow(viewer, targetId, { self = false } = {}) {
    if (!viewer) return false;
    if (viewer.role === 'admin') return true;
    if (targetId === viewer.id) return self;
    return this.descendants(viewer.id).has(targetId);
  }

  /** The managers above a person, nearest first. */
  chain(id) {
    const all = this.#all();
    const out = [];
    let cur = all.find((u) => u.id === id);
    const seen = new Set();
    while (cur?.managerId && !seen.has(cur.managerId)) {
      seen.add(cur.managerId);
      cur = all.find((u) => u.id === cur.managerId);
      if (cur) out.push(publicUser(cur));
    }
    return out;
  }

  /** The tree as `viewer` sees it, rooted at them (at the top people, for an Admin). */
  tree(viewer) {
    const all = this.#all().filter((u) => u.active !== false);
    const node = (u) => ({ ...publicUser(u), reports: all.filter((x) => x.managerId === u.id).sort(byLevelName).map(node) });
    if (viewer.role === 'admin') return all.filter((u) => !u.managerId || !all.some((x) => x.id === u.managerId)).sort(byLevelName).map(node);
    const me = all.find((u) => u.id === viewer.id);
    return me ? [node(me)] : [];
  }

  can(user, permission, settings) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    // A permission added after the roles were last saved follows the default until an Admin decides.
    const decided = settings?.roles && (settings.rolesKnown ?? OLD_PERMISSIONS).includes(permission);
    const matrix = decided ? settings.roles : DEFAULT_MATRIX;
    return (matrix[user.role] ?? DEFAULT_MATRIX[user.role] ?? []).includes(permission);
  }

  permissionsOf(user, settings) {
    return Object.keys(PERMISSIONS).filter((p) => this.can(user, p, settings));
  }

  /**
   * Add a person. Only below oneself (an Admin anywhere), with a role below one's own, under a manager whose role is
   * above theirs.
   */
  add(actor, { email, name, role, managerId, title, password, region }) {
    const all = this.#all();
    const address = cleanEmail(email);
    if (!address) throw fail(400, 'Give a valid email address.');
    if (all.some((u) => u.email === address)) throw fail(409, `${address} already has an account.`);
    if (!ROLES[role] || role === 'admin' && actor.role !== 'admin') throw fail(400, 'Choose a role.');
    const manager = managerId ? all.find((u) => u.id === managerId) : null;
    this.#checkPlacement(actor, role, manager);
    const problem = passwordProblem(password);
    if (problem) throw fail(400, problem);
    const user = { id: randomUUID(), email: address, name: text(name, 120) || address, role, managerId: manager?.id ?? null, title: text(title, 120), region: text(region, 60), active: true, password: hashPassword(password), mustChangePassword: true, prefs: {}, createdAt: new Date().toISOString(), createdBy: actor.id };
    all.push(user);
    this.#save(all);
    return publicUser(user);
  }

  #checkPlacement(actor, role, manager) {
    if (actor.role !== 'admin') {
      if (ROLES[role].level <= ROLES[actor.role].level) throw fail(403, 'You can only add people with a role below yours.');
      if (!manager || !(manager.id === actor.id || this.descendants(actor.id).has(manager.id))) throw fail(403, 'Their manager must be you or someone in your team.');
    }
    if (manager && role !== 'admin' && ROLES[manager.role].level >= ROLES[role].level && manager.role !== 'admin') throw fail(400, `A ${ROLES[role].label} cannot report to a ${ROLES[manager.role].label}.`);
  }

  update(actor, id, changes) {
    const all = this.#all();
    const user = all.find((u) => u.id === id);
    if (!user) throw fail(404, 'No such person.');
    const self = actor.id === id;
    if (!self && !this.isBelow(actor, id)) throw fail(403, 'You can only change people in your team.');
    // Your own profile: name, title, preferences, password. Your team: also role, manager, email, active.
    if ('name' in changes) user.name = text(changes.name, 120) || user.email;
    if ('title' in changes) user.title = text(changes.title, 120);
    if ('region' in changes) user.region = text(changes.region, 60);
    if (changes.prefs && typeof changes.prefs === 'object') user.prefs = { ...user.prefs, ...cleanPrefs(changes.prefs) };
    if (!self) {
      if ('email' in changes) {
        const address = cleanEmail(changes.email);
        if (!address) throw fail(400, 'Give a valid email address.');
        if (all.some((u) => u !== user && u.email === address)) throw fail(409, `${address} already has an account.`);
        user.email = address;
      }
      const role = changes.role ?? user.role;
      if (!ROLES[role] || (role === 'admin' && actor.role !== 'admin')) throw fail(400, 'Choose a role.');
      const managerId = 'managerId' in changes ? changes.managerId || null : user.managerId;
      if (managerId === id || this.descendants(id).has(managerId)) throw fail(400, 'Someone cannot report to themselves or to someone in their own team.');
      const manager = managerId ? all.find((u) => u.id === managerId) : null;
      if (managerId && !manager) throw fail(400, 'No such manager.');
      if (role !== user.role || managerId !== user.managerId) this.#checkPlacement(actor, role, manager);
      user.role = role;
      user.managerId = manager?.id ?? null;
      if ('active' in changes) user.active = changes.active !== false;
      if (changes.password) {
        const problem = passwordProblem(changes.password);
        if (problem) throw fail(400, problem);
        user.password = hashPassword(changes.password);
        user.mustChangePassword = true;
        this.endSessions(id);
      }
    }
    this.#save(all);
    return publicUser(user);
  }

  changePassword(id, current, next, keepToken = null) {
    const all = this.#all();
    const user = all.find((u) => u.id === id);
    if (!user || !checkPassword(current, user.password)) throw fail(400, 'The current password is not right.');
    const problem = passwordProblem(next);
    if (problem) throw fail(400, problem);
    user.password = hashPassword(next);
    user.mustChangePassword = false;
    this.#save(all);
    // Signed in elsewhere with the old password: those sessions end; this one goes on.
    this.endSessions(id, keepToken);
  }

  /** Remove a person: their reports move up to their manager, their opportunities are handed over by the caller. */
  remove(actor, id) {
    if (actor.id === id) throw fail(400, 'You cannot remove yourself.');
    if (!this.isBelow(actor, id)) throw fail(403, 'You can only remove people in your team.');
    const all = this.#all();
    const user = all.find((u) => u.id === id);
    if (!user) throw fail(404, 'No such person.');
    if (user.role === 'admin' && all.filter((u) => u.role === 'admin').length === 1) throw fail(400, 'The last Admin cannot be removed.');
    for (const u of all) if (u.managerId === id) u.managerId = user.managerId;
    this.#save(all.filter((u) => u.id !== id));
    this.endSessions(id);
    return publicUser(user);
  }

  // ——— Sessions ———
  signIn(address, password) {
    const user = this.#all().find((u) => u.email === cleanEmail(address));
    // The same work whether or not the account exists.
    const ok = checkPassword(password, user?.password ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!user || !ok || user.active === false) throw fail(401, 'That email and password do not match.');
    const token = randomBytes(32).toString('base64url');
    this.#sessions.set(hashToken(token), { userId: user.id, exp: Date.now() + this.sessionMs, created: Date.now() });
    this.#dirty = true;
    this.flush();
    return { token, user: publicUser(user) };
  }

  /** A session for an active person the linked app vouched for (a checked pass), by email. Nobody is created. */
  signInLinked(address) {
    const user = this.#all().find((u) => u.email === cleanEmail(address));
    if (!user || user.active === false) throw fail(403, user ? 'Your Kendra account is turned off.' : 'You have no Kendra account yet: ask an Admin to add you with the same email.');
    // Signed in by the linked app, as with single sign-on: a password of their own is not needed for this.
    if (user.mustChangePassword) user.mustChangePassword = false;
    const token = randomBytes(32).toString('base64url');
    this.#sessions.set(hashToken(token), { userId: user.id, exp: Date.now() + this.sessionMs, created: Date.now(), via: 'linked' });
    this.#dirty = true;
    this.flush();
    return { token, user: publicUser(user) };
  }

  fromToken(token, { slide = true } = {}) {
    if (!token) return null;
    const s = this.#sessions.get(hashToken(token));
    const now = Date.now();
    if (!s || s.exp < now || (s.created ?? now) + Users.MAX_SESSION_MS < now) return null;
    // Slide the expiry, saved within 30 s (a minute's renewals are one write).
    if (slide && now + this.sessionMs - s.exp > 60_000) {
      s.exp = now + this.sessionMs;
      this.#dirty = true;
    }
    const user = this.#all().find((u) => u.id === s.userId);
    return user && user.active !== false ? publicUser(user) : null;
  }

  /** When the current session ends (for the browser's warning). */
  expiresAt(token) {
    const s = this.#sessions.get(hashToken(token ?? ''));
    return s ? new Date(Math.min(s.exp, (s.created ?? Date.now()) + Users.MAX_SESSION_MS)).toISOString() : null;
  }

  signOut(token) {
    this.#sessions.delete(hashToken(token ?? ''));
    this.#dirty = true;
    this.flush();
  }

  /** End a person's sessions (all but `keepToken`'s, when given). */
  endSessions(userId, keepToken = null) {
    const keep = keepToken ? hashToken(keepToken) : null;
    for (const [k, s] of this.#sessions) if (s.userId === userId && k !== keep) this.#sessions.delete(k);
    this.#dirty = true;
    this.flush();
  }
}

export const THEMES = ['orbit', 'maison', 'calibre', 'joaillier', 'hypercar', 'command', 'cabin', 'circuit', 'residence', 'chronometer', 'signal', 'studio', 'classic'];
function cleanPrefs(p) {
  const out = {};
  if (THEMES.includes(p.theme)) out.theme = p.theme;
  if (['auto', 'light', 'dark'].includes(p.mode)) out.mode = p.mode;
  if (['cards', 'table'].includes(p.view)) out.view = p.view;
  if (p.view === 'auto') out.view = undefined;
  if (['side', 'top'].includes(p.nav)) out.nav = p.nav;
  if (['insights', 'dashboard'].includes(p.home)) out.home = p.home;
  if (p.home === 'auto') out.home = undefined;
  return out;
}

const byLevelName = (a, b) => ROLES[a.role].level - ROLES[b.role].level || a.name.localeCompare(b.name);

export function publicUser(u) {
  const { password, ...safe } = u;
  return { ...safe, roleLabel: ROLES[u.role]?.label ?? u.role };
}
