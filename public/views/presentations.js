// The presentation designer (Settings → Presentation templates): each template's slides as previews of a demo POV, in
// order, in the main deck, the appendix or not used; for each slide that exists two ways, its design (the template's
// own slide or Kendra's); a title of its own; the template's words; its name, who it is for, and its PowerPoint, read
// by itself when uploaded.
import { esc, api, state, can, local, toast, attempt, ask } from '../core.js';

const ui = local.get('cc.presentations', { id: '', deck: 'wip' });
const save = () => local.set('cc.presentations', ui);
let cache = {}; // preview results by request fingerprint (this page visit)

export async function renderPresentations(body) {
  Object.assign(ui, local.get('cc.presentations', {}));
  const list = await api('/deck-templates');
  const tpls = list.templates;
  if (!tpls.some((t) => t.id === ui.id)) ui.id = (tpls.find((t) => t.id === list.orgDefault) ?? tpls.find((t) => !t.builtIn) ?? tpls[0])?.id ?? '';
  save();
  body.innerHTML = `<div class="pd-layout">
    <aside class="pd-list panel st-panel"><div class="st-ph"><h2>Templates</h2></div>
      <div class="pd-items">${tpls.map((t) => `<button type="button" class="pd-item${t.id === ui.id ? ' on' : ''}" data-pick="${esc(t.id)}"><b>${esc(t.name)}</b><span class="small muted">${t.builtIn ? 'Built in' : t.design ? esc(t.design.name) : 'Kendra’s design'}${t.id === list.orgDefault ? ' · everyone’s' : t.id === list.myTeamDefault ? ' · my team’s' : ''}</span></button>`).join('')}</div>
      ${list.canManage ? `<div class="pd-new"><button class="btn primary sm" data-act="new">New template</button><label class="btn sm">Upload a PowerPoint<input type="file" accept=".pptx" data-act="upload-new" hidden></label></div>
      <p class="small muted pd-hint">A new PowerPoint is read by itself: Kendra finds its cover, dividers, closing slide and its own versions of the plan, toolchain, environment and test plan slides by what they say.</p>` : ''}</aside>
    <section class="pd-main" id="pdMain"><p class="muted">Loading…</p></section></div>`;
  body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => ((ui.id = b.dataset.pick), save(), renderPresentations(body))));
  body.querySelector('[data-act="new"]')?.addEventListener('click', async () => {
    const r = await attempt(() => api('/deck-templates', { method: 'POST', body: { name: 'New template', scope: 'team', layout: list.defaultLayout } }));
    if (r) ((ui.id = r.template.id), save(), renderPresentations(body));
  });
  body.querySelector('[data-act="upload-new"]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = file.name.replace(/\.pptx$/i, '').slice(0, 80) || 'Team template';
    const r = await attempt(() => api('/deck-templates', { method: 'POST', body: { name, scope: 'team', description: 'From the PowerPoint uploaded here.', layout: list.defaultLayout } }));
    if (!r) return;
    if (await uploadDesign(r.template.id, file)) {
      ui.id = r.template.id;
      save();
      renderPresentations(body);
    }
  });
  if (ui.id) await designer(body.querySelector('#pdMain'), list, () => renderPresentations(body));
}

