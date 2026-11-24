/**
 * The success criteria bank: for every technical scenario (a capability in the catalogue), the business goal it
 * serves, the criterion as the customer reads it, the test item (what is done in the POV) and the benefit (what
 * the customer gains). When a criterion is added to a POV, Kendra fills its goal, test and benefit from here, so
 * the final report tells the story by business goal without anyone writing it.
 *
 * Built in: a starting bank written from Checkmarx POV guides. An Admin (or anyone who manages the catalogue)
 * replaces or extends it with the team's own bank: a CSV or JSON import, one row per scenario.
 */
import { fail, text } from './db.js';
import { CAP_TO_CATALOG } from './library.js';

/** The business goals a POV is told by. */
export const GOALS = [
  { key: 'consolidate', title: 'Consolidate AppSec testing onto one platform', statement: 'One platform replaces separate scanners, contracts, and reports with a single, correlated view of application risk.' },
  { key: 'supply', title: 'Secure the software supply chain', statement: 'Open source, containers and packages are checked before they ship, and SBOMs and license positions come on demand.' },
  { key: 'signal', title: 'Deliver findings worth a developer’s time', statement: 'Tuning and AI-based filtering cut false positives, so developers trust what they see, where they already work.' },
  { key: 'ai', title: 'Secure AI-generated code as it is written', statement: 'Code and packages from AI coding assistants are checked the moment they are created, so AI speed does not add security debt.' },
  { key: 'runtime', title: 'Discover and test every API and web application', statement: 'API discovery, API testing and authenticated DAST find the endpoints and runtime flaws static scanning misses.' },
  { key: 'govern', title: 'Govern application risk with evidence on demand', statement: 'Policies, roles and reports run from one place, so audits and leadership questions are answered with an export.' },
];

const e = (capabilityId, goal, title, test, benefit) => ({ capabilityId, goal, title, test, benefit });
const TOOL = (ids, goal, title, test, benefit) => ids.map((id) => e(id, goal, title, test, benefit));

