/**
 * The integration flow: the customer's path from code to production, stage by stage, with the tools they use there
 * and the Checkmarx One engines working at that point, each with its status, and what they add, said with this
 * POV's own numbers.
 *
 *   code → commit & pull request → build & CI → deploy & run → track & govern (and back to the developer)
 *
 * Tools come from three places: the success criteria (with their status), what the tenant shows (scans from a CI
 * tool or an IDE, projects on a code host) and the discovery (what the customer said they use). Where the code
 * scanners sit depends on how this customer works: on the pull request when the code host is wired in (webhook or
 * repository integration), in the pipeline when a CI tool runs the scans.
 */
import { tenantFacts, evaluate } from './catalog.js';
import { LABELS, stateOf, AI_POWERED } from './platform.js';

export const FLOW_STAGES = [
  { key: 'code', title: 'Code', sub: 'IDEs & AI coding agents', icon: 'code' },
  { key: 'commit', title: 'Commit & PR', sub: 'Source code management', icon: 'commit' },
  { key: 'build', title: 'Build & CI', sub: 'Pipelines & CLI', icon: 'build' },
  { key: 'run', title: 'Deploy & run', sub: 'Containers, APIs, AI apps', icon: 'run' },
  { key: 'govern', title: 'Track & govern', sub: 'Defect tracking & posture', icon: 'govern' },
];

const TOOL_STAGE = { ide: 'code', scm: 'commit', ci: 'build', cli: 'build', tracking: 'govern' };
const CODE_SCANNERS = ['sast', 'fusion', 'last', 'secrets', 'sca', 'malicious', 'scorecard'];
const FIXED = {
  code: ['dev-assist', 'mcp'],
  commit: ['aisc', 'llm-scanner', 'mcp-scanner', 'skills-scanner', 'ai-triage', 'ai-remediation'],
  build: ['iac', 'apisec', 'sbom'],
  run: ['containers', 'dast-ai', 'dast'],
  govern: ['risk-orchestration', 'analytics', 'policy'],
};
const GROUP_STAGE = { code: 'build', supply: 'build', aisc: 'commit', runtime: 'run', agents: 'code', aspm: 'govern' };
const SKIP_TOOLS = new Set(['portal', 'api', 'break-build']); // shown through their engines or not a tool of the customer's

const short = (name) => String(name).split(' (')[0].split(' — ')[0];
const fmt = (n) => Number(n).toLocaleString('en-US');
const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * @param {object} opp       the opportunity (criteria placed in their catalogue groups)
 * @param {object} catalog   the capability catalogue
 * @param {object} snapshot  the tenant's last read (or null)
 * @param {object} summary   the tenant's summary (monitor.live().summary, or null)
 */
