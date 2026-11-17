/**
 * Success criteria templates: a named set of criteria (capabilities from the catalogue, each must-have or
 * nice-to-have, plus criteria of the team's own words) an SE starts a POV from instead of ticking forty boxes.
 *
 *   - Built in: a few starting points along the Checkmarx One platform. Read-only; an Admin can hide one, anyone
 *     who manages templates can copy it and make it their own.
 *   - Made by Admins and managers (permission templates.manage): for "my team" (the maker and everyone below them)
 *     or for everyone. Edited or removed by their maker, a manager above the maker, or an Admin.
 *   - Several can be combined in the wizard; each use is counted, so managers see which ones their team relies on.
 */
import { randomUUID } from 'node:crypto';
import { fail, text } from './db.js';

const t = (id, name, description, must, nice = [], custom = []) => ({
  id: `builtin-${id}`,
  builtIn: true,
  scope: 'everyone',
  name,
  description,
  items: [...must.map((capabilityId) => ({ capabilityId, priority: 'must' })), ...nice.map((capabilityId) => ({ capabilityId, priority: 'nice' }))],
  custom: custom.map((title) => ({ title, priority: 'nice' })),
});

export const BUILT_IN_TEMPLATES = [
  t('core', 'Core AppSec', 'The essentials most POVs prove: code, open source, secrets and IaC, from a pipeline, with tickets.', ['sast', 'sca', 'secrets', 'iac'], ['containers', 'cli', 'jira', 'analytics'], ['Scan results reviewed with the AppSec team']),
  t('ai', 'AI-powered AppSec', 'Fusion and LLM-based SAST, with the Assist agents triaging and fixing for developers.', ['fusion', 'ai-triage', 'ai-remediation', 'dev-assist'], ['last', 'mcp', 'copilot', 'cursor']),
  t('supply', 'Software supply chain', 'Open source risk end to end: vulnerable and malicious packages, containers, SBOM and repository health.', ['sca', 'malicious', 'containers'], ['sbom', 'scorecard']),
  t('aisc', 'AI supply chain', 'What AI the code uses and how risky it is: AI inventory, LLM, MCP and skills scanning, DAST for AI.', ['aisc', 'llm-scanner', 'mcp-scanner'], ['skills-scanner', 'dast-ai']),
  t('devflow', 'Developer workflow', 'Shift left where developers work: scan on every pull request, results in the IDE and in their tickets.', ['github', 'webhook', 'github-actions', 'vscode', 'jira'], ['jetbrains', 'copilot', 'chat']),
  t('governance', 'Enterprise governance', 'For the CISO: single sign-on, access, policies, posture and reporting across every application.', ['sso', 'rbac', 'policy', 'analytics'], ['risk-orchestration', 'triage-workflow', 'api']),
  t('platform', 'Full platform', 'One platform for everything: the engines, the agents and the posture management, end to end.', ['sast', 'fusion', 'sca', 'secrets', 'iac', 'containers', 'malicious', 'ai-triage', 'ai-remediation', 'dev-assist', 'analytics'], ['apisec', 'aisc', 'dast', 'risk-orchestration', 'policy', 'sbom']),
];

export class Templates {
  #db;
  #users;
  #catalog;

  constructor(db, { users, catalog }) {
    this.#db = db;
    this.#users = users;
    this.#catalog = catalog;
  }