/** One entry per capability: the first for a capability is the one used to fill a criterion. */
export const DEFAULT_BANK = [
  // Code security
  e('sast', 'signal', 'Language coverage', 'Scan agreed repositories in the customer’s languages and review the results with the AppSec team.', 'One platform covers your full language mix.'),
  e('fusion', 'signal', 'AI false-positive reduction', 'Scan the same projects with AI-based analysis on and off, then review a sample of the removed findings.', 'Developers see fewer false alarms, and you confirm what was removed was noise.'),
  e('last', 'signal', 'Language coverage: LLM-based scanning', 'Enable LLM-based scanning on an agreed repository in a language classic SAST does not cover, and review the results.', 'Code in every language is covered, including legacy and niche ones.'),
  e('secrets', 'consolidate', 'Secrets detection', 'Scan agreed repositories for hard-coded secrets and review what is found, from the same project setup.', 'Exposed credentials are caught before they leak, without another tool.'),
  e('iac', 'consolidate', 'IaC scanning', 'Scan the agreed Terraform, CloudFormation, Helm or Kubernetes files and review the misconfigurations found.', 'Cloud misconfigurations are fixed in code, before they are deployed.'),
  e('apisec', 'runtime', 'API discovery', 'Compare the Global API Inventory with the customer’s existing API documentation for agreed applications.', 'Undocumented and shadow APIs become visible and governable.'),
  e('presets', 'signal', 'Custom queries', 'Adjust a query to recognise a sanitizer or framework used in the customer’s code, then rescan.', 'Results reflect your own code patterns, cutting repeat false positives.'),
  e('speed', 'signal', 'Incremental scanning', 'Compare full and incremental scan times on the largest agreed repository.', 'Commit scans stay fast enough for the pipeline.'),
  // Supply chain
  e('sca', 'supply', 'Full dependency coverage', 'Compare scan results with the resolved dependency tree, including transitive dependencies, across in-scope package managers, and review license findings against the customer’s policy.', 'You see what actually ships, not only what developers declared, with license exposure in the same view.'),
  e('sbom', 'supply', 'SBOM generation', 'Generate SBOMs for in-scope applications in CycloneDX and SPDX formats, including through the CLI as a pipeline artifact.', 'SBOM requests are met without a separate tool or manual work.'),
  e('malicious', 'supply', 'Malicious package protection', 'Add a known malicious package to a test project and confirm it is flagged before the build uses it.', 'Malicious packages are stopped before they reach a build or a developer laptop.'),
  e('containers', 'consolidate', 'Container image scanning', 'Scan agreed images from the customer’s registry and review OS and application package findings.', 'Vulnerable images are caught before deployment.'),
  e('scorecard', 'supply', 'Repository health', 'Review the health score of the open-source repositories the agreed applications depend on.', 'Risky, unmaintained dependencies are spotted before they become incidents.'),
  // AI supply chain
  e('aisc', 'ai', 'AI asset discovery', 'Scan in-scope repositories and review detected models, frameworks, SDKs, agents and MCP components in the Global Inventory, then export it as an AI-BOM.', 'You get a current picture of AI use in your code from the scans you already run.'),
  e('llm-scanner', 'ai', 'LLM risk', 'Review findings where untrusted input reaches an LLM call (prompt injection, unsafe output handling) in agreed repositories.', 'LLM risks are found before deployment.'),
  e('mcp-scanner', 'ai', 'MCP and agent risk', 'Review findings where untrusted input reaches an MCP tool, and detected agent frameworks and risks such as unsafe tool access.', 'Injection risks in agent tools are found before deployment.'),
  e('skills-scanner', 'ai', 'Skill risk', 'Scan repositories containing agent skills, including test skills with risky behaviour, and review the findings and each skill’s risk score.', 'Skills are vetted before a coding agent acts on them with a developer’s permissions.'),
  // Runtime
  e('dast', 'runtime', 'Authenticated DAST', 'Run DAST with authentication against an agreed web application, recording a business flow where needed.', 'Testing reaches the functionality real users see, not just the login page.'),
  e('dast-ai', 'runtime', 'DAST for AI applications', 'Run DAST against an agreed AI-powered application and review the AI-specific findings.', 'AI features are tested the way an attacker would use them.'),
  // Assist agents
  e('dev-assist', 'ai', 'Fix in the assistant', 'Connect Developer Assist in an agreed IDE, edit code, manifests, IaC files and Dockerfiles in a test project, and fix flagged issues with the fix action or in chat.', 'Issues are fixed while the context is fresh, not weeks later from a ticket.'),
  e('ai-triage', 'ai', 'Attackability-based prioritization', 'Run AI Triage on a representative set of SAST and SCA findings and compare its results with the customer’s analysts on a sample.', 'Effort goes to the findings an attacker could actually use, with human authority kept.'),
  e('ai-remediation', 'ai', 'Ready-to-review fixes', 'Review AI remediation output for confirmed findings: summary, explanation and code changes, merged by a person under branch protection.', 'Developers review a proposed change instead of researching each fix.'),
  e('mcp', 'ai', 'Security context for AI agents', 'Ask an AI coding agent about the project’s findings through the Checkmarx MCP server and fix one from there.', 'Agents and developers work with live security context.'),
  // Govern & unify
  e('risk-orchestration', 'consolidate', 'Correlated results', 'Review results for the same applications in the unified risk view and confirm related findings from different engines are brought together; import a SARIF file from an incumbent tool alongside.', 'Analysts work one list instead of reconciling overlapping tool outputs.'),
  e('analytics', 'govern', 'Executive dashboards and evidence', 'Review the executive dashboard for in-scope applications, and produce scan history, triage decisions and remediation timelines for the POV period.', 'Reports and audit evidence come from live data, not built by hand.'),
  e('policy', 'govern', 'Central policy', 'Define agreed policies once (for example, fail on new critical findings) and apply them to in-scope projects across engines.', 'One standard applies everywhere, without per-project drift.'),
  // Integrations
  ...TOOL(['github', 'gitlab', 'bitbucket', 'azure-repos', 'webhook'], 'signal', 'Pull request feedback', 'Open pull requests on test branches and review the advisory findings shown on the changed code.', 'Reviewers see security context in the review they are already doing.'),
  ...TOOL(['jenkins', 'github-actions', 'gitlab-ci', 'azure-pipelines', 'bitbucket-pipelines', 'teamcity', 'bamboo', 'circleci', 'travis', 'codebuild', 'cli'], 'consolidate', 'Pipeline integration and gates', 'Add scanning to an agreed pipeline on test branches with the native plugin or the CLI, introduce a test violation, and confirm the pipeline is blocked or warned as configured.', 'Enforcement fits existing pipelines without custom scripting.'),
  e('api', 'govern', 'API integration', 'Pull results into an existing reporting or GRC tool through the API.', 'Security data feeds enterprise reporting without manual exports.'),
  e('portal', 'consolidate', 'Scan without integration', 'Scan an agreed application by uploading a zip or a Git URL from the web portal.', 'Any team can be covered on day one, before integrations are set up.'),
  ...TOOL(['vscode', 'jetbrains', 'visual-studio', 'eclipse'], 'signal', 'IDE setup and real-time scanning', 'Install the extension in the agreed IDE, sign in, then edit code in a test project and confirm findings appear inline.', 'Security runs where developers already work.'),
  ...TOOL(['copilot', 'cursor', 'claude-code', 'windsurf', 'kiro'], 'ai', 'Generated code scanning', 'Connect Developer Assist to the customer’s AI coding assistant, prompt it to produce agreed insecure patterns, and confirm they are flagged.', 'Vulnerabilities in generated code are caught before commit.'),
  ...TOOL(['jira', 'azure-boards', 'servicenow'], 'signal', 'Findings in the backlog', 'Create tickets from agreed findings in the customer’s tracker and confirm they close when the finding is fixed.', 'Fixes are tracked where the team already plans its work.'),
  ...TOOL(['email-feedback', 'chat'], 'signal', 'Notifications', 'Send agreed alerts (new critical findings, failed policies) to the team’s channel or inbox.', 'The right people hear about risk without opening another tool.'),
  e('sso', 'govern', 'Single sign-on', 'Sign in through the customer’s identity provider and map its groups to roles.', 'Access follows the people directory, with no separate accounts to manage.'),
  e('rbac', 'govern', 'Scoped roles', 'Assign roles at tenant, application or project level to POV users and confirm each role’s permissions.', 'People see and change only what their role allows.'),
  e('triage-workflow', 'signal', 'Triage workflow', 'Triage a sample of findings with the agreed states and comments, and confirm the decisions carry to the next scan.', 'Decisions are made once and remembered.'),
];

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

