/**
 * Presentation templates: what a POV's decks look like and hold, set by managers.
 *
 *   - A design: the team's PowerPoint (masters, layouts, its own slides filled and reused), or Meridian's own.
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
  envFull: 'Environment & toolchain in full (Meridian)',
  devsecopsFull: 'Toolchain: every touch point (Meridian)',
  planFull: 'Plan & timeline: every meeting (Meridian)',
  testsFull: 'Test plan, rows sized to their text (Meridian)',
  evidence: 'Evidence for every criterion',
  impact: 'What the POV changed (Analytics: fix time, triage, scans)',
  analyticsDetail: 'Fix time and ageing charts (Analytics)',
  goals: 'Business goals at a glance (Version Kendra)',
  goalsPlan: 'Business goals and success criteria: numbered, with milestones and tracker references (Version Kendra)',
  notes: 'Meeting notes',
};

const MAIN = ['cover', 'age', 'devsecops', 'components', 'plan', 'env', 'tests', 'closing'];
export const DEFAULT_LAYOUT = {
  wip: { main: MAIN, appendix: ['overview', 'apma', 'devsecopsFull', 'planFull', 'envFull', 'notes'] },
  results: { main: [...MAIN.slice(0, -1), 'impact', 'closing'], appendix: ['challenges', 'glance', 'expansion', 'next', 'apma', 'tenant', 'analyticsDetail', 'devsecopsFull', 'planFull', 'envFull', 'testsFull', 'evidence', 'notes'] },
};

/** Version Kendra: Meridian's own slides, every engine and touch point, and the guide's business goals and criteria. */
export const KENDRA_LAYOUT = {
  wip: { main: ['cover', 'age', 'goals', 'devsecopsFull', 'components', 'planFull', 'envFull', 'goalsPlan', 'closing'], appendix: ['overview', 'apma', 'notes'] },
  results: { main: ['cover', 'age', 'glance', 'impact', 'goals', 'goalsPlan', 'components', 'expansion', 'next', 'closing'], appendix: ['challenges', 'analyticsDetail', 'devsecopsFull', 'planFull', 'envFull', 'apma', 'tenant', 'evidence', 'notes'] },
};

/** Meridian's own design, the Classic results deck, and Version Kendra: always there. */
export const BUILT_IN = [
  { id: 'builtin-meridian', builtIn: true, scope: 'everyone', name: 'Meridian', description: 'Meridian’s own dark design, every slide.', layout: DEFAULT_LAYOUT, texts: {} },
  { id: 'builtin-classic', builtIn: true, classic: true, scope: 'everyone', name: 'Classic', description: 'The original results presentation (the WIP deck in Meridian’s design).', layout: DEFAULT_LAYOUT, texts: {} },
  { id: 'builtin-kendra', builtIn: true, scope: 'everyone', name: 'Version Kendra', description: 'Meridian’s slides with every engine and touch point, and the POV guide’s business goals: each goal with its numbered success criteria, milestones and tracker references.', layout: KENDRA_LAYOUT, texts: {} },
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
    return this.#db.read('deckTemplates', []);
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
  migrate(legacyFile, { by = 'Meridian' } = {}) {
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
    const name = text(body.name, 80);
    if (!name) throw fail(400, 'Give the template a name.');
    return {
      ...prev,
      name,
      description: text(body.description, 300),
      scope: body.scope === 'everyone' ? 'everyone' : 'team',
      layout: cleanLayout(body.layout ?? prev.layout),
      texts: { support: lines(body.texts?.support ?? prev.texts?.support, 4), success: lines(body.texts?.success ?? prev.texts?.success, 4), quote: text(body.texts?.quote ?? prev.texts?.quote, 200) },
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
