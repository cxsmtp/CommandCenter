// Success criteria, a step at a time: start from one or more templates, adjust the engines and the integrations with a
// click each (must have → nice to have → not in this POV), review, done. Used for a new opportunity, for adding
// criteria to one, and for making or changing a template.
import { $, esc, api, state, can, openDialog, closeDialog, peopleOptions, reloadPeople, toast } from '../core.js';
import { getCatalog } from './new-opportunity.js';

const ENGINE_CATS = ['code', 'supply', 'aisc', 'runtime', 'agents', 'aspm'];
const INTEGRATION_CATS = ['scm', 'ci', 'cli', 'ide', 'tracking', 'platform'];
const NEXT = { off: 'must', must: 'nice', nice: 'off' };
const LABEL = { must: 'Must have', nice: 'Nice to have' };

let templatesCache = null;
export async function getTemplates(force = false) {
  if (!templatesCache || force) templatesCache = await api('/templates');
  return templatesCache;
}

/**
 * @param {object} o
 * @param {'new'|'add'|'edit'|'template'} o.mode   edit: every section of an opportunity, any time, in any order
 * @param {object} [o.opp]       the opportunity (modes add and edit)
 * @param {string} [o.section]   edit: the section to open on (details, goals, tools, plan, templates, engines, integrations, review)
 * @param {object} [o.template]  the template to change, or to copy (mode template; copy when `copy`)
 * @returns {Promise<string|null>} the new opportunity's id (mode new), 'ok', or null when cancelled
 */
const TC = () => state.meta?.toolchain ?? [];