export class Bank {
  #db;
  #catalog;
  #library;
  #cache = null;
  constructor(db, { catalog, library = null }) {
    this.#db = db;
    this.#catalog = catalog;
    this.#library = library;
  }

  /** With the SEAL library imported, its business goals and their criteria are the bank. */
  #fromLibrary() {
    const lib = this.#library?.goals() ?? [];
    if (!lib.length) return null;
    const stamp = this.#library.summary()?.files?.goals?.at;
    if (this.#cache?.stamp === stamp) return this.#cache;
    const caps = this.#catalog.list();
    const libCaps = this.#library.data?.capabilities ?? [];
    const goals = lib.map((g) => ({ key: g.id, title: g.title, statement: g.statement, persona: g.persona, driver: g.driver, measures: g.measures, expectedBenefit: g.expectedBenefit, baseline: g.baseline, methodology: g.methodology, evidence: g.evidence, scope: g.scope, traces: g.traces }));
    const entries = lib.flatMap((g) => {
      // The capabilities the goal depends on, as the catalogue knows them; each criterion goes to the closest one.
      const candidates = [...new Set(g.capabilities.map((c) => CAP_TO_CATALOG[c]).filter(Boolean))];
      return g.criteria.map((r) => {
        const w = words(`${r.name} ${r.test}`);
        let best = '';
        let score = 0;
        for (const id of candidates) {
          const cap = caps.find((c) => c.id === id);
          const libTitles = libCaps.filter((c) => c.catalogId === id).map((c) => c.title).join(' ');
          const hits = [...words(`${cap?.name ?? ''} ${cap?.cxName ?? ''} ${libTitles}`)].filter((x) => w.has(x)).length;
          if (hits > score) [best, score] = [id, hits];
        }
        return { capabilityId: best || (candidates.length === 1 ? candidates[0] : ''), goal: g.id, title: r.name, test: r.test, benefit: r.benefit };
      });
    });
    this.#cache = { stamp, goals, entries };
    return this.#cache;
  }

