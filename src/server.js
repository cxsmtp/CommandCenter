/**
 * Meridian: discovery → technical sessions → POV → outcome, for every SE in a team, in one place.
 *
 * One dependency (nodemailer). Everything it keeps lives in the data folder (CC_DATA_DIR, /data in the container).
 */
import http from 'node:http';
import https from 'node:https';
import { startMode, tlsOptions } from './tls.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, fail, text, email as cleanEmail } from './db.js';
import { Backups } from './backups.js';
import { Watchdog, healthChecks } from './health.js';
import { readTable, recordsOf, matchRecords, logMessage, opportunityIdOf } from './salesforce.js';
import { SfMailbox } from './sf-mailbox.js';
import { Users, ROLES, PERMISSIONS, DEFAULT_MATRIX, THEMES } from './users.js';
import { Catalog, CATEGORIES, tenantFacts, evaluate, provingScans } from './catalog.js';
import { Opportunities, STAGES, CRITERION_STATUS, SESSION_TYPES, publicOpp, progressOf, wordsOf, isMuted } from './opportunities.js';
import { Monitor } from './monitor.js';
import { Mailer, TEMPLATES, draft, cleanMessage, toEml } from './mail.js';
import { successReport } from './report.js';
import { eventsOf, scanLog, peopleActivity, SCAN_WINDOW_DAYS } from './collector.js';
import { finalDeck } from './deck.js';
import { predict, gaps, rollups } from './insights.js';
import { flowView } from './flow.js';
import { Updater, RESTART_CODE } from './updates.js';
import { Audit } from './audit.js';
import { zip } from './zip.js';
import { gzipSync } from 'node:zlib';
import { AiActions } from './ai-actions.js';
import { valueOf, ratesFor, cleanRates, totalValue, VALUE_DEFAULTS } from './value.js';
import { X509Certificate } from 'node:crypto';
import { spawn } from 'node:child_process';
import { criteriaForecast, creditsForecast, activityForecast, portfolioForecast } from './forecast.js';
import { resultsPage } from './results.js';
import { platformView, AI_POWERED, stateOf } from './platform.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
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
const DEFAULT_SETTINGS = { orgName: 'Meridian', refreshMinutes: 10, defaultTheme: 'orbit', defaultMode: 'dark', weeklyDrafts: true };

