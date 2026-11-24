/**
 * Opportunities: one record for the whole life of a deal's technical win, from discovery to the POV's outcome.
 *
 *   discovery → technical → pov → completed → won | lost      (on_hold at any point)
 *
 * A POV is an opportunity with a Checkmarx One tenant attached (its API key, sealed). Everything else (stakeholders,
 * discovery, sessions, notes, tasks, success criteria) lives on the same record, so the dashboard, the emails and the
 * report all read one place. Every change is written to the record's history (who, when, what).
 */
import { cleanToolchain, cleanPlan } from './toolchain.js';
import { cleanApma } from './apma.js';
import { randomUUID } from 'node:crypto';
import { fail, text, dateOnly, httpUrl, email as cleanEmail, isoOrNull } from './db.js';
import { deriveConnection } from './cxone/endpoints.js';
import { cleanRates } from './value.js';
import { changesOf } from './salesforce.js';

export const STAGES = {
  first_call: 'First call',
  discovery: 'Discovery',
  technical: 'Technical sessions',
  pov: 'POV running',
  completed: 'POV completed',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On hold',
};
export const CRITERION_STATUS = { not_started: 'Not started', in_progress: 'In progress', met: 'Completed successfully', not_met: 'Not met', na: 'Not applicable' };
export const SESSION_TYPES = { first_call: 'First call', discovery: 'Discovery', pre_pov: 'Pre-POV call', technical: 'Technical session', workshop: 'Workshop', launch: 'POV launch & setup', checkpoint: 'Check-in call', wrapup: 'Wrap-up call', readout: 'Readout' };
const HISTORY = 400;

const strList = (v, n = 40, max = 120) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => text(x, max)).filter(Boolean).slice(0, n);

export class Opportunities {
  #db;
  #users;
  #catalog;

  /** Told of every change to an opportunity (the audit trail): ({ opp, actor, what }) => void. */
  onHistory = null;

  #bank = null;

  constructor(db, { users, catalog, bank = null }) {
    this.#bank = bank;
    this.#db = db;
    this.#users = users;
    this.#catalog = catalog;
  }

