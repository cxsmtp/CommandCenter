/**
 * Reads one POV's tenant from Checkmarx One: what the SE wants to know every few minutes.
 *
 *  - projects (count, and the newest ones)
 *  - scans of the last 7 days: who ran them, from where, how they ended (and why a failed one failed)
 *  - scans queued or running right now
 *  - open results by severity on each project's latest completed scan
 *
 * A handful of calls for a POV-sized tenant. Reads only: nothing is ever written to Checkmarx One.
 */
import { CxClient, mapWithConcurrency } from './cxone/client.js';

export const SCAN_WINDOW_DAYS = 7;
const MAX_SCANS = Number(process.env.CC_MAX_SCANS) || 500;
const MAX_PROJECTS = Number(process.env.CC_MAX_PROJECTS) || 500;
const CHUNK = 50;
const DAY = 86_400_000;
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
// Engine counters in GET /api/scan-summary (package counters would count SCA twice).
const COUNTER_KEYS = ['sastCounters', 'scaCounters', 'kicsCounters', 'containersCounters', 'apiSecCounters', 'microEnginesCounters', 'scsCounters'];

const text = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const timeOf = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const SAFE_KEY = (k) => !['__proto__', 'constructor', 'prototype'].includes(k);

export function engineNames(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    let name = text(raw, 40).toLowerCase();
    if (name === 'iac' || name === 'iac-security') name = 'kics';
    if (name === 'container' || name === 'containers-security') name = 'containers';
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Why a scan failed, from its status details ("sast: out of memory"). */
export function failureReason(scan) {
  return (Array.isArray(scan?.statusDetails) ? scan.statusDetails : [])
    .filter((d) => /fail/i.test(String(d?.status ?? '')))
    .map((d) => [text(d?.name, 40), text(d?.details, 240)].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ')
    .slice(0, 400);
}

/** Fusion or LAST, from the scan's own AI settings (src/fusion-usage.js in CxMissionZero). */
export function scanTypeOf(scan) {
  const engines = Array.isArray(scan?.engines) ? scan.engines.map((e) => String(e).toLowerCase()) : [];
  if (!engines.includes('ai')) return 'none';
  const configs = Array.isArray(scan?.metadata?.configs) ? scan.metadata.configs : [];
  const ai = configs.find((c) => String(c?.type ?? '').toLowerCase() === 'ai')?.value;
  const on = ai?.fusionEnabled;
  return on === false || on === 'false' ? 'last' : 'fusion';
}

const ORIGIN_LABELS = [
  [/jenkins/i, 'Jenkins'],
  [/git\s*hub[\s_-]*action|gh[\s_-]*action/i, 'GitHub Actions'],
  [/azure|\bado\b|vsts|\btfs\b/i, 'Azure DevOps'],
  [/git\s*lab/i, 'GitLab CI'],
  [/bit\s*bucket/i, 'Bitbucket Pipelines'],
  [/team\s*city/i, 'TeamCity'],
  [/bamboo/i, 'Bamboo'],
  [/circle\s*ci/i, 'CircleCI'],
  [/travis/i, 'Travis CI'],
  [/code\s*build/i, 'AWS CodeBuild'],
  [/vs\s*code/i, 'VS Code'],
  [/visual\s*studio/i, 'Visual Studio'],
  [/jetbrains|intellij/i, 'JetBrains'],
  [/eclipse/i, 'Eclipse'],
  [/web\s*hook|\bscm\b|pull[\s_-]*request/i, 'Code repository (webhook)'],
  [/git\s*hub/i, 'GitHub'],
  [/web\s*app|web\s*portal|\bportal\b|\bui\b|manual|^web$/i, 'Web portal'],
  [/postman|\bapi\b|\brest\b/i, 'API'],
  [/\bcli\b|ast[\s_-]*cli|cx[\s_-]*cli/i, 'CLI'],
];
/** Where a scan came from, as a readable label (taken from CxMissionZero's src/projections.js). */
export function scanOrigin(scan) {
  const labelOf = (v) => ORIGIN_LABELS.find(([re]) => re.test(v))?.[1] ?? '';
  const said = text(scan?.sourceOrigin, 60);
  if (said) return labelOf(said) || said;
  return labelOf(text(scan?.userAgent, 200)) || labelOf(text(scan?.sourceType, 60)) || '';
}

export function slimScan(s) {
  return {
    id: text(s.id, 80),
    projectId: text(s.projectId, 80),
    projectName: text(s.projectName, 300),
    status: text(s.status, 40) || 'Unknown',
    branch: text(s.branch, 200),
    createdAt: s.createdAt ? new Date(timeOf(s.createdAt)).toISOString() : null,
    updatedAt: s.updatedAt ? new Date(timeOf(s.updatedAt)).toISOString() : null,
    initiator: text(s.initiator, 200),
    origin: scanOrigin(s),
    originRaw: text(s.sourceOrigin, 80),
    userAgent: text(s.userAgent, 200),
    sourceType: text(s.sourceType, 40),
    engines: engineNames(s.engines),
    scanType: scanTypeOf(s),
    reason: /fail/i.test(String(s.status)) ? failureReason(s) : '',
  };
}

/** Results by severity from one scan summary (every engine's counters added up). */
export function severityOf(summary) {
  const sev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const key of COUNTER_KEYS) {
    const list = summary?.[key]?.severityCounters;
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      const s = String(c?.severity ?? '').toLowerCase();
      if (s in sev) sev[s] += Number(c?.counter) || 0;
    }
  }
  return sev;
}

