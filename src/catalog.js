/**
 * The capability catalogue: every Checkmarx One touch point a POV can test, the name Checkmarx One gives it, and how
 * CommandCenter recognises it was tested.
 *
 * `detect` rules are read against what the tenant shows (its scans and credits):
 *   engines    engine names in completed scans (sast, sca, kics, containers, apisec, microengines, ai, …)
 *   scanTypes  'fusion' | 'last' (a scan whose AI engine ran with Fusion on / off)
 *   origins    text found in where scans came from (sourceOrigin / user agent: "Jenkins", "GitHub Actions", "cli"…)
 *   repoHosts  text found in projects' repository addresses (github.com, gitlab, dev.azure.com…)
 *   actions    AI actions Checkmarx One counted on the credits (triage, remediation)
 *   keywords   words looked for in the opportunity's own notes, discovery and sessions (a hint, never proof)
 *
 * Evidence only ever suggests: the SE confirms a criterion is met. An Admin (or anyone with catalog.manage) edits
 * the catalogue, so a naming that differs in a given Checkmarx One release is fixed without a code change.
 */
import { randomUUID } from 'node:crypto';
import { fail, text } from './db.js';

export const CATEGORIES = [
  ['code', 'Code Security'],
  ['supply', 'Supply Chain Security'],
  ['aisc', 'AI Supply Chain Security'],
  ['runtime', 'Runtime Security'],
  ['agents', 'Checkmarx One Assist — agents'],
  ['aspm', 'Application Security Posture Management'],
  ['scm', 'Source code management'],
  ['ci', 'CI/CD & build'],
  ['cli', 'CLI, API & portal'],
  ['ide', 'IDE & developer'],
  ['tracking', 'Defect tracking & feedback'],
  ['platform', 'Platform & access'],
];

/**
 * c(id, category, name, cxName, detect, { proof, tech, isNew })
 *   proof  what the SE shows the customer before marking it met
 *   tech   how CommandCenter recognises it in Checkmarx One (the API and the field it reads)
 */
const c = (id, category, name, cxName, detect = {}, { proof = '', tech = '', isNew = false, description = '' } = {}) => ({ id, category, name, cxName, description, proof, tech, isNew, detect: { engines: [], scanTypes: [], origins: [], repoHosts: [], actions: [], keywords: [], ...detect } });
const SCANS = 'GET /api/scans (last 7 days): a Completed or Partial scan whose engines include';
const MANUAL = 'Not visible through the read-only API: confirmed by the SE (keywords in the notes are shown as a hint).';

