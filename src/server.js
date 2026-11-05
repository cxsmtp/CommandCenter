/**
 * CommandCenter: discovery → technical sessions → POV → outcome, for every SE in a team, in one place.
 *
 * One dependency (nodemailer). Everything it keeps lives in the data folder (CC_DATA_DIR, /data in the container).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, fail, text, email as cleanEmail } from './db.js';
import { Users, ROLES, PERMISSIONS, DEFAULT_MATRIX, THEMES } from './users.js';
import { Catalog, CATEGORIES, tenantFacts, evaluate, provingScans } from './catalog.js';
import { Opportunities, STAGES, CRITERION_STATUS, SESSION_TYPES, publicOpp, progressOf, wordsOf, isMuted } from './opportunities.js';
import { Monitor } from './monitor.js';
import { Mailer, TEMPLATES, draft, cleanMessage, toEml } from './mail.js';
import { successReport } from './report.js';
import { eventsOf, scanLog, peopleActivity, SCAN_WINDOW_DAYS } from './collector.js';
import { finalDeck } from './deck.js';
import { Updater, RESTART_CODE } from './updates.js';
import { Audit } from './audit.js';
import { X509Certificate } from 'node:crypto';
import { spawn } from 'node:child_process';
import { criteriaForecast, creditsForecast, activityForecast, portfolioForecast } from './forecast.js';
import { resultsPage } from './results.js';
import { platformView, AI_POWERED, STATE as PLATFORM_STATE } from './platform.js';
import { randomBytes } from 'node:crypto';
import { CxClient } from './cxone/client.js';
import { deriveConnection, publicConnection, scrubText } from './cxone/endpoints.js';
import { tenantColours } from '../public/tenant-colour.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const STARTED_AT = new Date().toISOString();
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const MAX_BODY = 512 * 1024;
const DAY = 86_400_000;
const KINDS = new Set(['stakeholders', 'sessions', 'notes', 'tasks', 'criteria']);
const POLLED_STAGES = new Set(['pov']);
const DEFAULT_SETTINGS = { orgName: 'Command Center', refreshMinutes: 10, defaultTheme: 'orbit', defaultMode: 'dark', weeklyDrafts: true };

export function createApp({ dataDir = process.env.CC_DATA_DIR || path.join(ROOT, 'data'), collectFn, verifyKey = defaultVerify, secureCookies = process.env.CC_SECURE_COOKIES === 'true', updaterOptions = null } = {}) {
  const db = new Db(dataDir);
  const users = new Users(db);
  const catalog = new Catalog(db);
  const opps = new Opportunities(db, { users, catalog });
  const mailer = new Mailer(db);
  // What the page may see of the settings: never the email server's or the proxy's secrets.
  const settings = () => {
    const { smtp, network, lastWeeklyDrafts, ...rest } = { ...DEFAULT_SETTINGS, ...db.read('settings', {}) };
    return { ...rest, security: { sessionHours: 12, maxAttempts: 10, ...(rest.security ?? {}) } };
  };
  const fullSettings = () => db.read('settings', {});
  const firstAdmin = users.ensureAdmin();
  const audit = new Audit(db);
  const updater = new Updater({ dataDir, currentVersion: VERSION, ...(updaterOptions ?? {}) });
  users.sessionMs = (settings().security.sessionHours || 12) * 3600e3;
  const restartServer = (actor, why) => {
    if (!updater.launched) throw fail(409, 'Restarting needs the launcher: start CommandCenter with "npm start" or the container image.');
    audit.record(actor, 'system', `Restarted the server (${why})`);
    setTimeout(() => process.exit(RESTART_CODE), 300);
  };

  const monitor = new Monitor({
    source: {
      ids: () => opps.raw().filter((o) => o.tenant).map((o) => o.id),
      polled: (id) => POLLED_STAGES.has(opps.get(id)?.stage),
      connection: (id) => opps.connection(id),
    },
    dataDir,
    intervalMinutes: Number(process.env.REFRESH_MINUTES) || settings().refreshMinutes,
    ...(collectFn ? { collectFn } : {}),
  });

  // ——— Live updates (server-sent events), each client told only about what it may see ———
  const clients = new Set();
  const notify = (event) => {
    const opp = event.id ? opps.get(event.id) : null;
    const line = `event: update\ndata: ${JSON.stringify({ id: event.id ?? null, refreshing: Boolean(event.refreshing) })}\n\n`;
    for (const c of clients) if (!opp || opps.canView(users.get(c.userId), opp)) c.res.write(line);
  };
  monitor.on('update', notify);

  const checkKey = async (connection) => {
    try {
      return await verifyKey(connection);
    } catch (error) {
      throw fail(400, `Checkmarx One did not accept that key: ${scrubText(error.message)}`);
    }
  };

  // ——— What the dashboards show of one opportunity ———
  const colours = () => tenantColours(opps.raw().map((o) => o.id));
  const evidenceOf = (opp) => {
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    const facts = snap ? tenantFacts(snap) : null;
    const words = wordsOf(opp);
    const out = {};
    for (const c of opp.criteria ?? []) {
      const cap = c.capabilityId ? catalog.get(c.capabilityId) : null;
      const own = { engines: c.engines ?? [], origins: c.origins ?? [], keywords: c.keywords ?? [] };
      const rule = { detect: cap ? { ...cap.detect, engines: [...(cap.detect.engines ?? []), ...own.engines], origins: [...(cap.detect.origins ?? []), ...own.origins], keywords: [...(cap.detect.keywords ?? []), ...own.keywords] } : own };
      out[c.id] = evaluate(rule, facts, words);
    }
    return out;
  };

  function alertsOf(opp, live, now = Date.now()) {
    const out = [];
    const add = (level, what) => out.push({ level, what });
    const pov = opp.stage === 'pov';
    if (live?.health === 'failed') add('bad', `Cannot read the tenant: ${live.error?.message ?? ''}`);
    const s = live?.summary;
    if (pov && s) {
      const mutedProjects = new Set(opp.mute?.projects ?? []);
      const failed = (monitor.snapshot(opp.id)?.scans ?? []).filter((x) => /^failed$/i.test(x.status) && now - Date.parse(x.updatedAt ?? x.createdAt) <= DAY && !mutedProjects.has(x.projectId));
      if (failed.length) add('bad', `${failed.length} scan${failed.length > 1 ? 's' : ''} failed in the last 24 hours`);
      if (!s.lastActivityAt || now - Date.parse(s.lastActivityAt) > 3 * DAY) add('warn', 'No scan activity for 3 days');
    }
    if (opp.tenant?.keyExpiresAt) {
      const left = Math.ceil((Date.parse(opp.tenant.keyExpiresAt) - now) / DAY);
      if (left < 0) add('bad', 'The API key has expired');
      else if (left <= 14) add('warn', `The API key expires in ${left} day${left === 1 ? '' : 's'}`);
    }
    if (pov && opp.endDate) {
      const left = Math.ceil((Date.parse(`${opp.endDate}T23:59:59Z`) - now) / DAY);
      const p = progressOf(opp);
      if (left < 0) add('bad', `POV end date passed ${-left} day${left === -1 ? '' : 's'} ago`);
      else if (left <= 7 && p.percent < 100) add('warn', `${left} day${left === 1 ? '' : 's'} left with ${p.total - p.met} criteria to go`);
    }
    if (pov && !opp.criteria?.length) add('warn', 'No success criteria yet');
    const overdue = (opp.tasks ?? []).filter((t) => !t.done && t.due && Date.parse(`${t.due}T23:59:59Z`) < now).length;
    if (overdue) add('warn', `${overdue} overdue task${overdue > 1 ? 's' : ''}`);
    return out;
  }

  function row(opp, now = Date.now(), colour = colours()[opp.id]) {
    const live = opp.tenant ? monitor.live(opp.id, now) : null;
    const owner = users.get(opp.ownerId);
    const muted = isMuted(opp, now);
    const nextTask = (opp.tasks ?? []).filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))[0] ?? null;
    const lastNote = (opp.notes ?? []).reduce((m, n) => (n.at > m ? n.at : m), '');
    return {
      id: opp.id,
      name: opp.name,
      customer: opp.customer,
      stage: opp.stage,
      povResult: opp.povResult ?? '',
      colour,
      owner: owner ? { id: owner.id, name: owner.name, role: owner.role } : { id: opp.ownerId, name: 'Former member' },
      managers: users.chain(opp.ownerId).map((m) => ({ id: m.id, name: m.name })),
      startDate: opp.startDate,
      endDate: opp.endDate,
      daysLeft: opp.endDate ? Math.ceil((Date.parse(`${opp.endDate}T23:59:59Z`) - now) / DAY) : null,
      salesforceUrl: opp.salesforceUrl,
      sharepointUrl: opp.sharepointUrl,
      amount: opp.amount,
      tenant: publicOpp(opp).tenant,
      progress: progressOf(opp),
      live,
      alerts: alertsOf(opp, live, now),
      muted,
      mute: opp.mute,
      nextTask,
      forecast: {
        criteria: ['pov', 'completed'].includes(opp.stage) ? criteriaForecast(opp, now) : null,
        credits: live?.summary ? creditsForecast(live.summary, monitor.history(opp.id), now) : null,
        activity: live?.summary ? activityForecast(live.summary) : null,
      },
      lastNoteAt: lastNote || null,
      sessions: (opp.sessions ?? []).length,
      updatedAt: opp.updatedAt,
    };
  }

  function overview(viewer, q) {
    const now = Date.now();
    const visible = opps.visible(viewer);
    const owner = q.get('owner');
    const scope = owner ? new Set([owner, ...users.descendants(owner)]) : null;
    const list = visible.filter((o) => !scope || scope.has(o.ownerId));
    const col = colours();
    const rows = list.map((o) => row(o, now, col[o.id]));
    const live = rows.filter((r) => r.live?.summary);
    const sum = (f) => live.reduce((n, r) => n + (f(r.live.summary) ?? 0), 0);
    const byStage = Object.fromEntries(Object.keys(STAGES).map((k) => [k, rows.filter((r) => r.stage === k).length]));
    const totals = {
      opportunities: rows.length,
      byStage,
      povs: byStage.pov,
      needsAttention: rows.filter((r) => !r.muted && r.alerts.some((a) => a.level === 'bad')).length,
      endingSoon: rows.filter((r) => r.stage === 'pov' && r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 7).length,
      running: sum((s) => s.running + s.queued),
      scans24h: sum((s) => s.scans24h),
      failed24h: sum((s) => s.failed24h),
      fusion7d: sum((s) => s.fusion7d),
      last7d: sum((s) => s.last7d),
      critical: sum((s) => s.findings?.critical),
      high: sum((s) => s.findings?.high),
      usersActive: live.some((r) => r.live.summary.users?.total != null) ? sum((s) => s.users?.active ?? 0) : null,
      usersTotal: live.some((r) => r.live.summary.users?.total != null) ? sum((s) => s.users?.total ?? 0) : null,
      creditsAvailable: live.some((r) => r.live.summary.credits?.available != null) ? sum((s) => s.credits?.available) : null,
      creditsUsed30d: live.some((r) => r.live.summary.credits?.used30d != null) ? sum((s) => s.credits?.used30d) : null,
      criteriaMet: rows.reduce((n, r) => n + r.progress.met, 0),
      criteriaTotal: rows.reduce((n, r) => n + r.progress.total, 0),
    };
    const since = Date.parse(q.get('since') ?? '') || 0;
    const events = list
      .filter((o) => o.tenant)
      .flatMap((o) => eventsOf(monitor.snapshot(o.id), { povId: o.id, since }).filter((e) => !(o.mute?.projects ?? []).includes(e.projectId)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 250);
    // What the team did in CommandCenter (notes, stage changes, criteria met), newest first.
    const activity = list
      .flatMap((o) => (o.history ?? []).slice(-40).map((h) => ({ ...h, oppId: o.id, opp: o.name, byName: users.get(h.by)?.name ?? '' })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 150);
    const people = [...users.visibleIds(viewer)].map((id) => users.get(id)).filter(Boolean).map((u) => {
      const own = rows.filter((r) => r.owner.id === u.id);
      return { id: u.id, name: u.name, role: u.role, roleLabel: u.roleLabel, managerId: u.managerId, opportunities: own.length, povs: own.filter((r) => r.stage === 'pov').length, attention: own.filter((r) => !r.muted && r.alerts.some((a) => a.level === 'bad')).length };
    });
    return { at: new Date(now).toISOString(), intervalMinutes: monitor.intervalMs / 60_000, totals, forecast: portfolioForecast(rows, now), rows, events, activity, people };
  }

  function detail(viewer, opp) {
    const now = Date.now();
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    const byProject = snap?.findings?.byProject ?? {};
    const lastScan = new Map();
    for (const s of snap?.scans ?? []) if (!lastScan.has(s.projectId)) lastScan.set(s.projectId, s);
    const credits = new Map((snap?.credits?.byProject ?? []).map((c) => [c.projectId, c]));
    const projects = (snap?.projects?.list ?? []).map((p) => ({ ...p, findings: byProject[p.id] ?? null, lastScan: lastScan.get(p.id) ?? null, credits: credits.get(p.id) ?? null, muted: (opp.mute?.projects ?? []).includes(p.id) }));
    const ids = new Set([opp.ownerId, ...(opp.history ?? []).map((h) => h.by), ...(opp.notes ?? []).map((n) => n.by), ...(opp.criteria ?? []).map((c) => c.confirmedBy)].filter(Boolean));
    return {
      opportunity: publicOpp(placed(opp)),
      row: row(opp, now),
      canEdit: opps.canEdit(viewer, opp, fullSettings()),
      people: Object.fromEntries([...ids].map((id) => [id, users.get(id)?.name ?? 'Former member'])),
      evidence: evidenceOf(opp),
      tenant: snap
        ? {
            identity: snap.identity,
            at: snap.at,
            projects,
            active: snap.active ?? [],
            scans: snap.scans ?? [],
            credits: snap.credits,
            ai: snap.ai,
            errors: snap.errors,
            events: eventsOf(snap, { povId: opp.id }),
            people: peopleActivity(snap, now),
            history: monitor.history(opp.id),
          }
        : null,
      outbox: mailer.outbox(new Set([opp.id])).slice(0, 100),
      mailConfigured: mailer.configured,
    };
  }

  // ——— HTTP plumbing ———
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const file = (res, name, type, content) => send(res, 200, content, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.\- ]+/g, '_')}"` });
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const parts = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(fail(413, 'Request too large.'));
          req.destroy();
        } else parts.push(c);
      });
      req.on('end', () => {
        try {
          resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {});
        } catch {
          reject(fail(400, 'Body is not JSON.'));
        }
      });
      req.on('error', reject);
    });
  const cookie = (req, name) => String(req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
  const sessionCookie = (token, maxAge) => `cc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  const attempts = new Map();
  const throttle = (key) => {
    const now = Date.now();
    const list = (attempts.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
    if (list.length >= (settings().security.maxAttempts || 10)) throw fail(429, 'Too many sign-in attempts. Wait a few minutes.');
    list.push(now);
    attempts.set(key, list);
  };

  const need = (user, permission) => {
    if (!users.can(user, permission, fullSettings())) throw fail(403, `Your role may not do that (${PERMISSIONS[permission]}).`);
  };
  // A criterion sits in its capability's current group (catalogue groups can move).
  const placed = (opp) => ({ ...opp, criteria: (opp.criteria ?? []).map((c) => ({ ...c, category: (c.capabilityId && catalog.get(c.capabilityId)?.category) || c.category })) });
  const viewOpp = (user, id) => {
    const opp = opps.get(id);
    if (!opp || !opps.canView(user, opp)) throw fail(404, 'No such opportunity.');
    return placed(opp);
  };

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1);
    const m = req.method;
    const route = `${m} /${parts.map((p, i) => (i > 0 && /^[0-9a-f-]{8,}$/i.test(p) ? ':id' : p)).join('/')}`;

    // Public
    if (route === 'POST /login') {
      const body = await readBody(req);
      throttle(`${req.socket.remoteAddress}|${text(body.email, 254).toLowerCase()}`);
      const { token, user } = users.signIn(body.email, body.password);
      return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(token, 12 * 3600) });
    }
    const user = users.fromToken(cookie(req, 'cc_session'));
    if (route === 'GET /session') {
      return send(res, 200, user ? { user, permissions: users.permissionsOf(user, fullSettings()), settings: settings(), version: VERSION } : { user: null, settings: { orgName: settings().orgName, defaultTheme: settings().defaultTheme, defaultMode: settings().defaultMode }, version: VERSION });
    }
    if (!user) return send(res, 401, { error: 'Sign in first.' });
    // State-changing calls only from this page (with SameSite=Strict, no cross-site requests).
    if (m !== 'GET' && req.headers['x-requested-with'] !== 'CommandCenter') return send(res, 403, { error: 'Missing request header.' });

    if (route === 'POST /logout') {
      users.signOut(cookie(req, 'cc_session'));
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (route === 'GET /meta') {
      return send(res, 200, { stages: STAGES, criterionStatus: CRITERION_STATUS, sessionTypes: SESSION_TYPES, categories: catalog.categories(), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])), permissions: PERMISSIONS, templates: TEMPLATES, themes: THEMES, scanWindowDays: SCAN_WINDOW_DAYS });
    }
    if (route === 'PATCH /me') return send(res, 200, { user: users.update(user, user.id, await readBody(req)) });
    if (route === 'POST /me/password') {
      const b = await readBody(req);
      users.changePassword(user.id, b.current, b.next);
      return send(res, 200, { ok: true });
    }

    if (route === 'GET /stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
      const client = { res, userId: user.id };
      clients.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(client);
      });
      return;
    }

    // People and teams
    if (route === 'GET /users') return send(res, 200, { users: [...users.visibleIds(user)].map((id) => users.get(id)).filter(Boolean), tree: users.tree(user) });
    if (route === 'POST /users') {
      need(user, 'users.manage');
      const added = users.add(user, await readBody(req));
      audit.record(user, 'people', `Added ${added.name} (${added.roleLabel})`, { id: added.id });
      return send(res, 201, { user: added });
    }
    if (route === 'PATCH /users/:id') {
      if (parts[1] !== user.id) need(user, 'users.manage');
      const b = await readBody(req);
      const changed = users.update(user, parts[1], b);
      const fields = Object.keys(b).filter((k) => k !== 'prefs');
      if (parts[1] !== user.id || fields.length) audit.record(user, 'people', `Changed ${changed.name}: ${fields.map((k) => (k === 'password' ? 'password reset' : k)).join(', ') || 'preferences'}`, { id: changed.id });
      return send(res, 200, { user: changed });
    }
    if (route === 'DELETE /users/:id') {
      need(user, 'users.manage');
      const gone = users.get(parts[1]);
      const heir = gone?.managerId ?? user.id;
      for (const o of opps.raw().filter((x) => x.ownerId === parts[1])) opps.mutate({ ...user, role: 'admin' }, o.id, fullSettings(), (opp) => {
        opp.ownerId = heir;
        (opp.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `Handed over from ${gone?.name ?? 'a removed person'}` });
      });
      const removed = users.remove(user, parts[1]);
      audit.record(user, 'people', `Removed ${removed.name}; their opportunities went to ${users.get(heir)?.name ?? 'their manager'}`, { id: removed.id });
      return send(res, 200, { user: removed });
    }

    // Settings
    if (route === 'GET /settings') return send(res, 200, { settings: settings(), smtp: mailer.settings, roles: { matrix: fullSettings().roles ?? DEFAULT_MATRIX, permissions: PERMISSIONS, labels: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])) } });
    if (route === 'PUT /settings') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      if ('orgName' in b) all.orgName = text(b.orgName, 80) || DEFAULT_SETTINGS.orgName;
      if ('refreshMinutes' in b) all.refreshMinutes = Math.min(1440, Math.max(1, Math.trunc(Number(b.refreshMinutes)) || 10));
      if (THEMES.includes(b.defaultTheme)) all.defaultTheme = b.defaultTheme;
      if (['auto', 'light', 'dark'].includes(b.defaultMode)) all.defaultMode = b.defaultMode;
      if ('weeklyDrafts' in b) all.weeklyDrafts = Boolean(b.weeklyDrafts);
      db.write('settings', all);
      audit.record(user, 'settings', `Changed organisation settings: ${Object.keys(b).join(', ')}`);
      monitor.setInterval(all.refreshMinutes);
      monitor.reschedule();
      return send(res, 200, { settings: settings() });
    }
    if (route === 'PUT /settings/smtp') {
      need(user, 'settings.manage');
      const smtp = mailer.save(await readBody(req));
      audit.record(user, 'settings', `Changed the email server (${smtp.host}:${smtp.port})`);
      return send(res, 200, { smtp });
    }
    if (route === 'POST /settings/smtp/test') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const to = cleanEmail(b.to) || user.email;
      try {
        await mailer.test(to);
      } catch (error) {
        throw fail(400, smtpHint(error));
      }
      audit.record(user, 'settings', `Sent a test email to ${to}`);
      return send(res, 200, { ok: true, to });
    }
    if (route === 'PUT /settings/roles') {
      need(user, 'roles.manage');
      const b = await readBody(req);
      const matrix = {};
      for (const role of Object.keys(DEFAULT_MATRIX)) matrix[role] = (Array.isArray(b.matrix?.[role]) ? b.matrix[role] : []).filter((p) => PERMISSIONS[p]);
      const all = fullSettings();
      all.roles = matrix;
      db.write('settings', all);
      audit.record(user, 'settings', 'Changed what each role may do', { matrix });
      return send(res, 200, { matrix });
    }

    if (route === 'POST /settings/smtp/verify') {
      need(user, 'settings.manage');
      try {
        await mailer.verify();
      } catch (error) {
        throw fail(400, smtpHint(error));
      }
      return send(res, 200, { ok: true, smtp: mailer.settings });
    }
    if (route === 'PUT /settings/security') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      const hours = Math.trunc(Number(b.sessionHours));
      const attempts = Math.trunc(Number(b.maxAttempts));
      all.security = { sessionHours: hours >= 1 && hours <= 168 ? hours : 12, maxAttempts: attempts >= 3 && attempts <= 100 ? attempts : 10 };
      db.write('settings', all);
      users.sessionMs = all.security.sessionHours * 3600e3;
      audit.record(user, 'settings', `Sign-ins last ${all.security.sessionHours} h; ${all.security.maxAttempts} attempts per 15 min`);
      return send(res, 200, { security: all.security });
    }

    // Network & proxy, trusted certificates
    if (route === 'GET /settings/network') {
      need(user, 'settings.manage');
      const n = fullSettings().network ?? {};
      return send(res, 200, { network: { proxy: n.proxy ?? '', proxyUser: n.proxyUser ?? '', hasProxyPass: Boolean(n.proxyPass), noProxy: n.noProxy ?? '', active: Boolean(process.env.HTTPS_PROXY) }, allowlist: allowlist(), certs: certList(), launched: updater.launched, restartNeeded: restartNeeded() });
    }
    if (route === 'PUT /settings/network') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      const before = all.network ?? {};
      let proxy = text(b.proxy, 500);
      if (proxy) {
        try {
          const u = new URL(proxy);
          if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error();
          proxy = `${u.protocol}//${u.host}`;
        } catch {
          throw fail(400, 'The proxy is an address such as http://proxy.company.com:8080 (the user name and password go in their own fields).');
        }
      }
      all.network = { proxy, proxyUser: text(b.proxyUser, 200), proxyPass: b.proxyPass ? db.seal(b.proxyPass) : b.proxyUser && before.proxyUser === b.proxyUser ? before.proxyPass ?? '' : '', noProxy: text(b.noProxy, 1000) };
      db.write('settings', all);
      audit.record(user, 'settings', proxy ? `Set the company proxy to ${proxy}` : 'Removed the company proxy');
      if (b.restart && updater.launched) restartServer(user, 'network settings');
      return send(res, 200, { ok: true, restarting: Boolean(b.restart && updater.launched) });
    }
    if (route === 'POST /settings/certs') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const pems = String(b.pem ?? '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      if (!pems.length) throw fail(400, 'That is not a certificate: paste or upload a PEM file (-----BEGIN CERTIFICATE-----).');
      const list = readCerts();
      let added = 0;
      for (const pem of pems.slice(0, 50)) {
        let cert;
        try {
          cert = new X509Certificate(pem);
        } catch {
          throw fail(400, 'One of those certificates cannot be read.');
        }
        if (list.some((c) => c.fingerprint === cert.fingerprint256)) continue;
        list.push({ fingerprint: cert.fingerprint256, subject: cert.subject.replace(/\n/g, ', '), issuer: cert.issuer.replace(/\n/g, ', '), validTo: cert.validTo, ca: cert.ca, pem: cert.toString(), addedBy: user.name, addedAt: new Date().toISOString() });
        added += 1;
      }
      writeCerts(list);
      audit.record(user, 'settings', `Trusted ${added} certificate${added === 1 ? '' : 's'}`);
      return send(res, 200, { certs: certList(), added, restartNeeded: restartNeeded() });
    }
    if (m === 'DELETE' && parts[0] === 'settings' && parts[1] === 'certs' && parts[2]) {
      need(user, 'settings.manage');
      const fp = decodeURIComponent(parts[2]);
      writeCerts(readCerts().filter((c) => c.fingerprint !== fp));
      audit.record(user, 'settings', `Stopped trusting certificate ${fp.slice(0, 23)}…`);
      return send(res, 200, { certs: certList(), restartNeeded: restartNeeded() });
    }

    // Update & recovery
    if (route === 'GET /updates') {
      need(user, 'settings.manage');
      return send(res, 200, updater.status());
    }
    if (route === 'POST /updates/check') {
      need(user, 'settings.manage');
      try {
        return send(res, 200, await updater.check());
      } catch (error) {
        throw fail(502, `Could not read the published releases: ${scrubText(error.message)}`);
      }
    }
    if (route === 'POST /updates/install') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const r = await updater.install(text(b.version, 40) || undefined, { by: user.name });
      audit.record(user, 'system', `Installed version ${r.version}; restarting into it`);
      return send(res, 202, r);
    }
    if (route === 'POST /updates/rollback') {
      need(user, 'settings.manage');
      const r = updater.rollback({ by: user.name });
      audit.record(user, 'system', `Went back to ${r.version}`);
      return send(res, 202, r);
    }
    if (route === 'PUT /updates/auto') {
      need(user, 'settings.manage');
      const a = updater.setAuto(await readBody(req));
      audit.record(user, 'system', a.enabled ? `Turned on auto-update at ${String(a.hour).padStart(2, '0')}:00` : 'Turned off auto-update');
      return send(res, 200, updater.status());
    }
    if (route === 'POST /system/restart') {
      need(user, 'settings.manage');
      restartServer(user, 'from Settings');
      return send(res, 202, { restarting: true });
    }
    if (route === 'POST /system/backup') {
      need(user, 'settings.manage');
      const name = updater.backup('manual');
      audit.record(user, 'system', `Took a backup (${name})`);
      return send(res, 200, { backup: name, backups: backups() });
    }
    if (route === 'GET /system/backup/download') {
      need(user, 'settings.manage');
      audit.record(user, 'system', 'Downloaded a backup of the data');
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="commandcenter-backup-${new Date().toISOString().slice(0, 10)}.tar.gz"`, 'Cache-Control': 'no-store' });
      const tar = spawn('tar', ['-czf', '-', '--exclude=./app', '--exclude=./backups', '-C', dataDir, '.']);
      tar.stdout.pipe(res);
      tar.on('error', () => res.end());
      return;
    }
    if (route === 'GET /system/about') {
      return send(res, 200, { version: VERSION, node: process.version, repo: updater.status().repo, licence: 'Internal use', startedAt: STARTED_AT, launched: updater.launched, dataDir: can(user, 'settings.manage') ? dataDir : undefined, backups: can(user, 'settings.manage') ? backups() : undefined, audit: can(user, 'settings.manage') ? audit.verify() : undefined });
    }
    if (route === 'GET /audit') {
      need(user, 'settings.manage');
      return send(res, 200, { entries: audit.list({ type: url.searchParams.get('type') ?? '', limit: 500 }), chain: audit.verify() });
    }

    // Capability catalogue
    if (route === 'GET /catalog') return send(res, 200, { catalog: catalog.list(), categories: catalog.categories() });
    if (route === 'POST /catalog') {
      need(user, 'catalog.manage');
      const capability = catalog.save(await readBody(req));
      audit.record(user, 'catalog', `Saved capability "${capability.name}"`, { id: capability.id });
      return send(res, 200, { capability });
    }
    if (route === 'POST /catalog/reset') {
      need(user, 'catalog.manage');
      catalog.reset();
      audit.record(user, 'catalog', 'Restored the built-in capability catalogue');
      return send(res, 200, { catalog: catalog.list() });
    }
    if (m === 'DELETE' && parts[0] === 'catalog' && parts[1]) {
      need(user, 'catalog.manage');
      catalog.remove(parts[1]);
      audit.record(user, 'catalog', `Deleted capability ${parts[1]}`);
      return send(res, 200, { ok: true });
    }

    // Dashboards
    if (route === 'GET /overview') return send(res, 200, overview(user, url.searchParams));
    if (route === 'POST /refresh') {
      monitor.refreshAll(opps.visible(user).filter((o) => o.tenant).map((o) => o.id)).catch(() => {});
      return send(res, 202, { ok: true });
    }
    if (route === 'POST /keys/inspect') {
      const b = await readBody(req);
      const connection = deriveConnection(b.apiKey, b.overrides ?? {});
      const identity = await checkKey(connection);
      const clash = opps.clash(connection);
      return send(res, 200, { connection: publicConnection(connection), identity, inUse: clash ? (opps.canView(user, clash) ? clash.name : 'another opportunity') : null });
    }

    // Opportunities
    if (route === 'POST /opportunities') {
      const b = await readBody(req);
      if (b.apiKey) {
        const connection = deriveConnection(b.apiKey, b.overrides ?? {});
        if (opps.clash(connection)) throw fail(409, `Tenant "${connection.tenant}" is already on another opportunity.`);
        await checkKey(connection);
      }
      let opp = opps.create(user, b, fullSettings());
      if (b.apiKey) {
        opp = opps.setTenant(user, opp.id, { apiKey: b.apiKey, overrides: b.overrides }, fullSettings());
        monitor.refresh(opp.id, { force: true }).catch(() => {});
      }
      notify({ id: opp.id });
      return send(res, 201, { opportunity: publicOpp(opp) });
    }
    if (parts[0] === 'opportunities' && parts[1]) {
      const id = parts[1];
      const sub = parts[2];
      const s = fullSettings();
      const done = (opp, status = 200) => {
        notify({ id });
        return send(res, status, detail(user, opps.get(id) ?? opp));
      };
      if (!sub && m === 'GET') return send(res, 200, detail(user, viewOpp(user, id)));
      if (!sub && m === 'PATCH') {
        const opp = opps.update(user, id, await readBody(req), s);
        // A running POV is read now; one that just completed gets a final read for its report and deck.
        if (opp.tenant && (POLLED_STAGES.has(opp.stage) || opp.stage === 'completed')) monitor.refresh(id, { force: true }).catch(() => {});
        return done(opp);
      }
      if (!sub && m === 'DELETE') {
        opps.remove(user, id, s);
        monitor.forget(id);
        return send(res, 200, { ok: true });
      }
      if (sub === 'tenant' && m === 'POST') {
        viewOpp(user, id);
        const b = await readBody(req);
        const connection = deriveConnection(b.apiKey, b.overrides ?? {});
        const prev = opps.get(id).tenant;
        if (prev && prev.tenant !== connection.tenant && !b.replaceTenant) throw fail(409, `This opportunity is on tenant "${prev.tenant}"; that key is for "${connection.tenant}". Tick "connect a different tenant" to switch.`);
        await checkKey(connection);
        const opp = opps.setTenant(user, id, b, s);
        monitor.refresh(id, { force: true }).catch(() => {});
        return done(opp);
      }
      if (sub === 'tenant' && m === 'DELETE') {
        const opp = opps.removeTenant(user, id, s);
        monitor.forget(id);
        return done(opp);
      }
      if (sub === 'refresh' && m === 'POST') {
        const opp = viewOpp(user, id);
        if (!opp.tenant) throw fail(400, 'Connect a Checkmarx One tenant first.');
        monitor.refresh(id, { force: true }).catch(() => {});
        return send(res, 202, { ok: true });
      }
      if (sub === 'mute' && m === 'PUT') return done(opps.setMute(user, id, await readBody(req), s));
      if (sub === 'criteria' && parts[3] === 'bulk' && m === 'POST') {
        const b = await readBody(req);
        for (const capabilityId of (b.capabilityIds ?? []).slice(0, 200)) opps.upsertItem(user, id, 'criteria', { capabilityId, priority: b.priority }, s);
        for (const title of (b.custom ?? []).slice(0, 50)) if (text(title)) opps.upsertItem(user, id, 'criteria', { title, category: 'custom' }, s);
        return done();
      }
      if (KINDS.has(sub) && m === 'POST') {
        const b = await readBody(req);
        opps.upsertItem(user, id, sub, parts[3] ? { ...b, id: parts[3] } : b, s);
        return done();
      }
      if (KINDS.has(sub) && parts[3] && m === 'DELETE') {
        opps.removeItem(user, id, sub, parts[3], s);
        return done();
      }
      if (sub === 'results' && m === 'GET') {
        const opp = viewOpp(user, id);
        const nonce = randomBytes(12).toString('base64');
        const html = resultsPage(resultsData(opp), { nonce });
        if (url.searchParams.get('download')) return file(res, `${opp.customer} - POV results.html`, 'text/html; charset=utf-8', resultsPage(resultsData(opp)));
        return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; frame-ancestors 'self'` });
      }
      if (sub === 'deck' && m === 'GET') {
        const opp = viewOpp(user, id);
        return file(res, `${opp.customer} - POV results.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', await deckOf(opp));
      }
      if (sub === 'report' && m === 'GET') {
        const opp = viewOpp(user, id);
        const html = successReport(opp, { owner: users.get(opp.ownerId), live: opp.tenant ? monitor.live(id) : null, evidence: evidenceOf(opp), org: settings().orgName, categories: catalog.categories() });
        if (url.searchParams.get('download')) return file(res, `${opp.customer} POV success criteria.html`, 'text/html; charset=utf-8', html);
        return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
      }
      if (sub === 'email' && parts[3] === 'draft' && m === 'POST') {
        const opp = viewOpp(user, id);
        const b = await readBody(req);
        const template = TEMPLATES[b.template] ? b.template : 'blank';
        const out = draft(template, opp, { owner: users.get(opp.ownerId), live: opp.tenant ? monitor.live(id) : null, catalog });
        return send(res, 200, { template, ...out });
      }
      if (sub === 'email' && parts[3] === 'send' && m === 'POST') {
        const opp = viewOpp(user, id);
        if (!opps.canEdit(user, opp, s)) throw fail(403, 'You can view this opportunity but not email from it.');
        need(user, 'mail.send');
        const b = await readBody(req);
        const msg = cleanMessage(b);
        let messageId;
        const attachments = b.attachDeck ? [{ filename: `${opp.customer} - POV results.pptx`, content: await deckOf(opp) }] : [];
        try {
          messageId = await mailer.send(msg, { replyTo: user.email, attachments });
        } catch (error) {
          throw fail(error.status ?? 502, `The email was not sent: ${scrubText(error.message)}`);
        }
        mailer.record({ oppId: id, by: user.id, status: 'sent', template: text(b.template, 20), ...msg, messageId, attachments: attachments.map((a) => a.filename) });
        opps.mutate({ ...user, role: 'admin' }, id, s, (o) => (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `Emailed "${msg.subject}" to ${msg.to.join(', ')}` }));
        return done();
      }
      if (sub === 'email' && parts[3] === 'eml' && m === 'POST') {
        const opp = viewOpp(user, id);
        const b = await readBody(req);
        const msg = cleanMessage(b);
        const attachments = b.attachDeck ? [{ filename: `${opp.customer} - POV results.pptx`, content: await deckOf(opp) }] : [];
        mailer.record({ oppId: id, by: user.id, status: 'downloaded', template: text(b.template, 20), ...msg, attachments: attachments.map((a) => a.filename) });
        return file(res, `${opp.customer} - ${msg.subject}.eml`.slice(0, 120), 'message/rfc822', await toEml(msg, user.email, attachments));
      }
      if (sub === 'logs' && parts[3] && parts[4] && m === 'GET') {
        const opp = viewOpp(user, id);
        need(user, 'tenant.logs');
        const log = await scanLog(opps.connection(opp.id), parts[3], parts[4]);
        return file(res, `${opp.tenant.tenant}-${parts[3]}-${parts[4]}.log`, 'text/plain; charset=utf-8', log);
      }
      if (sub === 'troubleshoot' && m === 'GET') {
        const opp = viewOpp(user, id);
        need(user, 'tenant.logs');
        return file(res, `${opp.tenant?.tenant ?? 'tenant'}-troubleshooting-${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain; charset=utf-8', await troubleshootBundle(opp));
      }
    }
    return send(res, 404, { error: 'Not found.' });
  }

  /** Everything the results page shows, for one opportunity. */
  function resultsData(raw) {
    const opp = placed(raw);
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    const evidence = evidenceOf(opp);
    const groups = Object.fromEntries([...catalog.categories(), ['custom', 'Other']]);
    const history = opp.history ?? [];
    const completed = [...history].reverse().find((h) => /Marked the POV successful|→ POV completed/.test(h.what));
    const criteria = (opp.criteria ?? [])
      .filter((c) => c.status !== 'na')
      .map((c) => {
        const cap = c.capabilityId ? catalog.get(c.capabilityId) : null;
        const rule = { detect: { ...(cap?.detect ?? {}), engines: [...(cap?.detect?.engines ?? []), ...(c.engines ?? [])], origins: [...(cap?.detect?.origins ?? []), ...(c.origins ?? [])] } };
        return {
          id: c.id,
          capabilityId: c.capabilityId,
          title: c.title,
          group: groups[c.category] ?? 'Other',
          priority: c.priority,
          state: PLATFORM_STATE[c.status] ?? 'planned',
          ai: AI_POWERED.has(c.capabilityId),
          cxName: cap?.cxName ?? '',
          proof: cap?.proof ?? '',
          tech: cap?.tech ?? '',
          notes: c.notes,
          evidenceLink: c.evidenceLink,
          confirmedAt: c.confirmedAt,
          confirmedBy: c.confirmedBy ? users.get(c.confirmedBy)?.name ?? '' : '',
          evidence: evidence[c.id],
          scans: snap ? provingScans(rule, snap) : [],
          timeline: history.filter((h) => h.what.includes(`"${c.title}"`)).map((h) => ({ at: h.at, what: h.what.replace(`"${c.title}": `, '').replace(` "${c.title}"`, ''), by: users.get(h.by)?.name ?? '' })),
        };
      });
    return {
      org: settings().orgName,
      customer: opp.customer,
      name: opp.name,
      owner: users.get(opp.ownerId),
      startDate: opp.startDate,
      endDate: opp.endDate,
      stage: opp.stage,
      povResult: opp.povResult ?? '',
      completedAt: completed?.at ?? opp.outcome?.closedAt ?? null,
      generatedAt: new Date().toISOString(),
      summary: opp.summary ?? '',
      progress: progressOf(opp),
      platform: platformView(opp, catalog),
      criteria,
      tenant: opp.tenant ? monitor.live(opp.id).summary : null,
      sessions: [...(opp.sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date, title: x.title, type: SESSION_TYPES[x.type] ?? '' })),
      next: (opp.tasks ?? []).filter((t) => !t.done).map((t) => t.title).slice(0, 8),
    };
  }

  function deckOf(opp) {
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    return finalDeck(opp, { owner: users.get(opp.ownerId), live: opp.tenant ? monitor.live(opp.id) : null, people: snap ? peopleActivity(snap) : null, evidence: evidenceOf(opp), categories: catalog.categories(), org: settings().orgName, catalog });
  }

  /** One text file: the tenant's read, every failed scan of the last 7 days and each failed engine's log. */
  async function troubleshootBundle(opp) {
    if (!opp.tenant) throw fail(400, 'Connect a Checkmarx One tenant first.');
    const snap = monitor.snapshot(opp.id);
    const live = monitor.live(opp.id);
    const lines = [`CommandCenter troubleshooting bundle — ${opp.customer} — tenant ${opp.tenant.tenant} (${opp.tenant.regionLabel})`, `Made ${new Date().toISOString()}`, `API ${opp.tenant.baseUrl}`, `Last read: ${snap?.at ?? 'never'} (${snap?.ms ?? '?'} ms)${live.error ? `; last error ${live.error.at}: ${live.error.message}` : ''}`, ...(snap?.errors ?? []).map((e) => `Part not read: ${e.part}: ${e.message}`), ''];
    const failed = (snap?.scans ?? []).filter((s) => /fail|partial/i.test(s.status)).slice(0, 10);
    lines.push(`${failed.length} failed or partial scan(s) in the last ${SCAN_WINDOW_DAYS} days${failed.length === 10 ? ' (newest 10)' : ''}`, '');
    const connection = opps.connection(opp.id);
    for (const s of failed) {
      lines.push('='.repeat(80), `Scan ${s.id} · ${s.projectName} · ${s.branch} · ${s.status} · ${s.createdAt} · by ${s.initiator || '?'} from ${s.origin || '?'}`, `Reason: ${s.reason || 'not said'}`);
      const engines = s.reason ? [...new Set(s.reason.split(';').map((x) => x.split(':')[0].trim().toLowerCase()).filter(Boolean))] : s.engines;
      for (const engine of engines.slice(0, 4)) {
        lines.push('-'.repeat(80), `Log: ${engine}`);
        try {
          const log = await scanLog(connection, s.id, engine);
          lines.push(log.length > 200_000 ? `${log.slice(-200_000)}\n[only the last 200 KB kept]` : log);
        } catch (error) {
          lines.push(`(not available: ${scrubText(error.message)})`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ——— Weekly status drafts: each Monday, one per running POV, waiting in its Email tab ———
  function weeklyDrafts(now = new Date()) {
    if (!settings().weeklyDrafts || now.getUTCDay() !== 1) return;
    const week = now.toISOString().slice(0, 10);
    const all = fullSettings();
    if (all.lastWeeklyDrafts === week) return;
    for (const opp of opps.raw().filter((o) => o.stage === 'pov')) {
      const out = draft('weekly', opp, { owner: users.get(opp.ownerId), live: opp.tenant ? monitor.live(opp.id) : null, catalog });
      mailer.record({ oppId: opp.id, by: '', status: 'draft', template: 'weekly', to: out.to, cc: out.cc, subject: out.subject, body: out.body });
    }
    all.lastWeeklyDrafts = week;
    db.write('settings', all);
  }
  const hourly = setInterval(() => {
    try {
      weeklyDrafts();
    } catch {}
  }, 3600e3);
  hourly.unref();

  function serveStatic(req, res, url) {
    let target = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!target.startsWith(PUBLIC)) return send(res, 404, { error: 'Not found.' });
    if (url.pathname === '/' || !path.extname(target)) target = path.join(PUBLIC, 'index.html');
    fs.readFile(target, (error, data) => {
      if (error) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, version: VERSION });
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') serveStatic(req, res, url);
      else send(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) send(res, status === 401 && !String(error.message).includes('match') ? 400 : status, { error: scrubText(String(error.message ?? error)) });
    }
  });
  // ——— Helpers for Settings ———
  const certFile = path.join(dataDir, 'certs', 'trusted.json');
  const readCerts = () => {
    try {
      return JSON.parse(fs.readFileSync(certFile, 'utf8'));
    } catch {
      return [];
    }
  };
  const writeCerts = (list) => {
    fs.mkdirSync(path.dirname(certFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(certFile, JSON.stringify(list, null, 1), { mode: 0o600 });
    // The launcher hands this file to the server it starts (NODE_EXTRA_CA_CERTS).
    fs.writeFileSync(path.join(dataDir, 'certs', 'trusted.pem'), list.map((c) => c.pem.trim()).join('\n') + (list.length ? '\n' : ''), { mode: 0o644 });
  };
  const certList = () => readCerts().map(({ pem, ...c }) => c);
  const startedCerts = (() => {
    try {
      return fs.readFileSync(path.join(dataDir, 'certs', 'trusted.pem'), 'utf8');
    } catch {
      return '';
    }
  })();
  const startedNetwork = JSON.stringify(db.read('settings', {}).network ?? {});
  const restartNeeded = () => {
    let now = '';
    try {
      now = fs.readFileSync(path.join(dataDir, 'certs', 'trusted.pem'), 'utf8');
    } catch {}
    return now !== startedCerts || JSON.stringify(db.read('settings', {}).network ?? {}) !== startedNetwork;
  };
  const backups = () => {
    try {
      return fs.readdirSync(path.join(dataDir, 'backups')).sort().reverse().slice(0, 10);
    } catch {
      return [];
    }
  };
  /** Every connection the server makes or takes, for the network team. */
  const allowlist = () => {
    const out = [{ direction: 'in', host: 'this server', port: Number(process.env.PORT) || 4310, why: 'People opening CommandCenter (HTTPS when behind your reverse proxy)' }];
    const seen = new Set();
    for (const o of opps.raw().filter((x) => x.tenant && !['won', 'lost'].includes(x.stage))) {
      for (const [label, addr] of [['IAM (sign-in, users)', o.tenant.iamUrl], ['API (projects, scans, results, credits, logs)', o.tenant.baseUrl]]) {
        try {
          const h = new URL(addr).host;
          if (seen.has(h)) continue;
          seen.add(h);
          out.push({ direction: 'out', host: h, port: 443, why: `Checkmarx One ${label} — POV tenants` });
        } catch {}
      }
    }
    const smtp = mailer.settings;
    if (smtp.host) out.push({ direction: 'out', host: smtp.host, port: smtp.port, why: 'Email server (SMTP)' });
    for (const h of ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']) out.push({ direction: 'out', host: h, port: 443, why: 'Updates: published releases and their downloads' });
    return out;
  };
  const can = (u, p) => users.can(u, p, fullSettings());
  updater.start();

  server.on('close', () => {
    updater.stop();
    monitor.stop();
    clearInterval(hourly);
  });
  return { server, db, users, opps, catalog, monitor, mailer, firstAdmin, weeklyDrafts, updater, audit };
}

/** An email server error, said so it can be fixed. */
function smtpHint(error) {
  const m = String(error?.message ?? error);
  const code = error?.code ?? '';
  const hints = [
    [/wrong version number|ssl3_get_record|EPROTO/i, 'The port and the TLS setting do not match: port 465 is TLS from the start, 587 / 25 upgrade with STARTTLS.'],
    [/SmtpClientAuthentication is disabled|5\.7\.139|5\.7\.57/i, 'Microsoft 365 has SMTP sign-in turned off for this mailbox: turn on Authenticated SMTP (admin center → the mailbox → Mail → Manage email apps).'],
    [/Application-specific password required|5\.7\.9|534-5\.7/i, 'Gmail needs an App Password here, not the account password.'],
    [/EAUTH|535|Invalid login|authentication failed/i, 'The user name or password is not accepted by the email server.'],
    [/ENOTFOUND|EAI_AGAIN/i, 'The email server’s name cannot be found (DNS). Check the host.'],
    [/ECONNREFUSED/i, 'The email server refused the connection on that port.'],
    [/ETIMEDOUT|ESOCKET|timeout/i, 'No answer from the email server: a firewall may block the port.'],
    [/self[- ]signed|unable to verify|certificate/i, 'The email server’s certificate is not trusted here: add your company root certificate under Network & certificates, or turn off “Check the server’s certificate” for an internal relay.'],
    [/requireTLS|STARTTLS/i, 'The email server does not offer STARTTLS, so the password would travel unencrypted: use port 465 with TLS, or a server that offers STARTTLS.'],
  ];
  const hint = hints.find(([re]) => re.test(m) || re.test(code))?.[1];
  return `${hint ?? 'The email server did not accept the connection.'} (${scrubText(m).slice(0, 200)})`;
}

/** A key is only saved once Checkmarx One accepts it: one sign-in and one cheap read. */
async function defaultVerify(connection) {
  const client = new CxClient(connection);
  await client.request('/api/projects', { query: { limit: 1, offset: 0 }, retries: 1 });
  return client.identity();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 4310;
  const app = createApp();
  if (app.firstAdmin) {
    console.log(`\n  First start. Sign in as ${app.firstAdmin.email} with password: ${app.firstAdmin.password}\n  (you will be asked to change it)\n`);
  }
  app.server.listen(port, host, () => {
    console.log(`CommandCenter ${VERSION} on http://${host}:${port} — reading POV tenants every ${app.monitor.intervalMs / 60_000} min`);
    app.monitor.start();
  });
  const stop = () => app.server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