async function scansSince(client, since) {
  const out = [];
  for await (const scan of client.paginate('/api/scans', { query: { 'from-date': since, sort: '-created_at' }, itemsKey: 'scans', limit: 100, maxItems: MAX_SCANS })) {
    if (scan?.id && timeOf(scan.createdAt) >= timeOf(since)) out.push(slimScan(scan));
  }
  return out;
}

async function activeScans(client) {
  const page = await client.request('/api/scans', { query: { statuses: ['Queued', 'Running'], sort: '-created_at', limit: 100, offset: 0 } });
  return (Array.isArray(page?.scans) ? page.scans : []).filter((s) => /queued|running/i.test(String(s?.status))).map(slimScan);
}

async function listProjects(client) {
  const projects = [];
  let total = null;
  const first = await client.request('/api/projects', { query: { limit: 100, offset: 0 } });
  total = Number(first?.filteredTotalCount ?? first?.totalCount);
  const take = (p) => projects.push({ id: text(p.id, 80), name: text(p.name ?? p.id, 300), createdAt: p.createdAt ?? null, repoUrl: text(p.repoUrl, 500), mainBranch: text(p.mainBranch, 200), groups: Array.isArray(p.groups) ? p.groups.slice(0, 10) : [] });
  (Array.isArray(first?.projects) ? first.projects : []).forEach(take);
  if (Number.isFinite(total) && total > projects.length) {
    for (let offset = 100; offset < Math.min(total, MAX_PROJECTS); offset += 100) {
      const page = await client.request('/api/projects', { query: { limit: 100, offset } });
      const rows = Array.isArray(page?.projects) ? page.projects : [];
      rows.forEach(take);
      if (rows.length < 100) break;
    }
  }
  return { total: Number.isFinite(total) ? total : projects.length, list: projects };
}

/** Open results on each project's latest completed scan: totals and per project. */
async function latestFindings(client, projectIds) {
  const lastScans = Object.create(null);
  await mapWithConcurrency(chunks(projectIds, CHUNK), 4, async (ids) => {
    const answer = await client.request('/api/projects/last-scan', { query: { 'project-ids': ids, 'scan-status': 'Completed' } });
    for (const [pid, scan] of Object.entries(answer ?? {})) if (SAFE_KEY(pid) && scan?.id) lastScans[pid] = { id: text(scan.id, 80), at: scan.updatedAt ?? scan.createdAt ?? null };
  });
  const byScan = new Map(Object.entries(lastScans).map(([pid, s]) => [s.id, pid]));
  const byProject = Object.create(null);
  await mapWithConcurrency(chunks([...byScan.keys()], CHUNK), 4, async (ids) => {
    const answer = await client.request('/api/scan-summary', { query: { 'scan-ids': ids } });
    for (const summary of Array.isArray(answer?.scansSummaries) ? answer.scansSummaries : []) {
      const pid = byScan.get(text(summary?.scanId, 80));
      if (pid) byProject[pid] = { ...severityOf(summary), scanId: lastScans[pid].id, scanAt: lastScans[pid].at };
    }
  });
  const totals = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const sev of Object.values(byProject)) for (const s of SEVERITIES) totals[s] += sev[s];
  return { ...totals, total: SEVERITIES.reduce((n, s) => n + totals[s], 0), byProject };
}

const quietly = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    if ([400, 401, 403, 404, 405].includes(error.status)) return null;
    throw error;
  }
};
const n0 = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));

/**
 * The tenant's credits (GET /api/credits/info) and what used them over the last 30 days
 * (GET /api/credits/consumption by project). Null parts when the tenant does not answer (no AI licence, an older
 * tenant, a key without the permission).
 */
