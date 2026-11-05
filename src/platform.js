/**
 * The platform view: Checkmarx One's three pillars (capture, prevent, govern) with only the engines and agents this
 * POV set out to prove, each with its status. The deck's first slide and the Success criteria tab both draw it.
 *
 * A capability someone added to the catalogue in one of these groups (a new engine) lands in its group by itself.
 */
export const PILLARS = [
  {
    key: 'capture',
    title: 'CAPTURE ALL RISKS',
    sub: 'Fusion Scanning Architecture',
    color: 'F26A3D',
    groups: [
      { key: 'code', title: 'Code Security', icon: '</>', items: ['sast', 'fusion', 'last', 'secrets', 'iac', 'apisec'] },
      { key: 'supply', title: 'Supply Chain Security', icon: '{ }', items: ['malicious', 'sca', 'containers', 'scorecard', 'sbom'] },
      { key: 'aisc', title: 'AI Supply Chain Security', icon: 'AI', items: ['aisc', 'mcp-scanner', 'llm-scanner', 'skills-scanner'] },
      { key: 'runtime', title: 'Runtime Security', icon: 'RT', items: ['dast-ai', 'dast'] },
    ],
  },
  {
    key: 'prevent',
    title: 'ELIMINATE & PREVENT RISKS',
    sub: 'Assist Family of Agents',
    color: '8A4DFF',
    category: 'agents',
    rows: [
      ['dev-assist', 'Prevention at Creation', 'DA'],
      ['ai-triage', 'Attackability-Ranked Findings', 'TA'],
      ['ai-remediation', 'Merge-Ready Fixes', 'RA'],
    ],
  },
  {
    key: 'govern',
    title: 'GOVERN & UNIFY RISKS',
    sub: 'Orchestration/Posture Management',
    color: 'C04CE0',
    category: 'aspm',
    rows: [
      ['risk-orchestration', '', 'RO'],
      ['analytics', '', 'AR'],
      ['policy', '', 'PM'],
      ['mcp', '', 'MCP'],
    ],
  },
];

/** The golden stars on the slide: the capabilities powered by AI. */
export const AI_POWERED = new Set(['fusion', 'last', 'aisc', 'mcp-scanner', 'llm-scanner', 'skills-scanner', 'dast-ai', 'dev-assist', 'ai-triage', 'ai-remediation', 'mcp']);

/** The short names the slide uses. */
const LABELS = {
  sast: 'SAST', fusion: 'Fusion SAST', last: 'LAST', secrets: 'Secrets Detection', iac: 'IaC Security', apisec: 'API Security',
  malicious: 'Malicious Packages', sca: 'SCA', containers: 'Container Security', scorecard: 'Repository Health', sbom: 'SBOM',
  aisc: 'AI Inventory', 'mcp-scanner': 'MCP Scanner', 'llm-scanner': 'LLM Scanner', 'skills-scanner': 'Skills Scanner',
  'dast-ai': 'DAST for AI', dast: 'DAST',
  'dev-assist': 'Developer Assist', 'ai-triage': 'Triage Assist', 'ai-remediation': 'Remediation Assist',
  'risk-orchestration': 'Risk Orchestration', analytics: 'Analytics & Reporting', policy: 'Policy Management', mcp: 'Checkmarx MCP',
};

/** done (met) · progress (in progress) · planned (not started) · missed (not met); not applicable is left off. */
const STATE = { met: 'done', in_progress: 'progress', not_started: 'planned', not_met: 'missed' };

/**
 * What the slide shows for this opportunity: the pillars, groups and items it has criteria for, nothing else.
 * { pillars: [{ key, title, sub, color, groups?: [{ title, icon, items: [{ id, label, state }] }], rows?: [...] }], counts }
 */
export { LABELS, STATE };
export function platformView(opp, catalog) {
  const byCap = new Map();
  for (const c of opp.criteria ?? []) if (c.capabilityId && c.status !== 'na') byCap.set(c.capabilityId, c);
  const placed = new Set(PILLARS.flatMap((p) => [...(p.groups ?? []).flatMap((g) => g.items), ...(p.rows ?? []).map((r) => r[0])]));
  // Capabilities added to these groups later (new engines) join their group.
  const extra = (category) => [...byCap.keys()].filter((id) => !placed.has(id) && catalog?.get(id)?.category === category);
  const item = (id) => {
    const c = byCap.get(id);
    return c ? { id, criterionId: c.id, label: LABELS[id] ?? catalog?.get(id)?.name ?? c.title, state: STATE[c.status] ?? 'planned', title: c.title, ai: AI_POWERED.has(id) } : null;
  };
  const pillars = [];
  for (const p of PILLARS) {
    if (p.groups) {
      const groups = p.groups.map((g) => ({ key: g.key, title: g.title, icon: g.icon, items: [...g.items, ...extra(g.key)].map(item).filter(Boolean) })).filter((g) => g.items.length);
      if (groups.length) pillars.push({ key: p.key, title: p.title, sub: p.sub, color: p.color, groups });
    } else {
      const rows = [...p.rows, ...extra(p.category).map((id) => [id, '', (catalog?.get(id)?.name ?? id).slice(0, 2).toUpperCase()])]
        .map(([id, sub, icon]) => {
          const it = item(id);
          return it ? { ...it, sub, icon } : null;
        })
        .filter(Boolean);
      if (rows.length) pillars.push({ key: p.key, title: p.title, sub: p.sub, color: p.color, rows });
    }
  }
  const all = pillars.flatMap((p) => (p.groups ? p.groups.flatMap((g) => g.items) : p.rows));
  const counts = { done: 0, progress: 0, planned: 0, missed: 0 };
  for (const x of all) counts[x.state] += 1;
  return { pillars, counts, total: all.length };
}
