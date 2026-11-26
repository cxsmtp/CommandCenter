/**
 * Presentation templates: what a POV's decks look like and hold, set by managers.
 *
 *   - A design: the team's PowerPoint (masters, layouts, its own slides filled and reused), or Kendra's own.
 *   - For the WIP deck and the final report: which slides go in the main deck and which in the appendix, in order.
 *   - Its own words: the Support and Success lines of the plan, the closing line of the overview letter.
 *
 * Made and edited by those who manage templates (managers, VPs, Admins), for their team or for everyone. A manager
 * sets the one their team's decks are shared with customers in; an Admin sets the organisation's. A POV uses its own
 * choice, else its SE's nearest manager's, else the organisation's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, text } from './db.js';

/** Every slide a deck can hold, by key. */
export const SLIDES = {
  cover: 'Cover',
  age: 'AppSec for the Age of AI-Generated Risk',
  devsecops: 'Tailored to Your DevSecOps',
  components: 'CheckmarxOne: components activated',
  plan: 'POV Plan & Timeline',
  env: 'POV Environment Details',
  tests: 'Test Plan Overview (one per business goal)',
  closing: 'Closing',
  overview: 'Executive overview letter',
  challenges: 'Your challenges, answered',
  glance: 'Results at a glance',
  expansion: 'From proof to rollout',
  next: 'Next steps',
  apma: 'APMA assessment (when there is one)',
  tenant: 'What Checkmarx One showed',
  envFull: 'Environment & toolchain in full (Kendra)',
  devsecopsFull: 'Toolchain: every touch point (Kendra)',
  planFull: 'Plan & timeline: every meeting (Kendra)',
  testsFull: 'Test plan, rows sized to their text (Kendra)',
  evidence: 'Evidence for every criterion',
  impact: 'What the POV changed (Analytics: fix time, triage, scans)',
  screenshots: 'POV screenshots (a divider, then each screenshot the SE added)',
  tenantEvidence: 'Evidence from Checkmarx One: integrations, triage, supply chain and governance, scan activity (drawn from the tenant)',
  analyticsDetail: 'Fix time and ageing charts (Analytics)',
  goals: 'Business goals at a glance (Version Kendra)',
  goalsPlan: 'Business goals and success criteria: numbered, with milestones and tracker references (Version Kendra)',
  notes: 'Meeting notes',
  closingEnd: 'Closing (again, at the very end)',
};

/**
 * The slides that exist two ways: the team template's own slide filled with the POV's words, or Kendra's own drawing
 * on the template's background. Each presentation template chooses per slide; these are the defaults.
 */
export const SLIDE_VARIANTS = {
  cover: 'Cover',
  overview: 'Executive overview',
  components: 'Checkmarx One components',
  devsecops: 'Tailored to your DevSecOps',
  apma: 'APMA assessment',
  plan: 'POV plan & timeline',
  env: 'POV environment details',
  tests: 'Test plan per business goal',
  notes: 'Meeting notes',
  screenshots: 'POV screenshots',
  appendix: 'Appendix divider',
};
export const DEFAULT_VARIANTS = { cover: 'template', overview: 'kendra', components: 'kendra', devsecops: 'template', apma: 'template', plan: 'kendra', env: 'template', tests: 'kendra', notes: 'kendra', screenshots: 'template', appendix: 'template' };
export function cleanVariants(v) {
  const out = {};
  for (const k of Object.keys(SLIDE_VARIANTS)) out[k] = v?.[k] === 'template' || v?.[k] === 'kendra' ? v[k] : DEFAULT_VARIANTS[k];
  return out;
}
/** Titles a template gives slides of its own (only Kendra-drawn slides take them). */
export function cleanTitles(t) {
  const out = {};
  for (const [k, val] of Object.entries(t ?? {})) if (SLIDES[k] && typeof val === 'string' && val.trim()) out[k] = text(val, 80);
  return out;
}