async function credits(client, projectNames) {
  const info = await quietly(() => client.request('/api/credits/info', { retries: 1 }));
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const body = await quietly(() => client.request('/api/credits/consumption', { query: { viewBy: 'project', period: 'last_30_days', page, size: 100, sort_by: 'creditsUsed', sort_order: 'desc' }, retries: 1 }));
    if (!body) break;
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    rows.push(...items);
    const pages = Number(body?.totalPages);
    if (!items.length || (Number.isFinite(pages) ? page >= pages : items.length < 100)) break;
  }
  const actions = { triage: 0, remediation: 0, other: 0 };
  const byProject = [];
  for (const item of rows) {
    const used = n0(item?.creditsUsed ?? item?.credits) ?? 0;
    const own = { triage: 0, remediation: 0, other: 0 };
    for (const a of Array.isArray(item?.actionsPerformed?.actions) ? item.actionsPerformed.actions : []) {
      const type = String(a?.actionType ?? '').toLowerCase().replace(/[\s-]+/g, '_');
      const count = n0(a?.transactionCount) ?? 0;
      const key = /triage/.test(type) ? 'triage' : /remediation/.test(type) ? 'remediation' : 'other';
      own[key] += count;
      actions[key] += count;
    }
    const id = text(item?.projectId ?? item?.id, 80);
    byProject.push({ projectId: id, name: text(item?.name ?? item?.projectName, 300) || projectNames.get(id) || id, credits: used, ...own });
  }
  if (!info && !rows.length) return null;
  return {
    available: n0(info?.available),
    total: n0(info?.total),
    used: n0(info?.used),
    state: text(info?.enforcement?.state, 30),
    used30d: byProject.reduce((n, r) => n + r.credits, 0),
    actions,
    byProject: byProject.sort((a, b) => b.credits - a.credits).slice(0, 100),
    consumptionKnown: rows.length > 0 || Boolean(info),
  };
}

/** The tenant's AI settings (GET /api/configuration/tenant): Fusion on, LLM-based scanning on, the model. */
async function tenantAi(client) {
  const body = await quietly(() => client.request('/api/configuration/tenant', { retries: 1 }));
  if (!body) return null;
  const entries = Array.isArray(body) ? body : Array.isArray(body?.configEntries) ? body.configEntries : [];
  const entry = (k) => entries.find((e) => e?.key === k);
  const flag = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
  return {
    fusionEnabled: flag(entry('scan.config.ai.fusionEnabled')?.value),
    llmBased: flag(entry('scan.config.sast.extendedAnalysis')?.value),
    model: text(entry('scan.config.ai.llmModel')?.value, 60),
  };
}

/**
 * A scan's log for one engine (GET /api/logs/{scanId}/{engine}): Checkmarx One answers with the text, or with a
 * redirect to a signed address, which fetch follows (the access token is not sent on to another host by fetch).
 */
export async function scanLog(connection, scanId, engine, { client = new CxClient(connection) } = {}) {
  const safeId = encodeURIComponent(text(scanId, 80));
  const safeEngine = encodeURIComponent(text(engine, 40).toLowerCase());
  const body = await client.request(`/api/logs/${safeId}/${safeEngine}`, { accept: 'text/plain, application/json, */*', retries: 1 });
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}

/**
 * One full read of a POV's tenant. Each part fails on its own: a tenant without, say, the scan-summary service still
 * shows its scans. `errors` lists what could not be read.
 */
export async function collect(connection, { client = new CxClient(connection), now = Date.now() } = {}) {
  const started = Date.now();
  const since = new Date(now - SCAN_WINDOW_DAYS * DAY).toISOString();
  const errors = [];
  const part = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch (error) {
      errors.push({ part: name, message: text(error.message, 300), status: error.status ?? 0 });
      return fallback;
    }
  };
  // Authentication first: a rejected key fails the whole read, with Checkmarx One's reason.
  const identity = await client.identity();
  const [projects, scans, active] = await Promise.all([
    part('projects', () => listProjects(client), { total: null, list: [] }),
    part('scans', () => scansSince(client, since), []),
    part('running', () => activeScans(client), []),
  ]);
  const names = new Map(projects.list.map((p) => [p.id, p.name]));
  const [creditInfo, ai] = await Promise.all([part('credits', () => credits(client, names), null), part('ai', () => tenantAi(client), null)]);
  const findings = projects.list.length ? await part('findings', () => latestFindings(client, projects.list.map((p) => p.id)), null) : { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0, byProject: {} };
  // Nothing at all could be read (a rejected key, an unreachable tenant): the read failed.
  if (['projects', 'scans', 'running'].every((name) => errors.some((e) => e.part === name))) {
    throw Object.assign(new Error(errors[0].message), { status: errors[0].status, errors });
  }
  return { at: new Date(now).toISOString(), ms: Date.now() - started, identity, projects, scans, active, findings, credits: creditInfo, ai, errors };
}

/**
 * What a POV card shows, from its latest snapshot (and the one before, for what changed).
 */
