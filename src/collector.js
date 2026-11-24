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
const MAX_HISTORY_SCANS = Number(process.env.CC_MAX_HISTORY_SCANS) || 20000;
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

/**
 * What AI Triage and Remediation could act on in one scan summary: SAST and SCA results by state (the engines they
 * support). To verify: to triage, 1 credit each; confirmed (and urgent): to fix, 3 credits each.
 */
export function aiStatesOf(summary) {
  const out = { toVerify: 0, confirmed: 0, urgent: 0, notExploitable: 0, proposedNotExploitable: 0 };
  for (const key of ['sastCounters', 'scaCounters']) {
    for (const c of summary?.[key]?.stateCounters ?? []) {
      const st = String(c?.state ?? '').toUpperCase();
      const v = Number(c?.counter) || 0;
      if (st === 'TO_VERIFY') out.toVerify += v;
      else if (st === 'CONFIRMED') out.confirmed += v;
      else if (st === 'URGENT') out.urgent += v;
      else if (st === 'NOT_EXPLOITABLE') out.notExploitable += v;
      else if (st === 'PROPOSED_NOT_EXPLOITABLE') out.proposedNotExploitable += v;
    }
  }
  return out;
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

async function scansSince(client, since, max = MAX_SCANS) {
  const out = [];
  for await (const scan of client.paginate('/api/scans', { query: { 'from-date': since, sort: '-created_at' }, itemsKey: 'scans', limit: 100, maxItems: max })) {
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
      if (pid) byProject[pid] = { ...severityOf(summary), ...aiStatesOf(summary), scanId: lastScans[pid].id, scanAt: lastScans[pid].at };
    }
  });
  const totals = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const sev of Object.values(byProject)) for (const s of SEVERITIES) totals[s] += sev[s];
  const ai = { toVerify: 0, confirmed: 0, urgent: 0, notExploitable: 0, proposedNotExploitable: 0 };
  for (const p of Object.values(byProject)) for (const k of Object.keys(ai)) ai[k] += p[k] ?? 0;
  return { ...totals, total: SEVERITIES.reduce((n, s) => n + totals[s], 0), ai, byProject };
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

/**
 * What the tenant shows of ASPM, read the way the Checkmarx One portal reads it (from a browser recording of the ASPM
 * pages). Each part is null when the tenant does not answer it (not licensed, an older release, no permission):
 *   applications  GET /api/applications: applications, with their criticality, rules and projects
 *   armScores     GET /api/risk-management/summary: Application Risk Management, a risk score per application
 *   risks         GET /api/risks: Risk Orchestration, the unified list of risks across engines
 *   cloud         GET /api/cnas/accounts: Cloud Insights, the cloud accounts connected and when they were last scanned
 *   dast          GET /api/dast/scans/environments: DAST environments and their last scans (DAST scans are not always
 *                 in /api/scans). Its answer carries each environment's login settings: never kept, only counts and dates.
 *   policies      GET /api/policy_management_service_uri/policies/v3: the policies made (not the default one), on how
 *                 many projects or tags, how many break the build; .../incidents/total: violations raised
 *   feedback      GET /api/feedback-app/v2/apps and /v3/profiles: the feedback apps set up (Jira, Azure Boards,
 *                 ServiceNow, email, Slack, Teams) and how many projects a profile sends to each
 * No names are kept: only counts, scores and dates.
 */
