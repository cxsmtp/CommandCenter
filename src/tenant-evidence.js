/**
 * The evidence slides' numbers, from the latest read of the tenant (what the portal's pages show, drawn by
 * Meridian instead of photographed): integrations in use, triage, supply chain and governance, scan activity.
 * Counts and names of tools only; no project, person or finding names.
 */
const day = (iso) => String(iso ?? '').slice(0, 10);
const top = (m, n = 8) => [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
const HOSTS = [['GitHub', /github/], ['GitLab', /gitlab/], ['Bitbucket', /bitbucket/], ['Azure DevOps', /dev\.azure|visualstudio\.com/]];

export function tenantEvidence(snapshot) {
  if (!snapshot) return null;
  const scans = snapshot.scans ?? [];
  // Integrations: where scans came from, the developers per tool, the repositories by host, the feedback apps.
  const origins = new Map();
  for (const s of scans) if (s.origin) origins.set(s.origin, (origins.get(s.origin) ?? 0) + 1);
  const tools = new Map(Object.entries(snapshot.aspm?.contributors?.tools ?? {}));
  const hosts = new Map();
  for (const p of snapshot.projects?.list ?? []) {
    const h = HOSTS.find(([, re]) => re.test(String(p.repoUrl ?? '').toLowerCase()));
    if (h) hosts.set(h[0], (hosts.get(h[0]) ?? 0) + 1);
  }
  const NAMES = { jira: 'Jira', azure: 'Azure Boards', servicenow: 'ServiceNow', email: 'Email', slack: 'Slack', teams: 'Teams' };
  const feedback = Object.entries(snapshot.aspm?.feedback ?? {}).filter(([, f]) => f?.apps).map(([k, f]) => ({ name: NAMES[k] ?? k, projects: f.projects ?? 0 }));
  // Triage: the findings of each project's latest scan by state, and the AI actions counted.
  const st = { toVerify: 0, confirmed: 0, urgent: 0, notExploitable: 0, proposedNotExploitable: 0 };
  for (const p of Object.values(snapshot.findings?.byProject ?? {})) for (const k of Object.keys(st)) st[k] += p[k] ?? 0;
  const f = snapshot.findings;
  // Scan activity: completed scans per day and engine, over the read's window.
  const days = [...new Set(scans.map((s) => day(s.createdAt)).filter(Boolean))].sort();
  const engines = [...new Set(scans.flatMap((s) => s.engines ?? []))].filter((e) => e !== 'ai').slice(0, 6);
  const perDay = engines.map((e) => ({ engine: e, values: days.map((d) => scans.filter((s) => day(s.createdAt) === d && /completed|partial/i.test(s.status) && (s.engines ?? []).includes(e)).length) }));
  const a = snapshot.aspm ?? {};
  return {
    at: snapshot.at,
    integrations: { origins: top(origins), tools: top(tools), hosts: top(hosts), feedback },
    triage: { states: st, actions: snapshot.credits?.actions ?? null, customStates: a.triage?.customStates ?? null },
    supply: { severities: f ? { critical: f.critical ?? 0, high: f.high ?? 0, medium: f.medium ?? 0, low: f.low ?? 0 } : null, malicious: a.supplyChain ?? null },
    governance: { policies: a.policies ?? null, sso: a.access?.sso ?? null, ssoKinds: a.access?.ssoKinds ?? [], groups: a.access?.groups ?? null, applications: a.applications?.total ?? null, risks: a.risks?.total ?? null },
    activity: { days, perDay },
  };
}