export async function criteriaWizard({ mode, opp = null, template = null, copy = false, section = '' }) {
  const edit = mode === 'edit';
  const [cat, tpls, bankInfo, lib] = await Promise.all([getCatalog(), getTemplates(true), api('/bank'), api('/library').catch(() => ({ values: [] }))]);
  const goalsAll = bankInfo.goals;
  const goalEntries = (key) => bankInfo.entries.filter((e) => e.goal === key);
  if (mode === 'new') await reloadPeople();
  const caps = new Map(cat.catalog.map((c) => [c.id, c]));
  // Editing: the criteria already there are chosen like new ones (their priority can change, or they can go); adding
  // only: they show as added and stay as they are.
  const have = new Set(edit ? [] : (opp?.criteria ?? []).map((c) => c.capabilityId).filter(Boolean));
  const existing = new Map();
  if (edit) for (const c of opp.criteria ?? []) if (c.capabilityId) existing.set(c.capabilityId, [...(existing.get(c.capabilityId) ?? []), c]);
  const goalsBefore = new Set((opp?.goals ?? []).map((g) => g.key));
  const catLabel = Object.fromEntries(cat.categories);
  const engineCats = cat.categories.map(([k]) => k).filter((k) => !INTEGRATION_CATS.includes(k));
  const integrationCats = cat.categories.map(([k]) => k).filter((k) => INTEGRATION_CATS.includes(k));

  // What is chosen: the chosen templates merged (must beats nice), then the SE's own clicks on top.
  const w = {
    step: 0,
    details: { stage: 'pov' },
    // The first call: who was there, what they care about, their toolchain, and what was agreed next.
    call: { date: new Date().toISOString().slice(0, 10), people: [{ name: '', email: '', title: '', persona: '' }], personas: new Set(), pains: '', languages: '', teamSize: '', timeline: '', nextTitle: '', nextDue: '' },
    goals: new Set((opp?.goals ?? []).map((g) => g.key)),
    // The toolchain by touch point, and the POV plan behind the WIP deck.
    tools: Object.fromEntries(TC().map((t) => [t.key, new Set()])),
    toolExtra: {},
    access: {},
    plan: null,
    apma: null,
    picked: new Set(),
    manual: new Map(),
    custom: template ? [...(template.custom ?? [])] : [],
    apiKey: '',
    save: { on: false, name: '', description: '', scope: 'team' },
    tpl: { name: template ? (copy ? `${template.name} (copy)` : template.name) : '', description: template?.description ?? '', scope: template?.scope === 'everyone' && !copy ? 'everyone' : 'team' },
    error: '',
    done: null,
  };
  if (template) for (const i of template.items) w.manual.set(i.capabilityId, i.priority);
  // Editing: everything the opportunity holds, as the wizard asks for it.
  const sponsor = edit ? (opp.stakeholders ?? []).find((p) => p.side === 'internal' && ['Account manager', 'Checkmarx sponsor'].includes(p.povRole)) : null;
  if (edit) {
    for (const [id, list] of existing) w.manual.set(id, list.some((c) => c.priority === 'must') ? 'must' : 'nice');
    w.details = { customer: opp.customer ?? '', name: opp.name ?? '', salesforceUrl: opp.salesforceUrl ?? '', sharepointUrl: opp.sharepointUrl ?? '', startDate: opp.startDate ?? '', endDate: opp.endDate ?? '', ownerId: opp.ownerId, more: true };
    const tc = opp.toolchain ?? {};
    for (const t of TC()) {
      const known = new Set(t.tools.map(([n]) => n));
      const names = tc[t.key]?.tools ?? [];
      w.tools[t.key] = new Set(names.filter((n) => known.has(n)));
      w.toolExtra[t.key] = names.filter((n) => !known.has(n)).join(', ');
      if (tc[t.key]?.access) w.access[t.key] = tc[t.key].access;
    }
    w.call.languages = tc.languages ?? '';
    const p = opp.plan ?? {};
    w.plan = { meetings: [], scope: (p.scope ?? []).join('\n'), support: (p.support ?? []).join('\n'), success: (p.success ?? []).join('\n'), outOfScope: p.outOfScope ?? '', accountName: p.accountName ?? '', am: { name: sponsor?.name ?? '', email: sponsor?.email ?? '', title: sponsor?.title || 'Strategic Account Manager' } };
    w.apma = opp.apma ?? null;
  }
  const fromTemplates = () => {
    const m = new Map();
    for (const t of tpls.templates.filter((x) => w.picked.has(x.id))) for (const i of t.items) if (m.get(i.capabilityId) !== 'must') m.set(i.capabilityId, i.priority);
    return m;
  };
  const inGoals = () => new Set([...w.goals].filter((k) => !edit || !goalsBefore.has(k)).flatMap((k) => goalEntries(k).map((e) => e.capabilityId)).filter(Boolean).filter((id) => !existing.has(id)));
  const prio = (id) => (w.manual.has(id) ? w.manual.get(id) : fromTemplates().get(id) ?? 'off');
  const chosen = () => [...caps.keys()].filter((id) => !have.has(id) && !inGoals().has(id) && prio(id) !== 'off').map((id) => ({ capabilityId: id, priority: prio(id) }));
  const customFromTemplates = () => tpls.templates.filter((x) => w.picked.has(x.id)).flatMap((t) => t.custom ?? []);

  const plus = (n, from) => new Date((from ? new Date(`${from}T12:00:00Z`).getTime() : Date.now()) + n * 86_400_000).toISOString().slice(0, 10);
  // The meetings of the POV, proposed from its dates: the launch on the start date (today unless set), two check-ins a
  // week (every 3 and 4 days) until the end date, the wrap-up on it. A pre-POV call only when there is a week before the
  // start; nothing in the past.
  const povDates = () => {
    const start = w.details.startDate || plus(0);
    const end = w.details.endDate && w.details.endDate > start ? w.details.endDate : plus(30, start);
    return { start, end };
  };
  const proposeMeetings = () => {
    const { start, end } = povDates();
    const m = [];
    if (plus(-7, start) >= plus(0)) m.push({ type: 'pre_pov', date: plus(-7, start), title: 'Pre-POV call' });
    m.push({ type: 'launch', date: start, title: 'POV launch & quick setup' });
    for (let d = plus(3, start), i = 0; d < plus(-1, end); d = plus(i % 2 ? 3 : 4, d), i += 1) m.push({ type: 'checkpoint', date: d, title: 'Check-in call' });
    m.push({ type: 'wrapup', date: end, title: 'Wrap-up call' });
    return m;
  };
  // Every meeting after one whose date changed moves by as many days.
  const shiftFrom = (meetings, i, days) => meetings.map((m, j) => (j > i && m.date ? { ...m, date: plus(days, m.date) } : m));
  const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86_400_000);
  // The POV dates changed on the first step: untouched meetings are proposed again; edited ones move with the start.
  const syncMeetings = () => {
    if (edit || !w.plan) return;
    const { start, end } = povDates();
    const was = w.plan.for;
    if (was && was.start === start && was.end === end) return;
    if (!w.plan.touched) w.plan.meetings = proposeMeetings();
    else if (was && was.start !== start) w.plan.meetings = shiftFrom(w.plan.meetings, -1, daysBetween(was.start, start));
    w.plan.for = { start, end };
  };
  const planNow = () =>
    (w.plan ??= {
      for: edit ? null : povDates(),
      touched: false,
      meetings: edit ? [] : proposeMeetings(),
      scope: '',
      support: (state.meta?.planDefaults?.support ?? []).join('\n'),
      success: (state.meta?.planDefaults?.success ?? []).join('\n'),
      outOfScope: '',
      accountName: '',
      am: { name: '', email: '', title: 'Strategic Account Manager' },
    });
  const stepsNow = () => [
    ...(mode === 'new' || edit ? [['details', 'Opportunity']] : []),
    ...(mode === 'new' && ['first_call', 'discovery'].includes(w.details.stage) ? [['call', 'First call']] : []),
    ...(mode !== 'template' ? [['goals', 'Business goals']] : []),
    ...(mode === 'new' || edit ? [['tools', 'Toolchain'], ['plan', edit ? 'POV plan & APMA' : 'POV plan']] : []),
    ...(mode !== 'template' ? [['templates', edit ? 'Add from a template' : 'Start from']] : []),
    ['engines', 'Engines & agents'],
    ['integrations', 'Integrations'],
    ['review', mode === 'template' ? 'Name & share' : 'Review'],
  ];
  if (edit && section) w.step = Math.max(0, stepsNow().findIndex(([k]) => k === section));
  const canSave = can('templates.manage');
  const shareWide = ['admin', 'vp', 'leader'].includes(state.session.user.role);

  // ——— Steps ———
  const chips = (cats) =>
    cats
      .map((k) => {
        const list = cat.catalog.filter((c) => c.category === k);
        if (!list.length) return '';
        const on = list.filter((c) => prio(c.id) !== 'off' || have.has(c.id)).length;
        return `<section class="wz-cat"><div class="wz-cat-head"><b>${esc(catLabel[k] ?? k)}</b><span class="small muted">${on ? `${on} of ${list.length}` : ''}</span><span class="spacer"></span><button type="button" class="linkish small" data-all="${esc(k)}">All</button><button type="button" class="linkish small" data-none="${esc(k)}">None</button></div>
          <div class="wz-chips">${list
            .map((c) => {
              if (have.has(c.id)) return `<span class="wz-chip added" title="Already a success criterion">${esc(c.name)}<small>added</small></span>`;
              if (inGoals().has(c.id)) return `<span class="wz-chip added must" title="Proven by a business goal’s criteria">${esc(c.name)}<small>in a goal</small></span>`;
              const p = prio(c.id);
              return `<button type="button" class="wz-chip ${p}" data-cap="${esc(c.id)}" aria-pressed="${p !== 'off'}" title="${esc(c.cxName && c.cxName !== c.name ? `${c.cxName} — ` : '')}Click: must have → nice to have → not in this POV">${esc(c.name)}${c.isNew ? '<i class="wz-new">new</i>' : ''}${p !== 'off' ? `<small>${LABEL[p]}</small>` : ''}</button>`;
            })
            .join('')}</div></section>`;
      })
      .join('');

  const VIEWS = {
    details: () => {
      const d = w.details;
      const plus = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      return `<label class="field">Customer<input name="customer" required maxlength="160" value="${esc(d.customer ?? '')}" placeholder="e.g. Acme Bank" autofocus></label>
        ${edit ? '' : `<div class="field">Where it stands<div class="status-pick" role="radiogroup">${[['first_call', 'First call'], ['discovery', 'Discovery'], ['technical', 'Technical sessions'], ['pov', 'POV running']].map(([k, l]) => `<button type="button" data-pick-stage="${k}" aria-pressed="${(d.stage ?? 'pov') === k}">${l}</button>`).join('')}</div><input type="hidden" name="stage" value="${esc(d.stage ?? 'pov')}"></div>`}
        <label class="field">Salesforce opportunity link <span class="muted">(optional)</span><input name="salesforceUrl" type="url" value="${esc(d.salesforceUrl ?? '')}" placeholder="Paste it from Salesforce"></label>
        <details class="more-details" ${d.more ? 'open' : ''}><summary class="small">More details <span class="muted">— owner, dates, SharePoint</span></summary>
          <div class="stack" style="gap:10px;margin-top:10px">
            <label class="field">Opportunity name<input name="name" maxlength="160" value="${esc(d.name ?? '')}" placeholder="The customer’s name if left empty"></label>
            ${can('opps.reassign') ? `<label class="field">SE (owner)<select name="ownerId">${peopleOptions(d.ownerId ?? state.session.user.id)}</select></label>` : ''}
            <div class="row"><label class="field">POV start<input type="date" name="startDate" value="${esc(d.startDate ?? plus(0))}"></label><label class="field">POV end<input type="date" name="endDate" value="${esc(d.endDate ?? plus(30))}"></label></div>
            <label class="field">SharePoint site link<input name="sharepointUrl" type="url" value="${esc(d.sharepointUrl ?? '')}" placeholder="https://….sharepoint.com/sites/…"></label>
          </div></details>`;
    },
    call: () => {
      const c = w.call;
      const personas = [...new Set(goalsAll.flatMap((g) => String(g.persona ?? '').split(/,\s*(?=[A-Z])/)).map((x) => x.trim()).filter(Boolean))];
      const list = personas.length ? personas : ['CISO / Security Leader', 'AppSec Leader', 'Head of Engineering / Development', 'AI Engineer / AI Security Owner', 'DevSecOps / Platform Engineering'];
      return `<p class="muted wz-lead">Everything from the call, once: it becomes the stakeholders, the discovery notes, the business goals and a dated next step.</p>
        <label class="field">When was the call<input type="date" name="c_date" value="${esc(c.date)}"></label>
        <div class="field">Who joined from the customer${c.people.map((p, i) => `<div class="call-person">
          <input name="p_name_${i}" value="${esc(p.name)}" placeholder="Name" aria-label="Name">
          <input name="p_email_${i}" type="email" value="${esc(p.email)}" placeholder="Email" aria-label="Email">
          <input name="p_title_${i}" value="${esc(p.title)}" placeholder="Title, e.g. Head of AppSec" aria-label="Title">
          <select name="p_persona_${i}" aria-label="Role in the deal"><option value="">Persona…</option>${list.map((x) => `<option ${p.persona === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select name="p_role_${i}" aria-label="POV role"><option value="">POV role…</option>${(state.meta?.povRoles ?? []).filter((r) => !/Checkmarx/.test(r)).map((x) => `<option ${p.povRole === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        </div>`).join('')}<button type="button" class="btn sm" data-act="add-person" style="align-self:flex-start">Add someone</button></div>
        <label class="field">What they are worried about<textarea name="c_pains" rows="3" placeholder="In their words: tool sprawl, false positives, AI-generated code, audit pressure…">${esc(c.pains)}</textarea></label>
        <div class="row"><label class="field">Languages<input name="c_languages" value="${esc(c.languages)}" placeholder="e.g. Java, C#, Python"></label><label class="field">Teams and applications<input name="c_teamSize" value="${esc(c.teamSize)}" placeholder="e.g. 400 developers, 120 applications"></label></div>
        <label class="field">Timeline and buying process<input name="c_timeline" value="${esc(c.timeline)}" placeholder="e.g. decision by end of Q1, renewal of the current tool in March"></label>
        <div class="row"><label class="field">Agreed next step<input name="c_nextTitle" value="${esc(c.nextTitle)}" placeholder="e.g. Technical deep-dive with the AppSec team"></label><label class="field">By<input type="date" name="c_nextDue" value="${esc(c.nextDue)}"></label></div>`;
    },
    tools: () => `<p class="muted wz-lead">The customer’s toolchain, touch point by touch point. It fills the DevSecOps and environment slides of the WIP deck; tools Checkmarx One integrates with also become success criteria.</p>
      ${TC().map((t) => `<div class="field"><span>${esc(t.label)} <span class="muted small">· access needed</span> <input name="acc_${t.key}" value="${esc(w.access[t.key] ?? t.access)}" aria-label="Access needed for ${esc(t.label)}" style="display:inline-block;width:auto;min-width:170px;padding:2px 8px;font-size:13px"></span>
        <div class="wz-chips">${t.tools.map(([n]) => `<button type="button" class="wz-chip ${w.tools[t.key].has(n) ? 'must' : ''}" data-tc="${t.key}" data-name="${esc(n)}" aria-pressed="${w.tools[t.key].has(n)}">${esc(n)}</button>`).join('')}</div>
        <input name="extra_${t.key}" value="${esc(w.toolExtra[t.key] ?? '')}" placeholder="Others, separated by commas" aria-label="Other ${esc(t.label)} tools" style="margin-top:6px"></div>`).join('')}
      <label class="field">Languages and frameworks<input name="c_languages" value="${esc(w.call.languages)}" placeholder="e.g. Java, C#, Python, React"></label>`,
    plan: () => {
      syncMeetings();
      const p = planNow();
      const types = state.meta?.sessionTypes ?? {};
      return `<p class="muted wz-lead">${edit ? 'The plan the customer sees in the WIP deck.' : 'The plan the customer sees in the WIP deck. Meetings are proposed from the POV dates: change, add or remove them. Each shows as Completed once its date has passed.'}</p>
        ${edit ? '<p class="small muted" style="margin:0">The meetings are on the POV’s Meetings tab.</p>' : `<div class="field">Meetings${p.meetings.map((m, i) => `<div class="call-person" style="grid-template-columns:1.2fr 1fr 1.6fr auto">
          <select name="m_type_${i}" aria-label="Kind">${Object.entries(types).map(([k, l]) => `<option value="${k}" ${m.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <input type="date" name="m_date_${i}" value="${esc(m.date)}" aria-label="Date">
          <input name="m_title_${i}" value="${esc(m.title)}" placeholder="Title" aria-label="Title">
          <button type="button" class="btn sm ghost" data-del-meeting="${i}" aria-label="Remove">✕</button></div>`).join('')}
          <button type="button" class="btn sm" data-act="add-meeting" style="align-self:flex-start">Add a meeting</button></div>`}
        <div class="row"><label class="field">Scope <span class="muted small">one per line; the business goals if empty</span><textarea name="pl_scope" rows="4">${esc(p.scope)}</textarea></label>
          <label class="field">Support<textarea name="pl_support" rows="4">${esc(p.support)}</textarea></label>
          <label class="field">Success<textarea name="pl_success" rows="4">${esc(p.success)}</textarea></label></div>
        <label class="field">Out of scope<input name="pl_out" value="${esc(p.outOfScope)}" placeholder="e.g. Production deployments, mobile apps"></label>
        <div class="field">Account manager <span class="muted small">(on the cover, in the POV team)</span><div class="call-person" style="grid-template-columns:1fr 1fr 1fr">
          <input name="am_name" value="${esc(p.am.name)}" placeholder="Name" aria-label="Account manager name"><input name="am_title" value="${esc(p.am.title)}" placeholder="Title" aria-label="Title"><input name="am_email" type="email" value="${esc(p.am.email)}" placeholder="Email" aria-label="Email"></div></div>
        <label class="field">Account name in the tenant <span class="muted small">(optional)</span><input name="pl_account" value="${esc(p.accountName)}"></label>
        <div class="field">APMA assessment <span class="muted small">(optional: the report’s PDF fills the APMA slide)</span>
          ${w.apma ? `<div class="apma-got"><b>APMA assessment</b> · ${w.apma.dimensions.filter((d) => d.current != null).map((d) => `${esc(d.name)} ${d.current} → ${d.desired}`).join(' · ')} <button type="button" class="btn sm ghost" data-act="apma-clear">Remove</button></div>` : '<input type="file" id="wzApma" accept="application/pdf,.pdf">'}</div>`;
    },
    goals: () => {
      const mine = [...w.call.personas, ...w.call.people.map((p) => p.persona).filter(Boolean)];
      const fits = (g) => mine.some((p) => String(g.persona ?? '').includes(p));
      const ordered = [...goalsAll].sort((a, b) => Number(fits(b)) - Number(fits(a)));
      const talk = (g) => {
        const vs = (lib.values ?? []).filter((v) => (g.traces ?? []).includes(v.id) || (g.traces ?? []).includes(v.id.replace('VM-', 'VMAP-')));
        if (!vs.length) return '';
        return `<details class="talk" data-stop><summary>What to say</summary>${vs.map((v) => `<div class="talk-one"><div class="small muted">${esc(v.persona)}</div>${v.concern ? `<blockquote>${esc(v.concern)}</blockquote>` : ''}<p><b>${esc(v.title)}.</b> ${esc(v.message)}</p>${v.proof?.length ? `<ul>${v.proof.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${v.land ? `<p class="small"><b>How to land it:</b> ${esc(v.land)}</p>` : ''}</div>`).join('')}</details>`;
      };
      return `<p class="muted wz-lead">What the customer wants to achieve. Pick three to five: each brings the success criteria that prove it, with the test and the benefit written for the customer.${mine.length ? ' The goals for the people on the call come first.' : ''}</p>
        <div class="wz-tpls">${ordered.map((g) => {
          const on = w.goals.has(g.key);
          const n = goalEntries(g.key).length;
          return `<div class="wz-tpl goal-card ${on ? 'on' : ''} ${fits(g) ? 'fits' : ''}" data-goal="${esc(g.key)}" role="button" tabindex="0" aria-pressed="${on}">
            <span class="wz-tick" aria-hidden="true">${on ? '✓' : ''}</span>
            <b>${esc(g.title)}</b><span class="small muted">${esc(g.statement ?? '')}</span>
            <span class="wz-tpl-meta"><span>${n} criteria${g.driver ? ` · ${esc(g.driver)}` : ''}</span><span>${esc(g.persona ?? '')}</span></span>
            ${talk(g)}
          </div>`;
        }).join('')}</div>`;
    },
    templates: () => `<p class="muted wz-lead">Pick one or more templates: their criteria are chosen for you, and you adjust them in the next steps. Or start empty.</p>
      <div class="wz-tpls">${tpls.templates
        .map((t) => {
          const must = t.items.filter((i) => i.priority === 'must').length;
          const on = w.picked.has(t.id);
          return `<button type="button" class="wz-tpl ${on ? 'on' : ''}" data-tpl="${esc(t.id)}" aria-pressed="${on}">
            <span class="wz-tick" aria-hidden="true">${on ? '✓' : ''}</span>
            <b>${esc(t.name)}</b><span class="small muted">${esc(t.description || '')}</span>
            <span class="wz-tpl-meta"><span>${must} must · ${t.items.length - must + (t.custom?.length ?? 0)} nice</span><span>${t.builtIn ? 'Built in' : t.scope === 'everyone' ? `Everyone · ${esc(t.owner ?? '')}` : `Team · ${esc(t.owner ?? '')}`}${t.uses ? ` · used ${t.uses}×` : ''}</span></span>
            <span class="wz-tpl-chips">${t.items.slice(0, 8).map((i) => `<i class="${i.priority}">${esc(caps.get(i.capabilityId)?.name ?? i.capabilityId)}</i>`).join('')}${t.items.length > 8 ? `<i>+${t.items.length - 8}</i>` : ''}</span>
          </button>`;
        })
        .join('')}
        <button type="button" class="wz-tpl empty ${w.picked.size ? '' : 'on'}" data-tpl=""><span class="wz-tick" aria-hidden="true">${w.picked.size ? '' : '✓'}</span><b>Start empty</b><span class="small muted">Pick every criterion yourself.</span></button>
      </div>`,
    engines: () => `<p class="muted wz-lead">What the customer wants to see working. Click once for <b class="ok-t">must have</b>, again for <b class="warn-t">nice to have</b>, again to leave it out.</p>${chips(engineCats)}`,
    integrations: () => `<p class="muted wz-lead">Where Checkmarx One meets their tools: code hosts, pipelines, IDEs and AI coding agents, tickets and access.</p>${chips(integrationCats)}`,
    review: () => {
      if (edit) return editReview();
      const list = chosen();
      const must = list.filter((x) => x.priority === 'must');
      const custom = [...customFromTemplates(), ...w.custom];
      const group = (items) => items.map((x) => `<button type="button" class="wz-chip ${x.priority}" data-cap="${esc(x.capabilityId)}">${esc(caps.get(x.capabilityId)?.name)}<small>${LABEL[x.priority]}</small></button>`).join('');
      // The criteria the chosen business goals bring (must have), counted as the POV will hold them.
      const fromGoals = goalCriteria();
      const customMust = custom.filter((c) => c.priority === 'must').length;
      return `<div class="wz-sum"><div><b>${fromGoals}</b><span>from ${[...w.goals].filter((k) => !goalsBefore.has(k)).length} business goals</span></div><div><b class="ok-t">${must.length + customMust}</b><span>more must have</span></div><div><b class="warn-t">${list.length - must.length + custom.length - customMust}</b><span>nice to have</span></div><div><b>${fromGoals + list.length + custom.length}</b><span>success criteria${have.size ? ` (plus ${have.size} already there)` : ''}</span></div></div>
        ${list.length ? `<div class="wz-chips">${group(list)}</div>` : '<p class="muted">No capability chosen yet — go back a step, or add your own below.</p>'}
        <fieldset class="item"><legend class="small muted">In the customer’s own words (optional)</legend>
          ${custom.map((c, i) => `<div class="row center"><span style="flex:1">${esc(c.title)}</span><span class="badge">${LABEL[c.priority] ?? 'Nice to have'}</span>${i >= customFromTemplates().length ? `<button type="button" class="btn sm ghost" data-del-custom="${i - customFromTemplates().length}" aria-label="Remove">✕</button>` : '<span class="small muted">from a template</span>'}</div>`).join('')}
          <div class="row"><input id="wzCustom" placeholder="e.g. Results reviewed with the AppSec team in under 2 weeks" style="flex:1;min-width:200px"><select id="wzCustomPrio"><option value="must">Must have</option><option value="nice" selected>Nice to have</option></select><button type="button" class="btn sm" data-act="add-custom">Add</button></div>
        </fieldset>
        ${mode === 'new' ? `<details class="item" ${w.apiKey ? 'open' : ''}><summary class="small muted" style="cursor:pointer">POV tenant: Checkmarx One API key (optional now)</summary>
          <div class="stack" style="margin-top:10px;gap:8px"><textarea id="wzKey" class="mono" rows="3" placeholder="eyJhbGciOi…" spellcheck="false" autocomplete="off">${esc(w.apiKey)}</textarea>
          <div class="row center"><button type="button" class="btn sm" data-act="check-key">Check key</button><span id="keyResult" class="small"></span></div>
          <p class="small muted" style="margin:0">The tenant, region and hosts come from the key. It is checked with Checkmarx One, then stored encrypted; nobody can read it back.</p></div></details>` : ''}
        ${mode === 'template' ? templateFields() : canSave ? `<fieldset class="item"><label class="check"><input type="checkbox" id="wzSave" ${w.save.on ? 'checked' : ''}> Also save this set as a template for my team</label>${w.save.on ? `<div class="row" style="margin-top:8px"><label class="field">Template name<input id="wzSaveName" value="${esc(w.save.name)}" placeholder="e.g. Banking — core AppSec"></label>${shareWide ? `<label class="field" style="max-width:200px">Shared with<select id="wzSaveScope"><option value="team" ${w.save.scope === 'team' ? 'selected' : ''}>My team</option><option value="everyone" ${w.save.scope === 'everyone' ? 'selected' : ''}>Everyone</option></select></label>` : ''}</div>` : ''}</fieldset>` : ''}`;
    },
  };
  // The criteria the newly chosen goals bring, once each (as the server adds them: by goal and title).
  const goalCriteria = () => new Set([...w.goals].filter((k) => !goalsBefore.has(k)).flatMap((k) => goalEntries(k).map((e) => `${k}|${e.title}`))).size;
  // Editing: what Save will change in the criteria, the rest is saved as it is on each step.
  const criteriaChanges = () => {
    const want = new Map(chosen().map((x) => [x.capabilityId, x.priority]));
    const add = [...want].filter(([id]) => !existing.has(id)).map(([capabilityId, priority]) => ({ capabilityId, priority }));
    const change = [...existing].flatMap(([id, list]) => (want.has(id) ? list.filter((c) => c.priority !== want.get(id)).map((c) => ({ ...c, priority: want.get(id) })) : []));
    const remove = [...existing].filter(([id]) => !want.has(id) && !inGoals().has(id)).flatMap(([, list]) => list);
    return { add, change, remove };
  };
  const editReview = () => {
    const { add, change, remove } = criteriaChanges();
    const newGoals = [...w.goals].filter((k) => !goalsBefore.has(k));
    const goneGoals = [...goalsBefore].filter((k) => !w.goals.has(k));
    const fromGoals = newGoals.reduce((n, k) => n + goalEntries(k).length, 0);
    const name = (c) => esc(c.title || caps.get(c.capabilityId)?.name || c.capabilityId);
    const done = (c) => (c.status === 'met' ? ' <span class="badge">completed</span>' : '');
    return `<p class="muted wz-lead">Save keeps everything on every step: the opportunity, its goals, toolchain, plan and criteria. Go back to any step from the top.</p>
      <div class="wz-sum"><div><b class="ok-t">${add.length + fromGoals + w.custom.length}</b><span>criteria to add</span></div><div><b class="warn-t">${change.length}</b><span>change priority</span></div><div><b class="${remove.length ? 'bad-t' : ''}">${remove.length}</b><span>to remove</span></div></div>
      ${newGoals.length || goneGoals.length ? `<p class="small">${newGoals.length ? `Business goals added: ${newGoals.map((k) => esc(goalsAll.find((g) => g.key === k)?.title ?? k)).join(', ')}.` : ''} ${goneGoals.length ? `Taken out: ${goneGoals.map((k) => esc((opp.goals ?? []).find((g) => g.key === k)?.title ?? k)).join(', ')} (their criteria stay unless removed below).` : ''}</p>` : ''}
      ${remove.length ? `<fieldset class="item"><legend class="small bad-t">These criteria will be removed, with their status and notes</legend><ul class="small" style="margin:0;padding-left:18px">${remove.map((c) => `<li>${name(c)}${done(c)}</li>`).join('')}</ul></fieldset>` : ''}
      ${change.length ? `<p class="small muted">Priority changes: ${change.map((c) => `${name(c)} → ${LABEL[c.priority]}`).join(' · ')}</p>` : ''}
      <fieldset class="item"><legend class="small muted">Add one in the customer’s own words (optional)</legend>
        ${w.custom.map((c, i) => `<div class="row center"><span style="flex:1">${esc(c.title)}</span><span class="badge">${LABEL[c.priority] ?? 'Nice to have'}</span><button type="button" class="btn sm ghost" data-del-custom="${i}" aria-label="Remove">✕</button></div>`).join('')}
        <div class="row"><input id="wzCustom" placeholder="e.g. Results reviewed with the AppSec team in under 2 weeks" style="flex:1;min-width:200px"><select id="wzCustomPrio"><option value="must">Must have</option><option value="nice" selected>Nice to have</option></select><button type="button" class="btn sm" data-act="add-custom">Add</button></div>
      </fieldset>`;
  };
  const templateFields = () => `<fieldset class="item"><legend class="small muted">The template</legend>
    <div class="row"><label class="field">Name<input id="wzTplName" value="${esc(w.tpl.name)}" required placeholder="e.g. Banking — core AppSec"></label>${shareWide ? `<label class="field" style="max-width:200px">Shared with<select id="wzTplScope"><option value="team" ${w.tpl.scope === 'team' ? 'selected' : ''}>My team</option><option value="everyone" ${w.tpl.scope === 'everyone' ? 'selected' : ''}>Everyone</option></select></label>` : ''}</div>
    <label class="field">What it is for<input id="wzTplDesc" value="${esc(w.tpl.description)}" maxlength="300" placeholder="When to use it, in a line"></label></fieldset>`;

  // ——— The dialog ———
  const title = edit ? `Edit ${opp.customer}` : mode === 'new' ? 'New opportunity' : mode === 'add' ? 'Add success criteria' : template && !copy ? `Change “${template.name}”` : 'New success criteria template';
  const html = () => {
    const [key] = stepsNow()[w.step];
    const last = w.step === stepsNow().length - 1;
    const count = (edit ? criteriaChanges().add.length : chosen().length) + customFromTemplates().length + w.custom.length + goalCriteria();
    return `<form id="wz" class="wz" novalidate>
      <div class="wz-top"><h2>${esc(title)}</h2>
        <ol class="wz-steps">${stepsNow().map(([, l], i) => `<li class="${i < w.step ? 'done' : i === w.step ? 'current' : ''}"><button type="button" data-goto="${i}" ${i > w.step && !edit ? 'disabled' : ''}><span>${i < w.step && !edit ? '✓' : i + 1}</span>${esc(l)}</button></li>`).join('')}</ol></div>
      <div class="wz-body" id="wzBody">${VIEWS[key]()}</div>
      <p class="form-error" role="alert">${esc(w.error)}</p>
      <div class="dialog-actions wz-foot"><button type="button" class="btn ghost" data-act="cancel">Cancel</button><span class="spacer"></span>
        ${key !== 'details' ? `<span class="small muted wz-count">${edit ? `${count} to add` : `${count} criteria`}</span>` : ''}
        ${w.step ? '<button type="button" class="btn" data-act="back">Back</button>' : ''}
        ${edit && !last ? '<button type="submit" class="btn" data-act="save-now">Save</button>' : ''}
        <button class="btn primary" data-act="${last ? 'finish' : 'next'}">${last ? (edit ? 'Save' : mode === 'new' ? 'Create opportunity' : mode === 'add' ? `Add ${count} criteria` : 'Save template') : 'Next'}</button></div>
    </form>`;
  };

  const keep = (d) => {
    // Remember what was typed on this step before it is redrawn.
    const f = $('#wz', d);
    if (stepsNow()[w.step][0] === 'details') for (const el of f.querySelectorAll('[name]')) w.details[el.name] = el.value;
    if (stepsNow()[w.step][0] === 'call') {
      const val = (n) => f.querySelector(`[name="${n}"]`)?.value ?? '';
      Object.assign(w.call, { date: val('c_date'), pains: val('c_pains'), languages: val('c_languages'), teamSize: val('c_teamSize'), timeline: val('c_timeline'), nextTitle: val('c_nextTitle'), nextDue: val('c_nextDue') });
      w.call.people = w.call.people.map((_, i) => ({ name: val(`p_name_${i}`), email: val(`p_email_${i}`), title: val(`p_title_${i}`), persona: val(`p_persona_${i}`), povRole: val(`p_role_${i}`) }));
    }
    if (stepsNow()[w.step][0] === 'tools') {
      for (const t of TC()) {
        w.access[t.key] = f.querySelector(`[name="acc_${t.key}"]`)?.value ?? t.access;
        w.toolExtra[t.key] = f.querySelector(`[name="extra_${t.key}"]`)?.value ?? '';
      }
      w.call.languages = f.querySelector('[name="c_languages"]')?.value ?? w.call.languages;
    }
    if (stepsNow()[w.step][0] === 'plan') {
      const p = planNow();
      const val = (n) => f.querySelector(`[name="${n}"]`)?.value ?? '';
      if (!edit) p.meetings = p.meetings.map((_, i) => ({ type: val(`m_type_${i}`), date: val(`m_date_${i}`), title: val(`m_title_${i}`) }));
      Object.assign(p, { scope: val('pl_scope'), support: val('pl_support'), success: val('pl_success'), outOfScope: val('pl_out'), accountName: val('pl_account'), am: { name: val('am_name'), title: val('am_title'), email: val('am_email') } });
    }
    if ($('#wzKey', d)) w.apiKey = $('#wzKey', d).value;
    if ($('#wzSaveName', d)) w.save.name = $('#wzSaveName', d).value;
    if ($('#wzSaveScope', d)) w.save.scope = $('#wzSaveScope', d).value;
    if ($('#wzTplName', d)) w.tpl.name = $('#wzTplName', d).value;
    if ($('#wzTplDesc', d)) w.tpl.description = $('#wzTplDesc', d).value;
    if ($('#wzTplScope', d)) w.tpl.scope = $('#wzTplScope', d).value;
  };

  const finish = async () => {
    const items = chosen();
    const custom = [...customFromTemplates(), ...w.custom];
    const templateIds = [...w.picked];
    if (mode === 'template') {
      const body = { name: w.tpl.name, description: w.tpl.description, scope: w.tpl.scope, items, custom: w.custom };
      await api(template && !copy ? `/templates/${encodeURIComponent(template.id)}` : '/templates', { method: template && !copy ? 'PUT' : 'POST', body });
      return 'ok';
    }
    let id = opp?.id;
    if (edit) {
      const { more, stage, ...details } = w.details;
      const p = planNow();
      const lines = (t) => String(t ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      const toolchain = Object.fromEntries(TC().map((t) => [t.key, { tools: [...w.tools[t.key], ...String(w.toolExtra[t.key] ?? '').split(',').map((x) => x.trim()).filter(Boolean)], access: w.access[t.key] ?? t.access }]));
      toolchain.languages = w.call.languages;
      const goals = (opp.goals ?? []).filter((g) => w.goals.has(g.key));
      const body = { ...details, toolchain, plan: { scope: lines(p.scope), support: lines(p.support), success: lines(p.success), outOfScope: p.outOfScope, accountName: p.accountName }, ...(goals.length !== (opp.goals ?? []).length ? { goals } : {}) };
      if (!w.apmaFile && (w.apma ?? null) !== (opp.apma ?? null)) body.apma = w.apma;
      if (!can('opps.reassign')) delete body.ownerId;
      await api(`/opportunities/${id}`, { method: 'PATCH', body });
      if (w.apmaFile) {
        await api(`/opportunities/${id}`, { method: 'PATCH', body: { apma: w.apma } });
        await fetch(`/api/opportunities/${id}/apma`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(w.apmaFile.name) }, body: w.apmaFile }).catch(() => {});
      }
      // The account manager on the cover (the Checkmarx sponsor).
      const am = p.am;
      if (am.name.trim() && (am.name !== (sponsor?.name ?? '') || am.email !== (sponsor?.email ?? '') || am.title !== (sponsor?.title ?? ''))) {
        await api(`/opportunities/${id}/stakeholders${sponsor ? `/${sponsor.id}` : ''}`, { method: 'POST', body: { ...(sponsor ?? { side: 'internal', povRole: 'Account manager', notify: true }), name: am.name, email: am.email, title: am.title } });
      }
      const { add, change, remove } = criteriaChanges();
      for (const c of change) await api(`/opportunities/${id}/criteria/${c.id}`, { method: 'POST', body: c });
      for (const c of remove) await api(`/opportunities/${id}/criteria/${c.id}`, { method: 'DELETE' });
      const newGoals = [...w.goals].filter((k) => !goalsBefore.has(k));
      if (add.length || custom.length || templateIds.length || newGoals.length) await api(`/opportunities/${id}/criteria/bulk`, { method: 'POST', body: { items: add, custom, templateIds, goalIds: newGoals } });
      return 'ok';
    }
    if (mode === 'new') {
      const { more, ...details } = w.details;
      if ((details.stage ?? 'pov') !== 'pov' && !w.details.more) delete details.startDate, delete details.endDate;
      const c = w.call;
      const withCall = stepsNow().some(([k]) => k === 'call');
      const toolsBy = (k) => cat.catalog.filter((x) => x.category === k && prio(x.id) !== 'off').map((x) => x.id);
      const p = planNow();
      const lines = (t) => String(t ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      const toolchain = Object.fromEntries(TC().map((t) => [t.key, { tools: [...w.tools[t.key], ...String(w.toolExtra[t.key] ?? '').split(',').map((x) => x.trim()).filter(Boolean)], access: w.access[t.key] ?? t.access }]));
      toolchain.languages = c.languages;
      const am = p.am.name.trim() ? [{ name: p.am.name, email: p.am.email, title: p.am.title, side: 'internal', povRole: 'Account manager', notify: true }] : [];
      const people = withCall ? c.people.filter((p) => p.name.trim()) : [];
      const body = {
        stage: 'pov',
        ...details,
        criteria: items,
        custom,
        templateIds,
        goalIds: [...w.goals],
        toolchain,
        plan: { scope: lines(p.scope), support: lines(p.support), success: lines(p.success), outOfScope: p.outOfScope, accountName: p.accountName },
        ...(w.apma ? { apma: w.apma } : {}),
        stakeholders: am,
        sessions: p.meetings.filter((m) => m.date),
        ...(withCall
          ? {
              discovery: { callDate: c.date, attendees: people.map((p) => `${p.name}${p.title ? ` (${p.title})` : ''}`).join(', '), painPoints: c.pains, languages: c.languages, teamSize: c.teamSize, timeline: c.timeline, nextSteps: c.nextTitle, scm: toolsBy('scm'), ci: toolsBy('ci'), ide: toolsBy('ide'), tracking: toolsBy('tracking') },
              stakeholders: [...people.map((x) => ({ name: x.name, email: x.email, title: [x.title, x.persona && x.persona !== x.title ? x.persona : ''].filter(Boolean).join(' · '), povRole: x.povRole, side: 'customer', notify: true })), ...am],
              sessions: [{ type: 'first_call', date: c.date, title: 'First call', attendees: people.map((x) => x.name).join(', '), notes: c.pains, status: 'done' }, ...p.meetings.filter((m) => m.date)],
              tasks: c.nextTitle.trim() ? [{ title: c.nextTitle, due: c.nextDue }] : [],
            }
          : {}),
      };
      if (w.apiKey.trim()) body.apiKey = w.apiKey.trim();
      id = (await api('/opportunities', { method: 'POST', body })).opportunity.id;
      // Keep the APMA report itself with the POV too.
      if (w.apmaFile) await fetch(`/api/opportunities/${id}/apma`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(w.apmaFile.name) }, body: w.apmaFile }).catch(() => {});
    } else {
      await api(`/opportunities/${id}/criteria/bulk`, { method: 'POST', body: { items, custom, templateIds, goalIds: [...w.goals].filter((k) => !(opp?.goals ?? []).some((g) => g.key === k)) } });
    }
    if (w.save.on && w.save.name.trim()) {
      await api('/templates', { method: 'POST', body: { name: w.save.name, scope: w.save.scope, items, custom } })
        .then(() => toast(`Saved as the template “${w.save.name}”`))
        .catch((e) => toast(`The template was not saved: ${e.message}`, { bad: true }));
    }
    return mode === 'new' ? id : 'ok';
  };

  const draw = (d) => {
    d.innerHTML = html();
    wire(d);
    const field = w.badField ? d.querySelector(`[name="${w.badField}"]`) : null;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      const note = Object.assign(document.createElement('p'), { className: 'field-error', role: 'alert', textContent: w.error });
      field.closest('details')?.setAttribute('open', '');
      (field.closest('label') ?? field).after(note);
      d.querySelector('.form-error').textContent = '';
      field.focus();
      field.addEventListener('input', () => {
        note.remove();
        field.removeAttribute('aria-invalid');
        w.error = '';
        w.badField = '';
        w.badField = '';
      }, { once: true });
    }
  };
  const wire = (d) => {
    const f = $('#wz', d);
    const redraw = () => {
      keep(d);
      const scroll = $('#wzBody', d).scrollTop;
      draw(d);
      $('#wzBody', d).scrollTop = scroll;
    };
    f.querySelector('[data-act="cancel"]').addEventListener('click', () => closeDialog());
    f.querySelector('[data-act="back"]')?.addEventListener('click', () => {
      keep(d);
      w.step -= 1;
      w.error = '';
      w.badField = '';
      draw(d);
    });
    for (const b of f.querySelectorAll('[data-goto]'))
      b.addEventListener('click', () => {
        keep(d);
        w.step = Number(b.dataset.goto);
        w.error = '';
        w.badField = '';
        draw(d);
      });
    for (const card of f.querySelectorAll('[data-goal]')) {
      const go = (e) => {
        if (e.target.closest('[data-stop]')) return;
        const k = card.dataset.goal;
        w.goals.has(k) ? w.goals.delete(k) : w.goals.add(k);
        redraw();
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-stop]') && (e.preventDefault(), go(e)));
    }
    for (const b of f.querySelectorAll('[data-tc]'))
      b.addEventListener('click', () => {
        const set = w.tools[b.dataset.tc];
        const on = !set.has(b.dataset.name);
        on ? set.add(b.dataset.name) : set.delete(b.dataset.name);
        // A tool Checkmarx One integrates with becomes a success criterion (and stops being one when unpicked).
        const id = TC().find((t) => t.key === b.dataset.tc)?.tools.find(([n]) => n === b.dataset.name)?.[1];
        if (id && caps.has(id) && !TC().some((t) => t.tools.some(([n, x]) => x === id && n !== b.dataset.name && w.tools[t.key].has(n)))) w.manual.set(id, on ? 'must' : 'off');
        redraw();
      });
    f.querySelector('[data-act="add-meeting"]')?.addEventListener('click', () => {
      keep(d);
      const p = planNow();
      p.touched = true;
      p.meetings.push({ type: 'checkpoint', date: p.meetings.at(-1)?.date ?? plus(0), title: 'Check-in call' });
      draw(d);
    });
    // A meeting's date changed: the ones after it move by the same number of days.
    for (const el of f.querySelectorAll('[name^="m_date_"]'))
      // Updated in place (no redraw: a date field fires while it is being typed in, and redrawing under it loses the
      // typing); only a whole, valid date moves the others.
      el.addEventListener('change', () => {
        const i = Number(el.name.slice(7));
        const p = planNow();
        const before = p.meetings[i]?.date;
        const after = el.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(after) || !before || before === after) return;
        const days = daysBetween(before, after);
        p.meetings = shiftFrom(p.meetings.map((m, j) => (j === i ? { ...m, date: after } : m)), i, days);
        p.touched = true;
        p.meetings.forEach((m, j) => {
          const input = f.querySelector(`[name="m_date_${j}"]`);
          if (j > i && input) input.value = m.date;
        });
      });
    for (const el of f.querySelectorAll('[name^="m_type_"], [name^="m_title_"]')) el.addEventListener('change', () => (planNow().touched = true));
    for (const b of f.querySelectorAll('[data-del-meeting]'))
      b.addEventListener('click', () => {
        keep(d);
        planNow().touched = true;
        planNow().meetings.splice(Number(b.dataset.delMeeting), 1);
        draw(d);
      });
    f.querySelector('#wzApma')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      keep(d);
      const res = await fetch('/api/apma/read', { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/pdf', 'X-Customer': encodeURIComponent(w.details.customer ?? '') }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return toast(j.error ?? 'That file could not be read', { bad: true });
      if (j.otherCustomer) toast('This APMA report looks like it was written for another company. Check it is the right file.', { bad: true });
      w.apma = { ...j.apma, file: { name: file.name, at: new Date().toISOString() } };
      w.apmaFile = file;
      draw(d);
    });
    f.querySelector('[data-act="apma-clear"]')?.addEventListener('click', () => {
      keep(d);
      w.apma = null;
      w.apmaFile = null;
      draw(d);
    });
    f.querySelector('[data-act="add-person"]')?.addEventListener('click', () => {
      keep(d);
      w.call.people.push({ name: '', email: '', title: '', persona: '' });
      draw(d);
    });
    for (const b of f.querySelectorAll('[data-pick-stage]'))
      b.addEventListener('click', () => {
        // The hidden field is what the form keeps: set it first, so the redraw does not put the old stage back.
        f.querySelector('[name="stage"]').value = b.dataset.pickStage;
        w.details.stage = b.dataset.pickStage;
        redraw();
      });
    f.querySelector('.more-details')?.addEventListener('toggle', (e) => (w.details.more = e.target.open));
    for (const b of f.querySelectorAll('[data-cap]'))
      b.addEventListener('click', () => {
        w.manual.set(b.dataset.cap, NEXT[prio(b.dataset.cap)]);
        redraw();
      });
    for (const b of f.querySelectorAll('[data-all]'))
      b.addEventListener('click', () => {
        for (const c of cat.catalog.filter((x) => x.category === b.dataset.all && !have.has(x.id))) if (prio(c.id) === 'off') w.manual.set(c.id, 'must');
        redraw();
      });
    for (const b of f.querySelectorAll('[data-none]'))
      b.addEventListener('click', () => {
        for (const c of cat.catalog.filter((x) => x.category === b.dataset.none)) w.manual.set(c.id, 'off');
        redraw();
      });
    for (const b of f.querySelectorAll('[data-tpl]'))
      b.addEventListener('click', () => {
        if (!b.dataset.tpl) {
          w.picked.clear();
          if (!edit) w.manual.clear();
        } else if (w.picked.has(b.dataset.tpl)) w.picked.delete(b.dataset.tpl);
        else w.picked.add(b.dataset.tpl);
        redraw();
      });
    f.querySelector('[data-act="add-custom"]')?.addEventListener('click', () => {
      const title = $('#wzCustom', d).value.trim();
      if (!title) return;
      w.custom.push({ title, priority: $('#wzCustomPrio', d).value });
      redraw();
      $('#wzCustom', d).focus();
    });
    $('#wzCustom', d)?.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), f.querySelector('[data-act="add-custom"]').click()));
    for (const b of f.querySelectorAll('[data-del-custom]'))
      b.addEventListener('click', () => {
        w.custom.splice(Number(b.dataset.delCustom), 1);
        redraw();
      });
    $('#wzSave', d)?.addEventListener('change', (e) => {
      w.save.on = e.target.checked;
      redraw();
    });
    f.querySelector('[data-act="check-key"]')?.addEventListener('click', async () => {
      const out = $('#keyResult', d);
      out.textContent = 'Checking…';
      out.className = 'small muted';
      try {
        const r = await api('/keys/inspect', { method: 'POST', body: { apiKey: $('#wzKey', d).value } });
        out.className = r.inUse ? 'small bad-t' : 'small ok-t';
        out.textContent = r.inUse ? `Tenant "${r.connection.tenant}" is already on ${r.inUse}.` : `✓ ${r.connection.tenant} · ${r.connection.regionLabel}${r.identity?.user ? ` · as ${r.identity.user}` : ''}`;
      } catch (error) {
        out.className = 'small bad-t';
        out.textContent = error.message;
      }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      keep(d);
      const [key] = stepsNow()[w.step];
      w.error = '';
      w.badField = '';
      // Checked at the field: the message sits under it, and goes when it is corrected.
      const bad = (field, message) => {
        w.error = message;
        w.badField = field;
        draw(d);
      };
      const url = (v) => !v || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(String(v).trim());
      const mail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
      if (key === 'details') {
        const x = w.details;
        if (!String(x.customer ?? '').trim()) return bad('customer', 'Give the customer name.');
        if (!url(x.salesforceUrl)) return bad('salesforceUrl', 'This is not a link: paste the whole address, starting with https://');
        if (!url(x.sharepointUrl)) return bad('sharepointUrl', 'This is not a link: paste the whole address, starting with https://');
        if (x.startDate && x.endDate && x.endDate < x.startDate) return bad('endDate', 'The POV ends before it starts: pick an end date after the start.');
      }
      if (key === 'call') {
        const i = w.call.people.findIndex((p) => !mail(p.email));
        if (i >= 0) return bad(`p_email_${i}`, 'This email address is not complete.');
      }
      if (key === 'plan') {
        const p = planNow();
        if (!mail(p.am.email)) return bad('am_email', 'This email address is not complete.');
      }
      if (key === 'goals' && mode === 'new' && !w.goals.size) return bad('', 'Pick at least one business goal (three to five is best): they bring the success criteria and the story of the decks.');
      const saveNow = e.submitter?.dataset.act === 'save-now';
      if (w.step < stepsNow().length - 1 && !saveNow) {
        w.step += 1;
        return draw(d);
      }
      if (mode === 'template' && !w.tpl.name.trim()) {
        w.error = 'Give the template a name.';
        return draw(d);
      }
      if (!edit && mode !== 'new' && !chosen().length && !w.custom.length && !customFromTemplates().length) {
        w.error = 'Nothing is chosen yet.';
        return draw(d);
      }
      const btn = f.querySelector(saveNow ? '[data-act="save-now"]' : '[data-act="finish"]');
      btn.disabled = true;
      try {
        w.done = await finish();
        closeDialog('ok');
      } catch (error) {
        w.error = error.message;
        draw(d);
      }
    });
  };

  const result = await openDialog('<div></div>', { wide: true, onOpen: (d) => draw(d) });
  return result === 'ok' ? w.done : null;
}
