// The command center: every opportunity the viewer can see. Associates get detailed cards; managers get line items
// they can filter by person, stage and words, grouped by person, and drill into.
import { esc, fmt, api, state, local, ago, when, tc, HEALTH, KIND, sevBar, sevLegend, spark, progressBar, ring, forecastLine, scanTypeBadge, stageBadge, daysBadge, alertList, table, peopleOptions, can } from '../core.js';

const lastSeen = local.get('cc.lastSeen', 0);
const markSeen = () => local.set('cc.lastSeen', Date.now());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && markSeen());
addEventListener('pagehide', markSeen);

const ui = local.get('cc.dash', {});
const save = () => local.set('cc.dash', ui);
const defaultView = () => state.session.user.prefs?.view || (state.session.user.role === 'associate' ? 'cards' : 'table');

export async function renderDashboard(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Command center</h2>');
  const owner = ui.owner && state.users.some((u) => u.id === ui.owner) ? ui.owner : '';
  state.overview = await api(`/overview${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`);
  const o = state.overview;
  const view = ui.view || defaultView();
  const t = o.totals;

  if (!o.rows.length && !owner) {
    main.innerHTML = `<div class="hero-empty"><h1>Every opportunity, in one place</h1><p>Start with the discovery: log the opportunity, what the customer asked for and the success criteria they want to see. When the POV starts, paste the tenant's Checkmarx One API key: CommandCenter reads it every ${o.intervalMinutes} minutes and shows its scans, failures, Fusion and LAST scans, credits and the integrations already tested.</p>${can('opps.create') ? '<button class="btn primary" data-action="new-opp">New opportunity</button>' : ''}</div>`;
    return;
  }

  const q = (ui.q ?? '').toLowerCase();
  const rows = o.rows.filter((r) => (!ui.stage || r.stage === ui.stage || (ui.stage === 'open' && !['won', 'lost'].includes(r.stage))) && (!ui.attention || (!r.muted && r.alerts.length)) && (!q || [r.customer, r.name, r.owner.name, r.tenant?.tenant, ...r.managers.map((m) => m.name)].join(' ').toLowerCase().includes(q)));
  const rank = (r) => (r.muted ? 5 : r.alerts.some((a) => a.level === 'bad') ? 0 : r.alerts.length ? 1 : r.stage === 'pov' ? 2 : ['won', 'lost'].includes(r.stage) ? 4 : 3);
  rows.sort((a, b) => rank(a) - rank(b) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.customer.localeCompare(b.customer));

  const kpi = (label, value, cls = '', sub = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const stageCount = (k) => t.byStage[k] ?? 0;
  main.innerHTML = `
    <div class="toolbar">
      <select id="fOwner" aria-label="Whose work">${peopleOptions(owner, { any: true, anyLabel: state.session.user.role === 'associate' ? 'My work' : 'Everyone I can see' })}</select>
      <input type="search" id="fQ" placeholder="Search customer, SE, tenant…" value="${esc(ui.q ?? '')}">
      <label class="check"><input type="checkbox" id="fAttention" ${ui.attention ? 'checked' : ''}> Needs attention only</label>
      <span class="spacer"></span>
      ${view === 'table' ? `<label class="check"><input type="checkbox" id="fGroup" ${ui.group !== false ? 'checked' : ''}> Group by person</label>` : ''}
      <div class="seg" role="group" aria-label="View"><button data-view="cards" aria-pressed="${view === 'cards'}">Cards</button><button data-view="table" aria-pressed="${view === 'table'}">Line items</button></div>
    </div>
    <div class="pipeline" role="group" aria-label="Stage">
      <button data-stage="" aria-pressed="${!ui.stage}"><b>${t.opportunities}</b><span>All</span></button>
      <button data-stage="open" aria-pressed="${ui.stage === 'open'}"><b>${t.opportunities - stageCount('won') - stageCount('lost')}</b><span>Open</span></button>
      ${Object.entries(state.meta.stages).map(([k, label]) => `<button data-stage="${k}" aria-pressed="${ui.stage === k}"><b>${stageCount(k)}</b><span>${esc(label)}</span></button>`).join('')}
    </div>
    <div class="kpis">
      ${kpi('Need attention', t.needsAttention, t.needsAttention ? 'bad' : '')}
      ${kpi('Ending ≤ 7 days', t.endingSoon, t.endingSoon ? 'warn' : '')}
      ${kpi('Scans running', fmt(t.running))}
      ${kpi('Scans 24h', fmt(t.scans24h), '', `${fmt(t.failed24h)} failed`)}
      ${kpi('Fusion / LAST', `${fmt(t.fusion7d)} / ${fmt(t.last7d)}`)}
      ${kpi('Credits', fmt(t.creditsAvailable), '', t.creditsUsed30d !== null ? `${fmt(Math.round(t.creditsUsed30d))} used in 30 d` : '')}
      ${kpi('People active', t.usersTotal !== null ? `${fmt(t.usersActive)} / ${fmt(t.usersTotal)}` : '—', '', 'last 2 days')}
      ${kpi('Critical / High', `${fmt(t.critical)} / ${fmt(t.high)}`)}
      ${kpi('Criteria done', t.criteriaTotal ? `${Math.round((100 * t.criteriaMet) / t.criteriaTotal)}%` : '—', '', `${t.criteriaMet} of ${t.criteriaTotal}`)}
    </div>
    ${missionStrip(o.forecast)}
    <div class="layout">
      <div class="stack">${rows.length ? (view === 'cards' ? cards(rows) : lineItems(rows, ui.group !== false)) : '<div class="empty panel">Nothing matches.</div>'}</div>
      ${sidePanel(o)}
    </div>`;

  wire(main);
}

function wire(main) {
  const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
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
  main.querySelector('#fGroup')?.addEventListener('change', (e) => ((ui.group = e.target.checked), save(), rerender()));
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
  for (const b of main.querySelectorAll('[data-side]')) b.addEventListener('click', () => ((ui.side = b.dataset.side), save(), rerender()));
}

// Cards come in buckets by stage: what is live first, closed deals folded away.
const BUCKETS = ['pov', 'completed', 'technical', 'discovery', 'on_hold', 'won', 'lost'];
const BUCKET_NOTE = { pov: 'Tenant read every few minutes', completed: 'Awaiting the decision', technical: 'Sessions and integration work', discovery: 'Before the POV', on_hold: '', won: '', lost: '' };
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
    <div class="card-foot"><span>${r.nextTask ? `Next: ${esc(r.nextTask.title)}${r.nextTask.due ? ` · ${esc(r.nextTask.due)}` : ''}` : `Updated ${ago(r.updatedAt)}`}</span>${spark(r.live?.trend)}</div>
  </article>`;
}

const COLUMNS = [
  { label: 'Opportunity', key: (r) => r.customer, html: (r) => `<div class="row center" style="gap:8px;flex-wrap:nowrap"><span class="chip" style="background:${tc(r.colour)}"></span><div><b>${esc(r.customer)}</b>${r.name !== r.customer ? `<div class="small muted">${esc(r.name)}</div>` : ''}${r.tenant ? `<div class="small muted">${esc(r.tenant.tenant)} · ${esc(r.tenant.regionLabel)}</div>` : ''}</div></div>` },
  { label: 'SE', key: (r) => r.owner.name, html: (r) => `${esc(r.owner.name)}${r.managers[0] ? `<div class="small muted">→ ${esc(r.managers[0].name)}</div>` : ''}` },
  { label: 'Stage', key: (r) => Object.keys(state.meta.stages).indexOf(r.stage), html: (r) => `${stageBadge(r.stage)} ${daysBadge(r)}` },
  { label: 'Criteria', n: true, key: (r) => r.progress.percent, html: (r) => (r.progress.total ? `<b>${r.progress.percent}%</b><div class="small muted">${r.progress.met}/${r.progress.total}</div>` : '—') },
  { label: 'Forecast', key: (r) => ({ late: 0, 'at-risk': 1, 'no-pace': 2, 'on-track': 3, done: 4 })[r.forecast?.criteria?.state] ?? 5, html: (r) => forecastLine(r.forecast?.criteria) || '<span class="muted small">—</span>' },
  { label: 'Health', key: (r) => (r.muted ? 9 : r.alerts.filter((a) => a.level === 'bad').length * -10 - r.alerts.length), html: (r) => (r.alerts.length ? `<div class="alerts">${r.alerts.slice(0, 2).map((a) => `<div class="a ${r.muted ? 'muted' : a.level === 'bad' ? 'bad-t' : 'warn-t'}"><span class="dot ${r.muted ? '' : a.level}"></span>${esc(a.what)}</div>`).join('')}${r.alerts.length > 2 ? `<div class="small muted">+${r.alerts.length - 2} more</div>` : ''}${r.muted ? '<div class="small muted">Muted</div>' : ''}</div>` : r.live ? `<span class="health"><span class="dot ${r.live.health}"></span>${esc(HEALTH[r.live.health])}</span>` : '<span class="muted small">No tenant</span>') },
  { label: 'Scans 24h', n: true, key: (r) => r.live?.summary?.scans24h ?? -1, html: (r) => (r.live?.summary ? `${fmt(r.live.summary.scans24h)}${r.live.summary.failed24h ? ` <span class="bad-t small">(${r.live.summary.failed24h} ✕)</span>` : ''}` : '—') },
  { label: 'Running', n: true, key: (r) => (r.live?.summary ? r.live.summary.running + r.live.summary.queued : -1), html: (r) => (r.live?.summary ? fmt(r.live.summary.running + r.live.summary.queued) : '—') },
  { label: 'Fusion / LAST', n: true, key: (r) => r.live?.summary?.fusion7d ?? -1, html: (r) => (r.live?.summary ? `${fmt(r.live.summary.fusion7d)} / ${fmt(r.live.summary.last7d)}` : '—') },
  { label: 'C / H', n: true, key: (r) => (r.live?.summary?.findings ? r.live.summary.findings.critical * 1000 + r.live.summary.findings.high : -1), html: (r) => (r.live?.summary?.findings ? `${fmt(r.live.summary.findings.critical)} / ${fmt(r.live.summary.findings.high)}` : '—') },
  { label: 'People', n: true, key: (r) => r.live?.summary?.users?.active ?? -1, html: (r) => (r.live?.summary?.users?.total != null ? `${fmt(r.live.summary.users.active)}/${fmt(r.live.summary.users.total)}` : '—') },
  { label: 'Credits', n: true, key: (r) => r.live?.summary?.credits?.available ?? -1, html: (r) => fmt(r.live?.summary?.credits?.available) },
  { label: 'Last activity', key: (r) => Date.parse(r.live?.summary?.lastActivityAt ?? r.updatedAt) || 0, html: (r) => `<span title="${esc(when(r.live?.summary?.lastActivityAt ?? r.updatedAt))}">${ago(r.live?.summary?.lastActivityAt ?? r.updatedAt)}</span>` },
  { label: 'Links', html: (r) => `${r.salesforceUrl ? `<a href="${esc(r.salesforceUrl)}" target="_blank" rel="noopener noreferrer" title="Salesforce">SF↗</a> ` : ''}${r.sharepointUrl ? `<a href="${esc(r.sharepointUrl)}" target="_blank" rel="noopener noreferrer" title="SharePoint">SP↗</a>` : ''}` },
];

function lineItems(rows, group) {
  const attrs = (r) => `class="click" data-go="#/opp/${esc(r.id)}"`;
  if (!group) return `<section class="panel">${table('dash', COLUMNS, rows, { rowAttrs: attrs })}</section>`;
  const byOwner = new Map();
  for (const r of rows) {
    if (!byOwner.has(r.owner.id)) byOwner.set(r.owner.id, []);
    byOwner.get(r.owner.id).push(r);
  }
  return [...byOwner.values()]
    .map((list) => {
      const r0 = list[0];
      const bad = list.filter((r) => !r.muted && r.alerts.some((a) => a.level === 'bad')).length;
      const povs = list.filter((r) => r.stage === 'pov').length;
      return `<section class="panel"><div class="head"><div class="row center"><h3>${esc(r0.owner.name)}</h3><span class="muted small">${r0.managers.map((m) => esc(m.name)).join(' → ')}</span></div><div class="row center small"><span class="badge">${list.length} opportunities</span><span class="badge accent">${povs} POVs</span>${bad ? `<span class="badge bad">${bad} need attention</span>` : ''}</div></div>${table('dash', COLUMNS.filter((c) => c.label !== 'SE'), list, { rowAttrs: attrs })}</section>`;
    })
    .join('');
}

function sidePanel(o) {
  const side = ui.side || 'tenant';
  return `<section class="panel">
    <div class="head"><div class="seg" role="tablist"><button data-side="tenant" aria-pressed="${side === 'tenant'}">Tenant activity</button><button data-side="team" aria-pressed="${side === 'team'}">Team activity</button></div><span class="small muted">${side === 'tenant' ? 'last 7 days' : 'in CommandCenter'}</span></div>
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
