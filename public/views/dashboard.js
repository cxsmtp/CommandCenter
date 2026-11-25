// The portfolio: every opportunity the viewer can see, most urgent first, each saying in one line what is going on.
// Three numbers to narrow it, a search, and the rest of the filters in one sheet.
import { esc, api, state, local, openDialog, closeDialog, download, attempt, ago, when, day, KIND, scanTypeBadge, stageBadge, daysBadge, peopleOptions, can } from '../core.js';

const lastSeen = local.get('cc.lastSeen', 0);
const markSeen = () => local.set('cc.lastSeen', Date.now());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && markSeen());
addEventListener('pagehide', markSeen);

const ui = local.get('cc.dash', {});
const save = () => local.set('cc.dash', ui);
const defaultView = () => state.session.user.prefs?.view || (state.session.user.role === 'associate' ? 'cards' : 'table');

export async function renderDashboard(main, { crumbs, open = '' }) {
  ui.open = open;
  crumbs('<h2 style="font-size:16px">Portfolio</h2>');
  const owner = ui.owner && state.users.some((u) => u.id === ui.owner) ? ui.owner : '';
  state.overview = await api(`/overview${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`);
  const o = state.overview;

  if (!o.rows.length && !owner) {
    main.innerHTML = `<div class="hero-empty"><h1>Your POVs will live here</h1><p>Add an opportunity: the customer, then the success criteria (a template picks them for you). When the POV starts, paste the tenant's Checkmarx One API key and Kendra follows it by itself.</p>${can('opps.create') ? '<button class="btn primary" data-action="new-opp">New opportunity</button>' : ''}</div>`;
    return;
  }

  const regions = [...new Set(o.rows.map((r) => r.region || 'No region'))].sort();
  if (ui.region && !regions.includes(ui.region)) ui.region = '';
  const q = (ui.q ?? '').toLowerCase();
  const isClosed = (r) => ['won', 'lost'].includes(r.stage);
  const matches = (r) =>
    (!ui.stage || r.stage === ui.stage) &&
    (!ui.region || (r.region || 'No region') === ui.region) &&
    (!ui.focus || FOCUS[ui.focus].test(r)) &&
    (!q || [r.customer, r.name, r.owner.name, r.tenant?.tenant, ...r.managers.map((m) => m.name)].join(' ').toLowerCase().includes(q));
  const all = o.rows.filter(matches).sort(byUrgency);
  const open_ = all.filter((r) => !isClosed(r));
  const closed = all.filter(isClosed);
  const counts = Object.fromEntries(Object.entries(FOCUS).map(([k, f]) => [k, o.rows.filter((r) => !isClosed(r) && f.test(r)).length]));
  const filters = activeFilters(owner, regions);
  const table = (ui.view ?? defaultView()) === 'table';

  const running = o.rows.filter((r) => r.stage === 'pov').length;
  const summary = [`${o.rows.filter((r) => !isClosed(r)).length} open`, `${running} POV${running === 1 ? '' : 's'} running`, counts.needs ? `<span class="bad-t">${counts.needs} need${counts.needs === 1 ? 's' : ''} you</span>` : '<span class="ok-t">nothing needs you</span>', o.totals?.value?.hours ? `<span title="Time the AI actions in running tenants saved, at the value rates">AI saved ${Math.round(o.totals.value.hours)} h${o.totals.value.value ? ` (${new Intl.NumberFormat('en', { style: 'currency', currency: o.totals.value.currency || 'USD', maximumFractionDigits: 0 }).format(o.totals.value.value)})` : ''}</span>` : ''].filter(Boolean).join(' · ');

  main.innerHTML = `
    <div class="page-head"><div class="grow"><div class="sub" style="margin:0">${summary}</div></div>
      <div class="actions desk-only">${can('opps.create') ? '<button class="btn primary" data-action="new-opp">New opportunity</button>' : ''}</div></div>
    <div class="headline" role="group" aria-label="Show">
      ${Object.entries(FOCUS).map(([k, f]) => `<button data-focus="${k}" aria-pressed="${ui.focus === k}" class="${counts[k] ? f.tone : ''}"><b>${counts[k]}</b><span>${f.label}</span></button>`).join('')}
    </div>
    <div class="findbar">
      <input type="search" id="fQ" placeholder="Find a customer, SE or tenant" value="${esc(ui.q ?? '')}" aria-label="Find">
      <div class="seg-toggle" role="group" aria-label="View"><button type="button" data-view="cards" aria-pressed="${!table}">List</button><button type="button" data-view="table" aria-pressed="${table}">Table</button></div>
      ${table ? '<button class="btn" data-act="cols">Columns</button><button class="btn" data-act="csv">Export CSV</button>' : ''}
      <button class="btn" data-act="filters">Filters${filters.length ? ` <span class="count-dot">${filters.length}</span>` : ''}</button>
      <button class="btn ghost" data-act="tools" aria-label="More actions">•••</button>
    </div>
    ${filters.length ? `<div class="chips">${filters.map(([k, label]) => `<button class="chip-x" data-clear="${k}" aria-label="Remove filter ${esc(label)}">${esc(label)}</button>`).join('')}</div>` : ''}
    ${table ? tableHtml(all) : `<div class="list-scroll">${open_.length ? groupedRows(open_) : `<div class="panel empty-line" style="padding:16px">${ui.focus || filters.length || q ? 'Nothing matches. <button class="btn sm" data-act="reset">Show everything</button>' : 'No open opportunity.'}</div>`}
    ${closed.length ? `<details class="closed-fold" ${ui.showClosed ? 'open' : ''}><summary>Won and lost <span class="muted">(${closed.length})</span></summary>${rowsHtml(closed)}</details>` : ''}</div>`}`;
  wire(main, { owner, regions });
  if (table) wireTable(main, all);
}

