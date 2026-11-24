// The capability catalogue: every Checkmarx One touch point, its name in Checkmarx One and how it is recognised.
import { $, esc, api, can, state, attempt, openDialog, closeDialog, formData, toast, ask } from '../core.js';
import { getCatalog } from './new-opportunity.js';
import { getTemplates, criteriaWizard } from './criteria-wizard.js';
import { deckPanel, wireDeckPanel } from './deck-templates.js';

const RULES = [
  ['engines', 'Engines in completed scans', 'sast, sca, kics, containers, apisec, microengines, ai'],
  ['scanTypes', 'Scan types', 'fusion, last'],
  ['origins', 'Scan origin contains', 'jenkins, github action, cli'],
  ['repoHosts', 'Project repository on', 'github.com, gitlab, dev.azure.com'],
  ['actions', 'AI actions on credits', 'triage, remediation'],
  ['aspm', 'Checkmarx One shows', 'applications, risk-scores, risks, cloud, dast, policy, violations, feedback:jira, sso, ldap, groups, triaged, custom-states, custom-presets, malicious, mcp, schedules, ai-inventory, analytics'],
  ['keywords', 'Keywords in notes (hint only)', 'jira, ticket'],
];

export async function renderCatalog(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Capabilities & Checkmarx One mapping</h2>');
  const { catalog, categories } = await getCatalog(true);
  const editable = can('catalog.manage');
  const tp = await getTemplates(true);
  const [lib, bankInfo, decks] = await Promise.all([api('/library'), api('/bank'), deckPanel()]);
  const all = can('templates.manage') && state.session.user.role === 'admin' ? await api('/templates?all=1') : tp;
  main.innerHTML = `${libraryPanel(lib, bankInfo)}${decks}${templatesPanel(all)}<div class="page-head" style="margin-top:22px"><div class="grow"><h1>Capabilities</h1><div class="sub">What an SE can pick as a success criterion, and how Meridian recognises it in the tenant.</div></div><div class="actions">${editable ? '<button class="btn" data-act="reset">Restore defaults</button><button class="btn primary" data-act="add">New capability</button>' : ''}</div></div>
  <div class="findbar"><input type="search" id="capQ" placeholder="Find a capability" aria-label="Find a capability"></div>
  ${categories
    .map(([key, label]) => {
      const list = catalog.filter((c) => c.category === key);
      if (!list.length) return '';
      return `<div class="group-title cap-group"><h2>${esc(label)}</h2><span>${list.length}</span></div><div class="crit-list">${list
        .map((c) => `<details class="cap-row" data-name="${esc(`${c.name} ${c.cxName}`.toLowerCase())}"><summary><span class="crit-t"><b>${esc(c.name)} ${c.isNew ? '<span class="badge accent">New</span>' : ''}</b><small class="muted">${esc(c.cxName && c.cxName !== c.name ? c.cxName : RULES.filter(([k]) => c.detect?.[k]?.length).map(([, l]) => l).slice(0, 1).join('') || 'Confirmed by hand')}</small></span><span class="crit-go">›</span></summary>
          <div class="cap-more small">
            ${c.proof ? `<p><b>Show the customer:</b> ${esc(c.proof)}</p>` : ''}
            <p><b>Recognised in the tenant by:</b> ${RULES.filter(([k]) => c.detect?.[k]?.length).map(([k, l]) => `${esc(l)}: ${esc(c.detect[k].join(', '))}`).join(' · ') || 'nothing automatic — confirmed by hand'}</p>
            ${c.tech ? `<p class="muted">${esc(c.tech)}</p>` : ''}
            ${editable ? `<button class="btn sm" data-edit="${esc(c.id)}">Edit</button>` : ''}
          </div></details>`)
        .join('')}</div>`;
    })
    .join('')}`;
  main.querySelector('[data-act="add"]')?.addEventListener('click', () => edit(null, categories));
  main.querySelector('#capQ')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    for (const r of main.querySelectorAll('.cap-row')) r.hidden = q && !r.dataset.name.includes(q);
  });
  wireTemplates(main, all);
  wireLibrary(main);
  wireDeckPanel(main);
  main.querySelector('[data-act="reset"]')?.addEventListener('click', async () => {
    if (!(await ask('Put back the built-in catalogue? Your own capabilities and changes are lost (criteria already on opportunities stay).', { ok: 'Restore defaults', danger: true }))) return;
    if (await attempt(() => api('/catalog/reset', { method: 'POST' }), 'Restored')) document.dispatchEvent(new CustomEvent('cc:rerender'));
  });
  for (const b of main.querySelectorAll('[data-edit]')) b.addEventListener('click', () => edit(catalog.find((c) => c.id === b.dataset.edit), categories));
}