export const DEFAULT_CATALOG = [
  // ——— Code Security ———
  c('sast', 'code', 'SAST', 'SAST', { engines: ['sast'], keywords: ['sast', 'static analysis'] }, { proof: 'Scan the agreed applications; walk through results, attack vectors and best fix location; show the scan time and the false-positive review.', tech: `${SCANS} "sast".` }),
  c('fusion', 'code', 'Fusion SAST', 'AI engine with Fusion on (scan.config.ai.fusionEnabled)', { scanTypes: ['fusion'], keywords: ['fusion'] }, { isNew: true, proof: 'Run a Fusion scan on an agreed project; show what the AI engine added beyond SAST and the credits it used.', tech: `${SCANS} "ai", with its AI settings (metadata.configs, type "ai") not setting fusionEnabled to false. Fusion credits: GET /api/credits/consumption.` }),
  c('last', 'code', 'LLM-based SAST (LAST)', 'AI engine with Fusion off (scan.config.sast.extendedAnalysis)', { scanTypes: ['last'], keywords: ['last scan', 'llm-based', 'llm based'] }, { proof: 'Run an AI scan with Fusion off; compare its results with the SAST engine’s.', tech: `${SCANS} "ai" with fusionEnabled false.` }),
  c('secrets', 'code', 'Secrets Detection', 'Secret Detection (micro engines, 2MS)', { engines: ['microengines', 'secrets', '2ms'], keywords: ['secret', 'credentials', 'hardcoded password', 'api key leak'] }, { proof: 'Show secrets found in code and history, with their validity and where they are.', tech: `${SCANS} "microengines" (or "secrets").` }),
  c('iac', 'code', 'IaC Security', 'IaC Security (KICS)', { engines: ['kics'], keywords: ['iac', 'terraform', 'kics', 'cloudformation', 'helm', 'kubernetes manifest'] }, { proof: 'Scan Terraform/CloudFormation/Kubernetes files; show misconfigurations and their fixes.', tech: `${SCANS} "kics".` }),
  c('apisec', 'code', 'API Security', 'API Security', { engines: ['apisec', 'api-security'], keywords: ['api security', 'swagger', 'openapi', 'shadow api'] }, { proof: 'Show the API inventory found in code (including shadow and zombie APIs) and its risks.', tech: `${SCANS} "apisec".` }),
  // ——— Supply Chain Security ———
  c('malicious', 'supply', 'Malicious Packages', 'SCA — Malicious Package Protection', { keywords: ['malicious package', 'typosquat', 'malicious packages'] }, { proof: 'Show a malicious package being flagged (and blocked at install time where agreed).', tech: `A scan with the "sca" engine is a prerequisite; malicious-package results themselves are not counted by the read here. ${MANUAL}` }),
  c('sca', 'supply', 'SCA', 'SCA (Software Composition Analysis)', { engines: ['sca'], keywords: ['sca', 'open source', 'dependencies', 'third-party', 'licence', 'license'] }, { proof: 'Show vulnerable direct and transitive dependencies, exploitable path, licences and the upgrade advice.', tech: `${SCANS} "sca".` }),
  c('containers', 'supply', 'Container Security', 'Container Security', { engines: ['containers'], keywords: ['container', 'docker', 'image scan', 'dockerfile'] }, { proof: 'Scan the agreed images; show base-image findings and the recommended base image.', tech: `${SCANS} "containers".` }),
  c('scorecard', 'supply', 'Repository Health', 'Repository Health (OpenSSF Scorecard, micro engines)', { engines: ['scorecard', 'repository-health'], keywords: ['scorecard', 'repository health', 'repo health'] }, { proof: 'Show the repository health score and the checks that failed.', tech: `${SCANS} "scorecard" (some tenants report it under "microengines": confirm by hand then).` }),
  c('sbom', 'supply', 'SBOM export', 'SCA — SBOM (CycloneDX / SPDX)', { keywords: ['sbom', 'cyclonedx', 'spdx'] }, { proof: 'Export an SBOM in the customer’s format and open it in their tool.', tech: MANUAL }),
  // ——— AI Supply Chain Security ———
  c('aisc', 'aisc', 'AI Inventory', 'AI Supply Chain Security — AI Inventory (AI-BOM)', { engines: ['aisc', 'ai-inventory', 'aibom', 'ai-supply-chain'], keywords: ['ai inventory', 'ai-bom', 'aibom', 'ai supply chain', 'aisc', 'models in use'] }, { proof: 'Show the AI models, frameworks and providers found in the code, and their risks.', tech: `${SCANS} one of: aisc, ai-inventory, aibom (engine name to confirm on the tenant: edit this rule once seen). Otherwise confirmed by the SE.` }),
  c('llm-scanner', 'aisc', 'LLM Scanner', 'AI Supply Chain Security — LLM Scanner', { engines: ['llm-scanner', 'llmscanner', 'llm'], keywords: ['llm scanner', 'prompt injection', 'llm risk'] }, { isNew: true, proof: 'Show LLM-specific risks found in the application code (prompt injection, insecure output handling…).', tech: `${SCANS} llm-scanner (engine name to confirm on the tenant). Otherwise confirmed by the SE.` }),
  // ——— Runtime Security ———
  c('dast-ai', 'runtime', 'DAST for AI', 'DAST for AI', { engines: ['dast-ai', 'dast'], keywords: ['dast for ai', 'ai red team', 'llm pentest', 'dast'] }, { isNew: true, proof: 'Run DAST for AI against the customer’s AI endpoint; show the findings.', tech: `${SCANS} dast or dast-ai (DAST scans may not appear in /api/scans on every tenant: confirm by hand then).` }),
  c('dast', 'runtime', 'DAST', 'DAST', { engines: ['dast'], keywords: ['dast', 'dynamic scan', 'zap'] }, { proof: 'Scan the agreed web application; correlate with SAST where possible.', tech: `${SCANS} "dast" (else confirmed by hand).` }),
  // ——— Agents ———
  c('dev-assist', 'agents', 'Developer Assist', 'Checkmarx One Assist — Developer Assist (prevention in the IDE & coding assistants)', { origins: ['vs code', 'vscode', 'jetbrains', 'intellij', 'cursor', 'windsurf', 'kiro', 'visual studio', 'copilot'], keywords: ['developer assist', 'one assist', 'coding assistant', 'cursor', 'copilot', 'windsurf'] }, { proof: 'In the developer’s IDE or coding assistant, show a vulnerability prevented as the code is written, and the fix it proposes.', tech: 'Scans whose origin (sourceOrigin / user agent in GET /api/scans) names an IDE or coding assistant: VS Code, JetBrains, Visual Studio, Cursor, Windsurf, Kiro, Copilot.' }),
  c('ai-triage', 'agents', 'Triage Assist', 'Checkmarx One Assist — Triage Assist (attackability-first ranking)', { actions: ['triage'], keywords: ['triage assist', 'ai triage', 'attackability', 'auto triage'] }, { isNew: true, proof: 'Run Triage Assist on the agreed findings; show the attackability ranking and the not-exploitable verdicts.', tech: 'AI triage actions counted by GET /api/credits/consumption in the last 30 days (actionType containing "triage").' }),
  c('ai-remediation', 'agents', 'Remediation Assist', 'Checkmarx One Assist — Remediation Assist (merge-ready fixes)', { actions: ['remediation'], keywords: ['remediation assist', 'ai remediation', 'auto remediation', 'ai fix', 'merge-ready'] }, { isNew: true, proof: 'Generate a fix for an agreed finding and open the merge-ready pull request; show the rescan confirming it.', tech: 'AI remediation actions counted by GET /api/credits/consumption in the last 30 days (actionType containing "remediation").' }),
  c('mcp', 'agents', 'Checkmarx MCP', 'Checkmarx MCP server (agent & platform access)', { origins: ['mcp'], keywords: ['mcp', 'model context protocol', 'agent access'] }, { proof: 'Connect the customer’s agent (Claude, Copilot, Cursor…) to the Checkmarx MCP server and query findings or start a scan from it.', tech: 'Scans whose origin or user agent names "mcp" (GET /api/scans). MCP queries alone leave no scan: confirmed by the SE then.' }),
  // ——— ASPM ———
  c('risk-orchestration', 'aspm', 'Risk Orchestration', 'ASPM — Risk Orchestration (applications & risk)', { keywords: ['risk orchestration', 'application risk', 'aspm', 'risk score', 'business impact'] }, { isNew: true, proof: 'Group projects into applications with their criticality; show the unified risk score and the top risks across engines.', tech: `Applications are read from GET /api/applications by Checkmarx One itself; this read does not count them yet. ${MANUAL}` }),
  c('policy', 'aspm', 'Policy Management', 'Policy Management (rules, break build)', { keywords: ['policy', 'break build', 'break the build', 'threshold', 'gate', 'violation'] }, { proof: 'Create a policy, show a violation on a project and the pipeline breaking on it.', tech: MANUAL }),
  c('analytics', 'aspm', 'Analytics & Reporting', 'Analytics and Reports (PDF, SARIF, JSON)', { keywords: ['analytics', 'dashboard', 'kpi', 'report', 'sarif', 'pdf report', 'mttr'] }, { proof: 'Walk through the analytics dashboard (trends, MTTR, ageing); export the agreed report formats.', tech: MANUAL }),
  // ——— SCM ———
  c('github', 'scm', 'GitHub integration (repo import, PR decoration)', 'Code Repository integration — GitHub', { repoHosts: ['github.com', 'github.'], keywords: ['github'] }, { proof: 'Import repositories from GitHub; show a pull request decorated with new findings.', tech: 'A project whose repository address (repoUrl in GET /api/projects) is on GitHub.' }),
  c('gitlab', 'scm', 'GitLab integration', 'Code Repository integration — GitLab', { repoHosts: ['gitlab'], keywords: ['gitlab'] }, { proof: 'Import repositories from GitLab; show a merge request decorated with findings.', tech: 'A project whose repoUrl is on GitLab.' }),
  c('bitbucket', 'scm', 'Bitbucket integration', 'Code Repository integration — Bitbucket', { repoHosts: ['bitbucket'], keywords: ['bitbucket'] }, { proof: 'Import repositories from Bitbucket; show a pull request decorated with findings.', tech: 'A project whose repoUrl is on Bitbucket.' }),
  c('azure-repos', 'scm', 'Azure Repos integration', 'Code Repository integration — Azure DevOps', { repoHosts: ['dev.azure.com', 'visualstudio.com'], keywords: ['azure repos'] }, { proof: 'Import repositories from Azure Repos; show a pull request decorated with findings.', tech: 'A project whose repoUrl is on dev.azure.com or visualstudio.com.' }),
  c('webhook', 'scm', 'Scan on push / pull request (webhook)', 'Code Repository webhook scans', { origins: ['webhook', 'scm', 'pull request', 'pr-'], keywords: ['webhook', 'pull request', 'pr decoration', 'scan on push'] }, { proof: 'Push a change and open a pull request; show the scan starting by itself and the decoration.', tech: 'Scans whose origin names a webhook, SCM or pull request (GET /api/scans).' }),
  // ——— CI/CD ———
  ...[
    ['jenkins', 'Jenkins', 'Checkmarx One Jenkins plugin', ['jenkins'], ['jenkins']],
    ['github-actions', 'GitHub Actions', 'Checkmarx One GitHub Action', ['github action', 'github-action', 'gh-action', 'githubactions'], ['github actions', 'github action']],
    ['gitlab-ci', 'GitLab CI', 'Checkmarx One GitLab CI template', ['gitlab-ci', 'gitlab ci'], ['gitlab ci', 'gitlab pipeline']],
    ['azure-pipelines', 'Azure DevOps Pipelines', 'Checkmarx One Azure DevOps extension', ['azure', 'ado', 'vsts', 'tfs'], ['azure devops', 'azure pipeline']],
    ['bitbucket-pipelines', 'Bitbucket Pipelines', 'Checkmarx One Bitbucket pipe', ['bitbucket'], ['bitbucket pipeline']],
    ['teamcity', 'TeamCity', 'Checkmarx One TeamCity plugin', ['teamcity'], ['teamcity']],
    ['bamboo', 'Bamboo', 'Checkmarx One Bamboo plugin', ['bamboo'], ['bamboo']],
    ['circleci', 'CircleCI', 'Checkmarx One CircleCI orb', ['circleci', 'circle'], ['circleci']],
    ['travis', 'Travis CI', 'CLI in Travis CI', ['travis'], ['travis']],
    ['codebuild', 'AWS CodeBuild', 'CLI in AWS CodeBuild', ['codebuild'], ['codebuild', 'aws pipeline']],
  ].map(([id, name, cx, origins, keywords]) => c(id, 'ci', name, cx, { origins, keywords }, { proof: `Run the agreed pipeline in ${name} with the Checkmarx One step; show results in the build and the break-build threshold.`, tech: `Scans whose origin (sourceOrigin, or the user agent the plugin sends) names ${name} (GET /api/scans).` })),
  // ——— CLI, API, portal ———
  c('cli', 'cli', 'Checkmarx One CLI', 'ast-cli (cx)', { origins: ['cli', 'ast-cli', 'cx-cli'], keywords: ['cli'] }, { proof: 'Run a scan from the CLI in the customer’s environment.', tech: 'Scans whose origin names the CLI (GET /api/scans).' }),
  c('api', 'cli', 'REST API', 'Checkmarx One REST API', { origins: ['api', 'rest', 'postman'], keywords: ['rest api', 'api integration'] }, { proof: 'Start a scan and read results through the REST API from the customer’s script.', tech: 'Scans whose origin names the API or Postman (GET /api/scans).' }),
  c('portal', 'cli', 'Web portal (upload / Git URL scan)', 'Checkmarx One web application', { origins: ['web', 'portal', 'webapp', 'ui'], keywords: ['portal', 'zip upload'] }, { proof: 'Create a project and scan it from the portal (zip or Git URL).', tech: 'Scans whose origin names the web application (GET /api/scans).' }),
  // ——— IDE ———
  ...[
    ['vscode', 'VS Code extension', ['vs code', 'vscode']],
    ['jetbrains', 'JetBrains plugin', ['jetbrains', 'intellij']],
    ['visual-studio', 'Visual Studio extension', ['visual studio']],
    ['eclipse', 'Eclipse plugin', ['eclipse']],
  ].map(([id, name, origins]) => c(id, 'ide', name, `Checkmarx One ${name}`, { origins, keywords: origins }, { proof: `In ${name.split(' ')[0]}, show results of the project and a scan started from the IDE.`, tech: `Scans whose origin names ${name.split(' ')[0]} (GET /api/scans). Browsing results alone leaves no scan: confirmed by the SE then.` })),
  // ——— Tracking ———
  c('jira', 'tracking', 'Jira ticketing', 'Feedback Apps — Jira', { keywords: ['jira'] }, { proof: 'Create Jira tickets from findings (by hand and by the feedback app’s rules); show them closing when fixed.', tech: MANUAL }),
  c('azure-boards', 'tracking', 'Azure Boards', 'Feedback Apps — Azure Boards', { keywords: ['azure boards', 'work item'] }, { proof: 'Create work items from findings.', tech: MANUAL }),
  c('servicenow', 'tracking', 'ServiceNow', 'ServiceNow integration', { keywords: ['servicenow'] }, { proof: 'Create ServiceNow tickets from findings.', tech: MANUAL }),
  c('email-feedback', 'tracking', 'Email notifications', 'Feedback Apps — Email', { keywords: ['email notification', 'feedback app'] }, { proof: 'Show the notification email a team gets for new findings.', tech: MANUAL }),
  c('chat', 'tracking', 'Slack / Teams notifications', 'Notifications', { keywords: ['slack', 'teams'] }, { proof: 'Show the notification in the team’s channel.', tech: MANUAL }),
  // ——— Platform ———
  c('sso', 'platform', 'Single sign-on (SAML / OIDC)', 'Identity & Access Management — SSO', { keywords: ['sso', 'saml', 'okta', 'entra', 'azure ad'] }, { proof: 'Sign in through the customer’s identity provider; show group mapping.', tech: MANUAL }),
  c('rbac', 'platform', 'Roles, groups & access control', 'Identity & Access Management — roles and groups', { keywords: ['rbac', 'roles', 'groups', 'permissions'] }, { proof: 'Show a developer seeing only their team’s projects.', tech: MANUAL }),
  c('triage-workflow', 'platform', 'Triage workflow & custom states', 'Results — triage states', { keywords: ['triage', 'not exploitable', 'custom state'] }, { proof: 'Triage results with the customer’s states and comments; show the audit trail.', tech: MANUAL }),
  c('presets', 'platform', 'Presets & query customisation', 'SAST presets / CxQL', { keywords: ['preset', 'cxql', 'custom query'] }, { proof: 'Tune a preset or a query for the customer’s framework.', tech: MANUAL }),
  c('speed', 'platform', 'Scan speed & accuracy benchmark', 'Scan duration / false-positive rate', { keywords: ['scan time', 'false positive', 'accuracy', 'benchmark'] }, { proof: 'Compare scan times and the false-positive rate on the agreed applications.', tech: 'Scan durations are shown in the Live tenant tab (createdAt → updatedAt); the comparison is confirmed by the SE.' }),
];

