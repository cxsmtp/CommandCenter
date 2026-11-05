// New opportunity: who it is for, where it lives (Salesforce, SharePoint), what the customer wants to test, and,
// when the POV starts now, the tenant's API key.
import { $, esc, api, state, can, openDialog, closeDialog, formData, peopleOptions, reloadPeople } from '../core.js';

let catalogCache = null;
export async function getCatalog(force = false) {
  if (!catalogCache || force) catalogCache = await api('/catalog');
  return catalogCache;
}

/** Grouped checkboxes of every capability; `chosen`: ids already ticked; `disabled`: ids already on the opportunity. */
export function capabilityPicker({ catalog, categories }, { chosen = [], disabled = [] } = {}) {
  return `<div class="caps">${categories
    .map(([key, label]) => {
      const caps = catalog.filter((c) => c.category === key);
      if (!caps.length) return '';
      return `<fieldset><legend>${esc(label)}</legend>${caps
        .map((c) => `<label><input type="checkbox" name="capabilities" data-list="1" value="${esc(c.id)}" ${chosen.includes(c.id) || disabled.includes(c.id) ? 'checked' : ''} ${disabled.includes(c.id) ? 'disabled' : ''}><span>${esc(c.name)}${c.cxName && c.cxName !== c.name ? `<small>${esc(c.cxName)}</small>` : ''}</span></label>`)
        .join('')}</fieldset>`;
    })
    .join('')}</div>`;
}

export async function openNewOpportunity() {
  const cat = await getCatalog();
  await reloadPeople();
  let created = null;
  await openDialog(
    `<form id="newOpp">
      <h2>New opportunity</h2>
      <div class="row">
        <label class="field">Customer<input name="customer" required maxlength="160" autofocus></label>
        <label class="field">Opportunity name<input name="name" maxlength="160" placeholder="e.g. AppSec platform FY27"></label>
      </div>
      <div class="row">
        ${can('opps.reassign') ? `<label class="field">SE (owner)<select name="ownerId">${peopleOptions(state.session.user.id)}</select></label>` : ''}
        <label class="field">Stage<select name="stage">${['discovery', 'technical', 'pov'].map((k) => `<option value="${k}">${esc(state.meta.stages[k])}</option>`).join('')}</select></label>
        <label class="field">POV start<input type="date" name="startDate"></label>
        <label class="field">POV end<input type="date" name="endDate"></label>
      </div>
      <div class="row">
        <label class="field">Salesforce opportunity link<input name="salesforceUrl" type="url" placeholder="https://…lightning.force.com/…"></label>
        <label class="field">SharePoint site link<input name="sharepointUrl" type="url" placeholder="https://….sharepoint.com/sites/…"></label>
      </div>
      <details><summary class="small muted" style="cursor:pointer">What the customer wants to test (success criteria) — you can add more later</summary>
        <div style="margin-top:10px">${capabilityPicker(cat)}</div>
      </details>
      <details><summary class="small muted" style="cursor:pointer">POV tenant: Checkmarx One API key (optional now)</summary>
        <div class="stack" style="margin-top:10px;gap:8px">
          <textarea name="apiKey" class="mono" rows="3" placeholder="eyJhbGciOi…" spellcheck="false" autocomplete="off"></textarea>
          <div class="row center"><button type="button" class="btn sm" id="checkKey">Check key</button><span id="keyResult" class="small"></span></div>
          <p class="small muted" style="margin:0">The tenant, region and hosts come from the key. It is checked with Checkmarx One, then stored encrypted on this server; nobody can read it back.</p>
        </div>
      </details>
      <p class="form-error" id="newErr" role="alert"></p>
      <div class="dialog-actions"><button class="btn ghost" type="button" value="" data-close>Cancel</button><button class="btn primary">Create</button></div>
    </form>`,
    {
      wide: true,
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('#checkKey').addEventListener('click', async () => {
          const out = d.querySelector('#keyResult');
          out.textContent = 'Checking…';
          out.className = 'small muted';
          try {
            const r = await api('/keys/inspect', { method: 'POST', body: { apiKey: d.querySelector('[name=apiKey]').value } });
            out.className = r.inUse ? 'small bad-t' : 'small ok-t';
            out.textContent = r.inUse ? `Tenant "${r.connection.tenant}" is already on ${r.inUse}.` : `✓ ${r.connection.tenant} · ${r.connection.regionLabel}${r.identity?.user ? ` · as ${r.identity.user}` : ''}${r.connection.expiresAt ? ` · expires ${new Date(r.connection.expiresAt).toLocaleDateString()}` : ''}`;
          } catch (error) {
            out.className = 'small bad-t';
            out.textContent = error.message;
          }
        });
        d.querySelector('#newOpp').addEventListener('submit', async (e) => {
          e.preventDefault();
          const body = formData(e.target);
          if (!body.apiKey?.trim()) delete body.apiKey;
          try {
            const r = await api('/opportunities', { method: 'POST', body });
            created = r.opportunity.id;
            closeDialog('ok');
          } catch (error) {
            $('#newErr').textContent = error.message;
          }
        });
      },
    },
  );
  return created;
}
