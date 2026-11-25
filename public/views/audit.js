// The audit trail, for Admins, VPs and leaders: every change and every request, kept and provable. Each person sees
// what they and the people below them did; Admins see everything (failed sign-ins too).
import { esc, api, local, when, table, openDialog, closeDialog, state } from '../core.js';

const ui = local.get('cc.audit', { kind: 'changes' });
const save = () => local.set('cc.audit', ui);
let more = [];

export async function renderAudit(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Audit</h2>');
  more = [];
  const q = query();
  const d = await api(`/audit?${q}`);
  const chain = d.chain;
  main.innerHTML = `
    <div class="st-head"><h1>Audit log</h1><span class="st-sub">Every action, by everyone: sign-ins, changes to POVs, criteria, people, roles and settings, exports, updates and backups, and anything refused, with the reason. Newest first. Each entry is chained to the one before, so a changed or removed entry is found.</span></div>
    <div class="row center" style="margin:-4px 0 14px;gap:10px;flex-wrap:wrap">
      ${chain.ok ? `<span class="status on" title="${chain.records.toLocaleString()} entries since ${chain.from ? esc(when(chain.from)) : 'the start'}"><i></i>The log is intact · ${chain.records.toLocaleString()} ${d.kind === 'access' ? 'requests' : 'changes'}</span>` : `<span class="status off bad-t"><i></i>Broken at ${esc(chain.brokenAt ?? '?')}: ${esc(chain.reason ?? '')}</span>`}
      <span class="small muted">${d.keepDays ? `kept ${Math.round((d.keepDays / 365) * 10) / 10} years` : 'kept for good'}</span>
      <a class="btn" href="/api/audit/export?${q}" download>Export CSV</a></div>
    <section class="panel st-panel">
      <div class="st-filters" style="padding-top:16px">
        <div class="seg" role="group" aria-label="Show"><button data-kind="changes" aria-pressed="${ui.kind !== 'access'}">Changes</button><button data-kind="access" aria-pressed="${ui.kind === 'access'}">Every request</button></div>
        <input type="search" id="aQ" placeholder="${ui.kind === 'access' ? 'Search people, addresses, pages, IPs' : 'Search everything'}" value="${esc(ui.q ?? '')}" aria-label="Search">
        <select id="aWho" aria-label="Who"><option value="">Everyone</option>${d.people.map((p) => `<option value="${esc(p.id)}" ${ui.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <label class="small muted">From <input type="date" id="aFrom" value="${esc(ui.from ?? '')}" style="width:auto"></label>
        <label class="small muted">To <input type="date" id="aTo" value="${esc(ui.to ?? '')}" style="width:auto"></label>
        ${ui.kind === 'access' ? `<select id="aOutcome" aria-label="Outcome"><option value="">All</option><option value="writes" ${ui.writes ? 'selected' : ''}>Changes only</option><option value="errors" ${ui.errors ? 'selected' : ''}>Refused or failed</option></select>` : ''}
      </div>
      <div id="aList">${rowsTable(d.records)}</div>
      <div class="st-foot row center" id="aMore">${d.records.length} shown${d.next ? ` · <button class="btn sm" data-next="${d.next}">Older</button>` : d.records.length ? ' · that is everything that matches' : ''}</div></section>`;
  const set = (k, v) => ((ui[k] = v), save(), document.dispatchEvent(new CustomEvent('cc:rerender')));
  main.querySelector('#aWho').addEventListener('change', (e) => set('who', e.target.value));
  main.querySelector('#aFrom').addEventListener('change', (e) => set('from', e.target.value));
  main.querySelector('#aTo').addEventListener('change', (e) => set('to', e.target.value));
  main.querySelector('#aOutcome')?.addEventListener('change', (e) => {
    ui.writes = e.target.value === 'writes';
    ui.errors = e.target.value === 'errors';
    save();
    document.dispatchEvent(new CustomEvent('cc:rerender'));
  });
  wire(main, d);
}

function query(extra = {}) {
  const q = new URLSearchParams();
  q.set('kind', ui.kind === 'access' ? 'access' : 'changes');
  for (const k of ['q', 'who', 'from', 'to']) if (ui[k]) q.set(k, ui[k]);
  if (ui.kind === 'access' && ui.writes) q.set('writes', '1');
  if (ui.kind === 'access' && ui.errors) q.set('errors', '1');
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

const cols = () =>
  ui.kind === 'access'
    ? [
        { label: 'When', html: (r) => `<span title="${esc(r.at)}">${esc(when(r.at))}</span>` },
        { label: 'Who', html: (r) => `${esc(r.byName || 'Not signed in')}${r.role ? `<div class="small muted">${esc(state.meta?.roles?.[r.role] ?? r.role)}</div>` : ''}` },
        { label: 'Request', html: (r) => `<span class="mono" title="${esc(r.path)}">${esc(r.method)} ${esc((r.route || r.path).replace(/^\/api/, ''))}${esc((r.path ?? '').includes('?') ? `?${r.path.split('?')[1]}` : '')}</span>` },
        { label: 'POV', html: (r) => (r.opp ? `<a href="#/opp/${esc(r.opp)}">${esc(r.customer || 'opportunity')}</a>` : '<span class="muted">—</span>') },
        { label: 'Result', html: (r) => `<span class="${r.status >= 400 ? 'bad-t' : ''}">${esc(r.status)}</span> <span class="small muted">${esc(r.ms)} ms</span>` },
        { label: 'From', html: (r) => `<span class="small">${esc(r.ip)}<div class="muted">${esc(r.ua)}</div></span>` },
      ]
    : [
        { label: 'When', html: (r) => `<span title="${esc(r.at)}">${esc(when(r.at))}</span>` },
        { label: 'Who', html: (r) => `${esc(r.byName || 'Kendra')}${r.role ? `<div class="small muted">${esc(state.meta?.roles?.[r.role] ?? r.role)}</div>` : ''}` },
        { label: 'What', html: (r) => `${esc(r.what)}${r.imported ? ' <span class="small muted">(earlier log)</span>' : ''}` },
        { label: 'POV', html: (r) => (r.opp ? `<a href="#/opp/${esc(r.opp)}">${esc(r.customer || 'opportunity')}</a>` : `<span class="small muted">${esc(r.type)}</span>`) },
      ];

function rowsTable(records) {
  if (!records.length) return '<p class="empty-line" style="padding:16px">Nothing matches.</p>';
  return `<div class="audit-scroll">${table(`audit-${ui.kind}`, cols(), records, { rowAttrs: (r) => `class="click" data-seq="${r.seq}" tabindex="0"` })}</div>`;
}

function wire(main, d) {
  const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
  const all = [...d.records];
  for (const b of main.querySelectorAll('[data-kind]')) b.addEventListener('click', () => ((ui.kind = b.dataset.kind), save(), rerender()));
  for (const b of main.querySelectorAll('[data-clear]')) b.addEventListener('click', () => ((ui[b.dataset.clear] = ''), save(), rerender()));
  let timer;
  main.querySelector('#aQ').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ui.q = e.target.value;
      save();
      rerender();
      setTimeout(() => {
        const el = document.querySelector('#aQ');
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      });
    }, 350);
  });
  // Older records, appended under the ones shown.
  main.querySelector('#aMore').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-next]');
    if (!b) return;
    b.disabled = true;
    const page = await api(`/audit?${query({ before: b.dataset.next })}`);
    all.push(...page.records);
    more = all;
    main.querySelector('#aList').innerHTML = rowsTable(all);
    main.querySelector('#aMore').innerHTML = `${all.length} shown${page.next ? ` · <button class="btn sm" data-next="${page.next}">Older</button>` : ' · that is everything that matches'}`;
  });
  // A record in full, with its place in the chain.
  main.querySelector('#aList').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-seq]');
    if (!tr || e.target.closest('a')) return;
    const r = (more.length ? more : all).find((x) => String(x.seq) === tr.dataset.seq);
    if (!r) return;
    const { detail, ...rest } = r;
    openDialog(
      `<div class="dbody"><h2>Record ${esc(r.seq)}</h2>
        <dl class="sf-fields">${Object.entries({ ...rest, ...(detail && Object.keys(detail).length ? { detail: JSON.stringify(detail) } : {}) }).map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${['hash', 'prev'].includes(k) ? 'mono small' : ''}" style="overflow-wrap:anywhere">${esc(v)}</dd>`).join('')}</dl>
        <p class="small muted" style="margin:0">“prev” is the fingerprint of the record before this one; “hash” is this record’s. Changing or removing any record breaks every fingerprint after it.</p>
        <div class="dialog-actions"><button class="btn" data-close>Close</button></div></div>`,
      { onOpen: (dl) => dl.querySelector('[data-close]').addEventListener('click', () => closeDialog()) },
    );
  });
  main.querySelector('[data-act="filters"]')?.addEventListener('click', () =>
    openDialog(
      `<form class="dbody" id="aF"><h2>Filters</h2>
        <label class="field">Who<select name="who"><option value="">Everyone</option>${d.people.map((p) => `<option value="${esc(p.id)}" ${ui.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <div class="row"><label class="field">From<input type="date" name="from" value="${esc(ui.from ?? '')}"></label><label class="field">To<input type="date" name="to" value="${esc(ui.to ?? '')}"></label></div>
        ${ui.kind === 'access' ? `<label class="check"><input type="checkbox" name="writes" ${ui.writes ? 'checked' : ''}> Only requests that changed something</label><label class="check"><input type="checkbox" name="errors" ${ui.errors ? 'checked' : ''}> Only refused or failed requests</label>` : ''}
        <div class="dialog-actions"><button type="button" class="btn ghost" data-reset>Clear all</button><span class="spacer"></span><button class="btn primary">Show</button></div></form>`,
      {
        onOpen(dl) {
          const f = dl.querySelector('#aF');
          dl.querySelector('[data-reset]').addEventListener('click', () => {
            Object.assign(ui, { who: '', from: '', to: '', writes: false, errors: false });
            save();
            closeDialog();
            rerender();
          });
          f.addEventListener('submit', (e) => {
            e.preventDefault();
            Object.assign(ui, { who: f.who.value, from: f.from.value, to: f.to.value, writes: Boolean(f.writes?.checked), errors: Boolean(f.errors?.checked) });
            save();
            closeDialog();
            rerender();
          });
        },
      },
    ),
  );
}