const MAIN = ['cover', 'age', 'devsecops', 'components', 'plan', 'env', 'tests', 'closing'];
export const DEFAULT_LAYOUT = {
  wip: { main: MAIN, appendix: ['overview', 'apma', 'devsecopsFull', 'planFull', 'envFull', 'notes'] },
  results: { main: [...MAIN.slice(0, -1), 'impact', 'closing'], appendix: ['challenges', 'glance', 'expansion', 'next', 'apma', 'tenant', 'analyticsDetail', 'tenantEvidence', 'devsecopsFull', 'planFull', 'envFull', 'testsFull', 'evidence', 'notes'] },
};

/** The team's own template, in its own order: the guide, then the appendix with the notes and the screenshots. */
export const TEAM_LAYOUT = {
  wip: { main: ['cover', 'overview', 'components', 'devsecops', 'apma', 'plan', 'env', 'tests', 'closing'], appendix: ['notes', 'screenshots', 'closingEnd'] },
  results: { main: ['cover', 'glance', 'components', 'devsecops', 'apma', 'plan', 'env', 'tests', 'impact', 'next', 'closing'], appendix: ['expansion', 'notes', 'tenantEvidence', 'evidence', 'screenshots', 'closingEnd'] },
};

/** Version Kendra: Kendra's own slides, every engine and touch point, and the guide's business goals and criteria. */
export const KENDRA_LAYOUT = {
  wip: { main: ['cover', 'age', 'goals', 'devsecopsFull', 'components', 'planFull', 'envFull', 'goalsPlan', 'closing'], appendix: ['overview', 'apma', 'notes'] },
  results: { main: ['cover', 'age', 'glance', 'impact', 'goals', 'goalsPlan', 'components', 'expansion', 'next', 'closing'], appendix: ['challenges', 'analyticsDetail', 'tenantEvidence', 'devsecopsFull', 'planFull', 'envFull', 'apma', 'tenant', 'evidence', 'notes'] },
};

/** Chakra: the order of the team's POV WIP deck, screenshots before the appendix and the closing slide last. */
export const CHAKRA_LAYOUT = {
  wip: { main: ['cover', 'devsecops', 'components', 'apma', 'plan', 'env', 'tests', 'screenshots'], appendix: ['tenantEvidence', 'notes', 'closing'] },
  results: { main: ['cover', 'devsecops', 'components', 'apma', 'plan', 'env', 'tests', 'impact', 'screenshots'], appendix: ['tenantEvidence', 'evidence', 'notes', 'closing'] },
};

/** Kendra's own design, the Classic results deck, Version Kendra and Chakra: always there. */
export const BUILT_IN = [
  { id: 'builtin-meridian', builtIn: true, scope: 'everyone', name: 'Kendra standard', description: 'Kendra’s own dark design, every slide.', layout: DEFAULT_LAYOUT, texts: {} },
  { id: 'builtin-classic', builtIn: true, classic: true, scope: 'everyone', name: 'Classic', description: 'The original results presentation (the WIP deck in Kendra’s design).', layout: DEFAULT_LAYOUT, texts: {} },
  { id: 'builtin-chakra', builtIn: true, borrowsDesign: true, scope: 'everyone', name: 'Chakra', description: 'The team’s POV WIP order: cover, DevSecOps, components, APMA, plan, environment, the test plan per business goal, the POV screenshots; then the appendix with the meeting notes, and the closing slide last.', layout: CHAKRA_LAYOUT, texts: {} },
  { id: 'builtin-kendra', builtIn: true, borrowsDesign: true, scope: 'everyone', name: 'Version Kendra', description: 'Kendra’s slides with every engine and touch point, and the POV guide’s business goals: each goal with its numbered success criteria, milestones and tracker references.', layout: KENDRA_LAYOUT, texts: {} },
];

const lines = (v, n = 6) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x) => text(x, 200)).filter(Boolean).slice(0, n);

export function cleanLayout(l) {
  const one = (part, fallback) => {
    const seen = new Set();
    const keep = (arr) => (Array.isArray(arr) ? arr : []).filter((k) => SLIDES[k] && !seen.has(k) && seen.add(k));
    const main = keep(part?.main);
    const appendix = keep(part?.appendix);
    return main.length ? { main, appendix } : fallback;
  };
  return { wip: one(l?.wip, DEFAULT_LAYOUT.wip), results: one(l?.results, DEFAULT_LAYOUT.results) };
}

