/**
 * The customer's toolchain, as the POV WIP deck shows it: six touch points, each with the tools Checkmarx One
 * integrates with there and the access the POV needs. A tool that is also a capability in the catalogue (catalogId)
 * can become a success criterion.
 */
export const TOOLCHAIN = [
  {
    key: 'ide',
    label: 'IDE',
    access: 'add / remove plugins',
    tools: [['VS Code', 'vscode'], ['JetBrains', 'jetbrains'], ['Visual Studio', 'visual-studio'], ['Eclipse', 'eclipse'], ['Cursor', 'cursor'], ['Windsurf', 'windsurf'], ['AWS Kiro', 'kiro']],
  },
  { key: 'scm', label: 'SCM', access: 'read / write (repo)', tools: [['GitHub', 'github'], ['GitLab', 'gitlab'], ['Azure DevOps', 'azure-repos'], ['Bitbucket', 'bitbucket']] },
  { key: 'ai', label: 'AI', access: 'install extension / MCP', tools: [['GitHub Copilot', 'copilot'], ['OpenAI', ''], ['Azure AI', ''], ['Anthropic Claude', 'claude-code']] },
  {
    key: 'feedback',
    label: 'Feedback',
    access: 'read / write access',
    tools: [['Jira', 'jira'], ['Slack', 'chat'], ['Teams', 'chat'], ['GitHub Issues', ''], ['Azure Boards', 'azure-boards'], ['ServiceNow', 'servicenow']],
  },
  {
    key: 'cicd',
    label: 'CI/CD',
    access: 'write / edit pipelines',
    tools: [['Maven', ''], ['Jenkins', 'jenkins'], ['Bamboo', 'bamboo'], ['TeamCity', 'teamcity'], ['GitLab CI/CD', 'gitlab-ci'], ['Bitbucket Pipelines', 'bitbucket-pipelines'], ['AWS CodeBuild', 'codebuild'], ['Azure Pipelines', 'azure-pipelines'], ['GitHub Actions', 'github-actions'], ['CircleCI', 'circleci'], ['Sonar', '']],
  },
  { key: 'registry', label: 'Registry', access: 'read (pull images)', tools: [['GitHub Packages', ''], ['JFrog', ''], ['Docker Hub', ''], ['Amazon ECR', ''], ['Quay', ''], ['Azure ACR', '']] },
];

/** The software lifecycle stages across the top of the toolchain slide. */
export const DEVSECOPS = ['Train', 'Design', 'Code', 'Build', 'Test', 'Deploy', 'Go-live'];

/** POV roles for the people on the POV. */
export const POV_ROLES = ['POV admin', 'Evaluator', 'Decision maker', 'Champion', 'Executive sponsor', 'Checkmarx technical lead', 'Checkmarx sponsor'];

/** Objectives of the plan, as the WIP deck shows them, with sensible defaults. */
export const PLAN_DEFAULTS = {
  support: ['Custom-made test plan, mapped to your desired outcomes', 'Personalized onboarding session', 'Check-in calls: your questions answered by an AppSec expert', 'Documented POV progress and outcomes'],
  success: ['Frictionless integration with multiple touch points in the SDLC', 'Automation via policy management and developer support for fixes', 'Leverage AI to safely triage and resolve vulnerabilities quickly'],
};

const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const list = (v, n = 12, len = 200) => (Array.isArray(v) ? v : String(v ?? '').split(/\n|;/)).map((x) => text(x, len)).filter(Boolean).slice(0, n);

/** The toolchain as stored: names per touch point (known or the customer's own), with the access needed. */
export function cleanToolchain(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  for (const c of TOOLCHAIN) {
    const v = t[c.key];
    const names = Array.isArray(v) ? v : Array.isArray(v?.tools) ? v.tools : [];
    out[c.key] = { tools: [...new Set(names.map((x) => text(x, 60)).filter(Boolean))].slice(0, 20), access: text(v?.access, 80) };
  }
  out.languages = text(t.languages, 300);
  return out;
}

/** The plan: scope, support and success objectives, what is out of scope, and the overview letter if written. */
export function cleanPlan(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    scope: list(p.scope),
    support: list(p.support),
    success: list(p.success),
    outOfScope: text(p.outOfScope, 600),
    accountName: text(p.accountName, 120),
    // The environment: what is scanned and tested (the RW report and the environment slides show them).
    repositories: text(p.repositories, 600),
    targets: text(p.targets, 600),
    letter: String(p.letter ?? '').replace(/\r/g, '').slice(0, 6000).trim(),
    quote: text(p.quote, 200),
  };
}

/** Catalogue ids for the tools picked, so integration criteria can follow the toolchain. */
export function catalogIdsOf(toolchain) {
  const ids = new Set();
  for (const c of TOOLCHAIN) for (const [name, id] of c.tools) if (id && toolchain?.[c.key]?.tools?.includes(name)) ids.add(id);
  return [...ids];
}