export function flowView(opp, catalog, snapshot = null, summary = null) {
  const criteria = (opp.criteria ?? []).filter((c) => c.status !== 'na');
  const byCap = new Map(criteria.filter((c) => c.capabilityId || c.capRef).map((c) => [c.capabilityId || c.capRef, c]));
  const facts = snapshot ? tenantFacts(snapshot) : null;
  const d = opp.discovery ?? {};
  const discovered = new Set([...(d.scm ?? []), ...(d.ci ?? []), ...(d.tracking ?? []), ...(d.ide ?? [])]);
  const origins = new Map((summary?.origins ?? []).map((o) => [o.name.toLowerCase(), o.count]));
  const scansFrom = (cap) => {
    let n = 0;
    for (const o of cap?.detect?.origins ?? []) for (const [name, count] of origins) if (name.includes(o)) n = Math.max(n, count);
    return n;
  };

  // ——— The customer's tools, stage by stage ———
  const tools = Object.fromEntries(FLOW_STAGES.map((s) => [s.key, []]));
  for (const cap of catalog.list()) {
    const stage = TOOL_STAGE[cap.category];
    if (!stage || SKIP_TOOLS.has(cap.id)) continue;
    const c = byCap.get(cap.id);
    const detected = facts && (cap.detect.origins?.length || cap.detect.repoHosts?.length) ? evaluate({ detect: { origins: cap.detect.origins, repoHosts: cap.detect.repoHosts } }, facts).level === 'detected' : false;
    if (!c && !detected && !discovered.has(cap.id)) continue;
    tools[stage].push({ id: cap.id, label: short(cap.name), state: c ? stateOf(c) : detected ? 'seen' : 'uses', criterionId: c?.id ?? null, scans: scansFrom(cap), ai: cap.category === 'ide' && /AI coding agent/.test(cap.name) });
  }
  const rank = { done: 0, demo: 1, progress: 2, seen: 3, planned: 4, missed: 5, uses: 6 };
  for (const k of Object.keys(tools)) tools[k].sort((a, b) => rank[a.state] - rank[b.state] || b.scans - a.scans);

  // ——— Where the code scanners sit, for this customer ———
  const wiredScm = tools.commit.some((t) => ['done', 'progress', 'seen'].includes(t.state)) && (byCap.has('webhook') || (summary?.origins ?? []).some((o) => /webhook|repository/i.test(o.name)));
  const ciUsed = tools.build.some((t) => ['done', 'progress', 'seen'].includes(t.state));
  const scannerStage = wiredScm && !ciUsed ? 'commit' : ciUsed || !tools.commit.length ? 'build' : 'commit';

  // ——— The engines at each stage ———
  const engines = Object.fromEntries(FLOW_STAGES.map((s) => [s.key, []]));
  const placed = new Set();
  const add = (stage, id) => {
    const c = byCap.get(id);
    if (!c || placed.has(id)) return;
    placed.add(id);
    engines[stage].push({ id, label: LABELS[id] ?? short(catalog.get(id)?.name ?? c.title), state: stateOf(c), criterionId: c.id, ai: AI_POWERED.has(id) });
  };
  for (const id of CODE_SCANNERS) add(scannerStage, id);
  for (const [stage, ids] of Object.entries(FIXED)) for (const id of ids) add(stage, id);
  // New engines added to the catalogue land by their group.
  for (const [id] of byCap) {
    const g = catalog.get(id)?.category;
    if (GROUP_STAGE[g]) add(GROUP_STAGE[g], id);
  }

  // ——— What they add here, in this POV's own numbers ———
  const s = summary;
  const toolNames = (k, states = ['done', 'progress', 'seen']) => tools[k].filter((t) => states.includes(t.state) || (t.state === 'demo' && states.includes('done'))).map((t) => t.label);
  const engNames = (k) => engines[k].map((e) => e.label);
  const value = {
    code: [],
    commit: [],
    build: [],
    run: [],
    govern: [],
  };
  const metric = {};
  // Code
  const ides = tools.code.filter((t) => t.scans);
  if (byCap.has('dev-assist')) value.code.push(`Developer Assist stops vulnerabilities as code is written${toolNames('code').length ? ` in ${list(toolNames('code').slice(0, 3))}` : ''}, including code written by AI agents.`);
  if (byCap.has('mcp')) value.code.push('Agents read findings and start scans through the Checkmarx MCP server.');
  if (ides.length) metric.code = { value: ides.reduce((n, t) => n + t.scans, 0), label: 'scans started from IDEs this week' };
  // Commit
  if (s?.projects) metric.commit = { value: s.projects, label: `projects${facts?.repoHosts?.length ? ` from ${list([...new Set(facts.repoHosts.map((u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean))].slice(0, 3))}` : ''}` };
  if (scannerStage === 'commit' && engNames('commit').length) value.commit.push(`${list(engNames('commit').filter((n) => !/Assist/.test(n)).slice(0, 4))} run on every pull request, before the code is merged.`);
  if (engines.commit.some((e) => /^(aisc|llm-scanner|mcp-scanner|skills-scanner)$/.test(e.id))) value.commit.push('AI supply chain: the models, MCP servers and agent skills in the code are inventoried and checked.');
  const actions = s?.credits?.actions;
  if (byCap.has('ai-triage') || byCap.has('ai-remediation')) value.commit.push(actions && (actions.triage || actions.remediation) ? `AI ranked ${fmt(actions.triage)} findings by attackability and proposed ${fmt(actions.remediation)} merge-ready fixes in 30 days.` : 'Triage Assist ranks findings by attackability; Remediation Assist opens merge-ready fixes.');
  // Build
  const ciScans = tools.build.filter((t) => t.scans);
  if (ciScans.length) {
    metric.build = { value: ciScans.reduce((n, t) => n + t.scans, 0), label: 'pipeline scans this week' };
    value.build.push(`${list(ciScans.slice(0, 3).map((t) => `${t.label} (${t.scans})`))} scan in the pipeline${scannerStage === 'build' && engNames('build').length ? `: ${list(engNames('build').slice(0, 4))}` : ''}.`);
  } else if (scannerStage === 'build' && engNames('build').length) value.build.push(`${list(engNames('build').slice(0, 4))} run in the customer’s pipeline${toolNames('build', ['done', 'progress', 'seen', 'planned', 'uses']).length ? ` (${list(toolNames('build', ['done', 'progress', 'seen', 'planned', 'uses']).slice(0, 3))})` : ''}.`);
  if (s?.fusion7d) value.build.push(`${fmt(s.fusion7d)} Fusion scans added what the AI engine found beyond SAST.`);
  if (s?.failed24h) value.build.push(`${fmt(s.failed24h)} scan${s.failed24h > 1 ? 's' : ''} failed in the last day: logs are one click away.`);
  if (byCap.has('policy')) value.build.push('Policy Management can break the build on what the customer will not ship.');
  // Run
  if (byCap.has('containers')) value.run.push('Container Security checks the images and suggests a safer base image.');
  if (byCap.has('dast-ai') || byCap.has('dast')) value.run.push('DAST tests the running application, including its AI endpoints, as an attacker would.');
  // Govern
  if (s?.findings) metric.govern = { value: s.findings.critical + s.findings.high, label: 'critical and high open on latest scans' };
  const trackers = toolNames('govern', ['done', 'progress', 'seen', 'planned', 'uses']);
  if (trackers.length) value.govern.push(`Findings become tickets in ${list(trackers.slice(0, 3))}, and close when the fix is verified.`);
  if (engines.govern.length) value.govern.push(`${list(engNames('govern'))}: one risk view across every engine and application.`);

  const stages = FLOW_STAGES.map((st) => ({ ...st, tools: tools[st.key].slice(0, 6), moreTools: Math.max(0, tools[st.key].length - 6), engines: engines[st.key].slice(0, 7), moreEngines: Math.max(0, engines[st.key].length - 7), value: value[st.key].slice(0, 2), metric: metric[st.key] ?? null, empty: !tools[st.key].length && !engines[st.key].length }));
  return { stages, scannerStage, hasAny: stages.some((x) => !x.empty) };
}