export class DeckTemplates {
  #db;
  #users;
  #dir;

  constructor(db, { users, dataDir }) {
    this.#db = db;
    this.#users = users;
    this.#dir = path.join(dataDir, 'templates');
  }

  #own() {
    // A team design given the template's own order for a day (TEAM_LAYOUT, 1.0.83-1.0.84) goes back to Kendra's
    // order: the template gives the design, Kendra the content. An order someone chose is kept as it is.
    const same = (x) => JSON.stringify(x) === JSON.stringify(TEAM_LAYOUT);
    return this.#db.read('deckTemplates', []).map((t) => (t.design && same(t.layout) ? { ...t, layout: DEFAULT_LAYOUT } : t));
  }

  #save(list) {
    this.#db.write('deckTemplates', list);
  }

  #defaults() {
    return this.#db.read('deckDefaults', { org: null, teams: {} });
  }

  fileOf(id) {
    return path.join(this.#dir, `deck-${String(id).replace(/[^\w-]/g, '')}.pptx`);
  }

  /** The template uploaded before templates existed becomes the first one, the organisation's default. */
  migrate(legacyFile, { by = 'Kendra' } = {}) {
    if (this.#own().length || !fs.existsSync(legacyFile)) return null;
    const tpl = { id: randomUUID(), name: 'Team template', description: 'The team’s PowerPoint design.', scope: 'everyone', ownerId: null, ownerName: by, layout: DEFAULT_LAYOUT, texts: {}, design: { name: 'Team template.pptx', at: new Date().toISOString() }, createdAt: new Date().toISOString() };
    fs.mkdirSync(this.#dir, { recursive: true });
    fs.copyFileSync(legacyFile, this.fileOf(tpl.id));
    this.#save([tpl]);
    const d = this.#defaults();
    if (!d.org) this.#db.write('deckDefaults', { ...d, org: tpl.id });
    return tpl;
  }

  #visible(viewer, tpl) {
    if (tpl.builtIn || tpl.scope === 'everyone') return true;
    const owner = tpl.ownerId ? this.#users.get(tpl.ownerId) : null;
    return Boolean(owner) && (owner.id === viewer.id || viewer.role === 'admin' || this.#users.isBelow(owner, viewer.id) || this.#users.isBelow(viewer, owner.id));
  }

  canEdit(viewer, tpl) {
    return Boolean(tpl && !tpl.builtIn && (viewer.role === 'admin' || tpl.ownerId === viewer.id || (tpl.ownerId && this.#users.isBelow(viewer, tpl.ownerId))));
  }

  /**
   * The PowerPoint a template's decks are drawn in: its own design; for a built-in arrangement (Chakra, Version
   * Kendra), the team's design: the organisation's default template's, else the latest one uploaded. None: Kendra's own.
   */
  designOf(tpl) {
    if (!tpl) return null;
    if (tpl.design) return tpl;
    if (!tpl.borrowsDesign) return null;
    const own = this.#own().filter((t) => t.design && fs.existsSync(this.fileOf(t.id)));
    const org = own.find((t) => t.id === this.#defaults().org);
    return org ?? own.sort((a, b) => String(b.design.at ?? '').localeCompare(String(a.design.at ?? '')))[0] ?? null;
  }

  get(id) {
    return [...BUILT_IN, ...this.#own()].find((t) => t.id === id) ?? null;
  }

  list(viewer) {
    const d = this.#defaults();
    return [...BUILT_IN, ...this.#own()]
      .filter((t) => this.#visible(viewer, t))
      .map((t) => ({ ...t, canEdit: this.canEdit(viewer, t), orgDefault: d.org === t.id, myTeamDefault: d.teams?.[viewer.id] === t.id }));
  }

  #clean(body, prev = {}) {
    const name = text(body.name ?? prev.name, 80);
    if (!name) throw fail(400, 'Give the template a name.');
    return {
      ...prev,
      name,
      layout: cleanLayout(body.layout ?? prev.layout),
      description: text(body.description ?? prev.description, 300),
      scope: (body.scope ?? prev.scope) === 'everyone' ? 'everyone' : 'team',
      texts: { support: lines(body.texts?.support ?? prev.texts?.support, 4), success: lines(body.texts?.success ?? prev.texts?.success, 4), quote: text(body.texts?.quote ?? prev.texts?.quote, 200), titles: cleanTitles(body.texts?.titles ?? prev.texts?.titles) },
      variants: cleanVariants(body.variants ?? prev.variants),
    };
  }

  create(actor, body) {
    if (body.scope === 'everyone' && !['admin', 'vp', 'leader'].includes(actor.role)) throw fail(403, 'Templates for everyone are made by VPs, leaders and Admins.');
    const tpl = { id: randomUUID(), ...this.#clean(body), ownerId: actor.id, ownerName: actor.name, design: null, createdAt: new Date().toISOString() };
    this.#save([...this.#own(), tpl]);
    return tpl;
  }

  update(actor, id, body) {
    const list = this.#own();
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) throw fail(404, 'No such template (built-in ones are copied, not changed).');
    if (!this.canEdit(actor, list[i])) throw fail(403, 'Only its maker, a manager above them or an Admin may change this template.');
    if (body.scope === 'everyone' && list[i].scope !== 'everyone' && !['admin', 'vp', 'leader'].includes(actor.role)) throw fail(403, 'Templates for everyone are made by VPs, leaders and Admins.');
    list[i] = { ...this.#clean(body, list[i]), updatedAt: new Date().toISOString(), updatedBy: actor.name };
    this.#save(list);
    return list[i];
  }

  remove(actor, id) {
    const list = this.#own();
    const tpl = list.find((t) => t.id === id);
    if (!tpl) throw fail(404, 'No such template.');
    if (!this.canEdit(actor, tpl)) throw fail(403, 'Only its maker, a manager above them or an Admin may remove this template.');
    this.#save(list.filter((t) => t.id !== id));
    fs.rmSync(this.fileOf(id), { force: true });
    const d = this.#defaults();
    const teams = Object.fromEntries(Object.entries(d.teams ?? {}).filter(([, v]) => v !== id));
    this.#db.write('deckDefaults', { org: d.org === id ? null : d.org, teams });
    return tpl;
  }

  /** The design's file stored (encrypted by the caller's vault). */
  setDesign(actor, id, info) {
    const list = this.#own();
    const i = list.findIndex((t) => t.id === id);
    if (i < 0 || !this.canEdit(actor, list[i])) throw fail(403, 'Only its maker, a manager above them or an Admin may change this template.');
    list[i] = { ...list[i], design: info };
    this.#save(list);
    return list[i];
  }

  /** Share a template with customers: for the actor's team, or (Admins) for everyone. */
  setDefault(actor, id, { org = false } = {}) {
    if (id && !this.get(id)) throw fail(404, 'No such template.');
    if (id && !this.#visible(actor, this.get(id))) throw fail(403, 'That template is not shared with you.');
    const d = this.#defaults();
    if (org) d.org = id || null;
    else d.teams = { ...(d.teams ?? {}), [actor.id]: id || undefined };
    this.#db.write('deckDefaults', d);
    return d;
  }

  /** The template a POV's decks use: its own, else its SE's nearest manager's (or the SE's own), else the organisation's. */
  resolve(opp, { legacyStyle = null } = {}) {
    if (opp.deckTemplateId && this.get(opp.deckTemplateId)) return this.get(opp.deckTemplateId);
    if (opp.reportStyle === 'classic') return this.get('builtin-classic');
    const d = this.#defaults();
    for (const uid of [opp.ownerId, ...this.#users.chain(opp.ownerId).map((u) => u.id ?? u)]) {
      const id = d.teams?.[uid];
      if (id && this.get(id)) return this.get(id);
    }
    if (d.org && this.get(d.org)) return this.get(d.org);
    return this.get(legacyStyle === 'classic' ? 'builtin-classic' : 'builtin-meridian');
  }
}