/** Where an older saved catalogue's groups now live. */
const MOVED = { engines: { sast: 'code', secrets: 'code', iac: 'code', apisec: 'code', sca: 'supply', containers: 'supply', scorecard: 'supply', malicious: 'supply', sbom: 'supply', dast: 'runtime' }, ai: { fusion: 'code', last: 'code', aisc: 'aisc', 'ai-triage': 'agents', 'ai-remediation': 'agents', 'dev-assist': 'agents' } };

const list = (v, max = 30) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => text(x, 80).toLowerCase()).filter(Boolean).slice(0, max);

export class Catalog {
  #db;
  constructor(db) {
    this.#db = db;
  }

  /** The groups: the built-in ones, then any an Admin added. */
  categories() {
    return [...CATEGORIES, ...this.#db.read('catalogGroups', []).filter(([k]) => !CATEGORIES.some(([d]) => d === k))];
  }

  addCategory(label) {
    const name = text(label, 80);
    if (!name) throw fail(400, 'Name the group.');
    const existing = this.categories().find(([, l]) => l.toLowerCase() === name.toLowerCase());
    if (existing) return existing[0];
    const key = `g-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || randomUUID().slice(0, 6)}`;
    this.#db.write('catalogGroups', [...this.#db.read('catalogGroups', []), [key, name]]);
    return key;
  }

  /** The saved catalogue, with every built-in capability it does not have yet (unless deleted) added. */
  list() {
    const saved = this.#db.read('catalog', null);
    if (!saved) return DEFAULT_CATALOG;
    const deleted = new Set(this.#db.read('catalogDeleted', []));
    const groups = new Set(this.categories().map(([k]) => k));
    const out = saved.map((x) => {
      const moved = MOVED[x.category]?.[x.id];
      const def = DEFAULT_CATALOG.find((d) => d.id === x.id);
      return { ...x, category: groups.has(x.category) ? x.category : moved ?? def?.category ?? 'platform', proof: x.proof ?? def?.proof ?? '', tech: x.tech ?? def?.tech ?? '', isNew: x.isNew ?? def?.isNew ?? false };
    });
    for (const d of DEFAULT_CATALOG) if (!out.some((x) => x.id === d.id) && !deleted.has(d.id)) out.push(d);
    return out;
  }

  get(id) {
    return this.list().find((x) => x.id === id) ?? null;
  }

  save(entry) {
    const all = [...this.list()];
    const category = entry.newGroup ? this.addCategory(entry.newGroup) : this.categories().some(([k]) => k === entry.category) ? entry.category : 'platform';
    const clean = {
      id: text(entry.id, 60) || `x-${randomUUID().slice(0, 8)}`,
      category,
      name: text(entry.name, 160),
      cxName: text(entry.cxName, 300),
      description: text(entry.description, 1000),
      proof: text(entry.proof, 2000),
      tech: text(entry.tech, 2000),
      isNew: Boolean(entry.isNew),
      detect: Object.fromEntries(['engines', 'scanTypes', 'origins', 'repoHosts', 'actions', 'keywords'].map((k) => [k, list(entry.detect?.[k])])),
    };
    if (!clean.name) throw fail(400, 'Give the capability a name.');
    const i = all.findIndex((x) => x.id === clean.id);
    if (i === -1) all.push(clean);
    else all[i] = clean;
    this.#db.write('catalog', all);
    return clean;
  }

  remove(id) {
    this.#db.write('catalog', this.list().filter((x) => x.id !== id));
    this.#db.write('catalogDeleted', [...new Set([...this.#db.read('catalogDeleted', []), id])]);
  }

  reset() {
    this.#db.write('catalog', DEFAULT_CATALOG);
    this.#db.write('catalogDeleted', []);
  }
}

/** What a tenant shows, in the shape the rules read. */
export function tenantFacts(snapshot) {
  const completed = (snapshot?.scans ?? []).filter((s) => /completed|partial/i.test(s.status));
  return {
    engines: new Set(completed.flatMap((s) => s.engines ?? [])),
    scanTypes: new Set(completed.map((s) => s.scanType).filter((t) => t && t !== 'none')),
    origins: [...new Set((snapshot?.scans ?? []).flatMap((s) => [s.origin, s.originRaw, s.userAgent].filter(Boolean)).map((o) => o.toLowerCase()))],
    repoHosts: [...new Set((snapshot?.projects?.list ?? []).map((p) => p.repoUrl).filter(Boolean).map((u) => u.toLowerCase()))],
    actions: new Set(Object.entries(snapshot?.credits?.actions ?? {}).filter(([, n]) => n > 0).map(([k]) => k)),
  };
}

/**
 * Evidence for one criterion: { level: 'detected' | 'mentioned' | 'none', evidence: [text] }. `detected` comes from
 * the tenant, `mentioned` only from the opportunity's own words.
 */
export function evaluate(capability, facts, notesText = '') {
  const d = capability?.detect ?? {};
  const evidence = [];
  if (facts) {
    for (const e of d.engines ?? []) if (facts.engines.has(e)) evidence.push(`Completed scans ran the ${e} engine`);
    for (const t of d.scanTypes ?? []) if (facts.scanTypes.has(t)) evidence.push(`A ${t === 'fusion' ? 'Fusion' : 'LAST'} scan completed`);
    for (const o of d.origins ?? []) {
      const hit = facts.origins.find((x) => wordIn(x, o));
      if (hit) evidence.push(`Scans came from "${hit}"`);
    }
    for (const h of d.repoHosts ?? []) {
      const hit = facts.repoHosts.find((x) => x.includes(h));
      if (hit) evidence.push(`A project's repository is on ${h}`);
    }
    for (const a of d.actions ?? []) if (facts.actions.has(a)) evidence.push(`Checkmarx One counted AI ${a} actions`);
  }
  if (evidence.length) return { level: 'detected', evidence: [...new Set(evidence)].slice(0, 5) };
  const words = String(notesText).toLowerCase();
  const said = (d.keywords ?? []).filter((k) => k && wordIn(words, k));
  return said.length ? { level: 'mentioned', evidence: said.slice(0, 5).map((k) => `Notes mention "${k}"`) } : { level: 'none', evidence: [] };
}

/** `needle` in `hay` on word boundaries ("ado" must not match "shadow"). */
function wordIn(hay, needle) {
  const n = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${n}($|[^a-z0-9])`, 'i').test(hay);
}