export async function aspm(client) {
  // Each part on its own: a page this tenant lacks, or one that fails, leaves the others standing.
  const soft = (fn) => fn().catch(() => null);
  const [apps, arm, risks, cloud, dast, pol, incidents, fbApps, fbProfiles] = await Promise.all([
    soft(() => client.request('/api/applications', { query: { limit: 100, offset: 0 }, retries: 1 })),
    soft(() => client.request('/api/risk-management/summary', { retries: 1 })),
    soft(() => client.request('/api/risks', { query: { limit: 1, offset: 0 }, retries: 1 })),
    soft(() => client.request('/api/cnas/accounts', { query: { limit: 100, offset: 0 }, retries: 1 })),
    soft(() => client.request('/api/dast/scans/environments', { query: { from: 1, to: 100 }, retries: 1 })),
    soft(() => client.request('/api/policy_management_service_uri/policies/v3', { query: { limit: 100, page: 1 }, retries: 1 })),
    soft(() => client.request('/api/policy_management_service_uri/incidents/total', { retries: 1 })),
    soft(() => client.request('/api/feedback-app/v2/apps', { query: { limit: 100, page: 1 }, retries: 1 })),
    soft(() => client.request('/api/feedback-app/v3/profiles', { query: { limit: 100, page: 1, includeProjects: true }, retries: 1 })),
  ]);
  // The list's wrapper differs between releases ({ policies }, { data }, a bare array): the first array of policies.
  const policies = Array.isArray(pol) ? pol : [pol?.policies, pol?.data, pol?.items, pol?.results].find(Array.isArray) ?? null;
  const made = policies?.filter((x) => x && !x.defaultPolicy) ?? [];
  const feedback = feedbackOf(fbApps, fbProfiles);
  const violations = n0(typeof incidents === 'object' && incidents ? incidents.total ?? incidents.count ?? incidents.totalCount : incidents);
  const envs = Array.isArray(dast?.environments) ? dast.environments : null;
  const dastScans = envs?.map((e) => Date.parse(e?.lastScanTime)).filter(Number.isFinite).sort((a, b) => b - a) ?? [];
  const list = Array.isArray(apps?.applications) ? apps.applications : Array.isArray(apps) ? apps : null;
  const scored = Array.isArray(arm?.summary) ? arm.summary.filter((a) => Number.isFinite(Number(a?.riskScore))) : null;
  const accounts = Array.isArray(cloud?.data) ? cloud.data : null;
  const last = accounts?.map((a) => Date.parse(a?.lastScanDate)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return {
    applications: list ? { total: n0(apps?.totalCount) ?? list.length, withRules: list.filter((a) => a?.rules?.length).length, projects: new Set(list.flatMap((a) => a?.projectIds ?? [])).size } : null,
    armScores: scored ? { scored: scored.length, top: scored.length ? Math.max(...scored.map((a) => Number(a.riskScore))) : null, highOrAbove: scored.filter((a) => /critical|high/i.test(a?.riskSeverity ?? '')).length } : null,
    risks: risks?.metaData ? { total: n0(risks.metaData.totalResults) ?? 0 } : null,
    feedback,
    policies: policies ? { made: made.length, applied: made.filter((x) => x.projects?.length || x.tags?.length).length, breakBuild: made.filter((x) => x.breakBuild || x.netNewBreakBuild).length, violations } : null,
    dast: envs ? { environments: n0(dast?.totalItems) ?? envs.length, scanned: dastScans.length, lastScanAt: dastScans[0] ? new Date(dastScans[0]).toISOString() : null } : null,
    cloud: accounts ? { accounts: n0(cloud?.total) ?? accounts.length, lastScanAt: last ? new Date(last).toISOString() : null } : null,
  };
}

const arrayIn = (body, keys) => (Array.isArray(body) ? body : keys.map((k) => body?.[k]).find(Array.isArray) ?? null);
/** A feedback app's kind from whatever its type field is called: jira, azure, servicenow, email, slack, teams. */
export function feedbackKind(app) {
  const t = [app?.type, app?.applicationType, app?.appType, app?.applicationTypeName, app?.typeName, app?.applicationType?.name].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  return [['jira', /jira/], ['azure', /azure|ado|boards/], ['servicenow', /servicenow|snow/], ['email', /e-?mail|smtp/], ['slack', /slack/], ['teams', /teams/]].find(([, re]) => re.test(t))?.[0] ?? null;
}
/** { jira: { apps, projects }, … } from the apps and the profiles that send projects to them. Null when unreadable. */
function feedbackOf(appsBody, profilesBody) {
  const apps = arrayIn(appsBody, ['apps', 'applications', 'data', 'items', 'results', 'feedbackApps']);
  if (!apps) return null;
  const kindOf = new Map(apps.map((a) => [String(a?.id), feedbackKind(a)]));
  const out = {};
  for (const k of kindOf.values()) if (k) out[k] = { apps: (out[k]?.apps ?? 0) + 1, projects: 0 };
  const seen = {};
  for (const p of arrayIn(profilesBody, ['profiles', 'data', 'items', 'results']) ?? []) {
    const projects = (p?.projectsIds ?? p?.projectIds ?? p?.projects ?? []).map((x) => (typeof x === 'string' ? x : x?.id ?? x?.projectId)).filter(Boolean);
    for (const id of p?.appsIds ?? p?.appIds ?? (p?.apps ?? []).map((a) => a?.id)) {
      const k = kindOf.get(String(id));
      if (!k) continue;
      seen[k] ??= new Set();
      projects.forEach((x) => seen[k].add(x));
    }
  }
  for (const [k, set] of Object.entries(seen)) out[k].projects = set.size;
  return out;
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
 * The tenant's people, from its IAM (the Keycloak admin API behind Checkmarx One, as CxMissionZero's
 * src/cxone/directory.js reads it): every user, and, where the realm keeps login events and the key may read
 * them, each user's sign-ins over the last 7 days. Joined with who started scans, this says who is active in the
 * POV. Null when the key has no IAM read access (an ordinary outcome: the page then says so).
 */
async function iamPeople(client, connection, now) {
  if (!connection?.iamUrl || !connection?.tenant) return null;
  const base = `${connection.iamUrl}/auth/admin/realms/${encodeURIComponent(connection.tenant)}`;
  const users = [];
  for (let first = 0; first < 2000; first += 200) {
    const page = await quietly(() => client.request(`${base}/users`, { query: { first, max: 200, briefRepresentation: false }, retries: 1 }));
    if (!page) return first === 0 ? { users: [], denied: true, eventsKnown: false } : { users, denied: false, eventsKnown: false };
    const batch = Array.isArray(page) ? page : [];
    for (const u of batch) {
      users.push({
        id: text(u.id, 80),
        username: text(u.username, 200).toLowerCase(),
        email: text(u.email, 254).toLowerCase(),
        name: [text(u.firstName, 80), text(u.lastName, 80)].filter(Boolean).join(' '),
        enabled: u.enabled !== false,
        createdAt: Number.isFinite(Number(u.createdTimestamp)) ? new Date(Number(u.createdTimestamp)).toISOString() : null,
      });
    }
    if (batch.length < 200) break;
  }
  // Sign-ins: only when the realm stores login events and the key may view them.
  const from = new Date(now - SCAN_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const events = await quietly(() => client.request(`${base}/events`, { query: { type: 'LOGIN', dateFrom: from, max: 2000 }, retries: 1 }));
  const logins = new Map();
  if (Array.isArray(events)) {
    for (const e of events) {
      const id = text(e?.userId, 80);
      if (!id) continue;
      const at = Number(e.time);
      const cur = logins.get(id) ?? { count: 0, last: 0 };
      cur.count += 1;
      if (Number.isFinite(at) && at > cur.last) cur.last = at;
      logins.set(id, cur);
    }
  }
  for (const u of users) {
    const l = logins.get(u.id);
    u.logins7d = Array.isArray(events) ? l?.count ?? 0 : null;
    u.lastLoginAt = l?.last ? new Date(l.last).toISOString() : null;
  }
  return { users, denied: false, eventsKnown: Array.isArray(events) };
}

/**
 * Each person's activity in the POV: their IAM account (when readable) joined with the scans they started.
 * Someone who only appears as a scan initiator (a service account, a CI user) is listed too.
 * status: active (signed in or scanned in the last 2 days) · quiet (in the last 7) · inactive · never (no sign-in, no scan)
 */
export function peopleActivity(snapshot, now = Date.now()) {
  const iam = snapshot?.people;
  const byKey = new Map();
  const keyOf = (v) => String(v ?? '').trim().toLowerCase();
  for (const u of iam?.users ?? []) {
    const row = { ...u, scans7d: 0, lastScanAt: null, inIam: true };
    for (const k of [u.username, u.email]) if (k) byKey.set(keyOf(k), row);
  }
  const rows = new Set(byKey.values());
  for (const s of [...(snapshot?.scans ?? []), ...(snapshot?.active ?? [])]) {
    const k = keyOf(s.initiator);
    if (!k) continue;
    let row = byKey.get(k);
    if (!row) {
      row = { id: '', username: k, email: k.includes('@') ? k : '', name: '', enabled: true, createdAt: null, logins7d: null, lastLoginAt: null, scans7d: 0, lastScanAt: null, inIam: false };
      byKey.set(k, row);
      rows.add(row);
    }
    row.scans7d += 1;
    if (!row.lastScanAt || Date.parse(s.createdAt) > Date.parse(row.lastScanAt)) row.lastScanAt = s.createdAt;
  }
  const list = [...rows].map((r) => {
    const last = Math.max(Date.parse(r.lastLoginAt ?? '') || 0, Date.parse(r.lastScanAt ?? '') || 0);
    const status = !last ? (r.logins7d === null && !r.scans7d ? 'unknown' : 'never') : now - last <= 2 * DAY ? 'active' : now - last <= 7 * DAY ? 'quiet' : 'inactive';
    return { ...r, lastActiveAt: last ? new Date(last).toISOString() : null, status };
  });
  const rank = { active: 0, quiet: 1, inactive: 2, unknown: 3, never: 4 };
  list.sort((a, b) => rank[a.status] - rank[b.status] || (b.scans7d + (b.logins7d ?? 0)) - (a.scans7d + (a.logins7d ?? 0)));
  const iamRead = Boolean(iam && !iam.denied);
  // The figures count people: IAM accounts when IAM is readable (CI and service accounts are listed, not counted).
  const counted = iamRead ? list.filter((r) => r.inIam) : list;
  return {
    iamRead,
    eventsKnown: Boolean(iam?.eventsKnown),
    users: list,
    total: iamRead ? iam.users.length : null,
    active: counted.filter((r) => r.status === 'active').length,
    quiet: counted.filter((r) => r.status === 'quiet').length,
    inactive: counted.filter((r) => ['inactive', 'never'].includes(r.status)).length,
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
export async function collect(connection, { client = new CxClient(connection), now = Date.now(), previous = null, slow = true, historyFrom = null } = {}) {
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
    // Back to `historyFrom` when asked (the tenant's whole history the first time): the POV's proof record needs it.
    part('scans', () => (historyFrom && historyFrom < since ? scansSince(client, historyFrom, MAX_HISTORY_SCANS) : scansSince(client, since)), []),
    part('running', () => activeScans(client), []),
  ]);
  const names = new Map(projects.list.map((p) => [p.id, p.name]));
  // The slow parts (credits, AI settings, IAM people, ASPM) every hour; in between, the last read's are kept.
  const keep = !slow && previous;
  const [creditInfo, ai, people, aspmInfo] = keep
    ? [previous.credits ?? null, previous.ai ?? null, previous.people ?? null, previous.aspm ?? null]
    : await Promise.all([part('credits', () => credits(client, names), null), part('ai', () => tenantAi(client), null), part('people', () => iamPeople(client, connection, now), null), part('aspm', () => aspm(client), null)]);
  const findings = projects.list.length ? await part('findings', () => latestFindings(client, projects.list.map((p) => p.id)), null) : { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0, byProject: {} };
  // Nothing at all could be read (a rejected key, an unreachable tenant): the read failed.
  if (['projects', 'scans', 'running'].every((name) => errors.some((e) => e.part === name))) {
    throw Object.assign(new Error(errors[0].message), { status: errors[0].status, errors });
  }
  const recent = scans.filter((s) => timeOf(s.createdAt) >= timeOf(since)).slice(0, MAX_SCANS);
  const older = scans.length > recent.length ? scans.filter((s) => timeOf(s.createdAt) < timeOf(since)) : [];
  return { at: new Date(now).toISOString(), ms: Date.now() - started, identity, projects, scans: recent, older, active, findings, credits: creditInfo, ai, people, aspm: aspmInfo, errors };
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
    aspm: snapshot.aspm ?? null,
    users: (() => {
      const p = peopleActivity(snapshot, now);
      return { iamRead: p.iamRead, eventsKnown: p.eventsKnown, total: p.total, active: p.active, quiet: p.quiet, inactive: p.inactive, top: p.users.slice(0, 3).map((u) => ({ name: u.name || u.email || u.username, status: u.status })) };
    })(),
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