// The three numbers, each a question with a list behind it.
const FOCUS = {
  needs: { label: 'need you', tone: 'bad', test: (r) => !r.muted && (r.alerts.some((a) => a.level === 'bad') || (r.gaps ?? []).some((g) => g.level === 'bad')) },
  ending: { label: 'end within 7 days', tone: 'warn', test: (r) => r.stage === 'pov' && r.daysLeft !== null && r.daysLeft <= 7 },
  likely: { label: 'likely to win', tone: 'ok', test: (r) => (r.prediction?.score ?? 0) >= 70 && !['won', 'lost'].includes(r.stage) },
};
const urgency = (r) => (r.muted ? 6 : FOCUS.needs.test(r) ? 0 : r.alerts.length || (r.gaps ?? []).some((g) => g.level === 'warn') ? 1 : r.stage === 'pov' ? 2 : r.stage === 'completed' ? 3 : 4);
const byUrgency = (a, b) => urgency(a) - urgency(b) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.customer.localeCompare(b.customer);

function activeFilters(owner, regions) {
  const out = [];
  if (owner) out.push(['owner', state.users.find((u) => u.id === owner)?.name ?? 'One person']);
  if (ui.region && regions.length > 1) out.push(['region', ui.region]);
  if (ui.stage) out.push(['stage', state.meta.stages[ui.stage] ?? ui.stage]);
  if (ui.groupBy && ui.groupBy !== 'none') out.push(['groupBy', GROUPS[ui.groupBy]]);
  return out;
}

/** What is going on, in one sentence: the worst problem, else the pace, else the next step. */
function why(r) {
  const bad = r.alerts.find((a) => a.level === 'bad') ?? null;
  const gapBad = (r.gaps ?? []).find((g) => g.level === 'bad');
  if (r.muted) return ['', 'Muted'];
  if (bad) return ['bad', bad.what];
  if (gapBad) return ['bad', gapBad.text];
  // Before the POV, a missing detail is not news: the next step is.
  const warn = r.alerts.find((a) => a.level === 'warn') ?? (['pov', 'completed'].includes(r.stage) ? (r.gaps ?? []).find((g) => g.level === 'warn') : null);
  if (warn) return ['warn', warn.what ?? warn.text];
  if (r.stage === 'won') return ['', r.povResult === 'successful' ? 'Won · POV successful' : 'Won'];
  if (r.stage === 'lost') return ['', 'Lost'];
  if (r.forecast?.criteria?.label && r.stage === 'pov') return ['', r.forecast.criteria.label];
  if (r.nextTask) return ['', `Next: ${r.nextTask.title}${r.nextTask.due ? ` (${day(r.nextTask.due)})` : ''}`];
  return ['', { discovery: 'In discovery', technical: 'Technical sessions', completed: 'Waiting for the decision', on_hold: 'On hold' }[r.stage] ?? ''];
}