export function summarize(snapshot, previous = null, now = Date.now()) {
  if (!snapshot) return null;
  const in24 = (iso) => now - timeOf(iso) <= DAY;
  const scans = snapshot.scans ?? [];
  const recent = scans.filter((s) => in24(s.createdAt));
  const finished = (re) => scans.filter((s) => re.test(s.status) && in24(s.updatedAt ?? s.createdAt)).length;
  const lastActivity = Math.max(0, ...scans.map((s) => Math.max(timeOf(s.createdAt), timeOf(s.updatedAt))), ...(snapshot.active ?? []).map((s) => timeOf(s.createdAt)));
  const f = snapshot.findings;
  const pf = previous?.findings;
  const delta = f && pf ? { critical: f.critical - pf.critical, high: f.high - pf.high, total: f.total - pf.total } : null;
  const initiators = new Map();
  for (const s of scans) if (s.initiator) initiators.set(s.initiator, (initiators.get(s.initiator) ?? 0) + 1);
  return {
    at: snapshot.at,
    projects: snapshot.projects?.total ?? null,
    newProjects7d: (snapshot.projects?.list ?? []).filter((p) => now - timeOf(p.createdAt) <= SCAN_WINDOW_DAYS * DAY).length,
    scans24h: recent.length,
    scans7d: scans.length,
    completed24h: finished(/^completed$/i),
    failed24h: finished(/^failed$/i),
    partial24h: finished(/^partial$/i),
    running: (snapshot.active ?? []).filter((s) => /running/i.test(s.status)).length,
    queued: (snapshot.active ?? []).filter((s) => /queued/i.test(s.status)).length,
    lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    findings: f ? { critical: f.critical, high: f.high, medium: f.medium, low: f.low, info: f.info, total: f.total } : null,
    delta,
    fusion7d: scans.filter((x) => x.scanType === 'fusion').length,
    last7d: scans.filter((x) => x.scanType === 'last').length,
    origins: [...scans.reduce((m, x) => (x.origin ? m.set(x.origin, (m.get(x.origin) ?? 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    engines: [...new Set(scans.filter((x) => /completed|partial/i.test(x.status)).flatMap((x) => x.engines))],
    credits: snapshot.credits ? { available: snapshot.credits.available, total: snapshot.credits.total, used: snapshot.credits.used, used30d: snapshot.credits.used30d, actions: snapshot.credits.actions, state: snapshot.credits.state } : null,
    ai: snapshot.ai ?? null,
    people: [...initiators.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, scans]) => ({ name, scans })),
    partialRead: (snapshot.errors ?? []).length > 0,
    errors: snapshot.errors ?? [],
  };
}

/** healthy | attention | idle | failed | loading: one word for a POV's card. */
export function healthOf(summary, error, now = Date.now()) {
  if (error && (!summary || timeOf(error.at) > timeOf(summary.at))) return 'failed';
  if (!summary) return 'loading';
  if (summary.failed24h > 0) return 'attention';
  const last = timeOf(summary.lastActivityAt);
  if (summary.running + summary.queued > 0) return 'healthy';
  if (!last || now - last > 3 * DAY) return 'idle';
  return 'healthy';
}

/**
 * The activity feed: scans started, finished, failed and projects created, newest first. Built from the snapshot
 * itself, so it is right from the first read; `since` marks what is new since a given time.
 */
export function eventsOf(snapshot, { povId = '', since = 0 } = {}) {
  const events = [];
  for (const s of [...(snapshot?.active ?? []), ...(snapshot?.scans ?? [])]) {
    const running = /queued|running/i.test(s.status);
    const at = running ? s.createdAt : s.updatedAt ?? s.createdAt;
    const kind = running ? (/queued/i.test(s.status) ? 'queued' : 'running') : /^completed$/i.test(s.status) ? 'completed' : /fail/i.test(s.status) ? 'failed' : /cancel/i.test(s.status) ? 'canceled' : /partial/i.test(s.status) ? 'partial' : 'other';
    events.push({ id: `scan:${s.id}:${kind}`, povId, kind, at, scanId: s.id, projectId: s.projectId, project: s.projectName, branch: s.branch, initiator: s.initiator, origin: s.origin, engines: s.engines, scanType: s.scanType, reason: s.reason });
  }
  for (const p of snapshot?.projects?.list ?? []) {
    if (Date.parse(snapshot.at) - timeOf(p.createdAt) <= SCAN_WINDOW_DAYS * DAY) events.push({ id: `project:${p.id}`, povId, kind: 'project', at: p.createdAt, projectId: p.id, project: p.name });
  }
  const seen = new Set();
  return events
    .filter((e) => e.at && !seen.has(e.id) && seen.add(e.id))
    .map((e) => ({ ...e, fresh: since > 0 && timeOf(e.at) > since }))
    .sort((a, b) => timeOf(b.at) - timeOf(a.at));
}
