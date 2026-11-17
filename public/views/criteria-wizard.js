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
 * @param {'new'|'add'|'template'} o.mode
 * @param {object} [o.opp]       the opportunity (mode add)
 * @param {object} [o.template]  the template to change, or to copy (mode template; copy when `copy`)
 * @returns {Promise<string|null>} the new opportunity's id (mode new), 'ok', or null when cancelled
 */
export async function criteriaWizard({ mode, opp = null, template = null, copy = false }) {
  const [cat, tpls] = await Promise.all([getCatalog(), getTemplates(true)]);
  if (mode === 'new') await reloadPeople();
  const caps = new Map(cat.catalog.map((c) => [c.id, c]));
  const have = new Set((opp?.criteria ?? []).map((c) => c.capabilityId).filter(Boolean));
  const catLabel = Object.fromEntries(cat.categories);
  const engineCats = cat.categories.map(([k]) => k).filter((k) => !INTEGRATION_CATS.includes(k));
  const integrationCats = cat.categories.map(([k]) => k).filter((k) => INTEGRATION_CATS.includes(k));

  // What is chosen: the chosen templates merged (must beats nice), then the SE's own clicks on top.
  const w = {
    step: 0,
    details: { stage: 'pov' },
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
  const fromTemplates = () => {
    const m = new Map();
    for (const t of tpls.templates.filter((x) => w.picked.has(x.id))) for (const i of t.items) if (m.get(i.capabilityId) !== 'must') m.set(i.capabilityId, i.priority);
    return m;
  };
  const prio = (id) => (w.manual.has(id) ? w.manual.get(id) : fromTemplates().get(id) ?? 'off');
  const chosen = () => [...caps.keys()].filter((id) => !have.has(id) && prio(id) !== 'off').map((id) => ({ capabilityId: id, priority: prio(id) }));
  const customFromTemplates = () => tpls.templates.filter((x) => w.picked.has(x.id)).flatMap((t) => t.custom ?? []);

  const steps = [
    ...(mode === 'new' ? [['details', 'Opportunity']] : []),
    ...(mode !== 'template' ? [['templates', 'Start from']] : []),
    ['engines', 'Engines & agents'],
    ['integrations', 'Integrations'],
    ['review', mode === 'template' ? 'Name & share' : 'Review'],
  ];
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
              const p = prio(c.id);
              return `<button type="button" class="wz-chip ${p}" data-cap="${esc(c.id)}" aria-pressed="${p !== 'off'}" title="${esc(c.cxName && c.cxName !== c.name ? `${c.cxName} — ` : '')}Click: must have → nice to have → not in this POV">${esc(c.name)}${c.isNew ? '<i class="wz-new">new</i>' : ''}${p !== 'off' ? `<small>${LABEL[p]}</small>` : ''}</button>`;
            })
            .join('')}</div></section>`;
      })
      .join('');

  const VIEWS = {
    details: () => {
      const d = w.details;
      return `<p class="muted wz-lead">Who it is for and where it lives. Only the customer is needed now.</p>
        <div class="row"><label class="field">Customer<input name="customer" required maxlength="160" value="${esc(d.customer ?? '')}" autofocus></label><label class="field">Opportunity name<input name="name" maxlength="160" value="${esc(d.name ?? '')}" placeholder="e.g. AppSec platform FY27"></label></div>
        <div class="row">${can('opps.reassign') ? `<label class="field">SE (owner)<select name="ownerId">${peopleOptions(d.ownerId ?? state.session.user.id)}</select></label>` : ''}
          <label class="field">Stage<select name="stage">${['discovery', 'technical', 'pov'].map((k) => `<option value="${k}" ${d.stage === k ? 'selected' : ''}>${esc(state.meta.stages[k])}</option>`).join('')}</select></label>
          <label class="field">POV start<input type="date" name="startDate" value="${esc(d.startDate ?? '')}"></label><label class="field">POV end<input type="date" name="endDate" value="${esc(d.endDate ?? '')}"></label></div>
        <div class="row"><label class="field">Salesforce opportunity link<input name="salesforceUrl" type="url" value="${esc(d.salesforceUrl ?? '')}" placeholder="https://…lightning.force.com/…"></label><label class="field">SharePoint site link<input name="sharepointUrl" type="url" value="${esc(d.sharepointUrl ?? '')}" placeholder="https://….sharepoint.com/sites/…"></label></div>`;
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
      const list = chosen();
      const must = list.filter((x) => x.priority === 'must');
      const custom = [...customFromTemplates(), ...w.custom];
      const group = (items) => items.map((x) => `<button type="button" class="wz-chip ${x.priority}" data-cap="${esc(x.capabilityId)}">${esc(caps.get(x.capabilityId)?.name)}<small>${LABEL[x.priority]}</small></button>`).join('');
      return `<div class="wz-sum"><div><b class="ok-t">${must.length}</b><span>must have</span></div><div><b class="warn-t">${list.length - must.length + custom.length}</b><span>nice to have</span></div><div><b>${list.length + custom.length}</b><span>success criteria${have.size ? ` (plus ${have.size} already there)` : ''}</span></div></div>
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
  const templateFields = () => `<fieldset class="item"><legend class="small muted">The template</legend>
    <div class="row"><label class="field">Name<input id="wzTplName" value="${esc(w.tpl.name)}" required placeholder="e.g. Banking — core AppSec"></label>${shareWide ? `<label class="field" style="max-width:200px">Shared with<select id="wzTplScope"><option value="team" ${w.tpl.scope === 'team' ? 'selected' : ''}>My team</option><option value="everyone" ${w.tpl.scope === 'everyone' ? 'selected' : ''}>Everyone</option></select></label>` : ''}</div>
    <label class="field">What it is for<input id="wzTplDesc" value="${esc(w.tpl.description)}" maxlength="300" placeholder="When to use it, in a line"></label></fieldset>`;

  // ——— The dialog ———
  const title = mode === 'new' ? 'New opportunity' : mode === 'add' ? 'Add success criteria' : template && !copy ? `Change “${template.name}”` : 'New success criteria template';
  const html = () => {
    const [key] = steps[w.step];
    const last = w.step === steps.length - 1;
    const count = chosen().length + customFromTemplates().length + w.custom.length;
    return `<form id="wz" class="wz" novalidate>
      <div class="wz-top"><h2>${esc(title)}</h2>
        <ol class="wz-steps">${steps.map(([, l], i) => `<li class="${i < w.step ? 'done' : i === w.step ? 'current' : ''}"><button type="button" data-goto="${i}" ${i > w.step ? 'disabled' : ''}><span>${i < w.step ? '✓' : i + 1}</span>${esc(l)}</button></li>`).join('')}</ol></div>
      <div class="wz-body" id="wzBody">${VIEWS[key]()}</div>
      <p class="form-error" role="alert">${esc(w.error)}</p>
      <div class="dialog-actions wz-foot"><button type="button" class="btn ghost" data-act="cancel">Cancel</button><span class="spacer"></span>
        ${key !== 'details' ? `<span class="small muted wz-count">${count} criteria</span>` : ''}
        ${w.step ? '<button type="button" class="btn" data-act="back">Back</button>' : ''}
        <button class="btn primary" data-act="${last ? 'finish' : 'next'}">${last ? (mode === 'new' ? 'Create opportunity' : mode === 'add' ? `Add ${count} criteria` : 'Save template') : 'Next'}</button></div>
    </form>`;
  };

  const keep = (d) => {
    // Remember what was typed on this step before it is redrawn.
    const f = $('#wz', d);
    if (steps[w.step][0] === 'details') for (const el of f.querySelectorAll('[name]')) w.details[el.name] = el.value;
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
    if (mode === 'new') {
      const body = { ...w.details, criteria: items, custom, templateIds };
      if (w.apiKey.trim()) body.apiKey = w.apiKey.trim();
      id = (await api('/opportunities', { method: 'POST', body })).opportunity.id;
    } else {
      await api(`/opportunities/${id}/criteria/bulk`, { method: 'POST', body: { items, custom, templateIds } });
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
      draw(d);
    });
    for (const b of f.querySelectorAll('[data-goto]'))
      b.addEventListener('click', () => {
        keep(d);
        w.step = Number(b.dataset.goto);
        w.error = '';
        draw(d);
      });
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
          w.manual.clear();
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
      const [key] = steps[w.step];
      w.error = '';
      if (key === 'details' && !String(w.details.customer ?? '').trim()) {
        w.error = 'Give the customer name.';
        return draw(d);
      }
      if (w.step < steps.length - 1) {
        w.step += 1;
        return draw(d);
      }
      if (mode === 'template' && !w.tpl.name.trim()) {
        w.error = 'Give the template a name.';
        return draw(d);
      }
      if (mode !== 'new' && !chosen().length && !w.custom.length && !customFromTemplates().length) {
        w.error = 'Nothing is chosen yet.';
        return draw(d);
      }
      const btn = f.querySelector('[data-act="finish"]');
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
