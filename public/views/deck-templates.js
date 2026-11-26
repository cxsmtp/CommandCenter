// Customer presentations: the templates a POV's decks are made in (design, slides, words). Managers make and edit them
// slide by slide, and set the one their team's decks are shared with customers in; Admins set the organisation's.
import { esc, api, toast, attempt, openDialog, closeDialog, ask, state } from '../core.js';

export async function deckPanel() {
  let d;
  try {
    d = await api('/deck-templates');
  } catch {
    return '';
  }
  const card = (t) => {
    const shared = [t.orgDefault ? '<span class="badge accent">Everyone’s customer decks</span>' : '', t.myTeamDefault ? '<span class="badge ok">My team’s customer decks</span>' : ''].join('');
    return `<div class="tpl-card"><div class="row center" style="gap:8px;flex-wrap:wrap"><b>${esc(t.name)}</b>${t.builtIn ? '<span class="badge">Built in</span>' : t.scope === 'everyone' ? '<span class="badge accent">Everyone</span>' : '<span class="badge">Team</span>'}${shared}</div>
      <div class="small muted">${esc(t.description || '')}</div>
      <div class="small">${t.classic ? 'The original results presentation' : t.design ? `Design: ${esc(t.design.name)}` : 'Kendra’s own design'} · results ${(t.layout?.results?.main ?? []).length} slides + ${(t.layout?.results?.appendix ?? []).length} in the appendix${t.ownerName ? ` · by ${esc(t.ownerName)}` : ''}</div>
      ${d.canManage ? `<div class="row" style="margin-top:auto;flex-wrap:wrap"><button class="btn sm" data-deck-edit="${esc(t.id)}">${t.canEdit ? 'Open in the designer' : 'Preview'}</button><button class="btn sm ghost" data-deck-copy="${esc(t.id)}">Copy</button>${t.myTeamDefault ? '' : `<button class="btn sm ghost" data-deck-team="${esc(t.id)}">Use for my team’s customer decks</button>`}${d.canSetOrg && !t.orgDefault ? `<button class="btn sm ghost" data-deck-org="${esc(t.id)}">Use for everyone</button>` : ''}${t.canEdit ? `<button class="btn sm ghost danger" data-deck-del="${esc(t.id)}">Remove</button>` : ''}</div>` : ''}
    </div>`;
  };
  return `<section class="panel" style="margin-bottom:18px" id="deckPanel"><div class="head"><h3>Customer presentations</h3>${d.canManage ? '<button class="btn primary sm" data-act="deck-new">New presentation template</button>' : ''}</div>
    <div class="body"><p class="small muted" style="margin-top:0">What the WIP deck and the final report shared with customers look like and hold: the PowerPoint design, which slides go in the main deck and which in the appendix, and the template’s own words. ${d.canManage ? 'A POV uses its own choice, else its SE’s manager’s, else the organisation’s.' : 'Your managers set them.'}</p>
    <div class="tpl-grid">${d.templates.map(card).join('')}</div></div></section>`;
}

export async function wireDeckPanel(main) {
  const panel = main.querySelector('#deckPanel');
  if (!panel) return;
  const d = await api('/deck-templates');
  const find = (id) => d.templates.find((t) => t.id === id);
  const again = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
  panel.querySelector('[data-act="deck-new"]')?.addEventListener('click', () => editDeck(d, null));
  // Slides are arranged in the presentation designer (Settings → Presentation templates), with previews.
  const open = (id) => {
    try {
      localStorage.setItem('cc.presentations', JSON.stringify({ ...JSON.parse(localStorage.getItem('cc.presentations') || '{}'), id }));
    } catch {}
    location.hash = '#/settings/presentations';
  };
  for (const b of panel.querySelectorAll('[data-deck-edit]')) b.addEventListener('click', () => open(b.dataset.deckEdit));
  for (const b of panel.querySelectorAll('[data-deck-copy]')) b.addEventListener('click', () => editDeck(d, find(b.dataset.deckCopy), { copy: true }));
  for (const b of panel.querySelectorAll('[data-deck-team]')) b.addEventListener('click', async () => (await attempt(() => api('/deck-templates/default', { method: 'PUT', body: { templateId: b.dataset.deckTeam } }), 'Your team’s customer decks use it now')) && again());
  for (const b of panel.querySelectorAll('[data-deck-org]')) b.addEventListener('click', async () => (await attempt(() => api('/deck-templates/default', { method: 'PUT', body: { templateId: b.dataset.deckOrg, org: true } }), 'Everyone’s customer decks use it now')) && again());
  for (const b of panel.querySelectorAll('[data-deck-del]'))
    b.addEventListener('click', async () => {
      const t = find(b.dataset.deckDel);
      if (!(await ask(`Remove the presentation template “${t.name}”? POVs that used it go back to their team’s or the organisation’s.`, { ok: 'Remove', danger: true }))) return;
      if (await attempt(() => api(`/deck-templates/${encodeURIComponent(t.id)}`, { method: 'DELETE' }), 'Removed')) again();
    });
}

