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
    origin: text(s.sourceOrigin || s.sourceType, 80),
    engines: engineNames(s.engines),
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
  const take = (p) => projects.push({ id: text(p.id, 80), name: text(p.name ?? p.id, 300), createdAt: p.createdAt ?? null });
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
  const findings = projects.list.length ? await part('findings', () => latestFindings(client, projects.list.map((p) => p.id)), null) : { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0, byProject: {} };
  // Nothing at all could be read (a rejected key, an unreachable tenant): the read failed.
  if (['projects', 'scans', 'running'].every((name) => errors.some((e) => e.part === name))) {
    throw Object.assign(new Error(errors[0].message), { status: errors[0].status, errors });
  }
  return { at: new Date(now).toISOString(), ms: Date.now() - started, identity, projects, scans, active, findings, errors };
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
    events.push({ id: `scan:${s.id}:${kind}`, povId, kind, at, scanId: s.id, projectId: s.projectId, project: s.projectName, branch: s.branch, initiator: s.initiator, origin: s.origin, engines: s.engines, reason: s.reason });
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