const wide = () => matchMedia('(min-width: 1100px)').matches;
/** The dates that matter beside a POV in the list: the tenant's licence end and the Salesforce close date. */
const shortDay = (d) => { const t = new Date(`${String(d).slice(0, 10)}T12:00:00Z`); return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(t.getUTCFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
function datesLine(r) {
  const lic = r.live?.summary?.license;
  const bits = [];
  if (lic?.end) bits.push(`<span title="Tenant licence ${lic.start ? `${day(lic.start)} – ` : 'until '}${day(lic.end)}" class="${r.endDate && lic.end < String(r.endDate).slice(0, 10) ? 'warn-t' : ''}">tenant to ${shortDay(lic.end)}</span>`);
  if (r.closeDate) bits.push(`<span title="${r.closeFrom === 'report' ? 'Salesforce close date, from the report' : 'Salesforce close date, as typed'}" class="${r.stage === 'pov' && r.endDate && r.closeDate < r.endDate ? 'warn-t' : ''}">closes ${shortDay(r.closeDate)}</span>`);
  return bits.length ? `<span class="small muted dates">${bits.join(' · ')}</span>` : '';
}
function rowsHtml(rows) {
  return `<div class="povs">${rows
    .map((r) => {
      const [tone, text] = why(r);
      const score = r.prediction?.score;
      const scoreTone = score === null || score === undefined ? '' : score >= 70 ? 'ok' : score >= 40 ? 'warn' : 'bad';
      const p = r.progress;
      return `<a class="pov${ui.open === r.id ? ' selected' : ''}" href="${wide() ? `#/dashboard?open=${esc(r.id)}` : `#/opp/${esc(r.id)}`}">
        <span class="bar ${tone || (scoreTone === 'ok' ? 'ok' : '')}"></span>
        <span class="who"><b>${esc(r.customer)}</b><span>${esc([r.owner.name, r.tenant ? r.tenant.tenant : r.stage === 'pov' ? 'no tenant yet' : ''].filter(Boolean).join(' · '))}</span></span>
        <span class="stage">${stageBadge(r.stage)}${daysBadge(r)}${p.total ? `<span class="small muted">${p.met}/${p.total} criteria</span>` : ''}${datesLine(r)}</span>
        <span class="why ${tone}">${esc(text)}</span>
        ${score === null || score === undefined ? '<span></span>' : `<span class="score ${scoreTone}" title="Outlook: ${esc(r.prediction?.label ?? '')}">${score}</span>`}
      </a>`;
    })
    .join('')}</div>`;
}
// ——— The table view: a heading for every column, sorted by a click, filtered column by column, exported ———
const n0 = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
/** The Salesforce close date: days to go, amber when the POV ends after it, grey when typed rather than from a report. */
function closeCell(r) {
  if (!r.closeDate) return '—';
  const left = Math.ceil((Date.parse(`${r.closeDate}T23:59:59Z`) - Date.now()) / 86400000);
  const open = !['won', 'lost'].includes(r.stage) && !/closed/i.test(r.sf?.stage ?? '');
  const late = open && r.stage === 'pov' && r.endDate && r.closeDate < r.endDate;
  const title = `${r.closeFrom === 'report' ? 'From the Salesforce report' : 'Typed on the POV'}${late ? ': the POV ends after the deal closes' : ''}`;
  return `<span title="${esc(title)}" class="${late || (open && left < 0) ? 'warn-t' : ''}">${day(r.closeDate)}</span> <span class="small ${late || (open && left < 0) ? 'warn-t' : 'muted'}">${open ? (left < 0 ? 'passed' : `${left}d`) : ''}${late ? ' · before POV end' : ''}${r.closeFrom === 'typed' ? ' · typed' : ''}</span>`;
}
/** The tenant's licence end, with the days left: amber within 14 days, ended in grey. */
function tenantEnd(end, povEnd) {
  if (!end) return '—';
  const left = Math.ceil((Date.parse(`${end}T23:59:59Z`) - Date.now()) / 86400000);
  const early = left >= 0 && povEnd && end < String(povEnd).slice(0, 10);
  return `<span${early ? ' class="warn-t" title="The tenant’s licence ends before the POV does: extend it"' : ''}>${day(end)}</span> <span class="small ${left < 0 ? 'muted' : left <= 14 || early ? 'warn-t' : 'muted'}">${left < 0 ? 'ended' : `${left}d`}${early ? ' · before POV end' : ''}</span>`;
}
const COLS = [
  { key: 'customer', label: 'Customer', on: true, filter: 'text', v: (r) => r.customer, html: (r) => `<b>${esc(r.customer)}</b>${r.name && r.name !== r.customer ? `<div class="small muted">${esc(r.name)}</div>` : ''}` },
  { key: 'se', label: 'SE', on: true, filter: 'select', v: (r) => r.owner.name },
  { key: 'manager', label: 'Manager', on: false, filter: 'select', v: (r) => r.managers?.[0]?.name ?? '' },
  { key: 'region', label: 'Region', on: true, filter: 'select', v: (r) => r.region || '' },
  { key: 'stage', label: 'Stage', on: true, filter: 'select', v: (r) => state.meta.stages[r.stage] ?? r.stage, html: (r) => stageBadge(r.stage) },
  { key: 'start', label: 'POV start', on: false, filter: 'text', v: (r) => r.startDate || '', html: (r) => (r.startDate ? day(r.startDate) : '—') },
  { key: 'end', label: 'POV end', on: true, filter: 'text', v: (r) => r.endDate || '', html: (r) => (r.endDate ? day(r.endDate) : '—') },
  { key: 'close', label: 'Close date', on: true, filter: 'text', v: (r) => r.closeDate || '', html: (r) => closeCell(r) },
  { key: 'days', label: 'Days left', on: true, num: true, filter: 'num', v: (r) => (['pov', 'technical', 'discovery', 'first_call'].includes(r.stage) ? r.daysLeft : null), html: (r) => (['pov', 'technical', 'discovery', 'first_call'].includes(r.stage) && r.daysLeft !== null ? `<span class="${r.daysLeft < 0 ? 'bad-t' : r.daysLeft <= 7 ? 'warn-t' : ''}">${r.daysLeft}</span>` : '—') },
  { key: 'criteria', label: 'Criteria met', on: true, num: true, filter: 'num', v: (r) => (r.progress.total ? Math.round((100 * r.progress.met) / r.progress.total) : null), html: (r) => (r.progress.total ? `${r.progress.met}/${r.progress.total} <span class="small muted">${Math.round((100 * r.progress.met) / r.progress.total)}%</span>` : '—') },
  { key: 'must', label: 'Must-haves', on: true, num: true, filter: 'num', v: (r) => (r.progress.must ? r.progress.mustMet : null), html: (r) => (r.progress.must ? `<span class="${r.progress.mustMet === r.progress.must ? 'ok-t' : ''}">${r.progress.mustMet}/${r.progress.must}</span>` : '—') },
  { key: 'tStart', label: 'Tenant start', on: true, filter: 'text', v: (r) => r.live?.summary?.license?.start ?? '', html: (r) => (r.live?.summary?.license?.start ? day(r.live.summary.license.start) : '—') },
  { key: 'tEnd', label: 'Tenant end', on: true, filter: 'text', v: (r) => r.live?.summary?.license?.end ?? '', html: (r) => tenantEnd(r.live?.summary?.license?.end, r.endDate) },
  { key: 'tenant', label: 'Tenant', on: true, filter: 'text', v: (r) => r.tenant?.tenant ?? '', html: (r) => (r.tenant ? esc(r.tenant.tenant) : r.stage === 'pov' ? '<span class="warn-t">not connected</span>' : '—') },
  { key: 'scans', label: 'Scans 7d', on: true, num: true, filter: 'num', v: (r) => n0(r.live?.summary?.scans7d) },
  { key: 'critical', label: 'Critical', on: true, num: true, filter: 'num', v: (r) => n0(r.live?.summary?.findings?.critical) },
  { key: 'high', label: 'High', on: false, num: true, filter: 'num', v: (r) => n0(r.live?.summary?.findings?.high) },
  { key: 'users', label: 'Users active', on: false, num: true, filter: 'num', v: (r) => n0(r.live?.summary?.users?.active), html: (r) => (r.live?.summary?.users?.total != null ? `${r.live.summary.users.active}/${r.live.summary.users.total}` : '—') },
  { key: 'credits', label: 'Credits used', on: false, num: true, filter: 'num', v: (r) => n0(r.live?.summary?.credits?.used) },
  { key: 'saved', label: 'AI saved (h)', on: false, num: true, filter: 'num', v: (r) => (r.value?.hours ? Math.round(r.value.hours) : null) },
  { key: 'outlook', label: 'Outlook', on: true, num: true, filter: 'num', v: (r) => n0(r.prediction?.score), html: (r) => { const sc = r.prediction?.score; return sc == null ? '—' : `<span class="score ${sc >= 70 ? 'ok' : sc >= 40 ? 'warn' : 'bad'}" title="${esc(r.prediction?.label ?? '')}">${sc}</span>`; } },
  { key: 'health', label: 'Health', on: true, filter: 'select', v: (r) => ({ bad: 'Needs you', warn: 'Watch', '': 'On track' })[why(r)[0]] ?? 'On track', html: (r) => { const t = why(r)[0]; return `<span class="badge ${t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : 'ok'}">${t === 'bad' ? 'Needs you' : t === 'warn' ? 'Watch' : 'On track'}</span>`; } },
  { key: 'status', label: 'What is going on', on: true, filter: 'text', v: (r) => why(r)[1], html: (r) => { const [t, x] = why(r); return `<span class="${t ? `${t}-t` : ''}">${esc(x)}</span>`; } },
  { key: 'next', label: 'Next task', on: false, filter: 'text', v: (r) => (r.nextTask ? `${r.nextTask.title}${r.nextTask.due ? ` (${r.nextTask.due})` : ''}` : '') },
  { key: 'sfStage', label: 'Salesforce stage', on: false, filter: 'select', v: (r) => r.sf?.stage ?? '' },
  { key: 'amount', label: 'Amount', on: false, num: true, filter: 'num', v: (r) => n0(r.sf?.amount ?? r.amount) },
  { key: 'note', label: 'Last note', on: false, filter: 'text', v: (r) => r.lastNoteAt ?? '', html: (r) => (r.lastNoteAt ? ago(r.lastNoteAt) : '—') },
];
// A column added since someone chose theirs is shown when it is on by default (they can hide it again).
if (ui.cols) {
  const known = new Set(ui.colsKnown ?? ui.cols);
  const added = COLS.filter((c) => c.on && !known.has(c.key)).map((c) => c.key);
  if (added.length || !ui.colsKnown) {
    ui.cols = COLS.map((c) => c.key).filter((k) => ui.cols.includes(k) || added.includes(k));
    ui.colsKnown = COLS.map((c) => c.key);
    local.set('cc.dash', ui);
  }
}
const shownCols = () => COLS.filter((c) => (ui.cols ? ui.cols.includes(c.key) : c.on));
/** "> 5", "<10", "=0" or plain text: what a filter box asks for. */
function passes(col, r, want) {
  if (!want) return true;
  const v = col.v(r);
  if (col.filter === 'select') return String(v ?? '') === want;
  if (col.filter === 'num') {
    const m = /^\s*(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)\s*$/.exec(want);
    if (!m) return String(v ?? '').includes(want);
    if (v === null || v === undefined) return false;
    const x = Number(m[2]);
    return { '>': v > x, '<': v < x, '>=': v >= x, '<=': v <= x, '=': v === x, undefined: v === x }[m[1]];
  }
  return String(v ?? '').toLowerCase().includes(want.toLowerCase());
}
function tableRows(rows) {
  const cols = shownCols();
  const f = ui.colFilter ?? {};
  let out = rows.filter((r) => cols.every((c) => passes(c, r, f[c.key])));
  const s = ui.sort && COLS.find((c) => c.key === ui.sort.key);
  if (s) {
    const dir = ui.sort.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = s.v(a);
      const y = s.v(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (s.num ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }
  return out;
}
function tableHtml(rows) {
  const cols = shownCols();
  const f = ui.colFilter ?? {};
  const list = tableRows(rows);
  const opts = (c) => [...new Set(rows.map((r) => String(c.v(r) ?? '')).filter(Boolean))].sort();
  const arrow = (c) => (ui.sort?.key === c.key ? (ui.sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  const any = Object.values(f).some(Boolean);
  return `<div class="panel ptable-wrap"><div class="ptable-meta small muted">${list.length} of ${rows.length} shown${any ? ' · <button class="btn sm ghost" data-act="clear-cols">Clear column filters</button>' : ''}<span class="spacer"></span>Filters take text, a choice, or a number like &gt;5, &lt;10, =0</div>
    <div class="ptable-scroll"><table class="ptable"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'n' : ''}"><button type="button" data-sort="${c.key}" aria-label="Sort by ${esc(c.label)}">${esc(c.label)}${arrow(c)}</button></th>`).join('')}</tr>
      <tr class="frow">${cols.map((c) => `<th>${c.filter === 'select' ? `<select data-cf="${c.key}" aria-label="Filter ${esc(c.label)}"><option value="">All</option>${opts(c).map((o) => `<option ${f[c.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input data-cf="${c.key}" value="${esc(f[c.key] ?? '')}" placeholder="${c.filter === 'num' ? '>0' : 'Filter'}" aria-label="Filter ${esc(c.label)}">`}</th>`).join('')}</tr></thead>
      <tbody>${list.map((r) => `<tr data-row="${esc(r.id)}" class="${ui.open === r.id ? 'selected' : ''}" tabindex="0">${cols.map((c) => `<td class="${c.num ? 'n' : ''}" title="${esc(String(c.v(r) ?? ''))}">${c.html ? c.html(r) : esc(c.v(r) ?? '—') || '—'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted">Nothing matches these filters.</td></tr>`}</tbody></table></div></div>`;
}
function wireTable(main, rows) {
  const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
  for (const b of main.querySelectorAll('[data-sort]'))
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      ui.sort = ui.sort?.key === k ? (ui.sort.dir === 'asc' ? { key: k, dir: 'desc' } : null) : { key: k, dir: 'asc' };
      save();
      rerender();
    });
  let timer;
  for (const el of main.querySelectorAll('[data-cf]'))
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        ui.colFilter = { ...(ui.colFilter ?? {}), [el.dataset.cf]: el.value };
        save();
        rerender();
        setTimeout(() => {
          const again = document.querySelector(`[data-cf="${el.dataset.cf}"]`);
          if (again?.tagName === 'INPUT') {
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
          }
        });
      }, el.tagName === 'SELECT' ? 0 : 300);
    });
  main.querySelector('[data-act="clear-cols"]')?.addEventListener('click', () => ((ui.colFilter = {}), save(), rerender()));
  const go = (id) => (location.hash = wide() ? `#/dashboard?open=${encodeURIComponent(id)}` : `#/opp/${encodeURIComponent(id)}`);
  for (const tr of main.querySelectorAll('tr[data-row]')) {
    tr.addEventListener('click', (e) => !e.target.closest('a,button,select,input') && go(tr.dataset.row));
    tr.addEventListener('keydown', (e) => e.key === 'Enter' && go(tr.dataset.row));
  }
  main.querySelector('[data-act="cols"]')?.addEventListener('click', () => {
    const on = new Set(shownCols().map((c) => c.key));
    openDialog(
      `<form class="dbody" id="colsForm"><h2>Columns</h2><div class="cols-pick">${COLS.map((c) => `<label class="check"><input type="checkbox" name="${c.key}" ${on.has(c.key) ? 'checked' : ''} ${c.key === 'customer' ? 'disabled checked' : ''}> ${esc(c.label)}</label>`).join('')}</div>
        <div class="dialog-actions"><button type="button" class="btn ghost" data-default>Default columns</button><span class="spacer"></span><button class="btn primary">Show</button></div></form>`,
      {
        onOpen(d) {
          const form = d.querySelector('form');
          d.querySelector('[data-default]').addEventListener('click', () => ((ui.cols = null), save(), closeDialog(), rerender()));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            ui.cols = ['customer', ...COLS.filter((c) => c.key !== 'customer' && form[c.key].checked).map((c) => c.key)];
            ui.colsKnown = COLS.map((c) => c.key);
            save();
            closeDialog();
            rerender();
          });
        },
      },
    );
  });
  main.querySelector('[data-act="csv"]')?.addEventListener('click', () => {
    const cols = shownCols();
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => cell(c.label)).join(','), ...tableRows(rows).map((r) => cols.map((c) => cell(c.v(r))).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `Kendra portfolio ${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

function groupedRows(rows) {
  const by = ui.groupBy ?? 'none';
  if (by === 'none') return rowsHtml(rows);
  const groups = new Map();
  for (const r of rows) {
    const k = groupKey(by, r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups].map(([name, list]) => `<div class="group-title"><h2>${esc(name)}</h2><span>${list.length}</span></div>${rowsHtml(list)}`).join('');
}

function wire(main, { owner, regions }) {
  const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
  let timer;
  main.querySelector('#fQ').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ui.q = e.target.value;
      save();
      rerender();
      setTimeout(() => {
        const el = document.querySelector('#fQ');
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      });
    }, 250);
  });
  for (const b of main.querySelectorAll('[data-focus]')) b.addEventListener('click', () => ((ui.focus = ui.focus === b.dataset.focus ? '' : b.dataset.focus), save(), rerender()));
  for (const b of main.querySelectorAll('[data-clear]')) b.addEventListener('click', () => ((ui[b.dataset.clear] = ''), save(), rerender()));
  main.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
    Object.assign(ui, { q: '', focus: '', owner: '', region: '', stage: '' });
    save();
    rerender();
  });
  main.querySelector('.closed-fold')?.addEventListener('toggle', (e) => ((ui.showClosed = e.target.open), save()));
  for (const b of main.querySelectorAll('[data-view]')) b.addEventListener('click', () => ((ui.view = b.dataset.view), save(), rerender()));
  main.querySelector('[data-act="filters"]').addEventListener('click', () => openFilters(owner, regions));
  main.querySelector('[data-act="tools"]').addEventListener('click', () => openTools());
  pageDrop();
}

/** Everything that narrows the list, in one sheet. */
function openFilters(owner, regions) {
  const sel = (name, options, value) => `<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  openDialog(
    `<form class="dbody" id="filtersForm"><h2>Filters</h2>
      <label class="field">Whose POVs<select name="owner">${peopleOptions(owner, { any: true, anyLabel: state.session.user.role === 'associate' ? 'Mine' : 'Everyone I can see' })}</select></label>
      ${regions.length > 1 ? `<label class="field">Region${sel('region', [['', 'Every region'], ...regions.map((x) => [x, x])], ui.region ?? '')}</label>` : ''}
      <label class="field">Stage${sel('stage', [['', 'Every stage'], ...Object.entries(state.meta.stages)], ui.stage ?? '')}</label>
      <label class="field">Group the list${sel('groupBy', Object.entries(GROUPS), ui.groupBy ?? 'none')}</label>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-reset>Clear all</button><span class="spacer"></span><button class="btn primary">Show</button></div>
    </form>`,
    {
      onOpen(d) {
        const f = d.querySelector('form');
        d.querySelector('[data-reset]').addEventListener('click', () => {
          Object.assign(ui, { owner: '', region: '', stage: '', groupBy: 'none' });
          save();
          closeDialog();
          document.dispatchEvent(new CustomEvent('cc:rerender'));
        });
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          Object.assign(ui, { owner: f.owner.value, region: f.region?.value ?? '', stage: f.stage.value, groupBy: f.groupBy.value });
          save();
          closeDialog();
          document.dispatchEvent(new CustomEvent('cc:rerender'));
        });
      },
    },
  );
}

/** The less frequent things to do from the list. */
function openTools() {
  openDialog(
    `<div class="dbody"><h2>More</h2>
      <nav class="more-list">
        <button type="button" data-t="sf"><span>Bring in a Salesforce report</span><small class="muted">Stage, amount and close date beside each POV</small></button>
        <button type="button" data-t="results"><span>Results pages</span><small class="muted">One per POV, to share or download</small></button>
        <button type="button" data-action="refresh-all"><span>Read every POV tenant now</span><small class="muted">Otherwise every ${state.overview?.intervalMinutes ?? 10} minutes, by itself</small></button>
      </nav>
      <div class="dialog-actions"><button class="btn" data-close>Close</button></div></div>`,
    {
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('[data-t="sf"]').addEventListener('click', () => (closeDialog(), setTimeout(() => openSfImport(), 50)));
        d.querySelector('[data-t="results"]').addEventListener('click', () => (closeDialog(), setTimeout(() => openResults(), 50)));
        d.querySelector('[data-action="refresh-all"]').addEventListener('click', () => closeDialog());
      },
    },
  );
}

// Results pages: every POV the viewer can see (with the person and stage filters applied), one per line.
async function openResults() {
  const q = new URLSearchParams();
  if (ui.owner) q.set('owner', ui.owner);
  if (ui.stage) q.set('stage', ui.stage);
  const { results } = await api(`/results?${q}`);
  const scope = [ui.owner ? state.users.find((u) => u.id === ui.owner)?.name : 'everyone you can see', ui.stage ? state.meta.stages[ui.stage] ?? 'open' : ''].filter(Boolean).join(' · ');
  await openDialog(
    `<div class="dbody"><h2>Results pages</h2>
      <p class="muted" style="margin:0">One page per POV, opening with the Checkmarx One platform slide, with only its engines and their status. Select any engine for its record. A POV marked successful also has its <b>final</b> copy, kept as it stood then. Showing ${esc(scope)}.</p>
      ${results.length ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>SE</th><th>Stage</th><th class="n">Criteria</th><th>Final copy</th><th></th></tr></thead><tbody>${results
        .map((r) => `<tr><td><b>${esc(r.customer)}</b>${r.tenant ? `<div class="small muted">${esc(r.tenant)}</div>` : ''}</td><td>${esc(r.owner)}</td><td>${esc(state.meta.stages[r.stage])}${r.povResult === 'successful' ? ' <span class="badge ok">successful</span>' : ''}</td><td class="n">${r.progress.met}/${r.progress.total}<div class="small muted">${r.progress.percent}%</div></td><td class="small">${r.finalAt ? `${esc(when(r.finalAt))}` : '<span class="muted">—</span>'}</td><td><div class="row" style="flex-wrap:nowrap"><a class="btn sm" href="/api/opportunities/${esc(r.id)}/results" target="_blank" rel="noopener">Open</a>${r.finalAt ? `<a class="btn sm" href="/api/opportunities/${esc(r.id)}/results?final=1" target="_blank" rel="noopener">Final</a>` : ''}<button class="btn sm" data-dl="${esc(r.id)}" data-final="${r.finalAt ? 1 : ''}">Download</button></div></td></tr>`)
        .join('')}</tbody></table></div>` : '<p class="empty">No POV with success criteria yet.</p>'}
      <div class="dialog-actions"><button class="btn ghost" data-close>Close</button>${results.length ? `<button class="btn primary" data-all>Download all (${results.length}) as .zip</button>` : ''}</div></div>`,
    {
      wide: true,
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('[data-all]')?.addEventListener('click', () => attempt(() => download(`/results/download?${q}`), 'Downloaded'));
        for (const b of d.querySelectorAll('[data-dl]')) b.addEventListener('click', () => attempt(() => download(`/opportunities/${b.dataset.dl}/results?download=1${b.dataset.final ? '&final=1' : ''}`), 'Downloaded'));
      },
    },
  );
}

const GROUPS = { none: 'One list', owner: 'By SE', team: 'By team', region: 'By region', stage: 'By stage', outlook: 'By outlook' };
const groupKey = (by, r) => (by === 'owner' ? r.owner.name : by === 'team' ? r.managers[0]?.name ?? r.owner.name : by === 'region' ? r.region || r.tenant?.regionLabel || 'No region' : by === 'stage' ? state.meta.stages[r.stage] : by === 'outlook' ? r.prediction?.label ?? '—' : '');

export function feed(events, rows, { showOpp = true } = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const filters = [['all', 'All'], ['failed', 'Failed'], ['running', 'Running'], ['completed', 'Completed'], ['fusion', 'Fusion'], ['last', 'LAST'], ['project', 'Projects']];
  const f = ui.feed || 'all';
  const match = (e) => f === 'all' || e.kind === f || (f === 'running' && e.kind === 'queued') || (f === 'failed' && ['partial', 'canceled'].includes(e.kind)) || ((f === 'fusion' || f === 'last') && e.scanType === f);
  const list = events.filter(match).slice(0, 150);
  const fresh = (e) => lastSeen && Date.parse(e.at) > lastSeen;
  const n = events.filter(fresh).length;
  return `<div class="filters">${filters.map(([k, l]) => `<button class="filter" data-feed="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}${n ? `<span class="small muted" style="margin-left:auto">${n} new since your last visit</span>` : ''}</div>
    <ul class="feed">${
      list.length
        ? list
            .map((e) => {
              const [icon, label] = KIND[e.kind] ?? KIND.other;
              const r = byId.get(e.povId);
              const meta = [showOpp && r ? r.customer : '', e.branch, e.initiator, e.origin, (e.engines ?? []).join(', ')].filter(Boolean).join(' · ');
              return `<li class="${fresh(e) ? 'fresh' : ''}" ${showOpp ? `data-go="#/opp/${esc(e.povId)}/tenant"` : ''}>
                <span class="icon k-${e.kind}">${icon}</span>
                <div><div class="t">${esc(label)} · <b>${esc(e.project || e.projectId)}</b> ${scanTypeBadge(e.scanType)}</div><div class="m">${esc(meta)}</div>${e.reason ? `<div class="m bad-t">${esc(e.reason)}</div>` : ''}</div>
                <span class="when" title="${esc(when(e.at))}">${ago(e.at)}</span></li>`;
            })
            .join('')
        : '<li style="display:block" class="empty">Nothing here yet.</li>'
    }</ul>`;
}

// ——— Salesforce report: a file dropped here (or chosen) is matched to the POVs by their Opportunity ID ———
export const sfMoney = (a) => (a?.value ? `${a.currency && a.currency !== 'USD' ? `${a.currency} ` : '$'}${a.value >= 1e6 ? `${(a.value / 1e6).toFixed(1)}M` : a.value >= 1e3 ? `${Math.round(a.value / 1e3)}k` : Math.round(a.value)}` : '');

async function uploadReport(file) {
  if (!/\.(xlsx|csv|html?)$/i.test(file.name)) throw new Error('Use the report exported from Salesforce as .xlsx or .csv.');
  const res = await fetch('/api/salesforce/import', { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The report was not taken (${res.status}).`);
  return body;
}

function importResult(r) {
  const d = r.detail;
  return `<div class="stack" style="gap:10px">
    <div class="row center"><span class="badge ok">${r.matched} matched</span>${r.unmatched ? `<span class="badge warn">${r.unmatched} not matched</span>` : ''}<span class="small muted">${r.rows} rows · columns: ${esc(d.columns.join(', '))}</span></div>
    ${d.matched.length ? `<div class="table-wrap"><table><thead><tr><th>POV</th><th>Salesforce stage</th><th>What changed</th></tr></thead><tbody>${d.matched.map((m) => `<tr><td><a href="#/dashboard?open=${esc(m.id)}" data-close>${esc(m.customer)}</a>${m.how === 'name' ? ' <span class="small muted">(by name)</span>' : ''}</td><td>${esc(m.stage)}</td><td class="small">${m.changes.length ? esc(m.changes.join(' · ')) : '<span class="muted">nothing new</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${d.unmatched.length ? `<details><summary class="small">Not matched to a POV (${d.unmatched.length})</summary><p class="small muted">Rows for opportunities without a POV here, or whose POV has no Salesforce link. Add the opportunity’s Salesforce link (it holds the 006… ID) to the POV and bring the report in again.</p><div class="small">${d.unmatched.slice(0, 60).map((u) => esc([u.account, u.name].filter(Boolean).join(' — '))).join('<br>')}</div></details>` : ''}
  </div>`;
}

async function openSfImport(file = null) {
  const { imports } = await api('/salesforce/imports');
  await openDialog(
    `<div class="dbody stack"><h2>Salesforce report</h2>
      <p class="muted" style="margin:0">Bring Salesforce’s stage, amount, close date and next step in beside each POV — no API needed. In Salesforce, run an <b>Opportunities</b> report with the columns <b>Opportunity ID</b>, Opportunity Name, Account Name, Stage, Amount, Close Date, Probability and Next Step, then <b>Export → Details only → .xlsx</b>. Rows match a POV by the ID in its Salesforce link. Nothing is written back to Salesforce.</p>
      <label class="drop" id="sfDrop"><input type="file" id="sfFile" accept=".xlsx,.csv" hidden><b>Drop the report here</b> or click to choose it<div class="small">.xlsx or .csv · up to 15 MB · you can also drop it anywhere on the Portfolio</div></label>
      <div id="sfOut"></div>
      ${imports.length ? `<details><summary class="small">Earlier reports (${imports.length})</summary><div class="small stack" style="gap:4px;margin-top:6px">${imports.slice(0, 10).map((x) => `<div>${esc(when(x.at))} · ${esc(x.source === 'mailbox' ? 'from the report mailbox' : x.by)} · ${x.rows} rows, ${x.matched.length} of your POVs</div>`).join('')}</div></details>` : ''}
      <div class="dialog-actions"><span class="small muted">Admins can have this happen by itself: Settings → Salesforce.</span><span class="spacer"></span><button class="btn" data-close>Close</button></div></div>`,
    {
      wide: true,
      onOpen(dlg) {
        const out = dlg.querySelector('#sfOut');
        const go = async (f) => {
          out.innerHTML = '<div class="muted">Reading the report…</div>';
          try {
            const r = await uploadReport(f);
            out.innerHTML = importResult(r);
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          } catch (error) {
            out.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
          }
          for (const a of out.querySelectorAll('[data-close]')) a.addEventListener('click', () => closeDialog());
        };
        for (const b of dlg.querySelectorAll('button[data-close]')) b.addEventListener('click', () => closeDialog());
        const drop = dlg.querySelector('#sfDrop');
        dlg.querySelector('#sfFile').addEventListener('change', (e) => e.target.files[0] && go(e.target.files[0]));
        drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.remove('over');
          if (e.dataTransfer.files[0]) go(e.dataTransfer.files[0]);
        });
        if (file) go(file);
      },
    },
  );
}

/** A report dropped anywhere on the Portfolio opens the dialog with it. */
let dropWired = false;
function pageDrop() {
  if (dropWired) return;
  dropWired = true;
  const onPortfolio = () => /^#\/(dashboard)?(\?|$)/.test(location.hash || '#/') && !document.querySelector('#dialog')?.open;
  const hasFile = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let depth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!onPortfolio() || !hasFile(e)) return;
    depth += 1;
    document.body.classList.add('sf-dragging');
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('sf-dragging');
  });
  document.addEventListener('dragover', (e) => onPortfolio() && hasFile(e) && e.preventDefault());
  document.addEventListener('drop', (e) => {
    depth = 0;
    document.body.classList.remove('sf-dragging');
    if (!onPortfolio() || !e.dataTransfer?.files?.[0]) return;
    e.preventDefault();
    openSfImport(e.dataTransfer.files[0]);
  });
}
