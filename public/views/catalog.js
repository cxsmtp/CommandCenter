// The capability catalogue: every Checkmarx One touch point, its name in Checkmarx One and how it is recognised.
import { $, esc, api, can, attempt, openDialog, closeDialog, formData } from '../core.js';
import { getCatalog } from './new-opportunity.js';

const RULES = [
  ['engines', 'Engines in completed scans', 'sast, sca, kics, containers, apisec, microengines, ai'],
  ['scanTypes', 'Scan types', 'fusion, last'],
  ['origins', 'Scan origin contains', 'jenkins, github action, cli'],
  ['repoHosts', 'Project repository on', 'github.com, gitlab, dev.azure.com'],
  ['actions', 'AI actions on credits', 'triage, remediation'],
  ['keywords', 'Keywords in notes (hint only)', 'jira, ticket'],
];

export async function renderCatalog(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Capabilities & Checkmarx One mapping</h2>');
  const { catalog, categories } = await getCatalog(true);
  const editable = can('catalog.manage');
  main.innerHTML = `<div class="toolbar"><span class="muted">The success criteria an SE can pick, the name each has in Checkmarx One, and what in the tenant proves it was tested. Edit a mapping when Checkmarx One names something differently.</span><span class="spacer"></span>${editable ? '<button class="btn" data-act="reset">Restore defaults</button><button class="btn primary" data-act="add">＋ Capability</button>' : ''}</div>
  ${categories
    .map(([key, label]) => {
      const list = catalog.filter((c) => c.category === key);
      if (!list.length) return '';
      return `<section class="panel" style="margin-bottom:14px"><div class="head"><h3>${esc(label)}</h3><span class="small muted">${list.length}</span></div><div class="table-wrap"><table><thead><tr><th>Capability</th><th>In Checkmarx One</th><th>Recognised by</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>${list
        .map((c) => `<tr><td><b>${esc(c.name)}</b>${c.description ? `<div class="small muted">${esc(c.description)}</div>` : ''}</td><td>${esc(c.cxName)}</td><td class="small">${RULES.filter(([k]) => c.detect?.[k]?.length).map(([k, l]) => `<div><span class="muted">${esc(l)}:</span> ${esc(c.detect[k].join(', '))}</div>`).join('') || '<span class="muted">Confirmed by hand</span>'}</td>${editable ? `<td><button class="btn sm" data-edit="${esc(c.id)}">Edit</button></td>` : ''}</tr>`)
        .join('')}</tbody></table></div></section>`;
    })
    .join('')}`;
  main.querySelector('[data-act="add"]')?.addEventListener('click', () => edit(null, categories));
  main.querySelector('[data-act="reset"]')?.addEventListener('click', async () => {
    if (!confirm('Put back the built-in catalogue? Your own capabilities and changes are lost (criteria already on opportunities stay).')) return;
    if (await attempt(() => api('/catalog/reset', { method: 'POST' }), 'Restored')) document.dispatchEvent(new CustomEvent('cc:rerender'));
  });
  for (const b of main.querySelectorAll('[data-edit]')) b.addEventListener('click', () => edit(catalog.find((c) => c.id === b.dataset.edit), categories));
}

function edit(c, categories) {
  return openDialog(
    `<form id="capForm"><h2>${c ? 'Edit capability' : 'New capability'}</h2>
      <div class="row"><label class="field">Name<input name="name" value="${esc(c?.name ?? '')}" required></label><label class="field">Category<select name="category">${categories.map(([k, l]) => `<option value="${k}" ${c?.category === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
      <label class="field">Name in Checkmarx One<input name="cxName" value="${esc(c?.cxName ?? '')}"></label>
      <label class="field">Description<textarea name="description" rows="2">${esc(c?.description ?? '')}</textarea></label>
      <h3>Recognised by (comma separated)</h3>
      ${RULES.map(([k, l, ph]) => `<label class="field">${esc(l)}<input name="${k}" value="${esc((c?.detect?.[k] ?? []).join(', '))}" placeholder="${esc(ph)}"></label>`).join('')}
      <p class="form-error" id="capErr" role="alert"></p>
      <div class="dialog-actions">${c ? '<button type="button" class="btn ghost danger" id="delCap">Delete</button><span class="spacer"></span>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`,
    {
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('#delCap')?.addEventListener('click', async () => {
          if (!confirm(`Delete "${c.name}" from the catalogue?`)) return;
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
            await api('/catalog', { method: 'POST', body: { id: c?.id, name: b.name, category: b.category, cxName: b.cxName, description: b.description, detect } });
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
