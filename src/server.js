/**
 * Kendra: discovery → technical sessions → POV → outcome, for every SE in a team, in one place.
 *
 * One dependency (nodemailer). Everything it keeps lives in the data folder (CC_DATA_DIR, /data in the container).
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { startMode, tlsOptions, certificateInfo, saveUploaded, removeUploaded } from './tls.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, fail, text, email as cleanEmail } from './db.js';
import { Backups } from './backups.js';
import { Trail } from './trail.js';
import { Watchdog, healthChecks } from './health.js';
import { readTable, readCsv, recordsOf, matchRecords, logMessage, opportunityIdOf } from './salesforce.js';
import { SfMailbox } from './sf-mailbox.js';
import { Templates } from './templates.js';
import { Bank } from './bank.js';
import { rwReport } from './guide.js';
import { makePass, readPass, newLinkKey, safePath, cleanPartnerUrl, movePage } from './link.js';
import { Links, Help, imageFrom, maskEmail } from './self-service.js';
import { Sso, mergeSso } from './sso.js';
import { tenantEvidence } from './tenant-evidence.js';
import { Library } from './library.js';
import { Users, ROLES, PERMISSIONS, DEFAULT_MATRIX, THEMES } from './users.js';
import { Catalog, CATEGORIES, tenantFacts, evaluate, provingScans } from './catalog.js';
import { Opportunities, STAGES, CRITERION_STATUS, SESSION_TYPES, publicOpp, progressOf, wordsOf, isMuted } from './opportunities.js';
import { Monitor } from './monitor.js';
import { Mailer, TEMPLATES, draft, cleanMessage, toEml } from './mail.js';
import { successReport } from './report.js';
import { eventsOf, scanLog, exportSbom, peopleActivity, SCAN_WINDOW_DAYS } from './collector.js';
import { finalDeck } from './deck.js';
import { wipDeck, checkTemplate, analyzeTemplate } from './wip.js';
import { SharePoint } from './sharepoint.js';
import { DeckTemplates, SLIDES, DEFAULT_LAYOUT, SLIDE_VARIANTS, DEFAULT_VARIANTS, cleanLayout, cleanVariants, cleanTitles } from './deck-templates.js';
import { demoOpportunity, demoScreenshot } from './deck-demo.js';
import { canPreview, previewDeck, fingerprint, prunePreviews } from './deck-preview.js';
import { lockDataDir, preflight, AdminAlerts, ErrorLog, verifyManifest } from './stability.js';
import { readApma, cleanApma, forAnotherCustomer } from './apma.js';
import { TOOLCHAIN, POV_ROLES, PLAN_DEFAULTS, DEVSECOPS } from './toolchain.js';
import { predict, gaps, rollups, dayReading, insightsMore } from './insights.js';
import { flowView } from './flow.js';
import { Updater, RESTART_CODE } from './updates.js';
import { Audit } from './audit.js';
import { zip } from './zip.js';
import { gzipSync } from 'node:zlib';
import { AiActions } from './ai-actions.js';
import { valueOf, ratesFor, cleanRates, totalValue, VALUE_DEFAULTS } from './value.js';
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const MAX_BODY = 512 * 1024;
const DAY = 86_400_000;
const KINDS = new Set(['stakeholders', 'sessions', 'notes', 'tasks', 'criteria']);
const POLLED_STAGES = new Set(['pov']);
const DEFAULT_SETTINGS = { orgName: 'Kendra', refreshMinutes: 10, defaultTheme: 'orbit', defaultMode: 'light', lookForAll: false, weeklyDrafts: true, reportStyle: 'classic' };

export function createApp({ dataDir = process.env.CC_DATA_DIR || path.join(ROOT, 'data'), collectFn, verifyKey = defaultVerify, secureCookies = process.env.CC_SECURE_COOKIES === 'true', updaterOptions = null, backupOptions = null, startBackground = true, tls = false } = {}) {
  // HTTPS served here (src/tls.js): the given certificate, else a self-signed one; cookies are then always Secure.
  const cert = tls ? tlsOptions(dataDir) : null;
  if (cert) secureCookies = true;
  // One server per data folder, and what a crash left half-written cleared, before anything is read.
  const releaseLock = lockDataDir(dataDir);
  for (const note of preflight(dataDir)) console.warn(`[start] ${note}`);
  const db = new Db(dataDir);
  // A restore chosen before the restart is put in place now, before any record is read.
  {
    const restored = new Backups({ dataDir, vault: db.vault }).applyPending();
    if (restored) console.log(`[start] Restored the backup ${restored}.`);
  }
  const users = new Users(db);
  const catalog = new Catalog(db);
  const library = new Library(db);
  const bank = new Bank(db, { catalog, library });
  const opps = new Opportunities(db, { users, catalog, bank });
  const mailer = new Mailer(db);
  const PREVIEWS = path.join(dataDir, 'previews');
  const links = new Links(db);
  // Single sign-on with SAML 2.0 (src/sso.js, as in the FTR command center).
  const sso = new Sso({ settings: () => db.read('settings', {}).sso, publicUrl: String(process.env.CC_PUBLIC_URL || '') });
  const leadersList = () => users.list().filter((u) => u.active !== false && ['vp', 'leader', 'team_lead'].includes(u.role)).map((u) => ({ id: u.id, name: u.name, role: u.roleLabel }));
  const help = new Help(db);
  // Sign-in rules (Settings → Sign-in): who may reset a forgotten password by email; who may join by themselves.
  const signinRules = () => {
    const v = db.read('settings', {}).signin ?? {};
    return { reset: ['everyone', 'not-admins', 'nobody'].includes(v.reset) ? v.reset : 'everyone', join: { enabled: v.join?.enabled === true, domains: Array.isArray(v.join?.domains) && v.join.domains.length ? v.join.domains : ['checkmarx.com'] } };
  };
  const publicUrl = () => String(process.env.CC_PUBLIC_URL || '').replace(/\/$/, '');
  const mailReady = () => {
    const missing = [];
    if (!mailer.configured) missing.push('The email server is not set up (Settings → Email).');
    if (!publicUrl()) missing.push('CC_PUBLIC_URL is not set to the https address people use.');
    return missing;
  };
  const brand = () => {
    const b = db.read('brand', {});
    return { tagline: b.tagline ?? 'One line of sight', logoAt: b.logo?.at ?? null, iconAt: b.icon?.at ?? null };
  };
  // What the page may see of the settings: never the email server's or the proxy's secrets.
  const settings = () => {
    const { smtp, network, lastWeeklyDrafts, salesforce, sharepoint: _sp, ...rest } = { ...DEFAULT_SETTINGS, ...db.read('settings', {}) };
    // The product's old names, saved as the organisation's name before it was renamed Kendra, read as Kendra.
    if (['Meridian', 'CommandCenter', 'Command Center'].includes(rest.orgName)) rest.orgName = 'Kendra';
    return { ...rest, security: { sessionHours: 12, maxAttempts: 10, ...(rest.security ?? {}) }, brand: brand() };
  };
  const fullSettings = () => db.read('settings', {});
  // Light became the default look (2026-11): once, an organisation still on the old dark default moves to light.
  {
    const all = db.read('settings', {});
    if (!all.lightDefault) {
      if (all.defaultMode === 'dark') all.defaultMode = 'light';
      all.lightDefault = true;
      db.write('settings', all);
    }
  }
  // Linked apps: the FTR Credits Command Center, one sign-in for both (src/link.js).
  const linkSettings = () => {
    const l = db.read('settings', {}).link ?? {};
    return { ftrUrl: l.ftrUrl ?? '', key: l.key ? db.open(l.key) : '', at: l.at ?? null, by: l.by ?? '', teams: l.teams !== false, domains: Array.isArray(l.domains) ? l.domains : ['checkmarx.com'], lastSync: l.lastSync ?? null };
  };
  const linkReady = () => {
    const l = linkSettings();
    return Boolean(l.ftrUrl && l.key);
  };
  const usedPasses = new Map();
  /** The FTR command center's team structure, read with a pass made for this alone, made into Kendra's reporting tree. */
  let syncing = null;
  async function syncTeams(by = null) {
    if (syncing) return syncing;
    syncing = (async () => {
      const l = linkSettings();
      const save = (lastSync) => {
        const all = db.read('settings', {});
        if (all.link) all.link.lastSync = lastSync;
        db.write('settings', all);
        return lastSync;
      };
      try {
        if (!linkReady()) throw new Error('Not linked to the FTR command center.');
        const pass = makePass({ key: l.key, from: 'kendra', to: 'ftr', purpose: 'directory' });
        const r = await fetch(`${l.ftrUrl}/link/kendra/directory`, { headers: { 'X-Link-Pass': pass, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `The FTR command center answered ${r.status}.`);
        const counts = users.syncDirectory(body);
        audit.record(by, 'people', `Teams from the FTR command center: ${counts.added} added, ${counts.updated} changed, ${counts.off} turned off`);
        return save({ at: new Date().toISOString(), ok: true, teams: (body.teams ?? []).length, people: (body.people ?? []).length, ...counts });
      } catch (error) {
        audit.record(by, 'people', `Teams from the FTR command center failed: ${error.message}`);
        return save({ at: new Date().toISOString(), ok: false, error: String(error.message).slice(0, 300) });
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }
  // Insights: one reading of every POV a day (score, critical gaps, amount), 120 days kept, to show what moved.
  const recordReading = () => {
    const day = new Date().toISOString().slice(0, 10);
    const h = db.read('insightsHistory', {});
    if (h[day] && Date.now() - (h[`${day}:at`] ?? 0) < 3_600_000) return;
    const now = Date.now();
    h[day] = dayReading(opps.raw().map((o) => row(o, now)));
    h[`${day}:at`] = now;
    for (const k of Object.keys(h)) if (k.slice(0, 10) < new Date(now - 120 * 86_400_000).toISOString().slice(0, 10)) delete h[k];
    db.write('insightsHistory', h);
  };
  // Software integrity: the files running are the ones installed (checked at start, every 6 hours, and on demand).
  let integrity = null;
  const checkIntegrity = () => {
    try {
      integrity = { at: new Date().toISOString(), ...verifyManifest(ROOT) };
    } catch (error) {
      integrity = { at: new Date().toISOString(), ok: true, checked: false, changed: [], error: String(error.message ?? error).slice(0, 200) };
    }
    return integrity;
  };
  checkIntegrity();
  if (startBackground) setInterval(checkIntegrity, 6 * 3_600_000).unref();
  // Teams from the FTR command center: a minute after start, then every hour (when linked and turned on).
  if (startBackground) {
    const teamSync = () => linkReady() && linkSettings().teams && syncTeams(null).catch(() => {});
    setTimeout(teamSync, 60_000).unref();
    setInterval(teamSync, 3_600_000).unref();
  }
  if (startBackground) setInterval(() => { try { recordReading(); } catch {} }, 3_600_000).unref();
  const firstAdmin = users.ensureAdmin();
  // The audit trail: every change (kept for good) and every request (kept CC_ACCESS_DAYS days), chained and encrypted.
  const trail = new Trail({ dataDir, vault: db.vault });
  const audit = new Audit(db, trail);
  const templates = new Templates(db, { users, catalog });
  opps.onHistory = ({ opp, actor, what }) => {
    const who = actor?.id ? users.get(actor.id) ?? actor : null;
    trail.change({ by: who?.id ?? '', byName: who?.name ?? 'Kendra', role: who?.role ?? '', type: 'opportunity', what, opp: opp.id, customer: opp.customer });
  };
  const ai = new AiActions({ db });
  const orgRates = () => ratesFor(db.read('settings', {}).valueRates ?? {});
  const valueFor = (opp, live = opp.tenant ? monitor.live(opp.id) : null) => (live?.summary ? valueOf({ credits: monitor.snapshot(opp.id)?.credits, summary: live.summary, backlog: monitor.snapshot(opp.id)?.findings?.ai ?? null, ledger: ai.ledger(opp.id), rates: ratesFor(db.read('settings', {}).valueRates ?? {}, opp.valueRates ?? {}) }) : null);
  const updater = new Updater({ dataDir, currentVersion: VERSION, restart: () => gracefulExit(RESTART_CODE, 'update'), ...(updaterOptions ?? {}) });
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
  // ——— Restarting without dropping anyone ———
  // New requests are answered "restarting, try again in 3 s" (the browser waits and retries), requests under way
  // finish, then sign-ins and the audit queue are saved before the process ends.
  let draining = false;
  let inFlight = 0;
  function gracefulExit(code, why = '') {
    if (draining) return;
    draining = true;
    if (why) console.log(`[meridian] Stopping (${why}): finishing ${inFlight} request(s) first.`);
    const end = Date.now() + 6000;
    const finish = () => {
      // A last backup on the way out (not for a restore, which has its own 'before-restore' one).
      if (why !== 'restore') {
        try {
          backupStore.take('stop', { version: VERSION });
        } catch (error) {
          console.error(`[meridian] The backup on stopping failed: ${error.message}`);
        }
      }
      for (const f of [() => users.stop(), () => trail.stop(), () => monitor.stop()]) {
        try {
          f();
        } catch {}
      }
      process.exit(code);
    };
    const wait = () => (inFlight > 0 && Date.now() < end ? setTimeout(wait, 100) : finish());
    setTimeout(wait, 150);
  }
  const restartServer = (actor, why) => {
    if (!updater.launched) throw fail(409, 'Restarting needs the launcher: start Kendra with "npm start" or the container image.');
    audit.record(actor, 'system', `Restarted the server (${why})`);
    gracefulExit(RESTART_CODE, why);
  };

  const monitor = new Monitor({
    source: {
      ids: () => opps.raw().filter((o) => o.tenant).map((o) => o.id),
      polled: (id) => POLLED_STAGES.has(opps.get(id)?.stage),
      connection: (id) => opps.connection(id),
      // The POV's own projects for the Analytics numbers (muted ones left out), and 90 days for a long POV.
      scope: (id) => {
        const o = opps.get(id);
        const days = o?.startDate ? (Date.now() - Date.parse(o.startDate)) / 86_400_000 : 0;
        return { exclude: o?.mute?.projects ?? [], range: days > 30 ? '90d' : '30d' };
      },
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
    const proof = opp.tenant ? monitor.proof(opp.id) : null;
    const facts = snap || proof ? tenantFacts(snap, proof) : null;
    const words = wordsOf(opp);
    const out = {};
    for (const c of opp.criteria ?? []) {
      const cap = c.capabilityId || c.capRef ? catalog.get(c.capabilityId || c.capRef) : null;
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
  // Each read of a tenant: criteria it now proves are marked completed (a status set by a person is left alone).
  monitor.on('update', (e) => {
    if (!e.id) return;
    const opp = opps.get(e.id);
    if (!opp?.tenant || ['won', 'lost'].includes(opp.stage)) return;
    const ev = evidenceOf(opp);
    const found = (opp.criteria ?? []).filter((c) => ev[c.id]?.level === 'detected' && c.statusSource !== 'manual' && ['not_started', 'in_progress'].includes(c.status)).map((c) => ({ criterionId: c.id, evidence: ev[c.id].evidence }));
    if (found.length && opps.autoComplete(opp.id, found).length) notify({ id: opp.id });
  });
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
      // The Salesforce close date: from the latest report, else as the SE typed it.
      closeDate: opp.salesforce?.closeDate || opp.closeDate || '',
      closeFrom: opp.salesforce?.closeDate ? 'report' : opp.closeDate ? 'typed' : '',
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
    base.gaps = gaps(placed(opp), base, { facts: snap ? tenantFacts(snap, monitor.proof(opp.id)) : null, people: snap ? peopleActivity(snap, now) : null, catalog, now });
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
    // What the team did in Kendra (notes, stage changes, criteria met), newest first.
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
  const placed = (opp) => ({ ...opp, criteria: (opp.criteria ?? []).map((c) => ({ ...c, category: (c.capabilityId && catalog.get(c.capabilityId)?.category) || (c.capRef && catalog.get(c.capRef)?.category) || c.category })) });
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
      res.auditEmail = text(body.email, 254).toLowerCase();
      throttle(`${req.socket.remoteAddress}|${res.auditEmail}`);
      if (sso.ready() && sso.config().passwordSignIn === 'admins' && users.list().find((u) => u.email === res.auditEmail)?.role !== 'admin') throw fail(403, `Passwords are kept for Admins: use “${sso.config().label}”.`);
      const { token, user } = users.signIn(body.email, body.password);
      return send(res, 200, { user, expiresAt: users.expiresAt(token) }, { 'Set-Cookie': sessionCookie(token, 30 * 86400) });
    }
    // ——— Self-service, before signing in: forgotten passwords and joining with a work address ———
    if (m === 'GET' && (route === 'GET /brand/logo' || route === 'GET /brand/icon')) {
      const img = db.read('brand', {})[parts[1]];
      if (!img) return send(res, 404, { error: 'Not set.' });
      return send(res, 200, Buffer.from(img.b64, 'base64'), { 'Content-Type': img.type, 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
    }
    if (route === 'GET /auth/options') {
      const r = signinRules();
      const ready = !mailReady().length;
      return send(res, 200, { reset: ready && r.reset !== 'nobody', join: ready && r.join.enabled ? { domains: r.join.domains } : null, sso: sso.ready() ? { label: sso.config().label, adminsOnlyPasswords: sso.config().passwordSignIn === 'admins' } : null });
    }
    if (route.startsWith('POST /auth/')) {
      if (!['Kendra', 'Meridian', 'CommandCenter'].includes(req.headers['x-requested-with'])) return send(res, 403, { error: 'Missing request header.' });
      const b = await readBody(req);
      const ip = req.socket.remoteAddress;
      const ASKED = 'Check your inbox. If the address may do this, an email is on its way with a link. It works once, for 30 minutes.';
      const DEAD = 'This link no longer works: it was used, a newer one was sent, or it is more than 30 minutes old. Ask for a new one.';
      const mayReset = (u) => u && u.active !== false && signinRules().reset !== 'nobody' && !(signinRules().reset === 'not-admins' && u.role === 'admin');
      const mailLink = async (to, subject, lines, link) => mailer.send({ to: [to], subject, body: `${lines.join('\n\n')}\n\n${link}\n\nIt works once, for 30 minutes. Did not ask for this? Ignore this email: nothing changes.` });
      if (route === 'POST /auth/forgot' || route === 'POST /auth/join') {
        const email = text(b.email, 254).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw fail(400, 'Enter your work email address.');
        throttle(`${ip}|self|${email}`);
        // The same answer, and the work after it, whether or not the address has an account.
        setImmediate(async () => {
          try {
            if (mailReady().length) return;
            const existing = users.list().find((u) => u.email === email);
            const domain = email.split('@')[1];
            if (existing && mayReset(existing) && links.maySend('reset', email)) {
              const { token } = links.issue('reset', email, { userId: existing.id });
              await mailLink(email, `Reset your ${settings().orgName} password`, [`Someone, hopefully you, asked to choose a new password for ${email} on ${settings().orgName}.`], `${publicUrl()}/#/reset?token=${token}`);
              audit.record(null, 'auth', `Sent a password reset link to ${email}`);
            } else if (!existing && route === 'POST /auth/join' && signinRules().join.enabled && signinRules().join.domains.includes(domain) && links.maySend('join', email)) {
              const { token } = links.issue('join', email);
              await mailLink(email, `Join ${settings().orgName}`, [`Someone, hopefully you, asked to join ${settings().orgName} with ${email}.`, 'Open the link to give your name, who you report to and a password.'], `${publicUrl()}/#/join?token=${token}`);
              audit.record(null, 'auth', `Sent a link to join to ${email}`);
            }
          } catch (error) {
            audit.record(null, 'auth', `A self-service email to ${email} failed: ${error.message}`);
          }
        });
        return send(res, 200, { message: ASKED });
      }
      if (route === 'POST /auth/reset/check' || route === 'POST /auth/reset') {
        const l = links.check('reset', b.token);
        if (!l) {
          throttle(`${ip}|badlink`);
          throw fail(400, DEAD);
        }
        if (route === 'POST /auth/reset/check') return send(res, 200, { email: maskEmail(l.email) });
        const u = users.setPasswordByLink(l.userId, b.password);
        links.consume(b.token);
        audit.record(u, 'auth', 'Chose a new password with an emailed link (every sign-in ended)');
        return send(res, 200, { email: u.email });
      }
      if (route === 'POST /auth/join/check' || route === 'POST /auth/join/finish') {
        const l = links.check('join', b.token);
        if (!l) {
          throttle(`${ip}|badlink`);
          throw fail(400, DEAD);
        }
        const managers = users.list().filter((u) => u.active !== false && ['vp', 'leader', 'team_lead'].includes(u.role)).map((u) => ({ id: u.id, name: u.name, role: u.roleLabel, region: u.region ?? '' }));
        if (route === 'POST /auth/join/check') return send(res, 200, { email: l.email, managers });
        const added = users.addJoined({ email: l.email, name: b.name, title: b.title, region: b.region, managerId: b.managerId, password: b.password });
        links.consume(b.token);
        audit.record(added, 'people', `Joined by themselves (${added.email}), to be reviewed`);
        const { token } = users.signIn(added.email, b.password);
        return send(res, 200, { user: added }, { 'Set-Cookie': sessionCookie(token, 30 * 86400) });
      }
      return send(res, 404, { error: 'Not found.' });
    }
    // A look at the session that does not renew it (the browser's expiry warning).
    const user = users.fromToken(cookie(req, 'cc_session'), { slide: req.headers['x-peek'] !== '1' });
    if (route === 'GET /session') {
      const linked = linkReady() ? { ftr: linkSettings().ftrUrl } : null;
      return send(res, 200, user ? { user, permissions: users.permissionsOf(user, fullSettings()), settings: settings(), version: VERSION, expiresAt: users.expiresAt(cookie(req, 'cc_session')), sessionHours: settings().security.sessionHours, linked, stage: updater.stage } : { user: null, settings: { orgName: settings().orgName, defaultTheme: settings().defaultTheme, defaultMode: settings().defaultMode, lookForAll: settings().lookForAll, brand: brand() }, version: VERSION, linked });
    }
    if (!user) return send(res, 401, { error: 'Sign in first.' });
    // State-changing calls only from this page (with SameSite=Strict, no cross-site requests).
    if (m !== 'GET' && !['Kendra', 'Meridian', 'CommandCenter'].includes(req.headers['x-requested-with'])) return send(res, 403, { error: 'Missing request header.' });

    if (route === 'POST /logout') {
      users.signOut(cookie(req, 'cc_session'));
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (route === 'GET /meta') {
      return send(res, 200, { stages: STAGES, criterionStatus: CRITERION_STATUS, sessionTypes: SESSION_TYPES, categories: catalog.categories(), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])), permissions: PERMISSIONS, templates: TEMPLATES, themes: THEMES, scanWindowDays: SCAN_WINDOW_DAYS, toolchain: TOOLCHAIN, povRoles: POV_ROLES, planDefaults: PLAN_DEFAULTS, devsecops: DEVSECOPS });
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
      users.changePassword(user.id, b.current, b.next, cookie(req, 'cc_session'));
      return send(res, 200, { ok: true });
    }

    if (route === 'GET /stream') {
      // A handful of tabs per person; a browser stuck reconnecting cannot use up the server.
      if ([...clients].filter((c) => c.userId === user.id).length >= 6) return send(res, 429, { error: 'Too many open Kendra tabs: close a few.' }, { 'Retry-After': '30' });
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
      if ('lookForAll' in b) all.lookForAll = Boolean(b.lookForAll);
      if ('weeklyDrafts' in b) all.weeklyDrafts = Boolean(b.weeklyDrafts);
      if (['classic', 'team'].includes(b.reportStyle)) all.reportStyle = b.reportStyle;
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
      // Checked straight away: settings that do not work never replace ones that did.
      const r = smtp.host ? await mailer.checkOrRevert() : { ok: true };
      if (r.restored) audit.record(user, 'settings', `The new email settings did not work (${scrubText(smtpHint(r.error))}); put back the last working ones (${r.to})`);
      return send(res, 200, { smtp: mailer.settings, verified: r.ok, restored: Boolean(r.restored), error: r.ok ? undefined : smtpHint(r.error) });
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
      all.rolesKnown = Object.keys(PERMISSIONS);
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
    if (route === 'GET /settings/signin') {
      need(user, 'settings.manage');
      return send(res, 200, { ...signinRules(), missing: mailReady(), publicUrl: publicUrl(), security: settings().security, joined: users.list().filter((u) => u.joined && !u.joined.reviewedAt && u.active !== false).length });
    }
    if (route === 'PUT /settings/signin') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      const prev = signinRules();
      const domains = 'domains' in b ? [...new Set(String(b.domains ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))].slice(0, 10) : prev.join.domains;
      if ('domains' in b && !domains.length) throw fail(400, 'Give at least one email domain, such as checkmarx.com.');
      all.signin = { reset: ['everyone', 'not-admins', 'nobody'].includes(b.reset) ? b.reset : prev.reset, join: { enabled: 'joinEnabled' in b ? Boolean(b.joinEnabled) : prev.join.enabled, domains } };
      db.write('settings', all);
      audit.record(user, 'settings', `Sign-in: forgotten passwords by email for ${all.signin.reset}; joining by themselves ${all.signin.join.enabled ? `on (${domains.join(', ')})` : 'off'}`);
      return send(res, 200, signinRules());
    }
    if (route === 'GET /help') {
      const admin = users.can(user, 'settings.manage', fullSettings());
      return send(res, 200, { email: admin ? fullSettings().help?.email ?? '' : undefined, ready: Boolean(fullSettings().help?.email) && mailer.configured, requests: help.list({ userId: admin ? null : user.id }) });
    }
    if (route === 'PUT /settings/help') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const email = text(b.email, 254).toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'Give a valid email address, or leave it empty.');
      const all = fullSettings();
      all.help = { email };
      db.write('settings', all);
      audit.record(user, 'settings', email ? `Get help requests go to ${email}` : 'Get help requests are only kept (no address)');
      return send(res, 200, { email });
    }
    if (route === 'POST /help') {
      const row = help.add(user, await readBody(req));
      audit.record(user, 'help', `${row.kind === 'idea' ? 'Asked for an enhancement' : 'Raised a support case'}: ${row.subject}`);
      const to = fullSettings().help?.email;
      if (to && mailer.configured) {
        try {
          await mailer.send({ to: [to], subject: `[Kendra ${row.kind === 'idea' ? 'enhancement' : 'support'}] ${row.subject}`, body: `${row.details}\n\n— ${user.name} <${user.email}>, ${row.at}\nKendra ${VERSION}` }, { replyTo: user.email });
          help.mark(row.id, { mailed: new Date().toISOString() });
          return send(res, 200, { ...row, mailed: true });
        } catch (error) {
          help.mark(row.id, { error: String(error.message).slice(0, 200) });
          return send(res, 200, { ...row, mailed: false, error: 'It is kept here, but the email did not go: an Admin can see it on Get help.' });
        }
      }
      return send(res, 200, { ...row, mailed: false, error: to ? 'It is kept here; the email server is not set up yet.' : 'It is kept here: no address is set for requests yet (Settings → Get help).' });
    }
    if (route === 'PUT /settings/brand') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const cur = db.read('brand', {});
      const all = fullSettings();
      if ('orgName' in b) all.orgName = text(b.orgName, 80) || DEFAULT_SETTINGS.orgName;
      if ('tagline' in b) cur.tagline = text(b.tagline, 60);
      for (const k of ['logo', 'icon']) {
        if (b[k] === null) delete cur[k];
        else if (b[k]) cur[k] = imageFrom(b[k]);
      }
      if (['auto', 'light', 'dark'].includes(b.defaultMode)) all.defaultMode = b.defaultMode;
      if (THEMES.includes(b.defaultTheme)) all.defaultTheme = b.defaultTheme;
      if ('lookForAll' in b) all.lookForAll = Boolean(b.lookForAll);
      db.write('brand', cur);
      db.write('settings', all);
      audit.record(user, 'settings', `Branding: ${Object.keys(b).join(', ')}`);
      return send(res, 200, { settings: settings() });
    }
    if (m === 'POST' && parts[0] === 'users' && parts[2] === 'approve') {
      need(user, 'users.manage');
      if (!users.isBelow(user, parts[1])) throw fail(403, 'You can only approve people in your team.');
      const u = users.approveJoined(parts[1], user.name);
      audit.record(user, 'people', `Approved ${u.name}, who joined by themselves`);
      return send(res, 200, { user: u });
    }
    // ——— HTTPS (Settings → HTTPS & network): how the server is reached, and the certificate it presents ———
    if (route === 'GET /settings/https') {
      need(user, 'settings.manage');
      const envCert = Boolean(process.env.TLS_CERT_FILE || process.env.TLS_PFX_FILE);
      let info = null;
      try {
        info = cert ? (cert.load().cert ? certificateInfo(cert.load().cert) : { subject: 'the .pfx certificate' }) : null;
      } catch {}
      return send(res, 200, { mode: cert ? 'https' : 'http', viewedOver: req.socket.encrypted ? 'https' : 'http', envCert, uploaded: fs.existsSync(path.join(dataDir, 'tls', 'uploaded.crt')), cert: info, publicUrl: process.env.CC_PUBLIC_URL || '', port: Number(process.env.PORT) || 4310 });
    }
    if (route === 'POST /settings/https/certificate' || route === 'DELETE /settings/https/certificate') {
      need(user, 'settings.manage');
      if (process.env.TLS_CERT_FILE || process.env.TLS_PFX_FILE) throw fail(409, 'This server takes its certificate from TLS_CERT_FILE / TLS_PFX_FILE: change those files instead.');
      let info = null;
      if (m === 'POST') info = saveUploaded(dataDir, await readBody(req));
      else removeUploaded(dataDir);
      // In use at once when this server does HTTPS itself; otherwise from its next start with HTTPS on.
      let live = false;
      if (cert && tlsServer) {
        const next = tlsOptions(dataDir);
        tlsServer.setSecureContext({ ...next.load(), minVersion: 'TLSv1.2' });
        Object.assign(cert, { load: next.load, files: next.files, selfSigned: next.selfSigned });
        live = true;
      }
      audit.record(user, 'settings', m === 'POST' ? `Put a certificate to use: ${info.subject}, until ${info.validTo.slice(0, 10)}` : 'Removed the uploaded certificate (back to the self-signed one)');
      return send(res, 200, { cert: info, live });
    }
    if (route === 'GET /settings/sso') {
      need(user, 'settings.manage');
      return send(res, 200, { ...sso.view(), leaders: leadersList(), publicUrl: process.env.CC_PUBLIC_URL || '' });
    }
    if (route === 'PUT /settings/sso') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      all.sso = mergeSso(all.sso ?? {}, b, { leaders: leadersList() });
      db.write('settings', all);
      audit.record(user, 'settings', `Single sign-on ${all.sso.enabled ? 'on' : 'off'} (changed: ${Object.keys(b).filter((k) => k !== 'idpCert').join(', ')}${b.idpCert ? ', certificate' : ''})`);
      return send(res, 200, { ...sso.view(), leaders: leadersList() });
    }
    if (route === 'GET /settings/link') {
      need(user, 'settings.manage');
      const l = linkSettings();
      return send(res, 200, { ftrUrl: l.ftrUrl, hasKey: Boolean(l.key), at: l.at, by: l.by, ready: linkReady(), here: process.env.CC_PUBLIC_URL || '', teams: l.teams, domains: l.domains, lastSync: l.lastSync });
    }
    if (route === 'POST /settings/link/sync') {
      need(user, 'settings.manage');
      return send(res, 200, { lastSync: await syncTeams(user) });
    }
    if (route === 'PUT /settings/link') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = fullSettings();
      const prev = all.link ?? {};
      const ftrUrl = 'ftrUrl' in b ? cleanPartnerUrl(b.ftrUrl) : prev.ftrUrl ?? '';
      let shown = null;
      let key = prev.key ?? '';
      if (b.remove) key = '';
      else if (b.newKey) {
        shown = newLinkKey();
        key = db.seal(shown);
      } else if (b.key) {
        const k = String(b.key).trim();
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(k)) throw fail(400, 'The shared key is the 43 letters and digits the other app shows when it makes one.');
        key = db.seal(k);
      }
      const domains = 'domains' in b ? [...new Set(String(Array.isArray(b.domains) ? b.domains.join(',') : b.domains ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))].slice(0, 10) : prev.domains;
      all.link = b.remove ? null : { ...prev, ftrUrl, key, at: new Date().toISOString(), by: user.name, teams: 'teams' in b ? Boolean(b.teams) : prev.teams !== false, domains };
      db.write('settings', all);
      audit.record(user, 'settings', b.remove ? 'Unlinked the FTR Credits Command Center' : `Linked the FTR Credits Command Center at ${ftrUrl}${shown ? ' (new shared key)' : b.key ? ' (key pasted)' : ''}`);
      return send(res, 200, { ftrUrl, hasKey: Boolean(key), ready: Boolean(ftrUrl && key), key: shown });
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
    // ——— SharePoint (Microsoft Graph app registration) ———
    if (route === 'GET /settings/sharepoint') {
      need(user, 'settings.manage');
      const c = db.read('settings', {}).sharepoint ?? {};
      return send(res, 200, { tenantId: c.tenantId ?? '', clientId: c.clientId ?? '', folder: c.folder ?? 'POV/{customer}', hasSecret: Boolean(c.clientSecret) });
    }
    if (route === 'PUT /settings/sharepoint') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      const all = db.read('settings', {});
      const prev = all.sharepoint ?? {};
      const guid = (v) => (/^[0-9a-f-]{36}$/i.test(String(v ?? '').trim()) ? String(v).trim() : '');
      all.sharepoint = b.remove ? null : { tenantId: guid(b.tenantId) || text(b.tenantId, 120), clientId: guid(b.clientId), folder: text(b.folder, 200) || 'POV/{customer}', clientSecret: b.clientSecret ? db.seal(String(b.clientSecret).slice(0, 400)) : prev.clientSecret ?? '' };
      db.write('settings', all);
      audit.record(user, 'settings', b.remove ? 'Removed the SharePoint connection' : 'Saved the SharePoint connection');
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /settings/sharepoint/test') {
      need(user, 'settings.manage');
      const b = await readBody(req);
      return send(res, 200, await sharepoint.test(spConfig(), text(b.siteUrl, 500)));
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
    if (route === 'POST /updates/dismiss-failure') {
      need(user, 'settings.manage');
      const v = updater.dismissFailure();
      audit.record(user, 'system', `Dismissed the notice that ${v ?? 'a version'} did not start`);
      return send(res, 200, updater.status());
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
      if (a.stage !== undefined) audit.record(user, 'system', `This installation is marked ${a.stage || 'unmarked'}`);
      return send(res, 200, updater.status());
    }
    if (route === 'POST /system/restart') {
      need(user, 'settings.manage');
      restartServer(user, 'from Settings');
      return send(res, 202, { restarting: true });
    }
    // Everything needed to see what went wrong, in one file (no secrets: keys, passwords and tokens are never in it).
    if (route === 'GET /system/report') {
      need(user, 'settings.manage');
      const u = updater.status();
      let disk = null;
      try {
        const st = fs.statfsSync(dataDir);
        disk = { freeMb: Math.round((st.bavail * st.bsize) / 1048576), totalMb: Math.round((st.blocks * st.bsize) / 1048576) };
      } catch {}
      const report = {
        generatedAt: new Date().toISOString(),
        version: VERSION,
        node: process.versions.node,
        uptimeMinutes: Math.round(process.uptime() / 60),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        launched: updater.launched,
        disk,
        signedIn: users.sessionCount,
        checks: healthChecks({ db, backups: backupStore, monitor, audit, updater, watchdog, version: VERSION, certValidTo: certValidTo(), drill: db.read('drill', null), integrity }),
        log: errorLog.tail(80),
        versions: { active: u.active ?? null, previous: u.previous ?? null, lastFailure: u.lastFailure ?? null, history: u.history ?? [] },
        corrections: watchdog.corrections,
        repairs: db.repairs,
        recentErrors,
        reading: monitor.load(),
        backups: backupStore.list().slice(0, 10).map(({ name, at, label, verified, bytes }) => ({ name, at, label, verified, bytes })),
        key: { source: db.vault.source, fingerprint: db.vault.fingerprint },
      };
      audit.record(user, 'system', 'Downloaded the troubleshooting report');
      return file(res, `meridian-report-${new Date().toISOString().slice(0, 16).replace(/:/g, '-')}.json`, 'application/json', JSON.stringify(report, null, 2));
    }
    if (route === 'GET /system/health') {
      need(user, 'settings.manage');
      return send(res, 200, { checks: healthChecks({ db, backups: backupStore, monitor, audit, updater, watchdog, version: VERSION, certValidTo: certValidTo(), drill: db.read('drill', null), integrity }), corrections: watchdog.corrections, repairs: db.repairs, backups: backupStore.list(), offsite: backupStore.offsite, key: { source: db.vault.source, fingerprint: db.vault.fingerprint }, launched: updater.launched });
    }
    if (route === 'POST /system/drill') {
      need(user, 'settings.manage');
      const r = runDrill();
      audit.record(user, 'system', `Ran the restore drill: ${r.message}`);
      return send(res, 200, r);
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
      const r = backupStore.restore(text(b.name, 200), { version: VERSION, staged: true });
      audit.record(user, 'system', `Restored the backup ${r.restored} (the data before it is in ${r.undo})`);
      gracefulExit(RESTART_CODE, 'restore');
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
    if (route === 'GET /system/integrity') {
      need(user, 'settings.manage');
      return send(res, 200, { integrity: url.searchParams.get('now') ? checkIntegrity() : integrity });
    }
    if (route === 'GET /system/about') {
      return send(res, 200, { version: VERSION, node: process.version, repo: updater.status().repo, licence: 'Internal use', startedAt: STARTED_AT, launched: updater.launched, dataDir: can(user, 'settings.manage') ? dataDir : undefined, backups: can(user, 'settings.manage') ? backupStore.list().slice(0, 10).map((x) => x.name) : undefined, audit: can(user, 'settings.manage') ? audit.verify() : undefined });
    }
    // ——— The audit trail: Admins see everything; VPs and leaders what they and the people below them did ———
    if (route === 'GET /audit' || route === 'GET /audit/export') {
      need(user, 'audit.view');
      const q = url.searchParams;
      const stream = q.get('kind') === 'access' ? 'access' : 'changes';
      const visible = user.role === 'admin' ? null : users.visibleIds(user);
      const words = String(q.get('q') ?? '').toLowerCase().trim();
      const who = q.get('who') ?? '';
      const oppId = q.get('opp') ?? '';
      const writes = q.get('writes') === '1';
      const errors = q.get('errors') === '1';
      const match = (r) => {
        if (visible && !(r.by && visible.has(r.by)) && !(r.opp && opps.canView(user, opps.get(r.opp) ?? null))) return false;
        if (who && r.by !== who) return false;
        if (oppId && r.opp !== oppId) return false;
        if (writes && r.method === 'GET') return false;
        if (errors && !(r.status >= 400)) return false;
        return !words || [r.byName, r.what, r.type, r.path, r.customer, r.ip, r.ua].join(' ').toLowerCase().includes(words);
      };
      const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') ?? '') ? q.get('from') : '';
      const to = /^\d{4}-\d{2}-\d{2}$/.test(q.get('to') ?? '') ? q.get('to') : '';
      if (route === 'GET /audit/export') {
        const { records } = trail.query(stream, { match, from, to, limit: 50_000 });
        audit.record(user, 'audit', `Exported ${records.length} ${stream === 'access' ? 'requests' : 'changes'} from the audit trail`);
        const cols = stream === 'access' ? ['seq', 'at', 'byName', 'role', 'ip', 'ua', 'method', 'path', 'status', 'ms', 'customer', 'hash'] : ['seq', 'at', 'byName', 'role', 'type', 'what', 'customer', 'hash'];
        const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
        const csv = [cols.join(','), ...records.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
        return file(res, `meridian-audit-${stream}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv; charset=utf-8', csv);
      }
      const before = Number(q.get('before')) || Infinity;
      const page = trail.query(stream, { match, before, from, to, limit: Math.min(200, Number(q.get('limit')) || 100) });
      const chain = trail.verify(stream);
      return send(res, 200, { kind: stream, records: page.records, next: page.next, chain, keepDays: stream === 'access' ? trail.accessDays : null, people: user.role === 'admin' ? state_people() : state_people(visible) });
    }

    // Capability catalogue
    // ——— The SEAL library: business goals, capabilities, value messages, value map, use cases ———
    if (route === 'GET /library') {
      const d = library.data;
      return send(res, 200, { summary: library.summary(), canManage: can(user, 'catalog.manage'), goals: d?.goals ?? [], values: d?.values ?? [], useCases: (d?.useCases ?? []).map((u) => ({ id: u.id, title: u.title, definition: u.definition, winThemes: u.winThemes })), capabilities: (d?.capabilities ?? []).map((c) => ({ id: c.id, title: c.title, category: c.category, what: c.what, metrics: c.metrics, catalogId: c.catalogId })) });
    }
    if (route === 'POST /library/import') {
      need(user, 'catalog.manage');
      const body = JSON.parse((await readRaw(req, 8 * 1048576)).toString('utf8'));
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, 10).map((f) => ({ name: text(f.name, 200), text: String(f.text ?? '') }));
      const taken = library.import(files, user);
      audit.record(user, 'catalog', `Imported the SEAL library: ${taken.map((t) => `${t.title} (${t.entries})`).join(', ')}`);
      return send(res, 200, { taken, summary: library.summary() });
    }
    if (route === 'DELETE /library') {
      need(user, 'catalog.manage');
      library.remove();
      audit.record(user, 'catalog', 'Removed the SEAL library');
      return send(res, 200, { summary: null });
    }
    if (route === 'GET /library/talk') {
      const ids = String(url.searchParams.get('goals') ?? '').split(',').filter(Boolean).slice(0, 12);
      return send(res, 200, { talk: library.talkTrack(ids) });
    }

    // ——— The success criteria bank ———
    if (route === 'GET /bank') return send(res, 200, { ...bank.info(), canManage: can(user, 'catalog.manage'), canEdit: user.role === 'admin' });
    if (route === 'POST /bank/import') {
      need(user, 'catalog.manage');
      const buf = await readRaw(req, 5 * 1048576);
      let rows;
      const head = buf.subarray(0, 1).toString();
      if (head === '[' || head === '{') {
        const j = JSON.parse(buf.toString('utf8'));
        rows = Array.isArray(j) ? j : j.entries ?? j.rows ?? [];
      } else {
        const table = await readTable(buf, { name: text(decodeURIComponent(req.headers['x-file-name'] ?? ''), 200), type: String(req.headers['content-type'] ?? '') });
        const [header, ...body] = table;
        rows = body.map((r) => Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ''])));
      }
      const r = bank.import(rows, user);
      audit.record(user, 'catalog', `Imported the success criteria bank: ${r.taken} criteria, ${r.goals} business goals`);
      return send(res, 200, { ...r, ...bank.info() });
    }
    // Editing the bank, goal by goal and criterion by criterion: Admins only.
    if (parts[0] === 'bank' && (parts[1] === 'goals' || parts[1] === 'entries') && ['POST', 'PUT', 'DELETE'].includes(m)) {
      if (user.role !== 'admin') throw fail(403, 'Only Admins edit the success criteria bank.');
      const id = parts[2] ? decodeURIComponent(parts[2]) : '';
      const goals = parts[1] === 'goals';
      if (m === 'DELETE') {
        if (goals) bank.removeGoal(user, id);
        else bank.removeEntry(user, id);
        audit.record(user, 'catalog', `Removed a ${goals ? 'business goal' : 'success criterion'} from the bank`);
      } else {
        const b = await readBody(req);
        const saved = goals ? bank.saveGoal(user, id, b) : bank.saveEntry(user, id, b);
        audit.record(user, 'catalog', `${id ? 'Changed' : 'Added'} the ${goals ? 'business goal' : 'success criterion'} “${saved.title}” in the bank`);
      }
      return send(res, 200, { ...bank.info(), canManage: can(user, 'catalog.manage'), canEdit: true });
    }
    if (route === 'POST /bank/reset') {
      need(user, 'catalog.manage');
      bank.reset();
      audit.record(user, 'catalog', 'Went back to the built-in success criteria bank');
      return send(res, 200, bank.info());
    }

    // An APMA report read without keeping it, for the new-opportunity wizard.
    if (route === 'POST /apma/read') {
      const a = readApma(await readRaw(req, 25 * 1048576));
      const customer = text(decodeURIComponent(req.headers['x-customer'] ?? ''), 160);
      return send(res, 200, { apma: { ...cleanApma(a), found: a.found }, otherCustomer: forAnotherCustomer(a, customer) });
    }
    // ——— Presentation templates ———
    if (route === 'GET /deck-templates') {
      const mine = db.read('deckDefaults', { org: null, teams: {} });
      return send(res, 200, { templates: deckTemplates.list(user), slides: SLIDES, defaultLayout: DEFAULT_LAYOUT, canManage: can(user, 'templates.manage'), canSetOrg: can(user, 'settings.manage'), orgDefault: mine.org, myTeamDefault: mine.teams?.[user.id] ?? null });
    }
    if (route === 'POST /deck-templates') {
      need(user, 'templates.manage');
      const t = deckTemplates.create(user, await readBody(req));
      audit.record(user, 'templates', `Made the presentation template “${t.name}”`);
      return send(res, 201, { template: t });
    }
    if (parts[0] === 'deck-templates' && parts[1] && !['default'].includes(parts[1])) {
      const id = parts[1];
      if (!parts[2] && m === 'PUT') {
        need(user, 'templates.manage');
        const t = deckTemplates.update(user, id, await readBody(req));
        audit.record(user, 'templates', `Changed the presentation template “${t.name}”`);
        return send(res, 200, { template: t });
      }
      if (!parts[2] && m === 'DELETE') {
        need(user, 'templates.manage');
        const t = deckTemplates.remove(user, id);
        audit.record(user, 'templates', `Removed the presentation template “${t.name}”`);
        return send(res, 200, { ok: true });
      }
      if (parts[2] === 'design' && m === 'POST') {
        need(user, 'templates.manage');
        const buf = await readRaw(req, 60 * 1048576);
        const found = await checkTemplate(buf);
        if (!found) throw fail(400, 'That is not a PowerPoint file (.pptx).');
        const tpl = deckTemplates.get(id);
        if (!deckTemplates.canEdit(user, tpl)) throw fail(403, 'Only its maker, a manager above them or an Admin may change this template.');
        db.vault.writeFile(deckTemplates.fileOf(id), buf, { keepPrevious: false });
        const t = deckTemplates.setDesign(user, id, { ...found, found: await analyzeTemplate(buf).catch(() => null), name: text(decodeURIComponent(req.headers['x-file-name'] ?? 'design.pptx'), 200), at: new Date().toISOString(), by: user.name });
        audit.record(user, 'templates', `Uploaded the design of the presentation template “${t.name}”`);
        return send(res, 200, { template: t });
      }
      if (parts[2] === 'design' && m === 'DELETE') {
        need(user, 'templates.manage');
        const tpl = deckTemplates.get(id);
        if (!deckTemplates.canEdit(user, tpl)) throw fail(403, 'Only its maker, a manager above them or an Admin may change this template.');
        fs.rmSync(deckTemplates.fileOf(id), { force: true });
        return send(res, 200, { template: deckTemplates.setDesign(user, id, null) });
      }
    }
    // ——— The presentation designer (Settings → Presentation templates): previews of each slide, both designs ———
    if (parts[0] === 'deck-templates' && parts[1] === 'preview' && parts[2] && parts[3] && m === 'GET') {
      need(user, 'templates.manage');
      const f = path.join(PREVIEWS, String(parts[2]).replace(/[^a-f0-9]/g, ''), String(parts[3]).replace(/[^\w.-]/g, ''));
      if (!/\.png$/.test(f) || !fs.existsSync(f)) return send(res, 404, { error: 'Not found.' });
      return send(res, 200, fs.readFileSync(f), { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' });
    }
    if (parts[0] === 'deck-templates' && parts[1] && parts[2] === 'designer' && m === 'GET') {
      need(user, 'templates.manage');
      const tpl = deckTemplates.get(parts[1]);
      if (!tpl) throw fail(404, 'No such template.');
      const file = designFileOf(tpl);
      const found = file ? await analyzeTemplate(file) : null;
      const from = deckTemplates.designOf(tpl);
      return send(res, 200, { template: { ...tpl, variants: cleanVariants(tpl.variants), canEdit: deckTemplates.canEdit(user, tpl) }, borrowed: from && from.id !== tpl.id ? { name: from.name, file: from.design.name, at: from.design.at } : null, found, slides: SLIDES, variants: SLIDE_VARIANTS, defaultVariants: DEFAULT_VARIANTS, canPreview: await canPreview() });
    }
    if (parts[0] === 'deck-templates' && parts[1] && (parts[2] === 'preview' || parts[2] === 'demo') && m === 'POST') {
      need(user, 'templates.manage');
      const tpl = deckTemplates.get(parts[1]);
      if (!tpl) throw fail(404, 'No such template.');
      const b = await readBody(req);
      const deck = b.deck === 'results' ? 'results' : 'wip';
      // What is on screen in the designer (saved or not): its order, designs and titles.
      const layout = cleanLayout(b.layout ?? tpl.layout);
      const variants = b.allVariants === 'template' || b.allVariants === 'kendra' ? Object.fromEntries(Object.keys(SLIDE_VARIANTS).map((k) => [k, b.allVariants])) : cleanVariants(b.variants ?? tpl.variants);
      const texts = { ...(tpl.texts ?? {}), titles: cleanTitles(b.titles ?? tpl.texts?.titles) };
      const designFile = designFileOf(tpl);
      const demo = demoOpportunity({ opps, actor: user, settings: fullSettings() });
      const shots = [demoScreenshot('Analytics and Dashboard'), demoScreenshot('Total scans by integration')];
      const make = () => wipDeck(placed(demo), { story: resultsData(demo), owner: user, catalog, screenshots: shots, template: designFile, mode: deck, layout, texts, variants });
      if (tpl.classic && deck === 'results') throw fail(400, 'The Classic presentation is Kendra’s fixed design: it has no slides to arrange.');
      if (parts[2] === 'demo') {
        const buf = await make();
        return file(res, `${tpl.name} - demo ${deck === 'wip' ? 'WIP deck' : 'results'}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buf);
      }
      if (!(await canPreview())) return send(res, 200, { available: false });
      // Drawn once for the same template file, order, designs, titles and Kendra version (the demo's dates aside).
      const key = fingerprint(VERSION, tpl.id, deckTemplates.designOf(tpl)?.id ?? '', deckTemplates.designOf(tpl)?.design?.at ?? '', deck, layout, variants, texts.titles, new Date().toISOString().slice(0, 10));
      const buf = fs.existsSync(path.join(PREVIEWS, key, 'done.json')) ? null : await make();
      const keys = buf?.slideKeys ?? JSON.parse(fs.existsSync(path.join(PREVIEWS, key, 'keys.json')) ? fs.readFileSync(path.join(PREVIEWS, key, 'keys.json'), 'utf8') : '[]');
      const names = await previewDeck(buf, PREVIEWS, key);
      if (buf) fs.writeFileSync(path.join(PREVIEWS, key, 'keys.json'), JSON.stringify(keys));
      prunePreviews(PREVIEWS);
      return send(res, 200, { available: true, slides: names.map((n, i) => ({ key: keys[i] ?? '', img: `/api/deck-templates/preview/${key}/${n}` })) });
    }
    if (route === 'PUT /deck-templates/default') {
      need(user, 'templates.manage');
      const b = await readBody(req);
      if (b.org) need(user, 'settings.manage');
      deckTemplates.setDefault(user, b.templateId ? text(b.templateId, 80) : null, { org: Boolean(b.org) });
      const t = b.templateId ? deckTemplates.get(b.templateId) : null;
      audit.record(user, 'templates', `${t ? `Shared “${t.name}” with customers` : 'Cleared the customer presentation'} for ${b.org ? 'everyone' : 'their team'}`);
      return send(res, 200, { ok: true });
    }

    // ——— The WIP deck template (.pptx): its look, layouts and closing slide are used for every POV's WIP deck ———
    if (route === 'GET /wip-template') {
      if (!fs.existsSync(WIP_TEMPLATE)) return send(res, 200, { template: null });
      const info = db.read('wipTemplate', null);
      return send(res, 200, { template: info });
    }
    if (route === 'POST /wip-template') {
      need(user, 'settings.manage');
      const buf = await readRaw(req, 60 * 1048576);
      const found = await checkTemplate(buf);
      if (!found) throw fail(400, 'That is not a PowerPoint file (.pptx).');
      db.vault.writeFile(WIP_TEMPLATE, buf, { keepPrevious: false });
      const info = { ...found, name: text(decodeURIComponent(req.headers['x-file-name'] ?? 'template.pptx'), 200), at: new Date().toISOString(), by: user.name };
      db.write('wipTemplate', info);
      // The organisation's presentation template takes this design (made the first time).
      const orgId = db.read('deckDefaults', { org: null }).org;
      const target = orgId && deckTemplates.get(orgId) && !deckTemplates.get(orgId).builtIn ? deckTemplates.get(orgId) : deckTemplates.create(user, { name: 'Team template', description: 'The team’s PowerPoint design.', scope: 'everyone' });
      db.vault.writeFile(deckTemplates.fileOf(target.id), buf, { keepPrevious: false });
      deckTemplates.setDesign({ ...user, role: 'admin' }, target.id, info);
      if (!orgId) deckTemplates.setDefault(user, target.id, { org: true });
      audit.record(user, 'settings', `Uploaded the POV WIP template “${info.name}”`);
      return send(res, 200, { template: info });
    }
    if (route === 'DELETE /wip-template') {
      need(user, 'settings.manage');
      fs.rmSync(WIP_TEMPLATE, { force: true });
      db.write('wipTemplate', null);
      audit.record(user, 'settings', 'Removed the POV WIP template');
      return send(res, 200, { template: null });
    }

    // ——— Success criteria templates ———
    if (route === 'GET /templates') return send(res, 200, { templates: templates.list(user, { includeHidden: user.role === 'admin' && url.searchParams.get('all') === '1' }), canManage: can(user, 'templates.manage') });
    if (route === 'POST /templates') {
      need(user, 'templates.manage');
      const b = await readBody(req);
      if (b.scope === 'everyone' && !['admin', 'vp', 'leader'].includes(user.role)) b.scope = 'team';
      const tpl = templates.create(user, b);
      audit.record(user, 'settings', `Made the success criteria template "${tpl.name}" (${tpl.scope === 'everyone' ? 'for everyone' : 'for their team'})`);
      return send(res, 201, { template: tpl, templates: templates.list(user) });
    }
    if (parts[0] === 'templates' && parts[1] && !parts[2] && ['PUT', 'DELETE'].includes(m)) {
      need(user, 'templates.manage');
      const tid = decodeURIComponent(parts[1]);
      if (m === 'PUT') {
        const b = await readBody(req);
        if (b.scope === 'everyone' && !['admin', 'vp', 'leader'].includes(user.role)) b.scope = 'team';
        const tpl = templates.update(user, tid, b);
        audit.record(user, 'settings', `Changed the success criteria template "${tpl.name}"`);
      } else {
        const name = templates.get(tid)?.name ?? tid;
        templates.remove(user, tid);
        audit.record(user, 'settings', `Removed the success criteria template "${name}"`);
      }
      return send(res, 200, { templates: templates.list(user, { includeHidden: user.role === 'admin' }) });
    }
    if (m === 'POST' && parts[0] === 'templates' && parts[1] && parts[2] === 'show') {
      templates.unhide(user, decodeURIComponent(parts[1]));
      return send(res, 200, { templates: templates.list(user, { includeHidden: true }) });
    }
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
      recordReading();
      const more = insightsMore(rows, { oppOf: (id) => opps.get(id), catalog, history: db.read('insightsHistory', {}) });
      return send(res, 200, { at: o.at, ...rollups(rows, { teamOf, regionOf }), more, regions: [...new Set(o.rows.map((r) => r.region).filter(Boolean))].sort(), tenantRegions: [...new Set(o.rows.map((r) => r.tenant?.regionLabel).filter(Boolean))].sort() });
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
      const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>POV results</title><style>body{font:15px/1.5 Aptos,"Segoe UI",Arial,sans-serif;background:#140920;color:#fff;margin:40px}a{color:#c9b6ff}td,th{padding:8px 14px;border-bottom:1px solid #3a2352;text-align:left}th{color:#b9b0cc;font-size:12px;text-transform:uppercase;letter-spacing:.1em}</style></head><body><h1>POV results</h1><p style="color:#b9b0cc">${list.length} POV${list.length === 1 ? '' : 's'} · made ${new Date().toUTCString()}</p><table><tr><th>Customer</th><th>SE</th><th>Stage</th><th>Criteria</th><th>Result</th></tr>${list.map((r, i) => `<tr><td><a href="${encodeURI(files[i].name)}">${esc2(r.customer)}</a></td><td>${esc2(r.owner)}</td><td>${esc2(STAGES[r.stage])}</td><td>${r.progress.met}/${r.progress.total} (${r.progress.percent}%)</td><td>${r.finalAt ? `Final, ${esc2(new Date(r.finalAt).toUTCString())}` : 'Live'}</td></tr>`).join('')}</table></body></html>`;
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
      for (const g of (Array.isArray(b.goalIds) ? b.goalIds : []).slice(0, 12)) for (const e of bank.forGoal(text(g, 60))) opps.upsertItem(user, opp.id, 'criteria', { ...e, fromGoal: true, statement: e.title }, fullSettings());
      // From the first-call wizard: who joined, the session itself and the agreed next step, saved with it.
      for (const [kind, list] of [['stakeholders', b.stakeholders], ['sessions', b.sessions], ['tasks', b.tasks]]) {
        for (const item of (Array.isArray(list) ? list : []).slice(0, 30)) {
          try {
            opps.upsertItem(user, opp.id, kind, item, fullSettings());
          } catch {}
        }
      }
      opp = opps.get(opp.id);
      if (Array.isArray(b.templateIds)) templates.used(b.templateIds.slice(0, 20).map((x) => text(x, 60)));
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
        let opp = opps.setTenant(user, id, b, s);
        // A tenant means the POV has started: a deal still in discovery or technical sessions moves on by itself, with
        // today as its start and four weeks to run unless dates were set.
        if (['discovery', 'technical'].includes(opp.stage)) {
          const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
          opp = opps.update(user, id, { stage: 'pov', startDate: opp.startDate || day(0), endDate: opp.endDate || day(30) }, s);
        }
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
        // From the wizard: each capability with its own priority, and criteria in the team's own words.
        for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 200)) if (it?.capabilityId) opps.upsertItem(user, id, 'criteria', { capabilityId: text(it.capabilityId, 60), priority: it.priority === 'nice' ? 'nice' : 'must' }, s);
        for (const c of (b.custom ?? []).slice(0, 50)) {
          const title = typeof c === 'string' ? c : c?.title;
          if (text(title)) opps.upsertItem(user, id, 'criteria', { title, category: 'custom', priority: c?.priority === 'must' ? 'must' : 'nice', ...(c?.engines ? { engines: c.engines } : {}) }, s);
        }
        if (Array.isArray(b.templateIds)) templates.used(b.templateIds.slice(0, 20).map((x) => text(x, 60)));
        for (const g of (Array.isArray(b.goalIds) ? b.goalIds : []).slice(0, 12)) for (const e of bank.forGoal(text(g, 60))) opps.upsertItem(user, id, 'criteria', { ...e, fromGoal: true, statement: e.title }, s);
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
      if (sub === 'screenshots') {
        const opp = viewOpp(user, id);
        const shot = parts[3] ? (opp.screenshots ?? []).find((x) => x.id === parts[3]) : null;
        if (parts[3] && !shot) throw fail(404, 'No such screenshot.');
        if (m === 'GET' && shot) return send(res, 200, db.vault.readFile(shotPath(opp.id, shot.id)), { 'Content-Type': shot.type, 'Cache-Control': 'private, max-age=300' });
        if (!opps.canEdit(user, opps.get(id), s)) throw fail(403, 'You can view this POV but not change its screenshots.');
        if (m === 'POST' && !parts[3]) {
          const buf = await readRaw(req, 8 * 1048576);
          const info = imageInfo(buf);
          if (!info) throw fail(400, 'A screenshot is a PNG or JPEG picture.');
          if ((opp.screenshots ?? []).length >= 30) throw fail(400, 'A POV keeps at most 30 screenshots.');
          const sid = randomUUID();
          db.vault.writeFile(shotPath(opp.id, sid), buf, { keepPrevious: false });
          const caption = text(url.searchParams.get('caption'), 120) || text(decodeURIComponent(req.headers['x-file-name'] ?? ''), 120).replace(/\.(png|jpe?g)$/i, '') || 'Screenshot';
          opps.mutate(user, id, s, (o) => {
            (o.screenshots ??= []).push({ id: sid, caption, ...info, at: new Date().toISOString(), by: user.id });
            (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `Added the screenshot "${caption}"` });
          });
          return done();
        }
        if (m === 'PUT' && shot) {
          const b = await readBody(req);
          opps.mutate(user, id, s, (o) => {
            const list = o.screenshots ?? [];
            const i = list.findIndex((x) => x.id === shot.id);
            if (b.caption !== undefined) list[i].caption = text(b.caption, 120) || list[i].caption;
            // Moved up or down: the order of the slides.
            const to = Number(b.move) ? Math.max(0, Math.min(list.length - 1, i + Math.sign(Number(b.move)))) : i;
            if (to !== i) list.splice(to, 0, ...list.splice(i, 1));
          });
          return done();
        }
        if (m === 'DELETE' && shot) {
          fs.rmSync(shotPath(opp.id, shot.id), { force: true });
          opps.mutate(user, id, s, (o) => {
            o.screenshots = (o.screenshots ?? []).filter((x) => x.id !== shot.id);
            (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `Removed the screenshot "${shot.caption}"` });
          });
          return done();
        }
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
      // The RW report: the POV guide as one interactive page (goals and success criteria, toolchain, platform, plan, team).
      if (sub === 'rw' && m === 'GET') {
        const opp = viewOpp(user, id);
        const make = (nonce = '') => rwReport(placed(opp), resultsData(opp), { owner: users.get(opp.ownerId), catalog, texts: deckFor(opp).tpl?.texts ?? {}, nonce });
        if (url.searchParams.get('download')) return file(res, `${opp.customer} - POV guide (RW report).html`, 'text/html; charset=utf-8', make());
        const nonce = randomBytes(12).toString('base64');
        return send(res, 200, make(nonce), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; frame-ancestors 'self'` });
      }
      if (sub === 'deck' && m === 'GET') {
        const opp = viewOpp(user, id);
        return file(res, `${opp.customer} - POV results.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', await deckOf(opp, url.searchParams.get('style')));
      }
      // The POV work-in-progress deck, in the team's template when there is one.
      if (sub === 'wip' && m === 'GET') {
        const opp = viewOpp(user, id);
        const { tpl, file: design } = deckFor(opp, url.searchParams.get('template'));
        const buf = await wipDeck(placed(opp), { story: resultsData(opp), owner: users.get(opp.ownerId), catalog, screenshots: shotsOf(opp), template: design, layout: tpl?.layout, texts: tpl?.texts ?? {}, variants: tpl?.variants });
        return file(res, `${opp.customer} - POV WIP.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buf);
      }
      // The APMA assessment: the PDF read into the POV (optional; it fills the APMA slide), kept encrypted.
      if (sub === 'apma' && m === 'POST') {
        const buf = await readRaw(req, 25 * 1048576);
        const a = readApma(buf);
        const name = text(decodeURIComponent(req.headers['x-file-name'] ?? 'APMA report.pdf'), 200);
        const other = forAnotherCustomer(a, viewOpp(user, id).customer);
        const opp = opps.update(user, id, { apma: { ...a, file: { name, at: new Date().toISOString() } } }, fullSettings());
        db.vault.writeFile(path.join(dataDir, 'apma', `${id.replace(/[^0-9a-f-]/gi, '')}.pdf`), buf, { keepPrevious: false });
        return send(res, 200, { opportunity: publicOpp(placed(opp)), apma: opp.apma, found: a.found, otherCustomer: other });
      }
      if (sub === 'apma' && m === 'GET') {
        const opp = viewOpp(user, id);
        const p = path.join(dataDir, 'apma', `${id.replace(/[^0-9a-f-]/gi, '')}.pdf`);
        if (!opp.apma?.file || !fs.existsSync(p)) return send(res, 404, { error: 'No APMA report on this POV.' });
        return file(res, opp.apma.file.name || 'APMA report.pdf', 'application/pdf', db.vault.readFile(p));
      }
      if (sub === 'apma' && m === 'DELETE') {
        const opp = opps.update(user, id, { apma: null }, fullSettings());
        fs.rmSync(path.join(dataDir, 'apma', `${id.replace(/[^0-9a-f-]/gi, '')}.pdf`), { force: true });
        return send(res, 200, { opportunity: publicOpp(placed(opp)) });
      }
      // Publish the POV's documents to its SharePoint site.
      if (sub === 'sharepoint' && m === 'POST') {
        const opp = viewOpp(user, id);
        if (!opps.canEdit(user, opps.get(id), fullSettings())) throw fail(403, 'Only those who may edit this POV publish its documents.');
        if (!opp.sharepointUrl) throw fail(400, 'Add the POV’s SharePoint site link first (Edit details).');
        const b = await readBody(req);
        const want = new Set(Array.isArray(b.what) ? b.what : ['wip', 'deck', 'results']);
        const stamp = new Date().toISOString().slice(0, 10);
        const files = [];
        const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        if (want.has('wip')) {
          const tpl = fs.existsSync(WIP_TEMPLATE) ? db.vault.readFile(WIP_TEMPLATE) : null;
          files.push({ name: `${opp.customer} - POV WIP ${stamp}.pptx`, type: PPTX, data: await wipDeck(placed(opp), { story: resultsData(opp), owner: users.get(opp.ownerId), catalog, screenshots: shotsOf(opp), template: tpl }) });
        }
        if (want.has('deck')) files.push({ name: `${opp.customer} - POV results ${stamp}.pptx`, type: PPTX, data: await deckOf(opp) });
        if (want.has('results')) files.push({ name: `${opp.customer} - POV results ${stamp}.html`, type: 'text/html', data: Buffer.from(resultsPage(resultsData(opp))) });
        if (want.has('rw')) files.push({ name: `${opp.customer} - POV guide ${stamp}.html`, type: 'text/html', data: Buffer.from(rwReport(placed(opp), resultsData(opp), { owner: users.get(opp.ownerId), catalog, texts: deckFor(opp).tpl?.texts ?? {} })) });
        if (!files.length) throw fail(400, 'Pick at least one document.');
        const r = await sharepoint.publish(spConfig(), { siteUrl: opp.sharepointUrl, customer: opp.customer, files });
        opps.mutate({ ...user, role: 'admin' }, id, fullSettings(), (o) => {
          o.sharepointPublished = { at: new Date().toISOString(), by: user.name, folder: r.folder, files: r.files };
          (o.history ??= []).push({ at: new Date().toISOString(), by: user.id, what: `Published to SharePoint: ${r.files.map((f) => f.name).join(', ')}` });
        });
        audit.record(user, 'sharepoint', `${opp.customer}: published ${r.files.length} document${r.files.length === 1 ? '' : 's'} to SharePoint (${r.folder})`, { oppId: id });
        notify({ id });
        return send(res, 200, r);
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
      if (sub === 'sbom' && m === 'GET') {
        // The SBOM evidence: made from the newest completed scan that ran SCA (or the one asked for).
        const opp = viewOpp(user, id);
        if (!opp.tenant) return send(res, 409, { error: 'Connect the tenant first.' });
        const snap = monitor.snapshot(opp.id);
        const scans = [...(snap?.scans ?? []), ...(snap?.older ?? [])].filter((s) => /completed|partial/i.test(s.status) && (s.engines ?? []).includes('sca')).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        const asked = text(url.searchParams.get('scan'), 80);
        const scan = asked ? scans.find((s) => s.id === asked) ?? { id: asked } : scans[0];
        if (!scan) return send(res, 409, { error: 'No completed SCA scan on this tenant yet: run one, then make the SBOM.' });
        const format = url.searchParams.get('format') === 'spdx' ? 'spdx' : 'cyclonedx';
        const sbom = await exportSbom(new CxClient(opps.connection(opp.id)), scan.id, format);
        audit.record(user, 'opportunity', `Made a ${format === 'spdx' ? 'SPDX' : 'CycloneDX'} SBOM for ${opp.customer}`);
        const name = `${opp.customer} - SBOM ${format === 'spdx' ? 'SPDX' : 'CycloneDX'}${scan.projectName ? ` - ${scan.projectName}` : ''}.json`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 150);
        return file(res, name, 'application/json; charset=utf-8', sbom);
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
        const cap = c.capabilityId || c.capRef ? catalog.get(c.capabilityId || c.capRef) : null;
        const rule = { detect: { ...(cap?.detect ?? {}), engines: [...(cap?.detect?.engines ?? []), ...(c.engines ?? [])], origins: [...(cap?.detect?.origins ?? []), ...(c.origins ?? [])] } };
        const b = c.capabilityId ? bank.forCapability(c.capabilityId) : null;
        return {
          id: c.id,
          capabilityId: c.capabilityId,
          title: c.title,
          goal: c.goal || b?.goal || '',
          statement: c.statement || b?.title || c.title,
          test: c.test || b?.test || cap?.proof || '',
          benefit: c.benefit || b?.benefit || '',
          milestone: c.milestone ?? '',
          refs: c.refs ?? '',
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
          scans: opp.tenant ? provingScans(rule, monitor.provingSnapshot(opp.id)) : [],
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
      flow: flowView(opp, catalog, opp.tenant ? monitor.provingSnapshot(opp.id) : null, opp.tenant ? monitor.live(opp.id).summary : null),
      criteria,
      ...storyOf(opp, criteria, snap),
      tenant: opp.tenant ? monitor.live(opp.id).summary : null,
      analytics: opp.tenant ? monitor.analytics(opp.id) : null,
      tenantEvidence: opp.tenant ? tenantEvidence(monitor.snapshot(opp.id)) : null,
      sessions: [...(opp.sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date, title: x.title, type: SESSION_TYPES[x.type] ?? '' })),
      next: (opp.tasks ?? []).filter((t) => !t.done).map((t) => t.title).slice(0, 8),
    };
  }

  /**
   * The report's story: the POV's business goals with their criteria and progress, and the expansion — what was
   * proven and can be rolled out, and what on the platform comes next (the closest to the proven goals first).
   */
  function storyOf(opp, criteria, snap) {
    const keys = [...(opp.goals ?? []).map((g) => g.key)];
    for (const c of criteria) if (c.goal && !keys.includes(c.goal)) keys.push(c.goal);
    const goals = keys
      .map((key) => {
        const g = (opp.goals ?? []).find((x) => x.key === key) ?? bank.goal(key);
        if (!g) return null;
        const list = criteria.filter((c) => c.goal === key);
        return { key, title: g.title, statement: g.statement ?? '', driver: g.driver ?? '', measures: g.measures ?? [], ids: list.map((c) => c.id), total: list.length, done: list.filter((c) => ['done', 'demo'].includes(c.state)).length };
      })
      .filter((g) => g && g.total);
    const others = criteria.filter((c) => !c.goal || !goals.some((g) => g.key === c.goal));
    if (others.length && goals.length) goals.push({ key: 'other', title: 'Further criteria', statement: 'Agreed with the team during the POV.', ids: others.map((c) => c.id), total: others.length, done: others.filter((c) => ['done', 'demo'].includes(c.state)).length });
    const inPov = new Set(criteria.map((c) => c.capabilityId).filter(Boolean));
    const platformCats = new Set(['code', 'supply', 'aisc', 'runtime', 'agents', 'aspm']);
    const goalRank = (k) => (goals.some((g) => g.key === k) ? 0 : 1);
    const next = catalog
      .list()
      .filter((c) => platformCats.has(c.category) && !inPov.has(c.id))
      .map((c) => {
        const b = bank.forCapability(c.id);
        return { id: c.id, name: c.name, group: (catalog.categories().find(([k]) => k === c.category) ?? [, ''])[1], goal: b?.goal ? bank.goal(b.goal)?.title ?? '' : '', benefit: library.capability(c.id)?.what?.split(/(?<=\.)\s/)[0] || b?.benefit || c.proof || '', isNew: Boolean(c.isNew), rank: goalRank(b?.goal) };
      })
      .sort((a, b) => a.rank - b.rank || Number(b.isNew) - Number(a.isNew));
    const live = opp.tenant ? monitor.live(opp.id).summary : null;
    const proven = criteria.filter((c) => ['done', 'demo'].includes(c.state));
    return {
      goals,
      expansion: {
        proven: proven.map((c) => c.statement || c.title).slice(0, 12),
        projects: live?.projects ?? null,
        integrations: (live?.origins ?? []).map((o) => o.name),
        people: live?.users?.total ?? null,
        organisation: opp.discovery?.teamSize ?? '',
        next: next.slice(0, 9),
      },
    };
  }

  /** The results presentation: Classic (Kendra's own design), or Team (the WIP design, in the team's template). */
  function deckOf(opp, style = null) {
    // The POV's presentation template (or one asked for: a template id, or the older 'classic' / 'team').
    const own = db.read('deckTemplates', []);
    const orgId = db.read('deckDefaults', { org: null }).org;
    const pick = style === 'classic' ? 'builtin-classic' : style === 'team' ? (own.find((t) => t.id === orgId) ?? own[0])?.id ?? 'builtin-meridian' : style;
    const { tpl, file: design } = deckFor(opp, pick);
    if (!tpl?.classic) return wipDeck(placed(opp), { story: resultsData(opp), owner: users.get(opp.ownerId), catalog, screenshots: shotsOf(opp), template: design, mode: 'results', live: opp.tenant ? monitor.live(opp.id) : null, layout: tpl?.layout, texts: tpl?.texts ?? {}, variants: tpl?.variants });
    const snap = opp.tenant ? monitor.snapshot(opp.id) : null;
    return finalDeck(opp, { owner: users.get(opp.ownerId), live: opp.tenant ? monitor.live(opp.id) : null, people: snap ? peopleActivity(snap) : null, evidence: evidenceOf(opp), categories: catalog.categories(), org: settings().orgName, catalog, flow: flowView(placed(opp), catalog, opp.tenant ? monitor.provingSnapshot(opp.id) : null, opp.tenant ? monitor.live(opp.id).summary : null), story: resultsData(opp) });
  }

  /** One text file: the tenant's read, every failed scan of the last 7 days and each failed engine's log. */
  async function troubleshootBundle(opp) {
    if (!opp.tenant) throw fail(400, 'Connect a Checkmarx One tenant first.');
    const snap = monitor.snapshot(opp.id);
    const live = monitor.live(opp.id);
    const lines = [`Kendra troubleshooting bundle — ${opp.customer} — tenant ${opp.tenant.tenant} (${opp.tenant.regionLabel})`, `Made ${new Date().toISOString()}`, `API ${opp.tenant.baseUrl}`, `Last read: ${snap?.at ?? 'never'} (${snap?.ms ?? '?'} ms)${live.error ? `; last error ${live.error.at}: ${live.error.message}` : ''}`, ...(snap?.errors ?? []).map((e) => `Part not read: ${e.part}: ${e.message}`), ''];
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

  // ——— Single sign-on (SAML 2.0): the identity provider signs people in ———
  async function samlRoute(req, res, url) {
    const htmlPage = (body, headers = {}) => send(res, 200, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers });
    try {
      if (req.method === 'GET' && url.pathname === '/saml/metadata') return send(res, 200, sso.metadata(), { 'Content-Type': 'application/samlmetadata+xml; charset=utf-8' });
      if (req.method === 'GET' && url.pathname === '/saml/login') return send(res, 302, '', { Location: await sso.loginUrl() });
      if (req.method === 'POST' && url.pathname === '/saml/acs') {
        let text_ = '';
        for await (const chunk of req) {
          text_ += chunk;
          if (text_.length > 1024 * 1024) throw fail(413, 'Too large.');
        }
        let who;
        try {
          who = await sso.verify(new URLSearchParams(text_).get('SAMLResponse'));
        } catch (error) {
          audit.record(null, 'auth', `Single sign-on refused: ${error.message}`);
          return htmlPage(movePage('/#/login?linked=none', 'Single sign-on failed', `${error.message} Ask an Admin, or sign in with your password if you have one.`));
        }
        const c = sso.config();
        let r;
        try {
          r = users.signInSso(who.email, { name: who.name, jit: c.jit, managerId: c.jitManagerId });
        } catch (error) {
          audit.record(null, 'auth', `Single sign-on refused for ${who.email}: ${error.message}`);
          return htmlPage(movePage('/#/login?linked=none', 'No access yet', error.message));
        }
        if (r.added) audit.record(r.user, 'people', `Added on their first single sign-on (${r.user.email})`);
        audit.record(r.user, 'auth', 'Signed in with single sign-on');
        return htmlPage(movePage('/#/', 'Signed in'), { 'Set-Cookie': sessionCookie(r.token, 30 * 86400) });
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (error) {
      return send(res, error.status ?? 500, { error: error.message });
    }
  }

  // ——— Linked apps: one sign-in for Kendra and the FTR Credits Command Center ———
  const html = (res, body, headers = {}) => send(res, 200, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers });
  function linkRoute(req, res, url) {
    const l = linkSettings();
    const step = url.pathname.slice('/link/ftr'.length) || '/';
    if (!linkReady()) return html(res, movePage('/#/', 'Not linked', 'This Kendra is not linked to an FTR Credits Command Center: an Admin links them in Settings → Linked apps.'));
    const to = safePath(url.searchParams.get('to') || '/');
    const passFor = (u) => makePass({ key: l.key, from: 'kendra', to: 'ftr', email: u.email, name: u.name });
    const me = () => users.fromToken(cookie(req, 'cc_session'));
    // Kendra's menu: go to the FTR command center, signed in.
    if (step === '/' || step === '') {
      const u = me();
      if (!u) return html(res, movePage('/#/login', 'Sign in to Kendra first'));
      audit.record(u, 'auth', 'Opened the FTR Credits Command Center, signed in');
      return send(res, 302, '', { Location: `${l.ftrUrl}/link/kendra/in?pass=${makePassSafe(passFor(u))}&to=${encodeURIComponent(to)}` });
    }
    // The FTR command center asks who is signed in here. A redirect from another site carries no SameSite=Strict
    // cookie: one hop through a page of this site, and the cookie comes with it.
    if (step === '/authorize') return html(res, movePage(`/link/ftr/authorize2?to=${encodeURIComponent(to)}`, 'Checking your Kendra sign-in…'));
    if (step === '/authorize2') {
      const u = me();
      if (!u) return send(res, 302, '', { Location: `${l.ftrUrl}/link/kendra/none` });
      audit.record(u, 'auth', 'Signed in to the FTR Credits Command Center through Kendra');
      return send(res, 302, '', { Location: `${l.ftrUrl}/link/kendra/in?pass=${makePassSafe(passFor(u))}&to=${encodeURIComponent(to)}` });
    }
    // The FTR command center vouches for someone signed in there.
    if (step === '/in') {
      try {
        const who = readPass(url.searchParams.get('pass'), { key: l.key, me: 'kendra', from: 'ftr', used: usedPasses });
        const { token, user, added } = users.signInLinked(who.email, { name: who.name, domains: l.domains });
        if (added) {
          audit.record(user, 'people', `Added ${user.email} on their first sign-in through the FTR Credits Command Center`);
          if (l.teams) syncTeams(null).catch(() => {});
        }
        audit.record(user, 'auth', 'Signed in through the FTR Credits Command Center');
        return html(res, movePage(to === '/' ? '/#/' : to, 'Signed in'), { 'Set-Cookie': sessionCookie(token, 30 * 86400) });
      } catch (error) {
        audit.record(null, 'auth', `Refused a sign-in from the FTR Credits Command Center: ${error.message}`);
        return html(res, movePage('/#/login?linked=none', 'Could not sign you in', error.message));
      }
    }
    // Nobody signed in on the FTR side: Kendra's own sign-in, without asking again.
    if (step === '/none') return html(res, movePage('/#/login?linked=none', 'Sign in to Kendra'));
    return send(res, 404, { error: 'Not found.' });
  }
  const makePassSafe = (p) => encodeURIComponent(p);

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (draining && url.pathname.startsWith('/api/')) return send(res, 503, { error: 'Kendra is restarting. Try again in a few seconds.', restarting: true }, { 'Retry-After': '3' });
    if (url.pathname !== '/api/stream') {
      inFlight += 1;
      res.once('close', () => (inFlight -= 1));
    }
    if (url.pathname.startsWith('/api/')) logAccess(req, res, url);
    try {
      if (url.pathname === '/healthz') {
        // Healthy means the data can be read and written, not only that the port answers.
        try {
          db.read('users', []);
          fs.writeFileSync(path.join(dataDir, '.healthz'), String(Date.now()));
        } catch (error) {
          return send(res, 503, { ok: false, version: VERSION, error: `The data folder cannot be used: ${error.message}` });
        }
        return send(res, draining ? 503 : 200, { ok: !draining, restarting: draining || undefined, version: VERSION, reading: monitor.load(), memoryMb: Math.round(process.memoryUsage().rss / 1048576), signedIn: users.sessionCount });
      }
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET' && url.pathname.startsWith('/link/ftr')) linkRoute(req, res, url);
      else if (url.pathname.startsWith('/saml/')) await samlRoute(req, res, url);
      else if (req.method === 'GET') serveStatic(req, res, url);
      else send(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status === 500) {
        console.error(error);
        recentErrors.unshift({ at: new Date().toISOString(), path: url.pathname.replace(/[0-9a-f-]{36}/gi, ':id'), message: scrubText(String(error.message ?? error)).slice(0, 300) });
        recentErrors.length = Math.min(recentErrors.length, 50);
        errorLog.write('error', `${req.method} ${recentErrors[0].path} ${recentErrors[0].message}`);
      }
      if (!res.headersSent) send(res, status === 401 && !String(error.message).includes('match') ? 400 : status, { error: scrubText(String(error.message ?? error)) });
    }
  };
  const state_people = (only = null) => users.list().filter((u) => !only || only.has(u.id)).map((u) => ({ id: u.id, name: u.name }));

  /** Every API request, once it is answered: who, from where, what, which POV, how it ended, how long it took. */
  function logAccess(req, res, url) {
    const t0 = Date.now();
    res.on('close', () => {
      try {
        const u = users.fromToken(cookie(req, 'cc_session'));
        const parts = url.pathname.split('/').filter(Boolean).slice(1);
        const oppId = parts[0] === 'opportunities' && /^[0-9a-f-]{36}$/i.test(parts[1] ?? '') ? parts[1] : null;
        const ip = (process.env.CC_TRUST_PROXY === 'true' && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '';
        trail.access({
          by: u?.id ?? '',
          byName: u?.name ?? (res.auditEmail ? `sign-in as ${res.auditEmail}` : ''),
          role: u?.role ?? '',
          ip: ip.replace(/^::ffff:/, ''),
          ua: shortAgent(req.headers['user-agent']),
          method: req.method,
          route: `/${parts.map((p, i) => (i > 0 && /^[0-9a-f-]{8,}$/i.test(p) ? ':id' : p)).join('/')}`,
          path: (url.pathname + url.search).slice(0, 300),
          status: res.statusCode,
          ms: Date.now() - t0,
          ...(oppId ? { opp: oppId, customer: opps.get(oppId)?.customer ?? '' } : {}),
        });
      } catch {}
    });
  }

  const tlsServer = cert
    ? https.createServer({ ...cert.options, minVersion: 'TLSv1.2' }, (req, res) => {
        // A real certificate: browsers are told to keep to HTTPS. (Not for a self-signed one: they would ignore it.)
        if (!cert.selfSigned) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
        return handler(req, res);
      })
    : null;
  const server = cert ? sharedPort(tlsServer) : http.createServer(handler);
  if (cert) {
    // A renewed certificate is taken without a restart.
    let reloadTimer = null;
    for (const f of cert.files)
      fs.watchFile(f, { interval: 60_000, persistent: false }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          try {
            tlsServer.setSecureContext({ ...cert.load(), minVersion: 'TLSv1.2' });
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
  // ——— POV screenshots: images the SE adds, each a slide of the decks (kept encrypted, like everything else) ———
  const shotPath = (oppId, sid) => path.join(dataDir, 'screenshots', oppId.replace(/[^0-9a-f-]/gi, ''), `${String(sid).replace(/[^0-9a-f-]/gi, '')}.img`);
  /** PNG or JPEG only, read from its first bytes (never from the name), with its size in pixels. */
  function imageInfo(buf) {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      for (let i = 2; i + 9 < buf.length; ) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'image/jpeg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
      return { type: 'image/jpeg', w: 1600, h: 900 };
    }
    return null;
  }
  /** The POV's screenshots with their pictures, for the decks. */
  function shotsOf(opp) {
    return (opp.screenshots ?? [])
      .map((x) => {
        try {
          return { caption: x.caption, w: x.w, h: x.h, data: `${x.type};base64,${db.vault.readFile(shotPath(opp.id, x.id)).toString('base64')}` };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
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
  const WIP_TEMPLATE = path.join(dataDir, 'templates', 'wip-template.pptx');
  const recentErrors = [];
  const errorLog = new ErrorLog(dataDir);
  // The weekly restore drill: the newest backup, restored into a scratch folder and opened with the same key.
  const runDrill = () => {
    const r = backupStore.drill({
      open: (dir) => {
        if (!process.env.CC_SECRET && !process.env.CC_SECRET_FILE && fs.existsSync(path.join(dataDir, 'secret.key'))) fs.copyFileSync(path.join(dataDir, 'secret.key'), path.join(dir, 'secret.key'));
        const d = new Db(dir);
        return { users: d.read('users', []).length, opportunities: d.read('opportunities', []).length, settings: Boolean(d.read('settings', null)) };
      },
    });
    db.write('drill', r);
    if (!r.ok) errorLog.write('drill', r.message);
    return r;
  };
  const sharepoint = new SharePoint();
  // Presentation templates (design, slides, words), set by managers; the template uploaded before them becomes the first.
  const deckTemplates = new DeckTemplates(db, { users, dataDir });
  try {
    const legacy = fs.existsSync(WIP_TEMPLATE) ? path.join(dataDir, 'templates', 'legacy-plain.pptx') : null;
    if (legacy && !db.read('deckTemplates', []).length) {
      fs.writeFileSync(legacy, db.vault.readFile(WIP_TEMPLATE));
      const t = deckTemplates.migrate(legacy);
      fs.rmSync(legacy, { force: true });
      if (t) db.vault.writeFile(deckTemplates.fileOf(t.id), fs.readFileSync(WIP_TEMPLATE) && db.vault.readFile(WIP_TEMPLATE), { keepPrevious: false });
    }
  } catch (error) {
    console.error(`[start] The earlier WIP template could not become a presentation template: ${error.message}`);
  }
  /** The presentation template a POV's decks use, with its design's file (or none for Kendra's own). */
  /** The PowerPoint a presentation template is drawn in (its own, or the team's for a built-in arrangement), or null. */
  const designFileOf = (tpl) => {
    const d = deckTemplates.designOf(tpl);
    return d && fs.existsSync(deckTemplates.fileOf(d.id)) ? db.vault.readFile(deckTemplates.fileOf(d.id)) : null;
  };
  const deckFor = (opp, chosen = null) => {
    const tpl = (chosen && deckTemplates.get(chosen)) || deckTemplates.resolve(opp, { legacyStyle: settings().reportStyle });
    const file = designFileOf(tpl);
    return { tpl, file };
  };
  function certValidTo() {
    try {
      return cert && !cert.selfSigned ? new X509Certificate(cert.options.cert ?? cert.options.pfx).validTo : null;
    } catch {
      return null;
    }
  }
  const spConfig = () => {
    const c = db.read('settings', {}).sharepoint ?? null;
    return c ? { ...c, clientSecret: c.clientSecret ? db.open(c.clientSecret) : '' } : null;
  };
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
    const out = [{ direction: 'in', host: 'this server', port: Number(process.env.PORT) || 4310, why: 'People opening Kendra (HTTPS when behind your reverse proxy)' }];
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
  // Seal finished days of the trail and drop access days past their keeping time.
  if (startBackground) {
    setTimeout(() => trail.maintain(), 20_000).unref();
    setInterval(() => trail.maintain(), 6 * 3_600_000).unref();
  }
  const watchdog = new Watchdog({ monitor, launched: updater.launched, restart: () => gracefulExit(RESTART_CODE, 'watchdog'), onNote: (what, action) => errorLog.write('watchdog', `${what} — ${action}`) });
  if (startBackground) watchdog.start();
  if (startBackground) sfMailbox.start();

  // The Admins hear about trouble (and about its end) by email, without looking.
  const alerts = new AdminAlerts({
    db,
    mailer,
    org: settings().orgName,
    checks: () => healthChecks({ db, backups: backupStore, monitor, audit, updater, watchdog, version: VERSION, certValidTo: certValidTo(), drill: db.read('drill', null), integrity }),
    corrections: () => watchdog.corrections,
    admins: () => users.list().filter((u) => u.role === 'admin' && u.active !== false && u.email && !u.email.endsWith('@meridian.local')).map((u) => u.email),
  });
  if (startBackground) alerts.start();
  if (startBackground) {
    setTimeout(() => runDrill(), 10 * 60_000).unref();
    setInterval(() => runDrill(), 7 * 86_400_000).unref();
  }

  server.on('close', () => {
    alerts.stop();
    releaseLock();
    users.stop();
    updater.stop();
    backupStore.stop();
    trail.stop();
    sfMailbox.stop();
    watchdog.stop();
    monitor.stop();
    clearInterval(hourly);
  });
  return { server, errorLog, runDrill, db, users, opps, catalog, monitor, mailer, firstAdmin, weeklyDrafts, updater, audit, trail, backups: backupStore, watchdog };
}

/**
 * HTTPS and plain http on one port: a browser given "172.35.0.128:8443" without https:// is sent to the https address
 * instead of getting an empty answer. The first byte tells them apart (a TLS handshake starts with 0x16).
 */
function sharedPort(tlsServer) {
  const redirect = http.createServer((req, res) => {
    const host = String(req.headers.host ?? '').replace(/[^\w.:[\]-]/g, '');
    if (!host) return res.writeHead(400).end();
    res.writeHead(301, { Location: `https://${host}${req.url.startsWith('/') ? req.url : '/'}`, 'Cache-Control': 'no-store' }).end();
  });
  const front = net.createServer({ pauseOnConnect: true }, (sock) => {
    sock.on('error', () => sock.destroy());
    sock.setTimeout(30_000, () => sock.destroy());
    sock.once('readable', () => {
      const first = sock.read(1);
      if (!first) return sock.destroy();
      sock.unshift(first);
      sock.setTimeout(0);
      (first[0] === 0x16 ? tlsServer : redirect).emit('connection', sock);
    });
    sock.resume();
    sock.pause();
  });
  front.closeAllConnections = () => {
    tlsServer.closeAllConnections?.();
    redirect.closeAllConnections?.();
  };
  return front;
}

/** "Safari on iPhone", "Chrome on Windows"… from a User-Agent header. */
function shortAgent(ua = '') {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : /curl|node|python|undici/i.test(s) ? s.split('/')[0] : 'Other';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
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
  let app;
  try {
    app = createApp({ tls: startMode() === 'https' });
  } catch (error) {
    if (error.code !== 'STATE') throw error;
    // A problem with the data or its key: say what and how to fix it; the launcher waits instead of rolling back.
    console.error(`\n  Kendra did not start: ${error.message}\n`);
    process.exit(error.exitCode);
  }
  if (app.firstAdmin) {
    console.log(`\n  First start. Sign in as ${app.firstAdmin.email} with password: ${app.firstAdmin.password}\n  (you will be asked to change it)\n`);
  }
  app.server.listen(port, host, () => {
    if (app.server.tlsInfo) console.log(`[https] ${app.server.tlsInfo.selfSigned ? 'Self-signed certificate (browsers warn until it is trusted; set TLS_CERT_FILE and TLS_KEY_FILE for your own)' : 'Certificate'}: ${app.server.tlsInfo.description}`);
    console.log(`Kendra ${VERSION} on ${app.server.tlsInfo ? 'https' : 'http'}://${host}:${port} — reading POV tenants every ${app.monitor.intervalMs / 60_000} min`);
    app.monitor.start();
  });
  // A clean stop within seconds: open live-update streams are closed rather than waited for (Podman and Docker give
  // 10 seconds before they kill). Records are written atomically, so nothing is ever half-saved.
  const stop = () => {
    // Sign-ins and the audit queue are saved first: a stop or an update signs nobody out.
    for (const f of [() => app.users.stop(), () => app.trail.stop()]) {
      try {
        f();
      } catch {}
    }
    app.server.close(() => process.exit(0));
    app.server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  // The last line of defence: an unexpected error is logged; a thrown one ends the process, and the launcher starts
  // a clean one within seconds (records are written atomically, so nothing is half-saved).
  process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception, restarting:', error);
    try {
      app.errorLog.write('crash', error?.stack ?? error);
      app.users.stop();
      app.trail.stop();
    } catch {}
    process.exit(1);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