  #all() {
    return this.#db.read('opportunities', []);
  }

  #save(list) {
    this.#db.write('opportunities', list);
  }

  /** Every opportunity, raw (the server's own use: polling, scheduling). */
  raw() {
    return this.#all();
  }

  canView(user, opp) {
    return Boolean(user && opp && this.#users.visibleIds(user).has(opp.ownerId));
  }

  canEdit(user, opp, settings) {
    if (!user || !opp) return false;
    if (user.role === 'admin' || opp.ownerId === user.id) return true;
    return this.#users.can(user, 'opps.edit.team', settings) && this.#users.isBelow(user, opp.ownerId);
  }

  visible(user) {
    const ids = this.#users.visibleIds(user);
    return this.#all().filter((o) => ids.has(o.ownerId));
  }

  get(id) {
    return this.#all().find((o) => o.id === id) ?? null;
  }

  /** The tenant connection (with the API key): server side only. */
  connection(id) {
    const opp = this.get(id);
    if (!opp?.tenant) throw fail(404, 'This opportunity has no Checkmarx One tenant.');
    return deriveConnection(this.#db.open(opp.tenant.apiKey), opp.tenant.overrides ?? {});
  }

  create(actor, body, settings) {
    if (!this.#users.can(actor, 'opps.create', settings)) throw fail(403, 'Your role may not create opportunities.');
    const ownerId = body.ownerId && body.ownerId !== actor.id ? body.ownerId : actor.id;
    if (ownerId !== actor.id && !(this.#users.can(actor, 'opps.reassign', settings) && this.#users.isBelow(actor, ownerId))) throw fail(403, 'You can only give an opportunity to someone in your team.');
    const now = new Date().toISOString();
    const opp = {
      id: randomUUID(),
      ownerId,
      name: '',
      customer: '',
      stage: 'discovery',
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
      salesforceUrl: '',
      sharepointUrl: '',
      amount: '',
      startDate: '',
      endDate: '',
      stakeholders: [],
      discovery: {},
      sessions: [],
      notes: [],
      tasks: [],
      criteria: [],
      tenant: null,
      mute: { until: null, projects: [], reason: '' },
      outcome: null,
      history: [],
    };
    applyFields(opp, body);
    if (!opp.customer) throw fail(400, 'Give the customer name.');
    opp.name ||= opp.customer;
    log(opp, actor, `Created the opportunity (${STAGES[opp.stage]})`, this.onHistory);
    for (const id of strList(body.capabilities, 200, 60)) this.#addCriterion(opp, { capabilityId: id }, actor);
    // From the wizard: each capability with its own priority, and criteria in the team's own words.
    for (const it of Array.isArray(body.criteria) ? body.criteria.slice(0, 200) : []) if (it?.capabilityId && this.#catalog.get(it.capabilityId)) this.#addCriterion(opp, { capabilityId: text(it.capabilityId, 60), priority: it.priority === 'nice' ? 'nice' : 'must' }, actor);
    for (const c of Array.isArray(body.custom) ? body.custom.slice(0, 50) : []) if (text(c?.title)) this.#addCriterion(opp, { title: c.title, category: 'custom', priority: c.priority === 'must' ? 'must' : 'nice' }, actor);
    const all = this.#all();
    all.push(opp);
    this.#save(all);
    return opp;
  }

  /** Change an opportunity with `fn(opp)`; checked, stamped and logged. */
  mutate(actor, id, settings, fn) {
    const all = this.#all();
    const opp = all.find((o) => o.id === id);
    if (!opp || !this.canView(actor, opp)) throw fail(404, 'No such opportunity.');
    if (!this.canEdit(actor, opp, settings)) throw fail(403, 'You can view this opportunity but not change it.');
    const result = fn(opp);
    opp.updatedAt = new Date().toISOString();
    opp.updatedBy = actor.id;
    this.#save(all);
    return result ?? opp;
  }

  update(actor, id, body, settings) {
    return this.mutate(actor, id, settings, (opp) => {
      const before = { stage: opp.stage, ownerId: opp.ownerId };
      if (body.ownerId && body.ownerId !== opp.ownerId) {
        if (!(this.#users.can(actor, 'opps.reassign', settings) && this.#users.isBelow(actor, body.ownerId, { self: true }))) throw fail(403, 'You can only give an opportunity to someone in your team.');
        opp.ownerId = body.ownerId;
        log(opp, actor, `Handed over to ${this.#users.get(body.ownerId)?.name ?? 'someone else'}`, this.onHistory);
      }
      const changed = applyFields(opp, body);
      if (opp.stage !== before.stage) {
        log(opp, actor, `Stage: ${STAGES[before.stage]} → ${STAGES[opp.stage]}`, this.onHistory);
        if (opp.stage === 'pov' && !opp.startDate) opp.startDate = new Date().toISOString().slice(0, 10);
        if (['won', 'lost'].includes(opp.stage)) opp.outcome = { result: opp.stage, reason: text(body.outcomeReason, 1000), closedAt: new Date().toISOString() };
      }
      if (changed.includes('povResult')) log(opp, actor, opp.povResult ? `Marked the POV ${opp.povResult}` : 'Cleared the POV result', this.onHistory);
      const rest = changed.filter((k) => k !== 'povResult');
      if (rest.length) log(opp, actor, `Changed ${rest.join(', ')}`, this.onHistory);
    });
  }

  /**
   * Salesforce report rows for opportunities (from a dropped file or the report mailbox), all saved at once.
   * @param {Array<{ id: string, rec: object }>} list
   * @returns {Map<string, string[]>} what changed on each
   */
  setSalesforce(list, meta, byName) {
    const all = this.#all();
    const out = new Map();
    const now = new Date().toISOString();
    for (let { id, rec } of list) {
      const opp = all.find((o) => o.id === id);
      if (!opp) continue;
      const before = opp.salesforce ?? null;
      // A report changes only the columns it has: a narrower report keeps what an earlier one brought in.
      const merged = { ...rec };
      if (before && meta.columns) for (const k of Object.keys(before)) if (!meta.columns.includes(k) && !(k in merged) && !['reportAt', 'importedAt', 'source', 'file'].includes(k)) merged[k] = before[k];
      rec = merged;
      const changes = changesOf(before, rec);
      opp.salesforce = { ...rec, reportAt: meta.at ?? now, importedAt: now, source: meta.source, file: text(meta.name, 200) };
      const what = before ? (changes.length ? `Salesforce: ${changes.join(' · ')}` : '') : `Salesforce report linked${rec.stage ? ` (stage ${rec.stage})` : ''}`;
      if (what) {
        (opp.history ??= []).push({ at: now, by: '', byName, what: text(what, 400) });
        this.onHistory?.({ opp, actor: null, what: text(what, 400) });
        if (opp.history.length > HISTORY) opp.history = opp.history.slice(-HISTORY);
      }
      out.set(id, changes);
    }
    this.#save(all);
    return out;
  }

  /**
   * Criteria the tenant proves (completed scans with the engine, the pipeline, the AI actions…) are marked completed by
   * themselves, unless a person has set their status. Returns what was completed.
   * @param {Array<{ criterionId: string, evidence: string[] }>} found
   */
  autoComplete(id, found) {
    if (!found.length) return [];
    const all = this.#all();
    const opp = all.find((o) => o.id === id);
    if (!opp || ['won', 'lost'].includes(opp.stage)) return [];
    const now = new Date().toISOString();
    const done = [];
    for (const { criterionId, evidence } of found) {
      const c = (opp.criteria ?? []).find((x) => x.id === criterionId);
      if (!c || c.statusSource === 'manual' || !['not_started', 'in_progress'].includes(c.status)) continue;
      Object.assign(c, { status: 'met', statusSource: 'tenant', proofType: 'tenant', confirmedBy: '', confirmedAt: now, autoEvidence: evidence.slice(0, 5) });
      (opp.history ??= []).push({ at: now, by: '', byName: 'Meridian', what: text(`Completed in the tenant: ${c.title} — ${evidence[0] ?? ''}`, 400) });
      this.onHistory?.({ opp, actor: null, what: text(`Completed in the tenant: ${c.title} — ${evidence[0] ?? ''}`, 400) });
      done.push(c.title);
    }
    if (!done.length) return [];
    if (opp.history.length > HISTORY) opp.history = opp.history.slice(-HISTORY);
    opp.updatedAt = now;
    this.#save(all);
    return done;
  }

  remove(actor, id, settings) {
    const opp = this.get(id);
    if (!opp || !this.canView(actor, opp)) throw fail(404, 'No such opportunity.');
    if (!this.canEdit(actor, opp, settings)) throw fail(403, 'You may not remove this opportunity.');
    this.#save(this.#all().filter((o) => o.id !== id));
    return opp;
  }

  // ——— Tenant ———
  /** Another live opportunity already on this tenant, if any. */
  clash(connection, exceptId = null) {
    return this.#all().find((o) => o.id !== exceptId && o.tenant && o.tenant.tenant === connection.tenant && o.tenant.iamUrl === connection.iamUrl && !['won', 'lost'].includes(o.stage)) ?? null;
  }

  setTenant(actor, id, { apiKey, overrides }, settings) {
    const connection = deriveConnection(apiKey, cleanOverrides(overrides));
    const clash = this.clash(connection, id);
    if (clash) throw fail(409, `Tenant "${connection.tenant}" is already on another opportunity${this.canView(actor, clash) ? ` ("${clash.name}")` : ''}.`);
    return this.mutate(actor, id, settings, (opp) => {
      const same = opp.tenant?.tenant === connection.tenant;
      opp.tenant = {
        tenant: connection.tenant,
        region: connection.region,
        regionLabel: connection.regionLabel,
        iamUrl: connection.iamUrl,
        baseUrl: connection.baseUrl,
        keyExpiresAt: connection.expiresAt,
        overrides: cleanOverrides(overrides),
        apiKey: this.#db.seal(connection.apiKey),
        addedAt: new Date().toISOString(),
        addedBy: actor.id,
      };
      if (['discovery', 'technical'].includes(opp.stage)) {
        log(opp, actor, `Stage: ${STAGES[opp.stage]} → ${STAGES.pov}`, this.onHistory);
        opp.stage = 'pov';
        opp.startDate ||= new Date().toISOString().slice(0, 10);
      }
      log(opp, actor, same ? 'Replaced the Checkmarx One API key' : `Connected Checkmarx One tenant "${connection.tenant}" (${connection.regionLabel})`, this.onHistory);
    });
  }

  removeTenant(actor, id, settings) {
    return this.mutate(actor, id, settings, (opp) => {
      if (!opp.tenant) return;
      log(opp, actor, `Disconnected tenant "${opp.tenant.tenant}" (its key deleted)`, this.onHistory);
      opp.tenant = null;
    });
  }

  setMute(actor, id, { until, projects, reason }, settings) {
    return this.mutate(actor, id, settings, (opp) => {
      opp.mute = { until: until === 'forever' ? 'forever' : isoOrNull(until), projects: strList(projects, 500, 80), reason: text(reason, 300) };
      log(opp, actor, opp.mute.until ? `Muted alerts ${opp.mute.until === 'forever' ? 'until unmuted' : `until ${opp.mute.until.slice(0, 16).replace('T', ' ')}`}` : opp.mute.projects.length ? `Muted ${opp.mute.projects.length} project(s)` : 'Unmuted alerts', this.onHistory);
    });
  }

  // ——— Lists on the record: stakeholders, sessions, notes, tasks, criteria ———
  upsertItem(actor, id, kind, item, settings) {
    const clean = CLEANERS[kind];
    if (!clean) throw fail(404, 'Unknown item.');
    return this.mutate(actor, id, settings, (opp) => {
      const list = (opp[kind] ??= []);
      const existing = item.id ? list.find((x) => x.id === item.id) : null;
      if (kind === 'criteria' && !existing) return this.#addCriterion(opp, item, actor);
      const next = clean({ ...(existing ?? {}), ...item }, actor, existing);
      const what = describe(kind, next, existing);
      if (existing) Object.assign(existing, next);
      else list.push({ id: randomUUID(), ...next });
      log(opp, actor, what, this.onHistory);
      return existing ?? list[list.length - 1];
    });
  }

  removeItem(actor, id, kind, itemId, settings) {
    if (!CLEANERS[kind]) throw fail(404, 'Unknown item.');
    return this.mutate(actor, id, settings, (opp) => {
      const item = (opp[kind] ?? []).find((x) => x.id === itemId);
      opp[kind] = (opp[kind] ?? []).filter((x) => x.id !== itemId);
      if (item) log(opp, actor, `Removed ${KIND_LABEL[kind]} "${item.title || item.name || item.text?.slice(0, 40) || ''}"`, this.onHistory);
    });
  }

  /** A criterion as stored, from a request (the demo route uses it). */
  cleanCriterion(c, actor, existing) {
    return CLEANERS.criteria(c, actor, existing);
  }

  #addCriterion(opp, item, actor = null) {
    // A business goal's criterion keeps its own words; the capability that proves it in the tenant is its capRef.
    if (item.goal && item.fromGoal) {
      const ref = item.capabilityId ? this.#catalog.get(item.capabilityId) : null;
      const same = opp.criteria.find((c) => c.goal === item.goal && c.title === item.title);
      if (same) return same;
      const crit = { id: randomUUID(), ...CLEANERS.criteria({ category: ref?.category ?? 'custom', ...item, capabilityId: '', capRef: ref?.id ?? '' }, actor) };
      this.#ensureGoal(opp, crit.goal);
      opp.criteria.push(crit);
      if (actor) log(opp, actor, `Added success criterion "${crit.title}"`, this.onHistory);
      return crit;
    }
    const cap = item.capabilityId ? this.#catalog.get(item.capabilityId) : null;
    if (cap && opp.criteria.some((c) => c.capabilityId === cap.id)) return opp.criteria.find((c) => c.capabilityId === cap.id);
    // From the bank: the business goal it serves, the criterion in the customer's words, the test and the benefit.
    const b = cap && this.#bank ? this.#bank.forCapability(cap.id) : null;
    const filled = b ? { goal: b.goal, statement: b.title, test: b.test, benefit: b.benefit } : {};
    const crit = { id: randomUUID(), ...CLEANERS.criteria({ title: cap?.name, category: cap?.category ?? 'custom', ...filled, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== '' && v !== undefined)), capabilityId: cap?.id ?? '' }, actor) };
    if (crit.goal) this.#ensureGoal(opp, crit.goal);
    if (!crit.title) throw fail(400, 'Give the success criterion a title.');
    opp.criteria.push(crit);
    if (actor) log(opp, actor, `Added success criterion "${crit.title}"`, this.onHistory);
    return crit;
  }

  /** The POV's business goal by its key, added from the bank when it is not there yet. */
  #ensureGoal(opp, key) {
    opp.goals ??= [];
    if (opp.goals.some((g) => g.key === key)) return;
    const g = this.#bank?.goal(key);
    if (g) opp.goals.push({ key: g.key, title: g.title, statement: g.statement ?? '', persona: g.persona ?? '', driver: g.driver ?? '', measures: g.measures ?? [] });
  }
}

const KIND_LABEL = { stakeholders: 'stakeholder', sessions: 'session', notes: 'note', tasks: 'task', criteria: 'success criterion' };
function describe(kind, next, existing) {
  if (kind === 'criteria' && existing && existing.status !== next.status) return `"${next.title}": ${CRITERION_STATUS[existing.status]} → ${CRITERION_STATUS[next.status]}`;
  if (kind === 'tasks' && existing && !existing.done && next.done) return `Completed task "${next.title}"`;
  if (kind === 'notes') return existing ? 'Edited a note' : 'Added a note';
  const name = next.title || next.name || '';
  return `${existing ? 'Updated' : 'Added'} ${KIND_LABEL[kind]}${name ? ` "${name}"` : ''}`;
}

const CLEANERS = {
  stakeholders: (s) => ({ name: text(s.name, 120), email: cleanEmail(s.email), title: text(s.title, 120), side: s.side === 'internal' ? 'internal' : 'customer', povRole: text(s.povRole, 60), notify: s.notify !== false }),
  sessions: (s) => ({ date: dateOnly(s.date) || new Date().toISOString().slice(0, 10), type: SESSION_TYPES[s.type] ? s.type : 'technical', title: text(s.title, 200) || SESSION_TYPES[s.type] || 'Session', attendees: text(s.attendees, 1000), notes: text(s.notes, 20000), followUps: text(s.followUps, 4000), did: text(s.did, 8000), theirNext: text(s.theirNext, 4000), ourNext: text(s.ourNext, 4000), status: ['done', 'planned'].includes(s.status) ? s.status : '' }),
  notes: (n, actor, existing) => ({ text: text(n.text, 20000), at: existing?.at ?? new Date().toISOString(), by: existing?.by ?? actor?.id ?? '', pinned: Boolean(n.pinned) }),
  tasks: (t, actor, existing) => ({ title: text(t.title, 300), due: dateOnly(t.due), done: Boolean(t.done), doneAt: t.done ? existing?.doneAt ?? new Date().toISOString() : null, assignee: text(t.assignee, 80) }),
  criteria: (c, actor, existing) => {
    const status = CRITERION_STATUS[c.status] ? c.status : 'not_started';
    const confirmed = status === 'met' && existing?.status !== 'met';
    return {
      capabilityId: text(c.capabilityId, 60),
      title: text(c.title, 300),
      category: text(c.category, 40) || 'custom',
      priority: c.priority === 'nice' ? 'nice' : 'must',
      status,
      notes: text(c.notes, 4000),
      evidenceLink: httpUrl(c.evidenceLink),
      keywords: strList(c.keywords, 20, 60).map((k) => k.toLowerCase()),
      engines: strList(c.engines, 20, 60).map((k) => k.toLowerCase()),
      origins: strList(c.origins, 20, 60).map((k) => k.toLowerCase()),
      due: dateOnly(c.due),
      // The story for the report: the business goal it serves, the criterion in the customer's words, what is
      // tested, what they gain, the milestone, and the customer's own tracker references.
      goal: text(c.goal, 60),
      statement: text(c.statement, 200),
      test: text(c.test, 1000),
      benefit: text(c.benefit, 600),
      milestone: text(c.milestone, 30),
      refs: text(c.refs, 120),
      capRef: text(c.capRef, 60),
      confirmedBy: confirmed ? actor?.id ?? '' : status === 'met' ? existing?.confirmedBy ?? '' : '',
      confirmedAt: confirmed ? new Date().toISOString() : status === 'met' ? existing?.confirmedAt ?? null : null,
      // How it was completed: in the customer's tenant, or demonstrated by the SE (their own environment).
      proofType: status === 'met' && (c.proofType ?? existing?.proofType) === 'demo' ? 'demo' : 'tenant',
      demo: cleanDemo(c.demo ?? existing?.demo ?? null, existing?.demo ?? null),
      // Who set the status: 'tenant' (completed by itself from the tenant's evidence) or 'manual' (a person). Once a
      // person sets it, Meridian never changes it again.
      // (Only autoComplete() sets 'tenant'; whatever a request sends for these fields is ignored.)
      statusSource: existing && status !== existing.status ? 'manual' : existing?.statusSource ?? '',
      autoEvidence: existing?.statusSource === 'tenant' && status === existing.status ? existing.autoEvidence ?? [] : [],
    };
  },
};

/** A demo session recorded against a criterion: when, where, who saw it, a recording link, an uploaded video. */
function cleanDemo(d, before) {
  if (!d) return null;
  return {
    date: dateOnly(d.date) || new Date().toISOString().slice(0, 10),
    environment: text(d.environment, 200),
    attendees: text(d.attendees, 1000),
    recordingUrl: httpUrl(d.recordingUrl),
    notes: text(d.notes, 4000),
    by: text(d.by ?? before?.by, 80),
    at: d.at ?? before?.at ?? new Date().toISOString(),
    // The video is set only by its upload (src/server.js), never from a request body.
    video: before?.video ?? null,
  };
}

const DISCOVERY_TEXT = ['goals', 'callDate', 'attendees', 'aiAssistants', 'currentTools', 'painPoints', 'languages', 'teamSize', 'timeline', 'decisionProcess', 'competition', 'environment', 'notes', 'nextSteps'];
const DISCOVERY_LISTS = ['scm', 'ci', 'tracking', 'ide', 'requested'];

/** Plain fields from a request body; returns what changed. */
function applyFields(opp, b) {
  const changed = [];
  const set = (k, v) => {
    if (v !== undefined && opp[k] !== v) {
      opp[k] = v;
      changed.push(k);
    }
  };
  if ('name' in b) set('name', text(b.name, 160));
  if ('customer' in b) set('customer', text(b.customer, 160));
  if ('stage' in b && STAGES[b.stage]) set('stage', b.stage);
  if ('salesforceUrl' in b) set('salesforceUrl', httpUrl(b.salesforceUrl));
  if ('sharepointUrl' in b) set('sharepointUrl', httpUrl(b.sharepointUrl));
  if ('amount' in b) set('amount', text(b.amount, 40));
  if ('startDate' in b) set('startDate', dateOnly(b.startDate));
  if ('endDate' in b) set('endDate', dateOnly(b.endDate));
  if ('summary' in b) set('summary', text(b.summary, 4000));
  if (b.valueRates && typeof b.valueRates === 'object') {
    opp.valueRates = cleanRates(b.valueRates);
    changed.push('value rates');
  }
  if ('reportStyle' in b && ['', 'classic', 'team'].includes(b.reportStyle)) set('reportStyle', b.reportStyle);
  if ('povResult' in b && ['', 'successful', 'unsuccessful'].includes(b.povResult)) set('povResult', b.povResult);
  if (Array.isArray(b.goals)) {
    opp.goals = b.goals
      .slice(0, 12)
      .map((g) => ({ key: text(g.key, 60) || text(g.title, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: text(g.title, 160), statement: text(g.statement, 400), persona: text(g.persona, 160), driver: text(g.driver, 40), measures: (Array.isArray(g.measures) ? g.measures : []).slice(0, 12).map((m) => text(m, 400)).filter(Boolean) }))
      .filter((g) => g.title);
    changed.push('business goals');
  }
  if (b.toolchain && typeof b.toolchain === 'object') {
    opp.toolchain = cleanToolchain(b.toolchain);
    changed.push('toolchain');
  }
  if (b.plan && typeof b.plan === 'object') {
    opp.plan = cleanPlan({ ...(opp.plan ?? {}), ...b.plan });
    changed.push('POV plan');
  }
  if ('apma' in b) {
    opp.apma = b.apma ? cleanApma({ ...b.apma, file: b.apma.file ?? opp.apma?.file }) : null;
    changed.push('APMA assessment');
  }
  if (b.discovery && typeof b.discovery === 'object') {
    const d = { ...(opp.discovery ?? {}) };
    for (const k of DISCOVERY_TEXT) if (k in b.discovery) d[k] = text(b.discovery[k], 20000);
    for (const k of DISCOVERY_LISTS) if (k in b.discovery) d[k] = strList(b.discovery[k], 100, 80);
    opp.discovery = d;
    changed.push('discovery');
  }
  return changed.filter((k) => !['stage'].includes(k));
}

function cleanOverrides(o) {
  const out = {};
  for (const k of ['baseUrl', 'iamUrl', 'tenant']) if (o?.[k]) out[k] = text(o[k], 300);
  return out;
}

function log(opp, actor, what, sink = null) {
  (opp.history ??= []).push({ at: new Date().toISOString(), by: actor?.id ?? '', what: text(what, 400) });
  sink?.({ opp, actor, what: text(what, 400) });
  if (opp.history.length > HISTORY) opp.history = opp.history.slice(-HISTORY);
}

/** Every word the opportunity holds (for keyword evidence). */
export function wordsOf(opp) {
  const d = opp.discovery ?? {};
  return [
    ...Object.values(d).flat(),
    ...(opp.sessions ?? []).flatMap((s) => [s.title, s.notes, s.followUps]),
    ...(opp.notes ?? []).map((n) => n.text),
    ...(opp.criteria ?? []).map((c) => c.notes),
  ].join('\n');
}

/** Success-criteria progress: met of those that count (not "not applicable"), must-haves apart. */
export function progressOf(opp) {
  const counted = (opp.criteria ?? []).filter((c) => c.status !== 'na');
  const met = counted.filter((c) => c.status === 'met').length;
  const must = counted.filter((c) => c.priority === 'must');
  const mustMet = must.filter((c) => c.status === 'met').length;
  const demonstrated = counted.filter((c) => c.status === 'met' && c.proofType === 'demo').length;
  return { demonstrated, inTenant: met - demonstrated, total: counted.length, met, percent: counted.length ? Math.round((100 * met) / counted.length) : 0, must: must.length, mustMet, notMet: counted.filter((c) => c.status === 'not_met').length, inProgress: counted.filter((c) => c.status === 'in_progress').length };
}

/** An opportunity as the page gets it: never the API key. */
export function publicOpp(opp) {
  if (!opp) return null;
  const { tenant, ...rest } = opp;
  if (!tenant) return { ...rest, tenant: null };
  const { apiKey, overrides, ...t } = tenant;
  return { ...rest, tenant: t };
}

export function isMuted(opp, now = Date.now()) {
  const u = opp?.mute?.until;
  return u === 'forever' || (u && Date.parse(u) > now);
}
