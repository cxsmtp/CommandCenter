// The capability catalogue (cached), the grouped capability picker, and the way into the new-opportunity wizard.
import { esc, api } from '../core.js';

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

/** A new opportunity: the step-by-step wizard (criteria-wizard.js). Returns its id, or null when cancelled. */
export async function openNewOpportunity() {
  const { criteriaWizard } = await import('./criteria-wizard.js');
  return criteriaWizard({ mode: 'new' });
}
