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
  ['engines', 'Scanners & engines'],
  ['ai', 'AI & Fusion'],
  ['scm', 'Source code management'],
  ['ci', 'CI/CD & build'],
  ['cli', 'CLI, API & portal'],
  ['ide', 'IDE & developer'],
  ['tracking', 'Defect tracking & feedback'],
  ['platform', 'Platform, governance & reporting'],
];

const c = (id, category, name, cxName, detect = {}, description = '') => ({ id, category, name, cxName, description, detect: { engines: [], scanTypes: [], origins: [], repoHosts: [], actions: [], keywords: [], ...detect } });

export const DEFAULT_CATALOG = [
  // Scanners
  c('sast', 'engines', 'SAST — static application security testing', 'SAST', { engines: ['sast'], keywords: ['sast', 'static analysis'] }),
  c('sca', 'engines', 'SCA — software composition analysis', 'SCA', { engines: ['sca'], keywords: ['sca', 'open source', 'dependencies', 'third-party'] }),
  c('iac', 'engines', 'IaC security', 'IaC Security (KICS)', { engines: ['kics'], keywords: ['iac', 'terraform', 'kics', 'cloudformation', 'helm'] }),
  c('containers', 'engines', 'Container security', 'Container Security', { engines: ['containers'], keywords: ['container', 'docker', 'image scan'] }),
  c('apisec', 'engines', 'API security', 'API Security', { engines: ['apisec', 'api-security'], keywords: ['api security', 'swagger', 'openapi'] }),
  c('secrets', 'engines', 'Secret detection', 'Secret Detection (2MS, micro engines)', { engines: ['microengines', 'secrets'], keywords: ['secret', 'credentials', 'hardcoded password'] }),
  c('scorecard', 'engines', 'Repository health (OpenSSF Scorecard)', 'Scorecard (micro engines)', { engines: ['scorecard'], keywords: ['scorecard', 'repository health'] }),
  c('malicious', 'engines', 'Malicious package protection', 'SCA — Malicious Packages', { keywords: ['malicious package', 'typosquat'] }),
  c('sbom', 'engines', 'SBOM export', 'SCA — SBOM (CycloneDX / SPDX)', { keywords: ['sbom', 'cyclonedx', 'spdx'] }),
  c('dast', 'engines', 'DAST', 'DAST', { engines: ['dast'], keywords: ['dast', 'dynamic'] }),
  // AI
  c('fusion', 'ai', 'Fusion (AI-native SAST with frontier models)', 'AI engine, Fusion on (scan.config.ai.fusionEnabled)', { scanTypes: ['fusion'], keywords: ['fusion'] }),
  c('last', 'ai', 'LAST — LLM-based SAST scanning', 'AI engine, Fusion off (LLM-based scanning)', { scanTypes: ['last'], keywords: ['llm scan', 'last scan', 'llm-based'] }),
  c('aisc', 'ai', 'AI supply chain security (AISC)', 'AI Supply Chain Security', { engines: ['aisc', 'ai-supply-chain', 'aisupplychain'], keywords: ['aisc', 'ai supply chain', 'ai-bom', 'model scanning'] }),
  c('ai-triage', 'ai', 'AI triage', 'Checkmarx One AI — Triage', { actions: ['triage'], keywords: ['ai triage', 'auto triage'] }),
  c('ai-remediation', 'ai', 'AI remediation (fix pull requests)', 'Checkmarx One AI — Remediation', { actions: ['remediation'], keywords: ['ai remediation', 'auto remediation', 'ai fix'] }),
  c('dev-assist', 'ai', 'Developer Assist (AI in the IDE)', 'Checkmarx One Assist / Developer Assist', { keywords: ['developer assist', 'one assist', 'ai assist', 'mcp'] }),
  // SCM
  c('github', 'scm', 'GitHub integration (repo import, PR decoration)', 'GitHub (Code Repository integration)', { repoHosts: ['github.com', 'github.'], keywords: ['github'] }),
  c('gitlab', 'scm', 'GitLab integration', 'GitLab (Code Repository integration)', { repoHosts: ['gitlab'], keywords: ['gitlab'] }),
  c('bitbucket', 'scm', 'Bitbucket integration', 'Bitbucket (Code Repository integration)', { repoHosts: ['bitbucket'], keywords: ['bitbucket'] }),
  c('azure-repos', 'scm', 'Azure Repos integration', 'Azure DevOps (Code Repository integration)', { repoHosts: ['dev.azure.com', 'visualstudio.com'], keywords: ['azure repos'] }),
  c('webhook', 'scm', 'Scan on push / pull request (webhook)', 'Code Repository webhook scans', { origins: ['webhook', 'scm', 'pull request', 'pr-'], keywords: ['webhook', 'pull request', 'pr decoration', 'scan on push'] }),
  // CI
  c('jenkins', 'ci', 'Jenkins', 'Checkmarx One Jenkins plugin', { origins: ['jenkins'], keywords: ['jenkins'] }),
  c('github-actions', 'ci', 'GitHub Actions', 'Checkmarx One GitHub Action', { origins: ['github action', 'github-action', 'gh-action', 'githubactions'], keywords: ['github actions', 'github action'] }),
  c('gitlab-ci', 'ci', 'GitLab CI', 'Checkmarx One GitLab CI template', { origins: ['gitlab-ci', 'gitlab ci', 'gitlab'], keywords: ['gitlab ci', 'gitlab pipeline'] }),
  c('azure-pipelines', 'ci', 'Azure DevOps Pipelines', 'Checkmarx One Azure DevOps extension', { origins: ['azure', 'ado', 'vsts', 'tfs'], keywords: ['azure devops', 'azure pipeline', 'ado'] }),
  c('bitbucket-pipelines', 'ci', 'Bitbucket Pipelines', 'Checkmarx One Bitbucket pipe', { origins: ['bitbucket'], keywords: ['bitbucket pipeline'] }),
  c('teamcity', 'ci', 'TeamCity', 'Checkmarx One TeamCity plugin', { origins: ['teamcity'], keywords: ['teamcity'] }),
  c('bamboo', 'ci', 'Bamboo', 'Checkmarx One Bamboo plugin', { origins: ['bamboo'], keywords: ['bamboo'] }),
  c('circleci', 'ci', 'CircleCI', 'Checkmarx One CircleCI orb', { origins: ['circleci', 'circle'], keywords: ['circleci'] }),
  c('travis', 'ci', 'Travis CI', 'CLI in Travis', { origins: ['travis'], keywords: ['travis'] }),
  c('codebuild', 'ci', 'AWS CodeBuild', 'CLI in AWS CodeBuild', { origins: ['codebuild', 'aws'], keywords: ['codebuild', 'aws pipeline'] }),
  c('break-build', 'ci', 'Break the build on policy', 'Policy Management — break build', { keywords: ['break build', 'break the build', 'threshold', 'gate'] }),
  // CLI / API
  c('cli', 'cli', 'Checkmarx One CLI', 'ast-cli (cx)', { origins: ['cli', 'ast-cli', 'cx-cli'], keywords: ['cli'] }),
  c('api', 'cli', 'REST API', 'Checkmarx One REST API', { origins: ['api', 'rest', 'postman'], keywords: ['rest api', 'api integration'] }),
  c('portal', 'cli', 'Web portal (upload / Git URL scan)', 'Checkmarx One web application', { origins: ['web', 'portal', 'webapp', 'ui'], keywords: ['portal', 'zip upload'] }),
  // IDE
  c('vscode', 'ide', 'VS Code extension', 'Checkmarx One VS Code extension', { origins: ['vs code', 'vscode'], keywords: ['vs code', 'vscode'] }),
  c('jetbrains', 'ide', 'JetBrains plugin', 'Checkmarx One JetBrains plugin', { origins: ['jetbrains', 'intellij'], keywords: ['jetbrains', 'intellij'] }),
  c('visual-studio', 'ide', 'Visual Studio extension', 'Checkmarx One Visual Studio extension', { origins: ['visual studio'], keywords: ['visual studio'] }),
  c('eclipse', 'ide', 'Eclipse plugin', 'Checkmarx One Eclipse plugin', { origins: ['eclipse'], keywords: ['eclipse'] }),
  // Tracking
  c('jira', 'tracking', 'Jira ticketing', 'Feedback Apps — Jira', { keywords: ['jira'] }),
  c('azure-boards', 'tracking', 'Azure Boards', 'Feedback Apps — Azure Boards', { keywords: ['azure boards', 'work item'] }),
  c('servicenow', 'tracking', 'ServiceNow', 'ServiceNow integration', { keywords: ['servicenow'] }),
  c('email-feedback', 'tracking', 'Email notifications / feedback app', 'Feedback Apps — Email', { keywords: ['email notification', 'feedback app'] }),
  c('chat', 'tracking', 'Slack / Teams notifications', 'Notifications', { keywords: ['slack', 'teams'] }),
  // Platform
  c('sso', 'platform', 'Single sign-on (SAML / OIDC)', 'Identity & Access Management — SSO', { keywords: ['sso', 'saml', 'okta', 'entra', 'azure ad'] }),
  c('rbac', 'platform', 'Roles, groups & access control', 'Identity & Access Management — roles and groups', { keywords: ['rbac', 'roles', 'groups', 'permissions'] }),
  c('applications', 'platform', 'Applications & risk scoring', 'Applications', { keywords: ['application risk', 'applications'] }),
  c('triage-workflow', 'platform', 'Triage workflow & custom states', 'Results — triage states', { keywords: ['triage', 'not exploitable', 'custom state'] }),
  c('presets', 'platform', 'Presets & query customisation', 'SAST presets / CxQL', { keywords: ['preset', 'cxql', 'custom query'] }),
  c('reports', 'platform', 'Reports & exports (PDF, SARIF, JSON)', 'Reports', { keywords: ['report', 'sarif', 'pdf report'] }),
  c('analytics', 'platform', 'Analytics dashboard', 'Analytics', { keywords: ['analytics', 'dashboard', 'kpi'] }),
  c('speed', 'platform', 'Scan speed & accuracy benchmark', 'Scan duration / false positive rate', { keywords: ['scan time', 'false positive', 'accuracy', 'benchmark'] }),
];

const list = (v, max = 30) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => text(x, 80).toLowerCase()).filter(Boolean).slice(0, max);

export class Catalog {
  #db;
  constructor(db) {
    this.#db = db;
  }

  list() {
    return this.#db.read('catalog', null) ?? DEFAULT_CATALOG;
  }

  get(id) {
    return this.list().find((x) => x.id === id) ?? null;
  }

  save(entry) {
    const all = [...this.list()];
    const category = CATEGORIES.some(([k]) => k === entry.category) ? entry.category : 'platform';
    const clean = {
      id: text(entry.id, 60) || randomUUID().slice(0, 8),
      category,
      name: text(entry.name, 160),
      cxName: text(entry.cxName, 200),
      description: text(entry.description, 1000),
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
  }

  reset() {
    this.#db.write('catalog', DEFAULT_CATALOG);
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