function edit(c, categories) {
  return openDialog(
    `<form id="capForm"><h2>${c ? 'Edit capability' : 'New capability'}</h2>
      <div class="row"><label class="field">Name<input name="name" value="${esc(c?.name ?? '')}" required></label><label class="field">Category<select name="category">${categories.map(([k, l]) => `<option value="${k}" ${c?.category === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
      <label class="field">Name in Checkmarx One<input name="cxName" value="${esc(c?.cxName ?? '')}"></label>
      <label class="field">Or a new group<input name="newGroup" placeholder="e.g. Runtime Security"></label>
      <label class="field">What the SE shows the customer to mark it met<textarea name="proof" rows="2">${esc(c?.proof ?? '')}</textarea></label>
      <label class="field">How Meridian checks it (technical detail)<textarea name="tech" rows="2">${esc(c?.tech ?? '')}</textarea></label>
      <label class="check"><input type="checkbox" name="isNew" ${c?.isNew ? 'checked' : ''}> Mark as new</label>
      <h3>Recognised by (comma separated)</h3>
      ${RULES.map(([k, l, ph]) => `<label class="field">${esc(l)}<input name="${k}" value="${esc((c?.detect?.[k] ?? []).join(', '))}" placeholder="${esc(ph)}"></label>`).join('')}
      <p class="form-error" id="capErr" role="alert"></p>
      <div class="dialog-actions">${c ? '<button type="button" class="btn ghost danger" id="delCap">Delete</button><span class="spacer"></span>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`,
    {
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('#delCap')?.addEventListener('click', async () => {
          if (!(await ask(`Delete "${c.name}" from the catalogue?`, { ok: 'Delete', danger: true }))) return;
          if (await attempt(() => api(`/catalog/${encodeURIComponent(c.id)}`, { method: 'DELETE' }), 'Deleted')) {
            closeDialog();
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          }
        });
        d.querySelector('#capForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = formData(e.target);
          const detect = Object.fromEntries(RULES.map(([k]) => [k, b[k]]));
          try {
            await api('/catalog', { method: 'POST', body: { id: c?.id, name: b.name, category: b.category, newGroup: b.newGroup, cxName: b.cxName, proof: b.proof, tech: b.tech, isNew: b.isNew, detect } });
            closeDialog('ok');
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          } catch (error) {
            $('#capErr').textContent = error.message;
          }
        });
      },
    },
  );
}

// ——— Success criteria templates: what SEs start a POV from ———
function templatesPanel({ templates, canManage }) {
  const card = (t) => {
    const must = t.items.filter((i) => i.priority === 'must').length;
    return `<div class="tpl-card ${t.hidden ? 'hidden-tpl' : ''}"><div class="row center" style="gap:8px"><b>${esc(t.name)}</b>${t.builtIn ? '<span class="badge">Built in</span>' : t.scope === 'everyone' ? '<span class="badge accent">Everyone</span>' : '<span class="badge">Team</span>'}${t.hidden ? '<span class="badge warn">Hidden</span>' : ''}</div>
      <div class="small muted">${esc(t.description || '')}</div>
      <div class="small">${must} must · ${t.items.length - must + (t.custom?.length ?? 0)} nice${t.owner ? ` · by ${esc(t.owner)}` : ''}${t.uses ? ` · used ${t.uses}×` : ''}</div>
      ${canManage ? `<div class="row" style="margin-top:auto">${t.canEdit ? `<button class="btn sm" data-tpl-edit="${esc(t.id)}">Edit</button>` : ''}<button class="btn sm ghost" data-tpl-copy="${esc(t.id)}">Copy</button>${t.canEdit ? `<button class="btn sm ghost danger" data-tpl-del="${esc(t.id)}">Remove</button>` : ''}${t.builtIn && state.session.user.role === 'admin' ? (t.hidden ? `<button class="btn sm ghost" data-tpl-show="${esc(t.id)}">Show</button>` : `<button class="btn sm ghost" data-tpl-del="${esc(t.id)}">Hide</button>`) : ''}</div>` : ''}
    </div>`;
  };
  return `<section class="panel" style="margin-bottom:18px"><div class="head"><h3>Success criteria templates</h3>${canManage ? '<button class="btn primary sm" data-act="tpl-new">New template</button>' : ''}</div>
    <div class="body"><p class="small muted" style="margin-top:0">SEs pick one or more when they add success criteria; every criterion in them is chosen for them. ${canManage ? 'Yours are for your team, or for everyone (VPs and leaders).' : 'Managers make them for their teams.'}</p>
    <div class="tpl-grid">${templates.map(card).join('')}</div></div></section>`;
}