/** The editor: name, who it is for, the design, its words, and the slides of each deck (main, appendix or off, in order). */
function editDeck(d, tpl, { copy = false } = {}) {
  const editing = tpl && !copy && !tpl.builtIn;
  const L = JSON.parse(JSON.stringify(tpl?.layout ?? d.defaultLayout));
  const shareWide = ['admin', 'vp', 'leader'].includes(state.session.user.role);
  let mode = 'results';
  const keys = Object.keys(d.slides);
  const place = (k) => (L[mode].main.includes(k) ? 'main' : L[mode].appendix.includes(k) ? 'appendix' : 'off');
  const rowsHtml = () => {
    const ordered = [...L[mode].main, ...L[mode].appendix, ...keys.filter((k) => place(k) === 'off')];
    return ordered
      .map((k) => {
        const p = place(k);
        return `<div class="slide-row ${p}" data-key="${k}"><span class="grow">${esc(d.slides[k])}</span>
          <div class="seg sm" role="group">${[['main', 'Main deck'], ['appendix', 'Appendix'], ['off', 'Off']].map(([v, l]) => `<button type="button" data-put="${v}" aria-pressed="${p === v}">${l}</button>`).join('')}</div>
          <button type="button" class="btn sm ghost" data-move="-1" aria-label="Up" ${p === 'off' ? 'disabled' : ''}>↑</button><button type="button" class="btn sm ghost" data-move="1" aria-label="Down" ${p === 'off' ? 'disabled' : ''}>↓</button></div>`;
      })
      .join('');
  };
  openDialog(
    `<form class="dbody" id="deckF"><h2>${editing ? `Edit “${esc(tpl.name)}”` : copy ? `Copy of “${esc(tpl.name)}”` : 'New presentation template'}</h2>
      <div class="row"><label class="field">Name<input name="name" required maxlength="80" value="${esc(copy ? `${tpl.name} (copy)` : tpl?.name ?? '')}"></label>
      <label class="field">For<select name="scope"><option value="team">My team</option>${shareWide ? `<option value="everyone" ${tpl?.scope === 'everyone' && !copy ? 'selected' : ''}>Everyone</option>` : ''}</select></label></div>
      <label class="field">Description<input name="description" maxlength="300" value="${esc(tpl?.description ?? '')}"></label>
      <div class="field">Design ${editing ? (tpl.design ? `<span class="small">· ${esc(tpl.design.name)} <button type="button" class="linkish" data-act="design-del">use Kendra’s instead</button></span>` : '<span class="small muted">· Kendra’s own</span>') : '<span class="small muted">· upload it after saving</span>'}
        ${editing ? '<input type="file" id="deckDesign" accept=".pptx">' : ''}<span class="small muted">The team’s PowerPoint: its cover, toolchain, plan, environment and test plan slides are filled with each POV’s data; its look carries every other slide.</span></div>
      <div class="field">Slides <div class="seg" role="group" style="width:auto;align-self:flex-start"><button type="button" data-mode="results" aria-pressed="true">Final report</button><button type="button" data-mode="wip" aria-pressed="false">WIP deck</button></div></div>
      <div class="slide-list" id="slideList">${rowsHtml()}</div>
      <div class="row"><label class="field">Support lines (one per line)<textarea name="support" rows="3">${esc((tpl?.texts?.support ?? []).join('\n'))}</textarea></label><label class="field">Success lines<textarea name="success" rows="3">${esc((tpl?.texts?.success ?? []).join('\n'))}</textarea></label></div>
      <label class="field">Closing line of the overview letter<input name="quote" maxlength="200" value="${esc(tpl?.texts?.quote ?? '')}" placeholder="“From code to confidence: building security from the ground up with Checkmarx.”"></label>
      <p class="form-error" id="deckErr" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    {
      wide: true,
      onOpen(dl) {
        const list = dl.querySelector('#slideList');
        const redraw = () => (list.innerHTML = rowsHtml());
        dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        for (const b of dl.querySelectorAll('[data-mode]'))
          b.addEventListener('click', () => {
            mode = b.dataset.mode;
            for (const x of dl.querySelectorAll('[data-mode]')) x.setAttribute('aria-pressed', String(x === b));
            redraw();
          });
        list.addEventListener('click', (e) => {
          const row = e.target.closest('[data-key]');
          if (!row) return;
          const k = row.dataset.key;
          const put = e.target.closest('[data-put]')?.dataset.put;
          const move = Number(e.target.closest('[data-move]')?.dataset.move ?? 0);
          if (put) {
            L[mode].main = L[mode].main.filter((x) => x !== k);
            L[mode].appendix = L[mode].appendix.filter((x) => x !== k);
            if (put !== 'off') L[mode][put].push(k);
          } else if (move) {
            const part = L[mode].main.includes(k) ? 'main' : 'appendix';
            const arr = L[mode][part];
            const i = arr.indexOf(k);
            const j = i + move;
            if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
          } else return;
          redraw();
        });
        dl.querySelector('[data-act="design-del"]')?.addEventListener('click', async () => {
          if (await attempt(() => api(`/deck-templates/${encodeURIComponent(tpl.id)}/design`, { method: 'DELETE' }), 'Back to Kendra’s design')) {
            closeDialog();
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          }
        });
        dl.querySelector('#deckF').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          if (!L.results.main.length || !L.wip.main.length) return void (dl.querySelector('#deckErr').textContent = 'Each deck needs at least one slide in its main deck.');
          const body = { name: f.name.value, scope: f.scope.value, description: f.description.value, layout: L, texts: { support: f.support.value, success: f.success.value, quote: f.quote.value } };
          try {
            const r = await api(editing ? `/deck-templates/${encodeURIComponent(tpl.id)}` : '/deck-templates', { method: editing ? 'PUT' : 'POST', body });
            const file = dl.querySelector('#deckDesign')?.files?.[0];
            if (file) {
              const res = await fetch(`/api/deck-templates/${encodeURIComponent(r.template.id)}/design`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The design could not be used.');
            }
            closeDialog();
            toast(editing ? 'Saved' : 'Made — edit it again to upload a design');
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          } catch (err) {
            dl.querySelector('#deckErr').textContent = err.message;
          }
        });
      },
    },
  );
}
