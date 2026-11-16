// The portfolio: every opportunity the viewer can see. Associates get detailed cards; managers get line items
// they can filter by person, stage and words, grouped by person, and drill into.
import { esc, fmt, api, state, local, openDialog, closeDialog, download, attempt, ago, when, day, toast, tc, HEALTH, KIND, sevBar, sevLegend, spark, progressBar, ring, forecastLine, scanTypeBadge, stageBadge, daysBadge, alertList, table, peopleOptions, can } from '../core.js';

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
  const view = ui.view || defaultView();
  const t = o.totals;

  if (!o.rows.length && !owner) {
    main.innerHTML = `<div class="hero-empty"><h1>Every opportunity, in one place</h1><p>Start with the discovery: log the opportunity, what the customer asked for and the success criteria they want to see. When the POV starts, paste the tenant's Checkmarx One API key: Meridian reads it every ${o.intervalMinutes} minutes and shows its scans, failures, Fusion and LAST scans, credits and the integrations already tested.</p>${can('opps.create') ? '<button class="btn primary" data-action="new-opp">New opportunity</button>' : ''}</div>`;
    return;
  }

  const q = (ui.q ?? '').toLowerCase();
  const regions = [...new Set(o.rows.map((r) => r.region || 'No region'))].sort();
  if (ui.region && !regions.includes(ui.region)) ui.region = '';
  const rows = o.rows.filter((r) => (!ui.stage || r.stage === ui.stage || (ui.stage === 'open' && !['won', 'lost'].includes(r.stage))) && (!ui.attention || (!r.muted && r.alerts.length)) && (!ui.region || (r.region || 'No region') === ui.region) && (!q || [r.customer, r.name, r.owner.name, r.tenant?.tenant, ...r.managers.map((m) => m.name)].join(' ').toLowerCase().includes(q)));
  const rank = (r) => (r.muted ? 5 : r.alerts.some((a) => a.level === 'bad') ? 0 : r.alerts.length ? 1 : r.stage === 'pov' ? 2 : ['won', 'lost'].includes(r.stage) ? 4 : 3);
  rows.sort((a, b) => rank(a) - rank(b) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.customer.localeCompare(b.customer));

  const kpi = (label, value, cls = '', sub = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const stageCount = (k) => t.byStage[k] ?? 0;
  main.innerHTML = `
    <div class="toolbar">
      <select id="fOwner" aria-label="Whose work">${peopleOptions(owner, { any: true, anyLabel: state.session.user.role === 'associate' ? 'My work' : 'Everyone I can see' })}</select>
      ${regions.length > 1 ? `<select id="fRegion" aria-label="Region"><option value="">Every region</option>${regions.map((x) => `<option ${ui.region === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
      <input type="search" id="fQ" placeholder="Search customer, SE, tenant…" value="${esc(ui.q ?? '')}">
      <label class="check"><input type="checkbox" id="fAttention" ${ui.attention ? 'checked' : ''}> Needs attention only</label>
      <span class="spacer"></span>
      ${view === 'table' ? `<select id="fGroup" aria-label="Group">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${(ui.groupBy ?? 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
      <button class="btn" data-act="sf-import" title="Bring in a Salesforce opportunities report (.xlsx or .csv)">Salesforce report</button>
      <button class="btn" data-act="results">Results pages</button>
      <div class="seg" role="group" aria-label="View"><button data-view="cards" aria-pressed="${view === 'cards'}">Cards</button><button data-view="table" aria-pressed="${view === 'table'}">Line items</button></div>
    </div>
    <div class="pipeline" role="group" aria-label="Stage">
      <button data-stage="" aria-pressed="${!ui.stage}"><b>${t.opportunities}</b><span>All</span></button>
      <button data-stage="open" aria-pressed="${ui.stage === 'open'}"><b>${t.opportunities - stageCount('won') - stageCount('lost')}</b><span>Open</span></button>
      ${Object.entries(state.meta.stages).map(([k, label]) => `<button data-stage="${k}" aria-pressed="${ui.stage === k}"><b>${stageCount(k)}</b><span>${esc(label)}</span></button>`).join('')}
    </div>
    ${figureGroups(t, o.forecast)}
    <div class="layout${view === 'table' ? ' layout-list' : ''}">
      <div class="stack">${rows.length ? (view === 'cards' ? cards(rows) : lineItems(rows, ui.groupBy ?? 'none')) : '<div class="empty panel">Nothing matches.</div>'}</div>
      ${sidePanel(o)}
    </div>`;

  wire(main);
}

function wire(main) {
  const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
  main.querySelector('#fRegion')?.addEventListener('change', (e) => ((ui.region = e.target.value), save(), rerender()));
  main.querySelector('#fOwner').addEventListener('change', (e) => ((ui.owner = e.target.value), save(), rerender()));
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
  main.querySelector('#fAttention').addEventListener('change', (e) => ((ui.attention = e.target.checked), save(), rerender()));
  main.querySelector('#fGroup')?.addEventListener('change', (e) => ((ui.groupBy = e.target.value), save(), rerender()));
  for (const b of main.querySelectorAll('[data-view]')) b.addEventListener('click', () => ((ui.view = b.dataset.view), save(), rerender()));
  for (const b of main.querySelectorAll('[data-stage]')) b.addEventListener('click', () => ((ui.stage = b.dataset.stage), save(), rerender()));
  for (const b of main.querySelectorAll('[data-feed]')) b.addEventListener('click', () => ((ui.feed = b.dataset.feed), save(), rerender()));
  for (const b of main.querySelectorAll('[data-fold]'))
    b.addEventListener('click', () => {
      ui.folded = { won: true, lost: true, ...(ui.folded ?? {}) };
      ui.folded[b.dataset.fold] = !ui.folded[b.dataset.fold];
      save();
      rerender();
    });
  main.querySelector('[data-act="results"]')?.addEventListener('click', () => openResults(main));
  main.querySelector('[data-act="sf-import"]')?.addEventListener('click', () => openSfImport());
  pageDrop();
  for (const b of main.querySelectorAll('[data-side]')) b.addEventListener('click', () => ((ui.side = b.dataset.side), save(), rerender()));
}

// Cards come in buckets by stage: what is live first, closed deals folded away.
const BUCKETS = ['pov', 'completed', 'technical', 'discovery', 'on_hold', 'won', 'lost'];
const BUCKET_NOTE = { pov: 'Tenant read every few minutes', completed: 'Awaiting the decision', technical: 'Sessions and integration work', discovery: 'Before the POV', on_hold: '', won: '', lost: '' };
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

// The figures, grouped by the question each answers, each group with its own colour.
function figureGroups(t, f) {
  const v = t.value ?? {};
  const cur = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: v.currency || 'USD', maximumFractionDigits: 0 }).format(n));
  const fig = (value, label, cls = '') => `<div class="${cls}"><b>${value}</b><span>${label}</span></div>`;
  const grp = (key, title, figs) => `<div class="ins-group g-${key}"><div class="ins-label">${title}</div><div class="ins-figs">${figs.join('')}</div></div>`;
  return `<section class="ins-hero dash-hero">
    ${grp('gaps', 'Needs you', [fig(t.needsAttention, 'need attention', t.needsAttention ? 'bad-t' : 'ok-t'), fig(t.endingSoon, 'end within 7 days', t.endingSoon ? 'warn-t' : '')])}
    ${grp('outlook', 'Outlook', [fig(f?.onTrack ?? 0, 'on track', 'ok-t'), fig(f?.atRisk ?? 0, 'at risk', (f?.atRisk ?? 0) ? 'warn-t' : ''), fig(f?.late ?? 0, 'late', (f?.late ?? 0) ? 'bad-t' : '')])}
    ${grp('tenants', 'Tenants today', [fig(fmt(t.scans24h), `scans${t.failed24h ? `, <span class="bad-t">${fmt(t.failed24h)} failed</span>` : ''}`), fig(fmt(t.running), 'running now'), fig(t.usersTotal !== null ? `${fmt(t.usersActive)}<small>/${fmt(t.usersTotal)}</small>` : '—', 'people active')])}
    ${grp('ai', 'Fusion · 7 days', [fig(fmt(t.fusion7d), 'Fusion scans'), fig(fmt(t.last7d), 'LAST scans')])}
    ${grp('value', 'Credits & value', [fig(fmt(t.creditsAvailable), 'credits left'), fig(fmt(v.hours ?? 0), 'hours saved by AI', 'ok-t'), fig(cur(v.value), 'value delivered', 'ok-t')])}
    ${grp('pipeline', 'Success criteria', [fig(t.criteriaTotal ? `${Math.round((100 * t.criteriaMet) / t.criteriaTotal)}%` : '—', `${t.criteriaMet} of ${t.criteriaTotal} done`)])}
  </section>`;
}

// The forecast strip: where the POVs are heading, across everything shown.
function missionStrip(f) {
  if (!f || !f.povs) return '';
  const cell = (label, value, cls = '', sub = '', go = '') => `<div class="ms-cell ${cls}" ${go ? `data-go="${go}" tabindex="0"` : ''}><div class="ms-label">${label}</div><div class="ms-value">${value}</div>${sub ? `<div class="ms-sub">${sub}</div>` : ''}</div>`;
  return `<section class="mission" aria-label="Forecast">
    <div class="ms-title"><span class="ms-pulse"></span>Forecast<span class="ms-note">at the current pace</span></div>
    ${cell('On track', fmt(f.onTrack), 'ok', `of ${f.povs} POVs`)}
    ${cell('At risk', fmt(f.atRisk), f.atRisk ? 'warn' : '', 'pace below what is needed')}
    ${cell('Late', fmt(f.late), f.late ? 'bad' : '', 'past or beyond the end date')}
    ${cell('Finishing this month', fmt(f.finishingThisMonth), '', 'criteria all completed')}
    ${cell('Shortest credits runway', f.shortestRunway ? `${fmt(f.shortestRunway.days)} d` : '—', f.shortestRunway && f.shortestRunway.days < 14 ? 'warn' : '', f.shortestRunway ? esc(f.shortestRunway.customer) : 'no burn yet', f.shortestRunway ? `#/opp/${esc(f.shortestRunway.id)}/tenant` : '')}
    ${cell('Next POV end', f.nextEnd ? (f.nextEnd.days <= 0 ? 'today' : `T−${fmt(f.nextEnd.days)} d`) : '—', f.nextEnd && f.nextEnd.days <= 3 ? 'warn' : '', f.nextEnd ? esc(f.nextEnd.customer) : '', f.nextEnd ? `#/opp/${esc(f.nextEnd.id)}` : '')}
  </section>`;
}

function cards(rows) {
  const folded = ui.folded ?? { won: true, lost: true };
  return BUCKETS.map((stage) => {
    const list = rows.filter((r) => r.stage === stage);
    if (!list.length) return '';
    const bad = list.filter((r) => !r.muted && r.alerts.some((a) => a.level === 'bad')).length;
    const closed = folded[stage];
    return `<section class="bucket bucket-${stage}">
      <button class="bucket-head" data-fold="${stage}" aria-expanded="${!closed}">
        <span class="fold">${closed ? '▸' : '▾'}</span><h2>${esc(state.meta.stages[stage])}</h2><span class="badge">${list.length}</span>${bad ? `<span class="badge bad">${bad} need attention</span>` : ''}<span class="small muted">${esc(BUCKET_NOTE[stage])}</span>
      </button>
      ${closed ? '' : `<div class="cards">${list.map(card).join('')}</div>`}
    </section>`;
  }).join('');
}

function card(r) {
  const s = r.live?.summary;
  const health = r.live ? (r.live.refreshing ? 'loading' : r.live.health) : null;
  return `<article class="card ${r.muted ? 'muted-card' : ''}" style="--tc:${tc(r.colour)}" data-go="#/opp/${esc(r.id)}" tabindex="0">
    <div class="card-head">
      <div><div class="card-title">${esc(r.customer)}</div>${r.povResult === 'successful' ? '<div class="small ok-t" style="letter-spacing:.12em;text-transform:uppercase">POV successful</div>' : ''}<div class="card-sub">${esc([r.name !== r.customer ? r.name : '', r.owner.name, r.tenant ? `${r.tenant.tenant} · ${r.tenant.regionLabel}` : ''].filter(Boolean).join(' · '))}</div></div>
      <div class="badges">${daysBadge(r)}${stageBadge(r.stage)}</div>
    </div>
    <div class="card-mid">${ring(r.progress)}<div class="card-mid-text"><div class="small muted">${r.progress.total ? `${r.progress.met} of ${r.progress.total} criteria completed${r.progress.must ? ` · must-haves ${r.progress.mustMet}/${r.progress.must}` : ''}` : 'No success criteria yet'}</div>${forecastLine(r.forecast?.criteria)}${r.forecast?.credits ? `<div class="fc muted"><span class="fc-dot"></span>${esc(r.forecast.credits.label)}</div>` : ''}</div></div>
    ${health ? `<div class="health"><span class="dot ${health}"></span>${esc(HEALTH[health] ?? health)}${s?.lastActivityAt ? ` · last scan activity ${ago(s.lastActivityAt)}` : ''}</div>` : ''}
    ${
      s
        ? `<div class="stats">
      <div class="stat"><div class="v">${fmt(s.projects)}</div><div class="l">Projects${s.newProjects7d ? ` (+${s.newProjects7d})` : ''}</div></div>
      <div class="stat"><div class="v">${fmt(s.scans24h)}</div><div class="l">Scans 24h</div></div>
      <div class="stat"><div class="v">${fmt(s.running + s.queued)}</div><div class="l">Running</div></div>
      <div class="stat ${s.failed24h ? 'bad' : ''}"><div class="v">${fmt(s.failed24h)}</div><div class="l">Failed 24h</div></div>
    </div>
    <div class="row center small">${s.fusion7d ? `<span class="badge fusion">Fusion ${s.fusion7d}</span>` : ''}${s.last7d ? `<span class="badge last">LAST ${s.last7d}</span>` : ''}${s.credits?.available != null ? `<span class="badge">Credits ${fmt(s.credits.available)}</span>` : ''}${s.users?.total != null ? `<span class="badge ${s.users.active ? 'ok' : 'warn'}">People ${s.users.active}/${s.users.total} active</span>` : ''}${(s.origins ?? []).slice(0, 3).map((x) => `<span class="badge">${esc(x.name)}</span>`).join('')}</div>
    ${sevBar(s.findings)}${sevLegend(s.findings, s.delta)}`
        : ''
    }
    ${alertList(r.alerts, r.muted)}
    <div class="card-foot"><span>${r.progress.total ? `<a href="/api/opportunities/${esc(r.id)}/results" target="_blank" rel="noopener" class="results-link">Results ↗</a> · ` : ''}${r.nextTask ? `Next: ${esc(r.nextTask.title)}${r.nextTask.due ? ` · ${esc(r.nextTask.due)}` : ''}` : `Updated ${ago(r.updatedAt)}`}</span>${spark(r.live?.trend)}</div>
  </article>`;
}

// The manager's list: one line per POV, each column answering one question, colour only where it matters.
const OUTLOOK_TONE = { ok: 'ok', warn: 'warn', bad: 'bad' };
const outlook = (pr) => (pr ? `<span class="outlook ${OUTLOOK_TONE[pr.tone] ?? ''}" title="${esc(pr.drivers.map((d) => `${d.effect > 0 ? '+' : d.effect < 0 ? '−' : '·'} ${d.text}`).join('\n'))}"><b>${pr.score ?? '–'}</b><span>${esc(pr.label)}</span></span>` : '');
const gapCell = (r) => {
  const g = (r.gaps ?? []).filter((x) => x.level !== 'info');
  if (!g.length) return '<span class="ok-t small">No gaps</span>';
  const bad = g.filter((x) => x.level === 'bad').length;
  return `<div class="gapcell"><span class="badge ${bad ? 'bad' : 'warn'}">${g.length} gap${g.length > 1 ? 's' : ''}</span><div class="small ${bad ? 'bad-t' : 'warn-t'}">${esc(g[0].text.length > 70 ? `${g[0].text.slice(0, 68)}…` : g[0].text)}</div></div>`;
};
export const COLUMNS = [
  { label: 'POV', key: (r) => r.customer, html: (r) => `<div class="row center" style="gap:10px;flex-wrap:nowrap"><span class="chip" style="background:${tc(r.colour)}"></span><div><b>${esc(r.customer)}</b><div class="small muted">${esc([r.tenant ? `${r.tenant.tenant} · ${r.tenant.regionLabel}` : 'no tenant', r.region].filter(Boolean).join(' · '))}</div></div></div>` },
  { label: 'SE', key: (r) => r.owner.name, html: (r) => `${esc(r.owner.name)}${r.managers[0] ? `<div class="small muted">${esc(r.managers[0].name)}</div>` : ''}` },
  { label: 'Stage', key: (r) => Object.keys(state.meta.stages).indexOf(r.stage), html: (r) => `${stageBadge(r.stage)} ${daysBadge(r)}${r.sf ? `<div class="small muted sf-line" title="Salesforce, from the report of ${esc(when(r.sf.reportAt))}">SF · ${esc([r.sf.stage, sfMoney(r.sf.amount)].filter(Boolean).join(' · '))}</div>` : ''}` },
  { label: 'Outlook', key: (r) => r.prediction?.score ?? 200, html: (r) => outlook(r.prediction) },
  { label: 'Criteria', key: (r) => r.progress.percent, html: (r) => (r.progress.total ? `<div class="row center" style="gap:8px;flex-wrap:nowrap">${ring(r.progress, { size: 34, label: false })}<div><b class="num">${r.progress.met}/${r.progress.total}</b>${r.forecast?.criteria ? `<div class="small fc-${esc(r.forecast.criteria.state)}">${esc(shortForecast(r.forecast.criteria))}</div>` : ''}</div></div>` : '<span class="muted small">none yet</span>') },
  { label: 'Gaps', key: (r) => -((r.gaps ?? []).filter((x) => x.level === 'bad').length * 10 + (r.gaps ?? []).filter((x) => x.level === 'warn').length), html: gapCell },
  { label: 'Tenant', key: (r) => (r.live?.summary ? r.live.summary.scans24h : -1), html: (r) => (r.live ? `<span class="health"><span class="dot ${r.live.refreshing ? 'loading' : r.live.health}"></span>${r.live.summary ? `${fmt(r.live.summary.scans24h)} scans today${r.live.summary.failed24h ? ` · <span class="bad-t">${r.live.summary.failed24h} failed</span>` : ''}` : esc(HEALTH[r.live.health])}</span><div class="small muted">${r.live.summary?.lastActivityAt ? `active ${ago(r.live.summary.lastActivityAt)}` : ''}${r.live.summary?.fusion7d || r.live.summary?.last7d ? ` · Fusion ${r.live.summary.fusion7d} · LAST ${r.live.summary.last7d}` : ''}</div>` : '<span class="muted small">—</span>') },
  { label: 'People', n: true, key: (r) => r.live?.summary?.users?.active ?? -1, html: (r) => (r.live?.summary?.users?.total != null ? `<b class="num">${fmt(r.live.summary.users.active)}</b><span class="muted">/${fmt(r.live.summary.users.total)}</span>` : '—') },
  { label: 'Credits · value', n: true, key: (r) => r.value?.hours.total ?? -1, html: (r) => (r.value ? `<b class="num">${fmt(r.value.credits?.available)}</b> <span class="muted small">left</span><div class="small ok-t">${fmt(r.value.hours.total)} h saved</div>` : '—') },
];
const shortForecast = (f) => (f.state === 'on-track' ? `on pace${f.marginDays !== null && f.marginDays !== undefined ? `, ${f.marginDays} d spare` : ''}` : f.state === 'late' ? (f.marginDays !== undefined && f.marginDays !== null ? `${-f.marginDays} d late` : 'late') : f.state === 'done' ? 'all done' : f.state === 'at-risk' ? 'at risk' : f.state === 'no-pace' ? 'none done yet' : '');

const GROUPS = { none: 'No grouping', owner: 'By SE', team: 'By team', region: 'By region', stage: 'By stage', outlook: 'By outlook' };
const groupKey = (by, r) => (by === 'owner' ? r.owner.name : by === 'team' ? r.managers[0]?.name ?? r.owner.name : by === 'region' ? r.region || r.tenant?.regionLabel || 'No region' : by === 'stage' ? state.meta.stages[r.stage] : by === 'outlook' ? r.prediction?.label ?? '—' : '');

function lineItems(rows, by) {
  const attrs = (r) => `class="click${ui.open === r.id ? ' selected' : ''}" data-go="#/dashboard?open=${esc(r.id)}" tabindex="0"`;
  if (!by || by === 'none') return `<section class="panel list-panel">${table('dash', COLUMNS, rows, { rowAttrs: attrs })}</section>`;
  const groups = new Map();
  for (const r of rows) {
    const k = groupKey(by, r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups]
    .map(([name, list]) => {
      const bad = list.filter((r) => (r.gaps ?? []).some((g) => g.level === 'bad')).length;
      const scored = list.filter((r) => r.prediction?.score !== null && r.prediction?.score !== undefined && !['won', 'lost'].includes(r.stage));
      const expected = scored.reduce((t, r) => t + r.prediction.score / 100, 0);
      const likely = scored.filter((r) => r.prediction.score >= 70).length;
      return `<section class="panel list-panel"><div class="head"><div class="row center"><h3>${esc(name)}</h3><span class="muted small">${list.length} POV${list.length > 1 ? 's' : ''}</span></div><div class="row center small">${scored.length ? `<span class="badge ok">${likely} likely</span><span class="badge">${Math.round(expected * 10) / 10} expected wins</span>` : ''}${bad ? `<span class="badge bad">${bad} with critical gaps</span>` : ''}</div></div>${table('dash', by === 'owner' ? COLUMNS.filter((c) => c.label !== 'SE') : COLUMNS, list, { rowAttrs: attrs })}</section>`;
    })
    .join('');
}

function sidePanel(o) {
  const side = ui.side || 'tenant';
  return `<section class="panel">
    <div class="head"><div class="seg" role="tablist"><button data-side="tenant" aria-pressed="${side === 'tenant'}">Tenant activity</button><button data-side="team" aria-pressed="${side === 'team'}">Team activity</button></div><span class="small muted">${side === 'tenant' ? 'last 7 days' : 'in Meridian'}</span></div>
    ${side === 'tenant' ? feed(o.events, o.rows) : teamFeed(o.activity)}
  </section>`;
}

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

function teamFeed(activity) {
  return `<ul class="feed">${
    activity.length
      ? activity.map((a) => `<li data-go="#/opp/${esc(a.oppId)}"><span class="icon">✎</span><div><div class="t">${esc(a.what)}</div><div class="m">${esc(a.opp)}${a.byName ? ` · ${esc(a.byName)}` : ''}</div></div><span class="when" title="${esc(when(a.at))}">${ago(a.at)}</span></li>`).join('')
      : '<li style="display:block" class="empty">No changes yet.</li>'
  }</ul>`;
}

// ——— Salesforce report: a file dropped here (or chosen) is matched to the POVs by their Opportunity ID ———
export const sfMoney = (a) => (a?.value ? `${a.currency && a.currency !== 'USD' ? `${a.currency} ` : '$'}${a.value >= 1e6 ? `${(a.value / 1e6).toFixed(1)}M` : a.value >= 1e3 ? `${Math.round(a.value / 1e3)}k` : Math.round(a.value)}` : '');

async function uploadReport(file) {
  if (!/\.(xlsx|csv|html?)$/i.test(file.name)) throw new Error('Use the report exported from Salesforce as .xlsx or .csv.');
  const res = await fetch('/api/salesforce/import', { method: 'POST', headers: { 'X-Requested-With': 'Meridian', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
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