function wireTemplates(main, { templates }) {
  const find = (id) => templates.find((t) => t.id === id);
  const after = (r, msg) => {
    if (!r) return;
    toast(msg);
    document.dispatchEvent(new CustomEvent('cc:rerender'));
  };
  main.querySelector('[data-act="tpl-new"]')?.addEventListener('click', async () => after(await criteriaWizard({ mode: 'template' }), 'Template saved'));
  for (const b of main.querySelectorAll('[data-tpl-edit]')) b.addEventListener('click', async () => after(await criteriaWizard({ mode: 'template', template: find(b.dataset.tplEdit) }), 'Template saved'));
  for (const b of main.querySelectorAll('[data-tpl-copy]')) b.addEventListener('click', async () => after(await criteriaWizard({ mode: 'template', template: find(b.dataset.tplCopy), copy: true }), 'Template saved'));
  for (const b of main.querySelectorAll('[data-tpl-del]'))
    b.addEventListener('click', async () => {
      const t = find(b.dataset.tplDel);
      if (!(await ask(t.builtIn ? `Hide “${t.name}” from everyone? You can show it again here.` : `Remove the template “${t.name}”? Criteria already added from it stay.`, { ok: 'Hide', danger: true }))) return;
      after(await attempt(() => api(`/templates/${encodeURIComponent(t.id)}`, { method: 'DELETE' })), t.builtIn ? 'Hidden' : 'Removed');
    });
  for (const b of main.querySelectorAll('[data-tpl-show]')) b.addEventListener('click', async () => after(await attempt(() => api(`/templates/${encodeURIComponent(b.dataset.tplShow)}/show`, { method: 'POST', body: {} })), 'Shown again'));
}

// ——— The SEAL library and the success criteria bank ———
const KIND_LABEL = { goals: 'Business goals & success criteria', capabilities: 'Capability reference', values: 'Value messaging', valueMap: 'Value map', useCases: 'Use case cards' };

function libraryPanel(lib, bankInfo) {
  const sum = lib.summary;
  const manage = lib.canManage;
  const src = { library: 'from the SEAL library', imported: `imported${bankInfo.by ? ` by ${esc(bankInfo.by)}` : ''}`, edited: `edited${bankInfo.by ? ` by ${esc(bankInfo.by)}` : ''}${bankInfo.editedAt ? ` on ${esc(new Date(bankInfo.editedAt).toLocaleDateString())}` : ''}`, 'built-in': 'built in' }[bankInfo.source];
  return `<section class="panel" style="margin-bottom:18px"><div class="head"><h3>Business goals and the pitch</h3>${manage ? '<button class="btn primary sm" data-act="lib-import">Import SEAL files</button>' : ''}</div>
    <div class="body"><p class="small muted" style="margin-top:0">The business goals SEs pick on the first call, each with the success criteria that prove it (criterion, how it is tested, what it means for the customer), and what to say to each persona. Kept encrypted on this server.</p>
    <p><b>${bankInfo.goals.length}</b> business goals · <b>${bankInfo.entries.length}</b> success criteria, ${src}.${bankInfo.canEdit ? ' <button class="btn sm" data-act="bank-edit">Edit the business goals and success criteria</button>' : ''}</p>
    ${sum ? `<div class="lib-files">${Object.entries(KIND_LABEL).map(([k, l]) => `<div class="${sum.counts[k] ? '' : 'muted'}"><b>${esc(l)}</b><span class="small">${sum.counts[k] ? `${sum.counts[k]} entries · ${esc(sum.files[k]?.name ?? '')}` : 'Not imported'}</span></div>`).join('')}</div>` : '<p class="small muted">No SEAL library yet: SEs see the built-in goals. Import the Markdown references (Business Goals & Success Criteria, Capability Reference, Value Messaging, Value Map, Use Case Cards) to give them the full bank and the talk track.</p>'}
    ${manage ? `<div class="row" style="margin-top:10px;flex-wrap:wrap">${sum ? '<button class="btn sm ghost danger" data-act="lib-remove">Remove the library</button>' : ''}<button class="btn sm ghost" data-act="bank-import">Import a criteria bank (CSV or Excel)</button>${bankInfo.custom ? '<button class="btn sm ghost" data-act="bank-reset">Back to the built-in bank</button>' : ''}</div>` : ''}
    <input type="file" id="libFiles" accept=".md,.markdown,.txt" multiple hidden><input type="file" id="bankFile" accept=".csv,.xlsx,.json" hidden></div></section>`;
}