  #own() {
    return this.#db.read('templates', []);
  }

  #meta() {
    return this.#db.read('templatemeta', { hidden: [], uses: {} });
  }

  #visible(viewer, tpl) {
    if (tpl.builtIn || tpl.scope === 'everyone') return true;
    const owner = this.#users.get(tpl.ownerId);
    return Boolean(owner) && (owner.id === viewer.id || this.#users.isBelow(owner, viewer.id) || viewer.role === 'admin' || this.#users.isBelow(viewer, owner.id));
  }

  canEdit(viewer, tpl) {
    if (!tpl || tpl.builtIn) return false;
    return viewer.role === 'admin' || tpl.ownerId === viewer.id || this.#users.isBelow(viewer, tpl.ownerId);
  }

  /** The templates a person can use, with what they hold (only capabilities still in the catalogue). */
  list(viewer, { includeHidden = false } = {}) {
    const meta = this.#meta();
    const known = new Set(this.#catalog.list().map((c) => c.id));
    const shown = (tpl) => ({
      ...tpl,
      items: tpl.items.filter((i) => known.has(i.capabilityId)),
      hidden: meta.hidden.includes(tpl.id),
      uses: meta.uses[tpl.id] ?? 0,
      owner: tpl.ownerId ? this.#users.get(tpl.ownerId)?.name ?? 'Former member' : null,
      canEdit: this.canEdit(viewer, tpl),
    });
    return [...BUILT_IN_TEMPLATES, ...this.#own()]
      .filter((x) => this.#visible(viewer, x) && (includeHidden || !meta.hidden.includes(x.id)))
      .map(shown);
  }

  get(id) {
    return BUILT_IN_TEMPLATES.find((x) => x.id === id) ?? this.#own().find((x) => x.id === id) ?? null;
  }

  #clean(body) {
    const known = new Set(this.#catalog.list().map((c) => c.id));
    const seen = new Set();
    const items = [];
    for (const i of Array.isArray(body.items) ? body.items.slice(0, 200) : []) {
      const id = text(i?.capabilityId, 60);
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      items.push({ capabilityId: id, priority: i.priority === 'nice' ? 'nice' : 'must' });
    }
    const custom = (Array.isArray(body.custom) ? body.custom.slice(0, 30) : []).map((c) => ({ title: text(c?.title, 200), priority: c?.priority === 'must' ? 'must' : 'nice' })).filter((c) => c.title);
    const name = text(body.name, 80);
    if (!name) throw fail(400, 'Give the template a name.');
    if (!items.length && !custom.length) throw fail(400, 'A template needs at least one criterion.');
    return { name, description: text(body.description, 300), scope: body.scope === 'everyone' ? 'everyone' : 'team', items, custom };
  }

  create(actor, body) {
    const tpl = { id: randomUUID(), ...this.#clean(body), ownerId: actor.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const all = this.#own();
    if (all.some((x) => x.name.toLowerCase() === tpl.name.toLowerCase() && this.#visible(actor, x))) throw fail(409, `There is already a template called "${tpl.name}".`);
    this.#db.write('templates', [...all, tpl]);
    return tpl;
  }

  update(actor, id, body) {
    const all = this.#own();
    const tpl = all.find((x) => x.id === id);
    if (!tpl) throw fail(404, BUILT_IN_TEMPLATES.some((x) => x.id === id) ? 'A built-in template cannot be changed: copy it and change the copy.' : 'No such template.');
    if (!this.canEdit(actor, tpl)) throw fail(403, 'Only its maker, a manager above them or an Admin can change this template.');
    Object.assign(tpl, this.#clean({ ...tpl, ...body }), { updatedAt: new Date().toISOString(), updatedBy: actor.id });
    this.#db.write('templates', all);
    return tpl;
  }

  remove(actor, id) {
    if (BUILT_IN_TEMPLATES.some((x) => x.id === id)) {
      if (actor.role !== 'admin') throw fail(403, 'Only an Admin can hide a built-in template.');
      const meta = this.#meta();
      meta.hidden = [...new Set([...meta.hidden, id])];
      this.#db.write('templatemeta', meta);
      return { hidden: true };
    }
    const tpl = this.#own().find((x) => x.id === id);
    if (!tpl) throw fail(404, 'No such template.');
    if (!this.canEdit(actor, tpl)) throw fail(403, 'Only its maker, a manager above them or an Admin can remove this template.');
    this.#db.write('templates', this.#own().filter((x) => x.id !== id));
    return { removed: true };
  }

  unhide(actor, id) {
    if (actor.role !== 'admin') throw fail(403, 'Only an Admin can show a built-in template again.');
    const meta = this.#meta();
    meta.hidden = meta.hidden.filter((x) => x !== id);
    this.#db.write('templatemeta', meta);
  }

  /** Count a use of each template applied (by the wizard). */
  used(ids) {
    const meta = this.#meta();
    for (const id of new Set(ids)) if (this.get(id)) meta.uses[id] = (meta.uses[id] ?? 0) + 1;
    this.#db.write('templatemeta', meta);
  }
}