  #stored() {
    return this.#db.read('bank', null);
  }

  /**
   * Which bank is in force: the SEAL library's, or the one kept here (imported, or edited by an Admin), whichever is
   * newer; else the built-in one. An Admin's edits stand until the library is imported again.
   */
  #current() {
    const lib = this.#fromLibrary();
    const s = this.#stored();
    if (lib && s) {
      const libAt = this.#library.summary()?.files?.goals?.at ?? '';
      return String(s.importedAt ?? s.editedAt ?? '') >= String(libAt) ? { ...s, source: s.edited ? 'edited' : 'imported' } : { ...lib, source: 'library' };
    }
    if (lib) return { ...lib, source: 'library' };
    if (s) return { ...s, source: s.edited ? 'edited' : 'imported' };
    return { goals: GOALS, entries: DEFAULT_BANK, source: 'built-in' };
  }

  goals() {
    return this.#current().goals;
  }

  entries() {
    return this.#current().entries;
  }

  /** The criteria that prove a business goal. */
  forGoal(key) {
    return this.entries().filter((x) => x.goal === key);
  }

  /** The bank entry for a capability (the first one). */
  forCapability(capabilityId) {
    return this.entries().find((x) => x.capabilityId === capabilityId) ?? null;
  }

  goal(key) {
    return this.goals().find((g) => g.key === key) ?? null;
  }

  info() {
    const s = this.#stored();
    const cur = this.#current();
    return { source: cur.source, custom: Boolean(s), importedAt: s?.importedAt ?? null, editedAt: s?.editedAt ?? null, by: s?.by ?? '', goals: this.goals(), entries: this.entries().map((e, i) => ({ ...e, id: e.id ?? `e${i}` })) };
  }

  // ——— Editing (Admins): the bank in force is copied here once, then changed in place ———
  #editable(actor) {
    const cur = this.#current();
    const goals = cur.goals.map((g) => ({ ...g }));
    const entries = cur.entries.map((e, i) => ({ ...e, id: e.id ?? `e${i}-${Date.now().toString(36)}` }));
    return { goals, entries, save: () => this.#db.write('bank', { goals, entries, edited: true, editedAt: new Date().toISOString(), importedAt: null, by: actor?.name ?? '' }) };
  }

  saveGoal(actor, key, body) {
    const b = this.#editable(actor);
    const title = text(body.title, 160);
    if (!title) throw fail(400, 'Give the business goal a title.');
    let g = key ? b.goals.find((x) => x.key === key) : null;
    if (key && !g) throw fail(404, 'No such business goal.');
    if (!g) {
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'goal';
      let k = base;
      for (let n = 2; b.goals.some((x) => x.key === k); n += 1) k = `${base}-${n}`;
      g = { key: k };
      b.goals.push(g);
    }
    Object.assign(g, { title, statement: text(body.statement, 400), driver: text(body.driver, 200), measures: (Array.isArray(body.measures) ? body.measures : String(body.measures ?? '').split('\n')).map((x) => text(x, 200)).filter(Boolean).slice(0, 8) });
    b.save();
    return g;
  }

  removeGoal(actor, key) {
    const b = this.#editable(actor);
    const i = b.goals.findIndex((x) => x.key === key);
    if (i < 0) throw fail(404, 'No such business goal.');
    b.goals.splice(i, 1);
    for (let j = b.entries.length - 1; j >= 0; j -= 1) if (b.entries[j].goal === key) b.entries.splice(j, 1);
    b.save();
  }

  saveEntry(actor, id, body) {
    const b = this.#editable(actor);
    const title = text(body.title, 200);
    if (!title) throw fail(400, 'Give the success criterion a name.');
    const goal = text(body.goal, 60);
    if (!b.goals.some((g) => g.key === goal)) throw fail(400, 'Pick the business goal it proves.');
    const capabilityId = text(body.capabilityId, 60);
    if (capabilityId && !this.#catalog.list().some((c) => c.id === capabilityId)) throw fail(400, 'That capability is not in the catalogue.');
    const current = this.info().entries;
    const at = id ? current.findIndex((e) => e.id === id) : -1;
    if (id && at < 0) throw fail(404, 'No such success criterion.');
    const e = { ...(at >= 0 ? b.entries[at] : { id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }), goal, capabilityId, title, test: text(body.test, 1000), benefit: text(body.benefit, 600) };
    if (at >= 0) b.entries[at] = e;
    else b.entries.push(e);
    b.save();
    return e;
  }

  removeEntry(actor, id) {
    const b = this.#editable(actor);
    const at = this.info().entries.findIndex((e) => e.id === id);
    if (at < 0) throw fail(404, 'No such success criterion.');
    b.entries.splice(at, 1);
    b.save();
  }

  reset() {
    this.#db.write('bank', null);
  }

  /**
   * Replace the bank with rows of: capability (id or name), goal (key or title), criterion, test, benefit, and
   * optionally goal_statement. A goal named that is not known yet is added. Returns what was taken and refused.
   */
  import(rows, actor) {
    const caps = this.#catalog.list();
    const byName = new Map(caps.flatMap((c) => [[c.id.toLowerCase(), c.id], [c.name.toLowerCase(), c.id], [String(c.cxName ?? '').toLowerCase(), c.id]]));
    const goals = [...GOALS];
    const goalKey = (v, statement = '') => {
      const s = text(v, 160);
      if (!s) return '';
      const hit = goals.find((g) => g.key === s.toLowerCase() || g.title.toLowerCase() === s.toLowerCase());
      if (hit) {
        if (statement && !hit.statement) hit.statement = text(statement, 400);
        return hit.key;
      }
      const key = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `goal-${goals.length + 1}`;
      goals.push({ key, title: s, statement: text(statement, 400) });
      return key;
    };
    const entries = [];
    const refused = [];
    for (const [i, raw] of rows.entries()) {
      const r = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v]));
      const capName = String(r.capability ?? r.capabilityid ?? r.scenario ?? r.technicalscenario ?? r.engine ?? '').trim().toLowerCase();
      const capabilityId = byName.get(capName) ?? '';
      const title = text(r.criterion ?? r.successcriterion ?? r.title ?? r.name, 200);
      if (!title) {
        refused.push({ row: i + 2, why: 'no criterion' });
        continue;
      }
      if (capName && !capabilityId) refused.push({ row: i + 2, why: `“${capName}” is not in the capability catalogue; kept as a criterion of the team’s own` });
      entries.push({
        capabilityId,
        goal: goalKey(r.goal ?? r.businessgoal, r.goalstatement ?? r.statement),
        title,
        test: text(r.test ?? r.testitem ?? r.howtotest, 1000),
        benefit: text(r.benefit ?? r.value ?? r.businessvalue, 600),
      });
    }
    if (!entries.length) throw fail(400, 'No rows with a criterion were found. Columns: capability, goal, criterion, test, benefit.');
    this.#db.write('bank', { goals, entries, importedAt: new Date().toISOString(), by: actor?.name ?? '' });
    return { taken: entries.length, refused, goals: goals.length };
  }
}