// ——— Editing the bank (Admins): every business goal and the success criteria that prove it ———
async function bankEditor() {
  let info = await api('/bank');
  const caps = (await getCatalog()).catalog ?? [];
  const capName = (id) => caps.find((c) => c.id === id)?.name ?? '';
  let open = null;
  const goalForm = (g) => `<form id="bgForm" class="stack"><h3 style="margin:0">${g ? 'Edit business goal' : 'New business goal'}</h3>
    <label class="field">Goal<input name="title" required value="${esc(g?.title ?? '')}"></label>
    <label class="field">Statement <span class="small muted">what the customer achieves</span><textarea name="statement" rows="2">${esc(g?.statement ?? '')}</textarea></label>
    <label class="field">Value driver<input name="driver" value="${esc(g?.driver ?? '')}"></label>
    <label class="field">Success measures <span class="small muted">one per line</span><textarea name="measures" rows="3">${esc((g?.measures ?? []).join('\n'))}</textarea></label>
    <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-back>Cancel</button></div></form>`;
  const entryForm = (e, goal) => `<form id="scForm" class="stack"><h3 style="margin:0">${e ? 'Edit success criterion' : 'New success criterion'}</h3>
    <label class="field">Business goal<select name="goal">${info.goals.map((g) => `<option value="${esc(g.key)}" ${(e?.goal ?? goal) === g.key ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label>
    <label class="field">Criterion<input name="title" required value="${esc(e?.title ?? '')}"></label>
    <label class="field">Test item <span class="small muted">what is done in the POV</span><textarea name="test" rows="3">${esc(e?.test ?? '')}</textarea></label>
    <label class="field">Benefit <span class="small muted">what the customer gains</span><textarea name="benefit" rows="2">${esc(e?.benefit ?? '')}</textarea></label>
    <label class="field">Capability that proves it in the tenant<select name="capabilityId"><option value="">— none (confirmed by the SE)</option>${caps.map((c) => `<option value="${esc(c.id)}" ${e?.capabilityId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-back>Cancel</button></div></form>`;
  const list = () => `<div class="dbody"><h2>Business goals and success criteria</h2>
    <p class="small muted">The bank SEs pick from: each criterion added to a POV takes its goal, wording, test item and benefit from here. Changing the bank does not change POVs that already have the criterion. Importing the SEAL files again replaces these edits.</p>
    ${info.goals.map((g, gi) => {
      const es = info.entries.filter((e) => e.goal === g.key);
      return `<div class="item" style="margin:8px 0"><div class="top"><b>${gi + 1}. ${esc(g.title)}</b><span class="small muted">${es.length} criteria</span>
        <span style="flex:1"></span><button class="btn sm ghost" data-g-open="${esc(g.key)}">${open === g.key ? 'Hide' : 'Criteria'}</button><button class="btn sm ghost" data-g-edit="${esc(g.key)}">Edit</button><button class="btn sm ghost danger" data-g-del="${esc(g.key)}">Remove</button></div>
        ${g.statement ? `<div class="small muted">${esc(g.statement)}</div>` : ''}
        ${open === g.key ? `<ol style="margin:8px 0 0;padding-left:20px">${es.map((e) => `<li style="margin:6px 0"><b>${esc(e.title)}</b>${e.capabilityId ? ` <span class="small muted">· ${esc(capName(e.capabilityId))}</span>` : ''}
          <div class="small">${esc(e.test || '')}</div><div class="small muted">${esc(e.benefit || '')}</div>
          <div class="row" style="margin-top:4px"><button class="btn sm ghost" data-e-edit="${esc(e.id)}">Edit</button><button class="btn sm ghost danger" data-e-del="${esc(e.id)}">Remove</button></div></li>`).join('')}</ol>
          <button class="btn sm" data-e-new="${esc(g.key)}" style="margin-top:6px">Add a success criterion</button>` : ''}</div>`;
    }).join('')}
    <div class="dialog-actions"><button class="btn" data-g-new>New business goal</button><span style="flex:1"></span><button class="btn primary" data-close>Done</button></div></div>`;
  const show = (html, wire) => {
    const d = $('#dialog');
    d.innerHTML = html;
    wire(d);
  };
  const back = () => show(list(), wireList);
  const save = async (path, method, body) => {
    const r = await attempt(() => api(path, { method, body }), 'Saved');
    if (r) {
      info = r;
      back();
    }
  };
  const form = (html, path, method) =>
    show(`<div class="dbody">${html}</div>`, (d) => {
      d.querySelector('[data-back]').addEventListener('click', back);
      d.querySelector('form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        save(path, method, formData(ev.target));
      });
    });
  // A second click confirms (no browser pop-ups); POVs keep the criteria they already have.
  const armed = (b, label) => {
    if (b.dataset.armed) return true;
    b.dataset.armed = '1';
    b.textContent = label;
    return false;
  };
  function wireList(d) {
    d.querySelector('[data-close]').addEventListener('click', () => {
      closeDialog();
      document.dispatchEvent(new CustomEvent('cc:rerender'));
    });
    d.querySelector('[data-g-new]').addEventListener('click', () => form(goalForm(null), '/bank/goals', 'POST'));
    for (const b of d.querySelectorAll('[data-g-open]')) b.addEventListener('click', () => ((open = open === b.dataset.gOpen ? null : b.dataset.gOpen), back()));
    for (const b of d.querySelectorAll('[data-g-edit]')) b.addEventListener('click', () => form(goalForm(info.goals.find((g) => g.key === b.dataset.gEdit)), `/bank/goals/${encodeURIComponent(b.dataset.gEdit)}`, 'PUT'));
    for (const b of d.querySelectorAll('[data-g-del]'))
      b.addEventListener('click', async () => {
        if (!armed(b, 'Remove the goal and its criteria?')) return;
        await save(`/bank/goals/${encodeURIComponent(b.dataset.gDel)}`, 'DELETE');
      });
    for (const b of d.querySelectorAll('[data-e-new]')) b.addEventListener('click', () => form(entryForm(null, b.dataset.eNew), '/bank/entries', 'POST'));
    for (const b of d.querySelectorAll('[data-e-edit]')) b.addEventListener('click', () => form(entryForm(info.entries.find((e) => e.id === b.dataset.eEdit)), `/bank/entries/${encodeURIComponent(b.dataset.eEdit)}`, 'PUT'));
    for (const b of d.querySelectorAll('[data-e-del]'))
      b.addEventListener('click', async () => {
        if (!armed(b, 'Click again to remove')) return;
        await save(`/bank/entries/${encodeURIComponent(b.dataset.eDel)}`, 'DELETE');
      });
  }
  openDialog(list(), { wide: true, onOpen: wireList });
}

function wireLibrary(main) {
  const again = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
  main.querySelector('[data-act="bank-edit"]')?.addEventListener('click', () => attempt(bankEditor));
  const libIn = main.querySelector('#libFiles');
  main.querySelector('[data-act="lib-import"]')?.addEventListener('click', () => libIn.click());
  libIn?.addEventListener('change', async () => {
    const files = await Promise.all([...libIn.files].map(async (f) => ({ name: f.name, text: await f.text() })));
    if (!files.length) return;
    const r = await attempt(() => api('/library/import', { method: 'POST', body: { files } }));
    if (r) {
      toast(`Imported ${r.taken.map((t) => `${t.entries} ${KIND_LABEL[t.kind]?.toLowerCase() ?? t.kind}`).join(', ')}`);
      again();
    }
  });
  main.querySelector('[data-act="lib-remove"]')?.addEventListener('click', async () => {
    if (!(await ask('Remove the SEAL library from Meridian? Criteria already on POVs keep their wording.', { ok: 'Remove', danger: true }))) return;
    if (await attempt(() => api('/library', { method: 'DELETE' }), 'Removed')) again();
  });
  const bankIn = main.querySelector('#bankFile');
  main.querySelector('[data-act="bank-import"]')?.addEventListener('click', () => bankIn.click());
  bankIn?.addEventListener('change', async () => {
    const file = bankIn.files[0];
    if (!file) return;
    const res = await fetch('/api/bank/import', { method: 'POST', headers: { 'X-Requested-With': 'Meridian', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? 'That file could not be read', { bad: true });
    toast(`Imported ${j.taken} criteria in ${j.goals} business goals`);
    again();
  });
  main.querySelector('[data-act="bank-reset"]')?.addEventListener('click', async () => {
    if (!(await ask('Go back to the built-in criteria bank? Criteria already on POVs stay as they are.', { ok: 'Go back' }))) return;
    if (await attempt(() => api('/bank/reset', { method: 'POST' }), 'Back to the built-in bank')) again();
  });
}