async function uploadDesign(id, file) {
  const res = await fetch(`/api/deck-templates/${encodeURIComponent(id)}/design`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
  if (!res.ok) {
    toast((await res.json().catch(() => ({}))).error ?? 'The PowerPoint could not be used.', { bad: true });
    return false;
  }
  toast('Read: its slides are below');
  cache = {};
  return true;
}

async function designer(el, list, reload) {
  const d = await api(`/deck-templates/${encodeURIComponent(ui.id)}/designer`);
  const t = d.template;
  const edit = t.canEdit && list.canManage;
  // What is on screen, saved with Save.
  const draft = { name: t.name, description: t.description ?? '', scope: t.scope, layout: JSON.parse(JSON.stringify(t.layout)), variants: { ...t.variants }, titles: { ...(t.texts?.titles ?? {}) }, support: (t.texts?.support ?? []).join('\n'), success: (t.texts?.success ?? []).join('\n'), quote: t.texts?.quote ?? '' };
  let dirty = false;
  const found = d.found?.slides ?? {};
  const two = (k) => Boolean(d.variants[k] && found[k]);
  const label = (k) => (k === 'appendix' ? 'Appendix divider' : d.slides[k] ?? k);
  let previews = { now: null, template: null, kendra: null };

  const body = () => ({ deck: ui.deck, layout: draft.layout, variants: draft.variants, titles: draft.titles });
  const loadPreviews = async () => {
    if (!d.canPreview) return;
    const get = async (extra) => {
      const req = { ...body(), ...extra };
      const k = JSON.stringify([ui.id, t.design?.at, req]);
      cache[k] ??= api(`/deck-templates/${encodeURIComponent(ui.id)}/preview`, { method: 'POST', body: req }).catch(() => ({ available: false }));
      return cache[k];
    };
    el.querySelector('#pdStatus').textContent = 'Drawing the previews from a demo POV…';
    previews.now = await get({});
    drawStrip();
    if (Object.keys(d.variants).some(two)) {
      [previews.template, previews.kendra] = await Promise.all([get({ allVariants: 'template' }), get({ allVariants: 'kendra' })]);
      drawStrip();
    }
    el.querySelector('#pdStatus').textContent = previews.now?.available ? `Previews of a made-up POV (Northwind Media), as this ${ui.deck === 'wip' ? 'WIP deck' : 'final report'} would be.` : 'Previews need LibreOffice on the server (the container image has it): download the demo deck instead.';
  };
  const imgsOf = (p, k) => (p?.available ? p.slides.filter((x) => x.key === k).map((x) => x.img) : []);

  const card = (k, where) => {
    const imgs = imgsOf(previews.now, k);
    const variant = draft.variants[k] ?? 'kendra';
    const thumb = imgs[0] ? `<img src="${esc(imgs[0])}" alt="" loading="lazy" draggable="false">` : `<div class="pd-schema">${esc(label(k))}</div>`;
    // Where the slide is in the deck (main deck, then the appendix), with arrows to move it one place either way.
    const L = draft.layout[ui.deck];
    const seq = [...L.main, ...L.appendix];
    const pos = seq.indexOf(k);
    // Its place in its part (main deck or appendix); at the edge between them, the arrow moves it across the divider.
    const inMain = L.main.includes(k);
    const part = inMain ? L.main : L.appendix;
    const at = part.indexOf(k);
    const back = inMain ? (at === 0 ? '' : 'Earlier') : at === 0 ? 'Back into the main deck' : 'Earlier';
    const fwd = inMain ? (at === part.length - 1 ? 'Into the appendix' : 'Later') : at === part.length - 1 ? '' : 'Later';
    const nav = edit && pos >= 0
      ? `<div class="pd-nav"><button type="button" class="pd-arrow" data-move="-1" ${back ? '' : 'disabled'} aria-label="${esc(back || 'Earlier')}: ${esc(label(k))}" title="${esc(back || 'First')}">◀</button><span class="pd-pos">${inMain ? 'Main deck' : 'Appendix'} ${at + 1} of ${part.length}</span><button type="button" class="pd-arrow" data-move="1" ${fwd ? '' : 'disabled'} aria-label="${esc(fwd || 'Later')}: ${esc(label(k))}" title="${esc(fwd || 'Last')}">▶</button></div>`
      : '';
    const choose = two(k)
      ? `<div class="pd-variants">${['template', 'kendra'].map((v) => {
          const im = imgsOf(previews[v], k)[0];
          return `<button type="button" class="pd-var${variant === v ? ' on' : ''}" data-variant="${v}" ${edit ? '' : 'disabled'} title="${v === 'template' ? 'The template’s own slide, filled with the POV' : 'Kendra’s design, on the template’s background'}">${im ? `<img src="${esc(im)}" alt="">` : ''}<span>${v === 'template' ? 'Template' : 'Kendra'}</span></button>`;
        }).join('')}</div>`
      : '';
    const kendraDrawn = !two(k) || variant === 'kendra';
    return `<div class="pd-card" data-key="${esc(k)}" data-where="${where}">
      <div class="pd-thumb" draggable="${edit && where !== 'off' && where !== 'divider'}" title="${edit && where !== 'off' && where !== 'divider' ? 'Drag to move, or use the arrows below' : ''}">${thumb}${imgs.length > 1 ? `<span class="pd-count">×${imgs.length}</span>` : ''}</div>
      ${nav}
      <div class="pd-meta"><b>${esc(label(k))}</b>
        ${edit && kendraDrawn && !['cover', 'closing', 'closingEnd', 'appendix'].includes(k) ? `<input class="pd-title" data-title="${esc(k)}" value="${esc(draft.titles[k] ?? '')}" placeholder="Title: as Kendra writes it" aria-label="Title of ${esc(label(k))}">` : ''}
        ${choose}
        ${edit ? `<div class="pd-moves">${where === 'off' ? '<button type="button" class="btn sm" data-put="main">Add to the deck</button><button type="button" class="btn sm ghost" data-put="appendix">To the appendix</button>' : where === 'divider' ? '' : `<button type="button" class="btn sm ghost" data-put="${where === 'main' ? 'appendix' : 'main'}">${where === 'main' ? 'To the appendix' : 'To the deck'}</button><button type="button" class="btn sm ghost danger" data-put="off" aria-label="Take out">✕</button>`}</div>` : ''}
      </div></div>`;
  };
  const drawStrip = () => {
    const L = draft.layout[ui.deck];
    const off = Object.keys(d.slides).filter((k) => !L.main.includes(k) && !L.appendix.includes(k));
    el.querySelector('#pdStrip').innerHTML = `
      <div class="pd-sec"><div class="pd-sec-h"><b>Main deck</b><span class="small muted">${L.main.length} slide types · ${edit ? 'move with ◀ ▶ under each slide, or drag its picture' : 'copy this template to change its order'}</span></div><div class="pd-row" data-drop="main">${L.main.map((k) => card(k, 'main')).join('')}</div></div>
      <div class="pd-sec"><div class="pd-sec-h"><b>Appendix</b><span class="small muted">after the Appendix divider</span></div><div class="pd-row" data-drop="appendix">${L.appendix.length ? `${card('appendix', 'divider')}${L.appendix.map((k) => card(k, 'appendix')).join('')}` : '<p class="small muted pd-empty">Drop slides here for the appendix.</p>'}</div></div>
      ${edit ? `<details class="pd-sec"><summary class="pd-sec-h"><b>Not used</b><span class="small muted">${off.length} more slides Kendra can make</span></summary><div class="pd-row" data-drop="off">${off.map((k) => card(k, 'off')).join('')}</div></details>` : ''}`;
    wireStrip();
  };
  const markDirty = () => {
    dirty = true;
    el.querySelector('#pdSave').disabled = false;
    el.querySelector('#pdDirty').textContent = 'Not saved yet';
  };
  const place = (k, to, before = null) => {
    const L = draft.layout[ui.deck];
    L.main = L.main.filter((x) => x !== k);
    L.appendix = L.appendix.filter((x) => x !== k);
    if (to === 'off') return;
    const arr = L[to];
    const i = before ? arr.indexOf(before) : -1;
    if (i >= 0) arr.splice(i, 0, k);
    else arr.push(k);
  };
  let dragging = null;
  // One place earlier or later in the deck: past the end of the main deck is the start of the appendix, and back.
  const move = (k, step) => {
    const L = draft.layout[ui.deck];
    const inMain = L.main.includes(k);
    const arr = inMain ? L.main : L.appendix;
    const i = arr.indexOf(k);
    if (i < 0) return false;
    const j = i + step;
    if (j >= 0 && j < arr.length) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return true;
    }
    if (inMain && j >= arr.length) {
      L.main.splice(i, 1);
      L.appendix.unshift(k);
      return true;
    }
    if (!inMain && j < 0) {
      L.appendix.splice(i, 1);
      L.main.push(k);
      return true;
    }
    return false;
  };
  const wireStrip = () => {
    const strip = el.querySelector('#pdStrip');
    strip.querySelectorAll('.pd-card').forEach((c) => {
      const k = c.dataset.key;
      c.querySelectorAll('[data-put]').forEach((b) => b.addEventListener('click', () => (place(k, b.dataset.put), markDirty(), drawStrip())));
      c.querySelectorAll('[data-move]').forEach((b) =>
        b.addEventListener('click', () => {
          if (!move(k, Number(b.dataset.move))) return;
          markDirty();
          drawStrip();
          // Keep the slide in view (and the arrow under the pointer focused) after the strip is redrawn.
          const moved = el.querySelector(`.pd-card[data-key="${CSS.escape(k)}"]`);
          moved?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          moved?.querySelector(`[data-move="${b.dataset.move}"]:not([disabled])`)?.focus({ preventScroll: true });
        }),
      );
      c.querySelectorAll('[data-variant]').forEach((b) => b.addEventListener('click', () => ((draft.variants[k] = b.dataset.variant), markDirty(), drawStrip(), loadPreviews())));
      c.querySelector('[data-title]')?.addEventListener('change', (e) => {
        const v = e.target.value.trim();
        if (v) draft.titles[k] = v;
        else delete draft.titles[k];
        markDirty();
      });
      const handle = c.querySelector('.pd-thumb[draggable="true"]');
      handle?.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', k);
        e.dataTransfer.setDragImage?.(c, 20, 20);
        dragging = k;
        c.classList.add('dragging');
      });
      handle?.addEventListener('dragend', () => {
        dragging = null;
        c.classList.remove('dragging');
        strip.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      });
    });
    strip.querySelectorAll('[data-drop]').forEach((row) => {
      row.addEventListener('dragenter', (e) => dragging && e.preventDefault());
      row.addEventListener('dragover', (e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('over');
      });
      row.addEventListener('dragleave', (e) => !row.contains(e.relatedTarget) && row.classList.remove('over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('over');
        const k = dragging || e.dataTransfer.getData('text/plain');
        dragging = null;
        if (!k || k === 'appendix') return;
        const target = e.target.closest('.pd-card');
        const before = target && target.dataset.key !== k && target.dataset.where === row.dataset.drop ? target.dataset.key : null;
        place(k, row.dataset.drop, before);
        markDirty();
        drawStrip();
      });
    });
  };

  const foundChips = d.found
    ? Object.entries(d.variants).map(([k, l]) => `<span class="pd-chip ${found[k] ? 'ok' : ''}" title="${found[k] ? 'Found: its own version can be used' : 'Not in this PowerPoint: Kendra’s design is used'}">${found[k] ? '✓' : '–'} ${esc(l)}</span>`).join('') + `<span class="pd-chip ${d.found.closing ? 'ok' : ''}">${d.found.closing ? '✓' : '–'} Closing slide</span>`
    : '';
  el.innerHTML = `
    <section class="panel st-panel"><div class="st-ph"><h2>${esc(t.name)}</h2><span class="st-aside">${t.builtIn ? 'Built in: copy it to change it' : t.design ? `Design: ${esc(t.design.name)}` : 'Kendra’s own design'}</span></div>
      <div class="st-form">
        ${edit ? `<div class="st-cols3"><label class="field">Name<input id="pdName" maxlength="80" value="${esc(draft.name)}"></label><label class="field">Description<input id="pdDesc" maxlength="300" value="${esc(draft.description)}"></label><label class="field">For<select id="pdScope"><option value="team" ${draft.scope !== 'everyone' ? 'selected' : ''}>My team</option>${['admin', 'vp', 'leader'].includes(state.session.user.role) ? `<option value="everyone" ${draft.scope === 'everyone' ? 'selected' : ''}>Everyone</option>` : ''}</select></label></div>` : `<p class="small muted" style="margin:0">${esc(t.description ?? '')}</p>`}
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${list.canManage && list.myTeamDefault !== t.id ? '<button class="btn sm" data-act="team">Use for my team’s decks</button>' : ''}${list.canSetOrg && list.orgDefault !== t.id ? '<button class="btn sm" data-act="org">Use for everyone’s decks</button>' : ''}
          ${list.canManage ? '<button class="btn sm ghost" data-act="copy">Copy</button>' : ''}<button class="btn sm ghost" data-act="demo">Download the demo deck</button>
          ${edit ? '<button class="btn sm ghost danger" data-act="del">Remove</button>' : ''}</div>
      </div></section>
    ${edit && !t.classic ? `<section class="panel st-panel"><div class="st-ph"><h2>PowerPoint design</h2><span class="st-aside">${t.design ? `uploaded ${esc(new Date(t.design.at).toLocaleDateString())}${t.design.by ? ` by ${esc(t.design.by)}` : ''}` : 'none: Kendra’s own dark design'}</span></div>
      <div class="st-form"><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn sm primary">${t.design ? 'Replace the PowerPoint' : 'Upload a PowerPoint'}<input type="file" accept=".pptx" id="pdDesign" hidden></label>${t.design ? '<button type="button" class="btn sm ghost" data-act="design-del">Use Kendra’s design instead</button>' : ''}</div>
      ${foundChips ? `<div><div class="small muted" style="margin-bottom:6px">Found in it, by itself:</div><div class="pd-chips">${foundChips}</div></div>` : ''}</div></section>` : ''}
    <section class="panel st-panel"><div class="st-ph"><h2>Slides</h2><div class="seg st-seg" style="margin-left:auto">${[['wip', 'WIP deck'], ['results', 'Final report']].map(([v, l]) => `<label><input type="radio" name="pdDeck" value="${v}" ${ui.deck === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <p class="st-note" id="pdStatus">${d.canPreview ? '' : 'Previews need LibreOffice on the server (the container image has it): download the demo deck instead.'}</p>
      <div id="pdStrip" class="pd-strip"></div></section>
    ${edit ? `<section class="panel st-panel"><div class="st-ph"><h2>The template’s words</h2></div><div class="st-form">
      <div class="st-cols2"><label class="field">Support lines <span class="small muted">one per line</span><textarea id="pdSupport" rows="3">${esc(draft.support)}</textarea></label><label class="field">Success lines<textarea id="pdSuccess" rows="3">${esc(draft.success)}</textarea></label></div>
      <label class="field">Closing line of the overview letter<input id="pdQuote" maxlength="200" value="${esc(draft.quote)}" placeholder="“From code to confidence: building security from the ground up with Checkmarx.”"></label></div></section>
    <div class="pd-bar"><span class="small muted" id="pdDirty">All saved</span><button class="btn" data-act="refresh">Refresh the previews</button><button class="btn primary" id="pdSave" disabled>Save</button></div>` : ''}`;
  drawStrip();
  for (const r of el.querySelectorAll('input[name="pdDeck"]')) r.addEventListener('change', () => ((ui.deck = r.value), save(), drawStrip(), loadPreviews()));
  // What is typed is kept in the draft at once, so nothing that redraws the page can put the old name back.
  const KEEP = { pdName: 'name', pdDesc: 'description', pdScope: 'scope' };
  for (const id of ['pdName', 'pdDesc', 'pdScope', 'pdSupport', 'pdSuccess', 'pdQuote'])
    for (const ev of ['input', 'change'])
      el.querySelector(`#${id}`)?.addEventListener(ev, (e) => {
        if (KEEP[id]) draft[KEEP[id]] = e.target.value;
        markDirty();
      });
  el.querySelector('#pdScope')?.addEventListener('change', markDirty);
  el.querySelector('[data-act="refresh"]')?.addEventListener('click', loadPreviews);
  el.querySelector('#pdSave')?.addEventListener('click', async () => {
    const r = await attempt(() => api(`/deck-templates/${encodeURIComponent(t.id)}`, { method: 'PUT', body: { name: el.querySelector('#pdName').value, description: el.querySelector('#pdDesc').value, scope: el.querySelector('#pdScope').value, layout: draft.layout, variants: draft.variants, texts: { support: el.querySelector('#pdSupport').value, success: el.querySelector('#pdSuccess').value, quote: el.querySelector('#pdQuote').value, titles: draft.titles } } }), 'Saved');
    if (r) {
      dirty = false;
      reload();
    }
  });
  el.querySelector('#pdDesign')?.addEventListener('change', async (e) => e.target.files[0] && (await uploadDesign(t.id, e.target.files[0])) && reload());
  el.querySelector('[data-act="design-del"]')?.addEventListener('click', async () => (await attempt(() => api(`/deck-templates/${encodeURIComponent(t.id)}/design`, { method: 'DELETE' }), 'Back to Kendra’s design')) && ((cache = {}), reload()));
  el.querySelector('[data-act="team"]')?.addEventListener('click', async () => (await attempt(() => api('/deck-templates/default', { method: 'PUT', body: { templateId: t.id } }), 'Your team’s decks use it now')) && reload());
  el.querySelector('[data-act="org"]')?.addEventListener('click', async () => (await attempt(() => api('/deck-templates/default', { method: 'PUT', body: { templateId: t.id, org: true } }), 'Everyone’s decks use it now')) && reload());
  el.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
    const r = await attempt(() => api('/deck-templates', { method: 'POST', body: { name: `${t.name} (copy)`, scope: 'team', description: t.description, layout: draft.layout, variants: draft.variants, texts: { ...t.texts, titles: draft.titles } } }), 'Copied');
    if (r) ((ui.id = r.template.id), save(), reload());
  });
  el.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
    if (!(await ask(`Remove the presentation template “${t.name}”? POVs that used it go back to their team’s or the organisation’s.`, { ok: 'Remove', danger: true }))) return;
    if (await attempt(() => api(`/deck-templates/${encodeURIComponent(t.id)}`, { method: 'DELETE' }), 'Removed')) ((ui.id = ''), save(), reload());
  });
  el.querySelector('[data-act="demo"]').addEventListener('click', async () => {
    const res = await fetch(`/api/deck-templates/${encodeURIComponent(t.id)}/demo`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? 'The demo deck could not be made.', { bad: true });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `${t.name} - demo ${ui.deck === 'wip' ? 'WIP deck' : 'final report'}.pptx` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  addEventListener('beforeunload', (e) => dirty && e.preventDefault(), { once: true });
  loadPreviews();
  void can;
}