export function createApp({ dataDir = process.env.CC_DATA_DIR || path.join(ROOT, 'data'), collectFn, verifyKey = defaultVerify, secureCookies = process.env.CC_SECURE_COOKIES === 'true', updaterOptions = null, backupOptions = null, startBackground = true, tls = false } = {}) {
  // HTTPS served here (src/tls.js): the given certificate, else a self-signed one; cookies are then always Secure.
  const cert = tls ? tlsOptions(dataDir) : null;
  if (cert) secureCookies = true;
  const db = new Db(dataDir);
  const users = new Users(db);
  const catalog = new Catalog(db);
  const opps = new Opportunities(db, { users, catalog });
  const mailer = new Mailer(db);
  // What the page may see of the settings: never the email server's or the proxy's secrets.
  const settings = () => {
    const { smtp, network, lastWeeklyDrafts, salesforce, ...rest } = { ...DEFAULT_SETTINGS, ...db.read('settings', {}) };
    return { ...rest, security: { sessionHours: 12, maxAttempts: 10, ...(rest.security ?? {}) } };
  };
  const fullSettings = () => db.read('settings', {});
  const firstAdmin = users.ensureAdmin();
  const audit = new Audit(db);
  const ai = new AiActions({ db });
  const orgRates = () => ratesFor(db.read('settings', {}).valueRates ?? {});
  const valueFor = (opp, live = opp.tenant ? monitor.live(opp.id) : null) => (live?.summary ? valueOf({ credits: monitor.snapshot(opp.id)?.credits, summary: live.summary, backlog: monitor.snapshot(opp.id)?.findings?.ai ?? null, ledger: ai.ledger(opp.id), rates: ratesFor(db.read('settings', {}).valueRates ?? {}, opp.valueRates ?? {}) }) : null);
  const updater = new Updater({ dataDir, currentVersion: VERSION, ...(updaterOptions ?? {}) });
  users.sessionMs = (settings().security.sessionHours || 12) * 3600e3;
  const backupStore = new Backups({ dataDir, vault: db.vault, ...(backupOptions ?? {}) });

  // ——— Salesforce, without its API (see salesforce.js) ———
  const sfSettings = () => ({ logStages: true, logResults: true, ...(fullSettings().salesforce ?? {}) });
  const sfAddressOf = (userId) => {
    const e = db.read('sfaddresses', {})[userId];
    if (!e?.address) return null;
    try {
      return { address: db.open(e.address), copy: e.copy !== false };
    } catch {
      return null;
    }
  };
  const maskEmail = (a) => a.replace(/^(.{3})[^@]*(@.{4})[^.]*/, '$1…$2…');
  const appLink = (opp) => (process.env.CC_PUBLIC_URL ? `${process.env.CC_PUBLIC_URL.replace(/\/$/, '')}/#/opp/${opp.id}` : '');
  /** Send one log message to a person's Email to Salesforce address; recorded on the POV either way. */
  async function sfLog(actor, opp, entry, { addressOf = actor.id } = {}) {
    const who = sfAddressOf(addressOf);
    if (!who) throw fail(409, 'Add your Email to Salesforce address under Settings → Profile & look first.');
    if (!mailer.settings.host) throw fail(409, 'The email server is not set up yet (Settings → Email server).');
    const msg = logMessage(opp, { ...entry, by: actor.name, link: appLink(opp) });
    try {
      await mailer.send({ to: [who.address], cc: [], subject: msg.subject, body: msg.body }, { replyTo: actor.email });
    } catch (error) {
      throw fail(502, `Salesforce did not get it: ${smtpHint(error)}`);
    }
    opps.mutate({ ...actor, role: 'admin' }, opp.id, fullSettings(), (o) => {
      (o.sfLog ??= []).push({ at: new Date().toISOString(), by: actor.id, kind: entry.kind, title: text(entry.title, 200), itemId: entry.itemId ?? '' });
      o.sfLog = o.sfLog.slice(-200);
      if (entry.itemKind && entry.itemId) {
        const item = (o[entry.itemKind] ?? []).find((x) => x.id === entry.itemId);
        if (item) item.sfLoggedAt = new Date().toISOString();
      }
      (o.history ??= []).push({ at: new Date().toISOString(), by: actor.id, what: text(`Logged to Salesforce: ${entry.kind} — ${entry.title}`, 400) });
    });
    notify({ id: opp.id });
    return { subject: msg.subject };
  }
  /** What a POV stands at, as a Salesforce activity. */
  function sfStatus(opp) {
    const p = progressOf(opp);
    const r = row(opp);
    const next = (opp.tasks ?? []).filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 3);
    return {
      kind: 'POV status',
      title: `${STAGES[opp.stage]}${p.total ? ` · ${p.met}/${p.total} criteria completed` : ''}${r.prediction?.score !== null && r.prediction?.score !== undefined ? ` · outlook ${r.prediction.label} (${r.prediction.score})` : ''}`,
      lines: [
        opp.endDate ? `POV ends: ${opp.endDate}${r.daysLeft !== null ? ` (${r.daysLeft} days)` : ''}` : '',
        r.value?.hours ? `Value delivered: ${Math.round(r.value.hours)} hours saved` : '',
        ...(r.gaps ?? []).filter((g) => g.level === 'bad').slice(0, 3).map((g) => `Gap: ${g.text}`),
        ...next.map((t) => `Next: ${t.title}${t.due ? ` (due ${t.due})` : ''}`),
      ].filter(Boolean),
    };
  }
  /** Bring a Salesforce report in: match its rows to POVs and keep their fields. */
  async function importReport(buf, meta, actor = null) {
    const rows = await readTable(buf, meta);
    const { records, columns } = recordsOf(rows);
    const pool = actor ? opps.visible(actor).filter((o) => opps.canEdit(actor, o, fullSettings())) : opps.raw();
    const { matched, unmatched } = matchRecords(records, pool);
    const changed = opps.setSalesforce(matched.map((x) => ({ id: x.opp.id, rec: x.rec })), { ...meta, columns }, actor?.name ?? 'Salesforce report');
    const summary = {
      at: new Date().toISOString(),
      source: meta.source,
      file: text(meta.name || meta.subject, 200),
      by: actor?.name ?? 'Report mailbox',
      rows: records.length,
      columns,
      matched: matched.map((x) => ({ id: x.opp.id, customer: x.opp.customer, how: x.how, stage: x.rec.stage ?? '', changes: changed.get(x.opp.id) ?? [] })),
      unmatched: unmatched.slice(0, 200).map((r) => ({ id: r.id, name: r.name, account: r.account, stage: r.stage ?? '' })),
    };
    db.write('sfimports', [summary, ...db.read('sfimports', [])].slice(0, 30));
    rowCache.clear();
    notify({ id: null });
    return { rows: summary.rows, matched: summary.matched.length, unmatched: summary.unmatched.length, detail: summary };
  }
  const sfMailbox = new SfMailbox({ settings: () => sfSettings().mailbox ?? {}, open: (x) => db.open(x), importFile: (buf, meta) => importReport(buf, meta) });
  const restartServer = (actor, why) => {
    if (!updater.launched) throw fail(409, 'Restarting needs the launcher: start Meridian with "npm start" or the container image.');
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
    // Someone changed something: every cached list and this POV's row are worked out again.
    overviewCache.clear();
    if (event.id) rowCache.delete(event.id);
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

  // Each POV's row is worked out once per change (its record, its tenant's read, the hour), not on every request:
  // with hundreds of POVs and dozens of people watching, the list is mostly reused.
  const rowCache = new Map();
  const overviewCache = new Map();
  const OVERVIEW_TTL_MS = 3000;
  // A change anyone makes shows at once to everyone: the cached lists go.
  monitor.on('update', () => overviewCache.clear());
  monitor.on('update', (e) => e.id && rowCache.delete(e.id));
  function row(opp, now = Date.now(), colour = colours()[opp.id]) {
    const key = `${opp.updatedAt}|${colour}|${Math.floor(now / 60_000)}|${ai.ledger(opp.id).length}`;
    const hit = rowCache.get(opp.id);
    if (hit?.key === key) return hit.row;
    const value = rowUncached(opp, now, colour);
    rowCache.set(opp.id, { key, row: value });
    return value;
  }
  function rowUncached(opp, now, colour) {
    const live = opp.tenant ? monitor.live(opp.id, now) : null;
    const owner = users.get(opp.ownerId);
    const muted = isMuted(opp, now);
    const nextTask = (opp.tasks ?? []).filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))[0] ?? null;
    const lastNote = (opp.notes ?? []).reduce((m, n) => (n.at > m ? n.at : m), '');
    const base = {
      id: opp.id,
      name: opp.name,
      region: regionOf(opp.ownerId),
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
      sf: opp.salesforce ? { stage: opp.salesforce.stage ?? '', amount: opp.salesforce.amount ?? null, closeDate: opp.salesforce.closeDate ?? '', probability: opp.salesforce.probability ?? null, forecast: opp.salesforce.forecast ?? '', nextStep: opp.salesforce.nextStep ?? '', reportAt: opp.salesforce.reportAt, source: opp.salesforce.source } : null,
      tenant: publicOpp(opp).tenant,
      progress: progressOf(opp),
      live,
      alerts: alertsOf(opp, live, now),
      muted,
      mute: opp.mute,
      nextTask,
      value: live?.summary ? valueFor(opp, live) : null,
      creditPool: opp.tenant ? ai.pool(opp) : null,
      forecast: {
        criteria: ['pov', 'completed'].includes(opp.stage) ? criteriaForecast(opp, now) : null,
        credits: live?.summary ? creditsForecast(live.summary, monitor.history(opp.id), now) : null,
        activity: live?.summary ? activityForecast(live.summary) : null,
      },
      lastNoteAt: lastNote || null,
      sessions: (opp.sessions ?? []).length,
      updatedAt: opp.updatedAt,
    };
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    base.prediction = predict(opp, base, { now });
    base.gaps = gaps(placed(opp), base, { facts: snap ? tenantFacts(snap) : null, people: snap ? peopleActivity(snap, now) : null, catalog, now });
    return base;
  }

  /** A person's sales region: their own, else their nearest manager's. */
  function regionOf(userId) {
    const u = users.get(userId);
    if (u?.region) return u.region;
    return users.chain(userId).find((m) => m.region)?.region ?? '';
  }
  /** A person's team: named after their team lead (or their manager, whoever that is). */
  function teamOf(userId) {
    const u = users.get(userId);
    if (!u) return '—';
    if (['team_lead', 'leader', 'vp', 'admin'].includes(u.role)) return u.name;
    const m = users.chain(userId)[0];
    return m ? m.name : u.name;
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
      value: totalValue(rows.map((r) => r.value).filter(Boolean), orgRates().currency),
    };
    const since = Date.parse(q.get('since') ?? '') || 0;
    const events = list
      .filter((o) => o.tenant)
      .flatMap((o) => eventsOf(monitor.snapshot(o.id), { povId: o.id, since }).filter((e) => !(o.mute?.projects ?? []).includes(e.projectId)).slice(0, 30))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 250);
    // What the team did in Meridian (notes, stage changes, criteria met), newest first.
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
      finals: finals(opp.id),
      mailConfigured: mailer.configured,
    };
  }

  // ——— HTTP plumbing ———
  const send = (res, status, body, headers = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const type = headers['Content-Type'] ?? 'application/json; charset=utf-8';
    // Lists of hundreds of POVs are large and very repetitive: compressed, they are about a tenth of the size.
    const accepts = /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] ?? ''));
    if (accepts && data.length > 8 * 1024 && /json|html|text|csv/.test(type) && !headers['Content-Disposition']) {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      return res.end(gzipSync(data, { level: 5 }));
    }
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  };
  const file = (res, name, type, content) => send(res, 200, content, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.\- ]+/g, '_')}"` });
  /** A file sent as the request body (a Salesforce report), up to `max` bytes. */
  const readRaw = (req, max) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const parts = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) {
          reject(fail(413, `The file is larger than ${Math.round(max / 1048576)} MB.`));
          req.destroy();
        } else parts.push(c);
      });
      req.on('end', () => (size ? resolve(Buffer.concat(parts)) : reject(fail(400, 'The file was empty.'))));
      req.on('error', reject);
    });
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
    if (m !== 'GET' && !['Meridian', 'CommandCenter'].includes(req.headers['x-requested-with'])) return send(res, 403, { error: 'Missing request header.' });

    if (route === 'POST /logout') {
      users.signOut(cookie(req, 'cc_session'));
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (route === 'GET /meta') {
      return send(res, 200, { stages: STAGES, criterionStatus: CRITERION_STATUS, sessionTypes: SESSION_TYPES, categories: catalog.categories(), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])), permissions: PERMISSIONS, templates: TEMPLATES, themes: THEMES, scanWindowDays: SCAN_WINDOW_DAYS });
    }
    // ——— Salesforce ———
    if (route === 'GET /me/salesforce') {
      const a = sfAddressOf(user.id);
      return send(res, 200, { set: Boolean(a), hint: a ? maskEmail(a.address) : '', copy: a?.copy ?? true, sender: mailer.settings.from || '' });
    }
    if (route === 'PUT /me/salesforce') {
      const b = await readBody(req);
      const all = db.read('sfaddresses', {});
      if ('address' in b) {
        const address = cleanEmail(b.address);
        if (b.address && !address) throw fail(400, 'That is not an email address. Salesforce shows yours under Settings → My Email to Salesforce.');
        if (address) all[user.id] = { address: db.seal(address), copy: b.copy !== false };
        else delete all[user.id];
      } else if (all[user.id]) all[user.id].copy = b.copy !== false;
      db.write('sfaddresses', all);
      audit.record(user, 'settings', 'address' in b ? (b.address ? 'Set their Email to Salesforce address' : 'Removed their Email to Salesforce address') : 'Changed copying emails to Salesforce');
      const a = sfAddressOf(user.id);
      return send(res, 200, { set: Boolean(a), hint: a ? maskEmail(a.address) : '', copy: a?.copy ?? true });
    }
    if (route === 'POST /salesforce/import') {
      const buf = await readRaw(req, 15 * 1048576);
      const r = await importReport(buf, { source: 'file', name: text(decodeURIComponent(req.headers['x-file-name'] ?? 'report'), 200), type: String(req.headers['content-type'] ?? '') }, user);
      audit.record(user, 'salesforce', `Brought in a Salesforce report: ${r.rows} rows, ${r.matched} matched`);
      return send(res, 200, r);
    }
    if (route === 'GET /salesforce/imports') {
      const mine = new Set(opps.visible(user).map((o) => o.id));
      const list = db.read('sfimports', []).map((x) => ({ ...x, matched: x.matched.filter((m) => mine.has(m.id)), unmatched: can(user, 'settings.manage') || x.by === user.name ? x.unmatched : [] }));
      return send(res, 200, { imports: list, mailbox: can(user, 'settings.manage') ? sfMailbox.last : undefined });
    }
    if (route === 'GET /salesforce/settings') {
      need(user, 'settings.manage');
      const s2 = sfSettings();
      const mb = s2.mailbox ?? {};
      return send(res, 200, { logStages: s2.logStages, logResults: s2.logResults, mailbox: { enabled: Boolean(mb.enabled), host: mb.host ?? '', port: mb.port ?? 993, secure: mb.secure !== false, user: mb.user ?? '', hasPassword: Boolean(mb.pass), folder: mb.folder ?? 'INBOX', senders: mb.senders ?? 'salesforce.com', everyMinutes: mb.everyMinutes ?? 30 }, last: sfMailbox.last, sender: mailer.settings.from || '', publicUrl: process.env.CC_PUBLIC_URL || '' });
    }
    if (route === 'PUT /salesforce/settings') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      const before = all.salesforce ?? {};
      const mb = before.mailbox ?? {};
      const nb = b.mailbox ?? {};
      const host = text(nb.host ?? mb.host ?? '', 200);
      if (host && !/^[a-z0-9.-]+$/i.test(host)) throw fail(400, 'The mailbox host is a name like outlook.office365.com.');
      all.salesforce = {
        logStages: 'logStages' in b ? Boolean(b.logStages) : before.logStages ?? true,
        logResults: 'logResults' in b ? Boolean(b.logResults) : before.logResults ?? true,
        mailbox: {
          enabled: 'enabled' in nb ? Boolean(nb.enabled) : Boolean(mb.enabled),
          host,
          port: Math.min(65535, Math.max(1, Math.trunc(Number(nb.port ?? mb.port)) || 993)),
          secure: 'secure' in nb ? Boolean(nb.secure) : mb.secure !== false,
          user: text(nb.user ?? mb.user ?? '', 200),
          pass: nb.pass ? db.seal(String(nb.pass)) : nb.clearPass ? '' : mb.pass ?? '',
          folder: text(nb.folder ?? mb.folder ?? 'INBOX', 200) || 'INBOX',
          senders: text(nb.senders ?? mb.senders ?? 'salesforce.com', 500),
          everyMinutes: Math.min(1440, Math.max(5, Math.trunc(Number(nb.everyMinutes ?? mb.everyMinutes)) || 30)),
        },
      };
      db.write('settings', all);
      audit.record(user, 'settings', 'Changed the Salesforce settings');
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /salesforce/mailbox/test') {
      need(user, 'settings.manage');
      try {
        return send(res, 200, await sfMailbox.test());
      } catch (error) {
        throw fail(error.status ?? 502, error.status ? error.message : `Could not open the mailbox: ${scrubText(String(error.responseText ?? error.message))}`);
      }
    }
    if (route === 'POST /salesforce/mailbox/run') {
      need(user, 'settings.manage');
      const r = await sfMailbox.run();
      audit.record(user, 'salesforce', `Read the report mailbox: ${r.imported?.length ?? 0} reports`);
      return send(res, 200, r);
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
    if (route === 'GET /settings') return send(res, 200, { valueRates: orgRates(), valueDefaults: VALUE_DEFAULTS, settings: settings(), smtp: mailer.settings, roles: { matrix: fullSettings().roles ?? DEFAULT_MATRIX, permissions: PERMISSIONS, labels: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])) } });
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
    if (route === 'PUT /settings/value') {
      need(user, 'settings.manage');
      const all = fullSettings();
      all.valueRates = cleanRates(await readBody(req));
      db.write('settings', all);
      audit.record(user, 'settings', 'Changed the value rates (minutes to triage and fix, hourly rate, credit price, currency)', { rates: all.valueRates });
      return send(res, 200, { rates: orgRates() });
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
      audit.record(user, 'system', a.enabled ? `Auto-update on: checks every ${a.everyMinutes} minutes, installs as soon as a release is found` : 'Turned off auto-update');
      return send(res, 200, updater.status());
    }
    if (route === 'POST /system/restart') {
      need(user, 'settings.manage');
      restartServer(user, 'from Settings');
      return send(res, 202, { restarting: true });
    }
    if (route === 'GET /system/health') {
      need(user, 'settings.manage');
      return send(res, 200, { checks: healthChecks({ db, backups: backupStore, monitor, audit, updater, watchdog, version: VERSION }), corrections: watchdog.corrections, repairs: db.repairs, backups: backupStore.list(), offsite: backupStore.offsite, key: { source: db.vault.source, fingerprint: db.vault.fingerprint }, launched: updater.launched });
    }
    if (route === 'POST /system/backup') {
      need(user, 'settings.manage');
      const name = backupStore.take('manual', { version: VERSION });
      audit.record(user, 'system', `Took a backup (${name})`);
      return send(res, 200, { backup: name, backups: backupStore.list() });
    }
    if (m === 'POST' && parts[0] === 'system' && parts[1] === 'backups' && parts[2] && parts[3] === 'verify') {
      need(user, 'settings.manage');
      return send(res, 200, backupStore.verify(parts[2]));
    }
    if (route === 'POST /system/restore') {
      need(user, 'settings.manage');
      if (!updater.launched) throw fail(409, 'Restoring needs the launcher (npm start or the container image), which restarts the server with the restored records.');
      const b = await readBody(req);
      const r = backupStore.restore(text(b.name, 200), { version: VERSION });
      audit.record(user, 'system', `Restored the backup ${r.restored} (the data before it is in ${r.undo})`);
      setTimeout(() => process.exit(RESTART_CODE), 300);
      return send(res, 202, { ...r, restarting: true });
    }
    if (route === 'GET /system/backup/download') {
      need(user, 'settings.manage');
      audit.record(user, 'system', 'Downloaded a backup of the data');
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="meridian-backup-${new Date().toISOString().slice(0, 10)}.tar.gz"`, 'Cache-Control': 'no-store' });
      // Encrypted records only: never the key, the snapshots (read again from Checkmarx One) or temporary copies.
      const tar = spawn('tar', ['-czf', '-', '--exclude=./app', '--exclude=./backups', '--exclude=./snapshots', '--exclude=./secret.key', '--exclude=*.prev', '--exclude=*.tmp', '--exclude=*.damaged-*', '-C', dataDir, '.']);
      tar.stdout.pipe(res);
      tar.on('error', () => res.end());
      return;
    }
    if (route === 'GET /system/about') {
      return send(res, 200, { version: VERSION, node: process.version, repo: updater.status().repo, licence: 'Internal use', startedAt: STARTED_AT, launched: updater.launched, dataDir: can(user, 'settings.manage') ? dataDir : undefined, backups: can(user, 'settings.manage') ? backupStore.list().slice(0, 10).map((x) => x.name) : undefined, audit: can(user, 'settings.manage') ? audit.verify() : undefined });
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
    if (route === 'GET /overview') {
      // The same scope (the people one can see) and filters give the same answer for a few seconds: worked out
      // and compressed once, served to everyone looking at it.
      const scope = [...users.visibleIds(user)].sort().join(',');
      const key = `${createHash('sha1').update(scope).digest('hex')}|${url.searchParams}`;
      const hit = overviewCache.get(key);
      const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      if (!hit || Date.now() - hit.at > OVERVIEW_TTL_MS) {
        const json = JSON.stringify(overview(user, url.searchParams));
        overviewCache.set(key, { at: Date.now(), json, gzip: gzipSync(json, { level: 5 }) });
        if (overviewCache.size > 500) overviewCache.delete(overviewCache.keys().next().value);
      }
      const c = overviewCache.get(key);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
      return res.end(gz ? c.gzip : c.json);
    }
    if (route === 'GET /results') return send(res, 200, { results: resultsList(user, url.searchParams) });
    if (route === 'GET /insights') {
      const o = overview(user, url.searchParams);
      const region = url.searchParams.get('region');
      const rows = region ? o.rows.filter((r) => r.region === region || r.tenant?.regionLabel === region) : o.rows;
      return send(res, 200, { at: o.at, ...rollups(rows, { teamOf, regionOf }), regions: [...new Set(o.rows.map((r) => r.region).filter(Boolean))].sort(), tenantRegions: [...new Set(o.rows.map((r) => r.tenant?.regionLabel).filter(Boolean))].sort() });
    }
    if (route === 'GET /results/download') {
      const list = resultsList(user, url.searchParams);
      if (!list.length) throw fail(404, 'No POV with success criteria to make a results page for.');
      const files = list.map((r) => {
        const last = r.finalAt ? finals(r.id)[0] : null;
        const html = last ? db.vault.readFile(path.join(resultsDir(r.id), last.file)).toString('utf8') : resultsPage(resultsData(opps.get(r.id)));
        return { name: `${r.customer} - POV results${last ? ' (final)' : ''}.html`, data: html };
      });
      const esc2 = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>POV results</title><style>body{font:15px/1.5 Arial,sans-serif;background:#140920;color:#fff;margin:40px}a{color:#c9b6ff}td,th{padding:8px 14px;border-bottom:1px solid #3a2352;text-align:left}th{color:#b9b0cc;font-size:12px;text-transform:uppercase;letter-spacing:.1em}</style></head><body><h1>POV results</h1><p style="color:#b9b0cc">${list.length} POV${list.length === 1 ? '' : 's'} · made ${new Date().toUTCString()}</p><table><tr><th>Customer</th><th>SE</th><th>Stage</th><th>Criteria</th><th>Result</th></tr>${list.map((r, i) => `<tr><td><a href="${encodeURI(files[i].name)}">${esc2(r.customer)}</a></td><td>${esc2(r.owner)}</td><td>${esc2(STAGES[r.stage])}</td><td>${r.progress.met}/${r.progress.total} (${r.progress.percent}%)</td><td>${r.finalAt ? `Final, ${esc2(new Date(r.finalAt).toUTCString())}` : 'Live'}</td></tr>`).join('')}</table></body></html>`;
      audit.record(user, 'reports', `Downloaded ${list.length} POV results page${list.length === 1 ? '' : 's'}`);
      return file(res, `POV results ${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip', zip([{ name: 'index.html', data: index }, ...files]));
    }
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
        const wasSuccessful = opps.get(id)?.povResult === 'successful';
        const stageBefore = opps.get(id)?.stage;
        const opp = opps.update(user, id, await readBody(req), s);
        // A running POV is read now; one that just completed gets a final read for its report and deck.
        const read = opp.tenant && (POLLED_STAGES.has(opp.stage) || opp.stage === 'completed') ? monitor.refresh(id, { force: true }).catch(() => {}) : Promise.resolve();
        // Marked successful: once that final read is in, its results page is kept as it stands now.
        if (!wasSuccessful && opp.povResult === 'successful') read.then(() => freezeResults(id, user)).catch(() => {});
        // Salesforce hears about stage changes and the POV result from the SE's own Email to Salesforce address.
        const sfs = sfSettings();
        const logIt = (entry) => {
          const from = sfAddressOf(user.id) ? user.id : sfAddressOf(opp.ownerId) ? opp.ownerId : null;
          if (from && mailer.settings.host) sfLog(user, opps.get(id), entry, { addressOf: from }).catch((error) => console.error(`Salesforce log failed: ${error.message}`));
        };
        if (sfs.logStages && opp.stage !== stageBefore) logIt({ kind: 'Stage', title: `${STAGES[stageBefore]} → ${STAGES[opp.stage]}`, lines: sfStatus(opp).lines });
        if (sfs.logResults && !wasSuccessful && opp.povResult === 'successful') logIt({ kind: 'POV result', title: 'POV successful', lines: progressOf(opp).total ? [`${progressOf(opp).met} of ${progressOf(opp).total} success criteria completed successfully`] : [] });
        return done(opp);
      }
      if (!sub && m === 'DELETE') {
        opps.remove(user, id, s);
        ai.forget(id);
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
      // A demo session recorded against a criterion (completed by the SE's demonstration, not in the tenant)
      if (sub === 'criteria' && parts[3] && parts[4] === 'demo' && m === 'POST') {
        const b = await readBody(req);
        opps.mutate(user, id, s, (o) => {
          const c = (o.criteria ?? []).find((x) => x.id === parts[3]);
          if (!c) throw fail(404, 'No such criterion.');
          const before = c.status;
          const next = opps.cleanCriterion({ ...c, status: b.markCompleted === false ? c.status : 'met', proofType: b.markCompleted === false ? c.proofType : 'demo', demo: { ...b, by: c.demo?.by || user.id } }, user, c);
          Object.assign(c, next);
          (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `"${c.title}": demonstrated by the SE on ${c.demo.date}${before !== c.status ? ' — Completed successfully' : ''}` });
        });
        return done();
      }
      if (sub === 'criteria' && parts[3] && parts[4] === 'demo-video') {
        const opp = viewOpp(user, id);
        const c = (opp.criteria ?? []).find((x) => x.id === parts[3]);
        if (!c) throw fail(404, 'No such criterion.');
        if (m === 'GET') return streamVideo(req, res, opp.id, c);
        if (!opps.canEdit(user, opps.get(id), s)) throw fail(403, 'You can view this POV but not change its demos.');
        if (m === 'DELETE') {
          removeVideo(opp.id, c);
          opps.mutate(user, id, s, (o) => {
            const x = o.criteria.find((y) => y.id === c.id);
            if (x.demo) x.demo.video = null;
            (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `"${x.title}": removed the demo video` });
          });
          return done();
        }
        if (m === 'PUT') {
          const video = await saveVideo(req, opp.id, c, url.searchParams.get('name'));
          opps.mutate(user, id, s, (o) => {
            const x = o.criteria.find((y) => y.id === c.id);
            x.demo = { ...(x.demo ?? { date: new Date().toISOString().slice(0, 10), by: user.id, at: new Date().toISOString() }), video };
            (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `"${x.title}": uploaded a demo video (${video.name}, ${(video.size / 1048576).toFixed(1)} MB)` });
          });
          return done();
        }
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
      // ——— AI actions and credits ———
      if (sub === 'ai') {
        const opp = viewOpp(user, id);
        const raw = opps.get(id);
        const canEdit = opps.canEdit(user, raw, s);
        const canRun = canEdit && users.can(user, 'ai.run', s);
        const canAllocate = users.can(user, 'credits.allocate', s) && (user.role === 'admin' || users.isBelow(user, raw.ownerId));
        const state = () => ({ pool: ai.pool(raw), ledger: [...ai.ledger(id)].reverse().slice(0, 200).map(({ alternateIds, ...e }) => e), value: valueFor(raw), rates: ratesFor(db.read('settings', {}).valueRates ?? {}, raw.valueRates ?? {}), ownRates: raw.valueRates ?? {}, orgRates: orgRates(), canRun, canAllocate, canEditRates: canEdit, hasTenant: Boolean(raw.tenant), ai: monitor.snapshot(id)?.ai ?? null, backlog: monitor.snapshot(id)?.findings?.ai ?? null });
        const loaded = async (force = false) => {
          if (!raw.tenant) throw fail(400, 'Connect a Checkmarx One tenant first.');
          const projects = monitor.snapshot(id)?.projects?.list ?? [];
          if (!projects.length) throw fail(409, 'The tenant has not been read yet, or has no projects: refresh it first.');
          return ai.findings(raw, opps.connection(id), projects, { force });
        };
        const tenantLeft = async () => {
          try {
            const info = await new CxClient(opps.connection(id)).request('/api/credits/info', { retries: 1 });
            return Number.isFinite(Number(info?.available)) ? Number(info.available) : null;
          } catch {
            return null;
          }
        };
        if (!parts[3] && m === 'GET') return send(res, 200, state());
        if (parts[3] === 'pool' && m === 'PUT') {
          if (!canAllocate) throw fail(403, 'Only a manager of this POV’s SE may set its credit pool (Set the credit pool of POVs in their team).');
          const b = await readBody(req);
          const size = b.size === null || b.size === '' ? null : Math.trunc(Number(b.size));
          if (size !== null && !(size >= 0 && size <= 1_000_000)) throw fail(400, 'The pool is a number of credits.');
          opps.mutate({ ...user, role: 'admin' }, id, s, (o) => {
            o.creditPool = size === null ? null : { size, by: user.name, at: new Date().toISOString() };
            (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: size === null ? 'Removed the credit pool' : `Set the credit pool to ${size} credits` });
          });
          audit.record(user, 'credits', `${raw.customer}: credit pool ${size === null ? 'removed' : `set to ${size}`}`, { oppId: id });
          notify({ id });
          return send(res, 200, state());
        }
        if (parts[3] === 'findings' && m === 'POST') {
          const b = await readBody(req);
          const l = await loaded(Boolean(b.force));
          return send(res, 200, { ...state(), loaded: { readAt: l.readAt, projects: l.projects, errors: l.errors, total: l.findings.length } });
        }
        if ((parts[3] === 'plan' || parts[3] === 'run') && m === 'POST') {
          if (!canRun) throw fail(403, 'Your role may not run AI actions on this POV.');
          const b = await readBody(req);
          const l = await loaded();
          const plan = ai.plan(raw, l, { action: b.action, projectIds: b.projectIds ?? [], severities: b.severities ?? [], tenantAvailable: await tenantLeft() });
          const { selected, ...shown } = plan;
          if (parts[3] === 'plan') return send(res, 200, { plan: shown });
          if (!b.confirm || Number(b.credits) !== plan.credits) throw fail(409, `Confirm the run: it costs ${plan.credits} credits.`);
          const result = await ai.run(raw, opps.connection(id), plan, user);
          const what = plan.action === 'triage' ? 'AI Triage' : 'AI Remediation';
          audit.record(user, 'credits', `${raw.customer}: ${what} on ${result.sent} finding${result.sent === 1 ? '' : 's'} (${plan.severities.join(', ').toLowerCase()}), ${result.charged} credits`, { oppId: id, failed: result.failed, jobs: result.jobs });
          opps.mutate({ ...user, role: 'admin' }, id, s, (o) => (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `Ran ${what} on ${result.sent} finding${result.sent === 1 ? '' : 's'}: ${result.charged} credits${result.failed ? `, ${result.failed} failed` : ''}` }));
          monitor.refresh(id, { force: true }).catch(() => {});
          notify({ id });
          return send(res, 200, { result, ...state() });
        }
      }
      if (sub === 'results' && m === 'GET' && url.searchParams.get('final')) {
        const opp = viewOpp(user, id);
        const last = finals(id)[0];
        if (!last) throw fail(404, 'This POV has no final results yet: it gets one when it is marked successful.');
        const html = db.vault.readFile(path.join(resultsDir(id), last.file)).toString('utf8');
        if (url.searchParams.get('download')) return file(res, `${opp.customer} - POV results (final).html`, 'text/html; charset=utf-8', html);
        const nonce = randomBytes(12).toString('base64');
        return send(res, 200, html.replace('<script>', `<script nonce="${nonce}">`), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; media-src data:; frame-ancestors 'self'` });
      }
      if (sub === 'results' && m === 'POST' && parts[3] === 'freeze') {
        const opp = viewOpp(user, id);
        if (!opps.canEdit(user, opps.get(id), s)) throw fail(403, 'You can view this POV but not keep its results.');
        freezeResults(opp.id, user);
        return done(opps.get(id));
      }
      if (sub === 'results' && m === 'GET') {
        const opp = viewOpp(user, id);
        const nonce = randomBytes(12).toString('base64');
        const html = resultsPage(resultsData(opp), { nonce });
        if (url.searchParams.get('download')) return file(res, `${opp.customer} - POV results.html`, 'text/html; charset=utf-8', resultsPage(resultsData(opp)));
        return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; media-src data:; frame-ancestors 'self'` });
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
      if (sub === 'salesforce' && parts[3] === 'log' && m === 'POST') {
        const opp = viewOpp(user, id);
        if (!opps.canEdit(user, opp, s)) throw fail(403, 'You can view this opportunity but not log it to Salesforce.');
        const b = await readBody(req);
        let entry;
        if (b.kind === 'task' || b.kind === 'note') {
          const list = b.kind === 'task' ? 'tasks' : 'notes';
          const item = (opp[list] ?? []).find((x) => x.id === b.itemId);
          if (!item) throw fail(404, `No such ${b.kind}.`);
          entry = b.kind === 'task'
            ? { kind: item.done ? 'Task completed' : 'Task', title: item.title, due: item.due ?? '', lines: [item.notes ?? ''].filter(Boolean), itemKind: 'tasks', itemId: item.id }
            : { kind: 'Note', title: String(item.text ?? '').split('\n')[0].slice(0, 90), lines: [String(item.text ?? '')], itemKind: 'notes', itemId: item.id };
        } else entry = sfStatus(opp);
        return send(res, 200, await sfLog(user, opp, entry));
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
          const sf = sfAddressOf(user.id);
          messageId = await mailer.send(msg, { replyTo: user.email, attachments, bcc: sf?.copy ? [sf.address] : [] });
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
          state: stateOf(c),
          demo: c.demo ? { ...c.demo, by: c.demo.by ? users.get(c.demo.by)?.name ?? '' : '', video: demoVideoData(opp.id, c) } : null,
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
      value: valueFor(raw),
      platform: platformView(opp, catalog),
      flow: flowView(opp, catalog, snap, opp.tenant ? monitor.live(opp.id).summary : null),
      criteria,
      tenant: opp.tenant ? monitor.live(opp.id).summary : null,
      sessions: [...(opp.sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date, title: x.title, type: SESSION_TYPES[x.type] ?? '' })),
      next: (opp.tasks ?? []).filter((t) => !t.done).map((t) => t.title).slice(0, 8),
    };
  }

  function deckOf(opp) {
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    return finalDeck(opp, { owner: users.get(opp.ownerId), live: opp.tenant ? monitor.live(opp.id) : null, people: snap ? peopleActivity(snap) : null, evidence: evidenceOf(opp), categories: catalog.categories(), org: settings().orgName, catalog, flow: flowView(placed(opp), catalog, snap, opp.tenant ? monitor.live(opp.id).summary : null) });
  }

  /** One text file: the tenant's read, every failed scan of the last 7 days and each failed engine's log. */
  async function troubleshootBundle(opp) {
    if (!opp.tenant) throw fail(400, 'Connect a Checkmarx One tenant first.');
    const snap = monitor.snapshot(opp.id);
    const live = monitor.live(opp.id);
    const lines = [`Meridian troubleshooting bundle — ${opp.customer} — tenant ${opp.tenant.tenant} (${opp.tenant.regionLabel})`, `Made ${new Date().toISOString()}`, `API ${opp.tenant.baseUrl}`, `Last read: ${snap?.at ?? 'never'} (${snap?.ms ?? '?'} ms)${live.error ? `; last error ${live.error.at}: ${live.error.message}` : ''}`, ...(snap?.errors ?? []).map((e) => `Part not read: ${e.part}: ${e.message}`), ''];
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

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, version: VERSION, reading: monitor.load(), memoryMb: Math.round(process.memoryUsage().rss / 1048576) });
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') serveStatic(req, res, url);
      else send(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) send(res, status === 401 && !String(error.message).includes('match') ? 400 : status, { error: scrubText(String(error.message ?? error)) });
    }
  };
  const server = cert
    ? https.createServer({ ...cert.options, minVersion: 'TLSv1.2' }, (req, res) => {
        // A real certificate: browsers are told to keep to HTTPS. (Not for a self-signed one: they would ignore it.)
        if (!cert.selfSigned) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
        return handler(req, res);
      })
    : http.createServer(handler);
  if (cert) {
    // A renewed certificate is taken without a restart.
    let reloadTimer = null;
    for (const f of cert.files)
      fs.watchFile(f, { interval: 60_000, persistent: false }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          try {
            server.setSecureContext({ ...cert.load(), minVersion: 'TLSv1.2' });
            console.log('[https] Certificate reloaded.');
          } catch (error) {
            console.error(`[https] The new certificate was not taken: ${error.message}`);
          }
        }, 2000);
      });
    server.on('close', () => cert.files.forEach((f) => fs.unwatchFile(f)));
  }
  server.tlsInfo = cert ? { selfSigned: cert.selfSigned, description: cert.description } : null;
  // ——— Demo videos: small (≤ 25 MB) MP4 or WebM, kept in the data folder, played in the app and embedded in the results page ———
  const MAX_VIDEO = 25 * 1048576;
  const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
  const videoPath = (oppId, v) => path.join(dataDir, 'demos', oppId.replace(/[^0-9a-f-]/gi, ''), `${String(v.id).replace(/[^0-9a-f-]/gi, '')}.${VIDEO_TYPES[v.type] ?? 'bin'}`);
  function saveVideo(req, oppId, c, name) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!VIDEO_TYPES[type]) throw fail(415, 'Upload an MP4 or WebM video.');
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_VIDEO) throw fail(413, 'The video is larger than 25 MB: trim it or export it smaller (720p is plenty).');
    const v = { id: randomUUID(), name: text(name, 120) || `demo.${VIDEO_TYPES[type]}`, type, size: 0, at: new Date().toISOString() };
    const file = videoPath(oppId, v);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file, { mode: 0o600 });
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_VIDEO) {
          req.destroy();
          out.destroy();
          fs.rmSync(file, { force: true });
          reject(fail(413, 'The video is larger than 25 MB: trim it or export it smaller (720p is plenty).'));
        }
      });
      req.pipe(db.vault.encryptingStream()).pipe(out);
      out.on('finish', () => {
        if (size > MAX_VIDEO) return;
        if (!size) {
          fs.rmSync(file, { force: true });
          return reject(fail(400, 'The video was empty.'));
        }
        if (c.demo?.video) removeVideo(oppId, c);
        resolve({ ...v, size });
      });
      out.on('error', reject);
    });
  }
  function removeVideo(oppId, c) {
    if (c.demo?.video) fs.rmSync(videoPath(oppId, c.demo.video), { force: true });
  }
  /** Played, never offered as a download: inline, with seeking (Range) support. */
  function streamVideo(req, res, oppId, c) {
    const v = c.demo?.video;
    if (!v) throw fail(404, 'No demo video.');
    const file = videoPath(oppId, v);
    const size = db.vault.plainSize(file);
    const head = { 'Content-Type': v.type, 'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return db.vault.readStream(file, start, end).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': size });
    db.vault.readStream(file).pipe(res);
  }
  /** The video as a data: address for the self-contained results page (it plays offline, from the file itself). */
  function demoVideoData(oppId, c) {
    const v = c.demo?.video;
    if (!v) return null;
    try {
      return { name: v.name, type: v.type, size: v.size, src: `data:${v.type};base64,${db.vault.readFile(videoPath(oppId, v)).toString('base64')}` };
    } catch {
      return null;
    }
  }

  // ——— Results pages: one per POV; a final copy kept when it is marked successful ———
  const resultsDir = (id) => path.join(dataDir, 'results', id.replace(/[^0-9a-f-]/gi, ''));
  const finals = (id) => {
    try {
      return fs.readdirSync(resultsDir(id)).filter((f) => f.endsWith('.html')).sort().reverse().map((f) => ({ file: f, at: f.replace(/\.html$/, '').replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z') }));
    } catch {
      return [];
    }
  };
  function freezeResults(id, actor) {
    const opp = opps.get(id);
    if (!opp) return;
    const dir = resultsDir(id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    db.vault.writeFile(path.join(dir, `${new Date().toISOString().replace(/:/g, '-').replace('.', '-')}.html`), resultsPage(resultsData(opp)), { keepPrevious: false });
    opps.mutate({ ...actor, role: 'admin' }, id, fullSettings(), (o) => (o.history ??= []).push({ at: new Date().toISOString(), by: actor?.id ?? '', what: 'Kept the final results page' }));
    notify({ id });
  }
  function resultsList(viewer, q) {
    const owner = q.get('owner');
    const scope = owner ? new Set([owner, ...users.descendants(owner)]) : null;
    const stage = q.get('stage');
    return opps
      .visible(viewer)
      .filter((o) => (o.criteria ?? []).length && (!scope || scope.has(o.ownerId)) && (!stage || o.stage === stage || (stage === 'open' && !['won', 'lost'].includes(o.stage))))
      .map((o) => ({ id: o.id, customer: o.customer, name: o.name, owner: users.get(o.ownerId)?.name ?? '', stage: o.stage, povResult: o.povResult ?? '', progress: progressOf(o), tenant: o.tenant?.tenant ?? null, finalAt: finals(o.id)[0]?.at ?? null }))
      .sort((a, b) => a.customer.localeCompare(b.customer));
  }

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
  /** Every connection the server makes or takes, for the network team. */
  const allowlist = () => {
    const out = [{ direction: 'in', host: 'this server', port: Number(process.env.PORT) || 4310, why: 'People opening Meridian (HTTPS when behind your reverse proxy)' }];
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
  if (startBackground) backupStore.start({ version: VERSION });
  const watchdog = new Watchdog({ monitor, launched: updater.launched, restart: () => setTimeout(() => process.exit(RESTART_CODE), 300) });
  if (startBackground) watchdog.start();
  if (startBackground) sfMailbox.start();

  server.on('close', () => {
    updater.stop();
    backupStore.stop();
    sfMailbox.stop();
    watchdog.stop();
    monitor.stop();
    clearInterval(hourly);
  });
  return { server, db, users, opps, catalog, monitor, mailer, firstAdmin, weeklyDrafts, updater, audit, backups: backupStore, watchdog };
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
  const app = createApp({ tls: startMode() === 'https' });
  if (app.firstAdmin) {
    console.log(`\n  First start. Sign in as ${app.firstAdmin.email} with password: ${app.firstAdmin.password}\n  (you will be asked to change it)\n`);
  }
  app.server.listen(port, host, () => {
    if (app.server.tlsInfo) console.log(`[https] ${app.server.tlsInfo.selfSigned ? 'Self-signed certificate (browsers warn until it is trusted; set TLS_CERT_FILE and TLS_KEY_FILE for your own)' : 'Certificate'}: ${app.server.tlsInfo.description}`);
    console.log(`Meridian ${VERSION} on ${app.server.tlsInfo ? 'https' : 'http'}://${host}:${port} — reading POV tenants every ${app.monitor.intervalMs / 60_000} min`);
    app.monitor.start();
  });
  const stop = () => app.server.close(() => process.exit(0));
  // The last line of defence: an unexpected error is logged; a thrown one ends the process, and the launcher starts
  // a clean one within seconds (records are written atomically, so nothing is half-saved).
  process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception, restarting:', error);
    process.exit(1);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
