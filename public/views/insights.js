// Insights: where every POV the viewer can see is heading, what moved, who carries what, and what stands in the way.
// One screen, after the best revenue and presales tools: the figures with their week's change at the top; then
// what needs attention, the forecast and what ends soon, and the team (workload, roll-ups, capabilities). The lists
// scroll inside their own panel, so the page itself does not.
import { esc, fmt, api, local, day } from '../core.js';

const ui = local.get('cc.insights', {});
const save = () => local.set('cc.insights', ui);
const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));

/** A small line of the last 30 days. */
function spark(values, tone = '') {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * 100).toFixed(1)},${(28 - ((x - min) / (max - min || 1)) * 24 - 2).toFixed(1)}`).join(' ');
  return `<svg class="spark ${tone}" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
/** The change since last week, coloured by whether up is good. */
function delta(now, before, { upGood = true, money = null } = {}) {
  if (before === null || before === undefined || now === null || now === undefined) return '<span class="kd muted">no week to compare yet</span>';
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return '<span class="kd muted">same as last week</span>';
  const good = d > 0 === upGood;
  return `<span class="kd ${good ? 'ok-t' : 'bad-t'}">${d > 0 ? '▲' : '▼'} ${money ? money(Math.abs(d)) : fmt(Math.abs(d))} since last week</span>`;
}

export async function renderInsights(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Insights</h2>');
  const q = new URLSearchParams();
  if (ui.region) q.set('region', ui.region);
  const d = await api(`/insights?${q}`);
  const t = d.totals;
  const m = d.more;
  const rv = d.revenue;
  const before = m.trend.before;
  const series = m.trend.series;
  const cur = (n) => `${rv.currency === 'USD' ? '$' : `${rv.currency} `}${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : fmt(Math.round(n))}`;
  const regions = [...new Set([...d.regions, ...d.tenantRegions])];
  const go = (id) => `#/insights?open=${encodeURIComponent(id)}`;
  const pill = (s) => (s === null || s === undefined ? '<span class="muted">—</span>' : `<span class="sc ${s >= 70 ? 'ok' : s >= 40 ? 'warn' : 'bad'}">${s}</span>`);

  // ——— The figures ———
  const kpis = [
    { label: 'Likely to succeed', hint: 'Running POVs Kendra scores 70 or more: on pace, must-haves moving, the tenant in use', value: t.likely, tone: 'ok', d: delta(t.likely, before?.likely), sp: spark(series.map((x) => x.likely), 'ok') },
    { label: 'At risk', hint: 'Running POVs Kendra scores 40 to 69: could go either way', value: t.atRisk, tone: 'warn', d: delta(t.atRisk, before?.atRisk, { upGood: false }), sp: spark(series.map((x) => x.atRisk), 'warn') },
    { label: 'Expected successes', hint: 'The sum of every running POV’s chance of success, as Kendra scores it', value: fmt(t.expectedWins), tone: '', d: delta(t.expectedWins, before?.expected), sp: spark(series.map((x) => x.expected)) },
    rv.linked
      ? { label: 'Amount at stake', hint: `The opportunity amounts from the Salesforce report imported ${rv.reportAt ? day(rv.reportAt) : ''}, each weighted by its POV’s chance of success. Kendra does not read Salesforce: these are only as current as that report.`, value: cur(rv.weighted), tone: '', d: `<span class="kd muted">from the report imported ${rv.reportAt ? esc(day(rv.reportAt)) : ''}</span>`, sp: '' }
      : { label: 'Ending in 30 days', hint: 'Running POVs that end within a month', value: t.ending30, tone: '', d: `<span class="kd muted">${fmt(t.ending30Expected)} should succeed</span>`, sp: '' },
    { label: 'Technical win rate', hint: 'POVs marked successful, of those decided', value: m.outcomes.techWinRate === null ? '—' : `${m.outcomes.techWinRate}%`, tone: m.outcomes.techWinRate >= 70 ? 'ok' : m.outcomes.techWinRate === null ? '' : 'warn', d: `<span class="kd muted">${m.outcomes.decided} decided${m.outcomes.winAfterSuccess !== null ? ` · ${m.outcomes.winAfterSuccess}% won after` : ''}${m.outcomes.avgDays ? ` · ${m.outcomes.avgDays} d a POV` : ''}</span>`, sp: '' },
    { label: 'Critical gaps', hint: 'Problems that need someone now', value: t.critical, tone: t.critical ? 'bad' : 'ok', d: delta(t.critical, before?.critical, { upGood: false }), sp: spark(series.map((x) => x.critical), t.critical ? 'bad' : 'ok') },
  ];

  // ——— Needs attention ———
  const leftTab = ['risk', 'movers', 'gaps'].includes(ui.left) ? ui.left : 'risk';
  const atRiskHtml = d.atRisk.map((r) => `<a class="irow" href="${go(r.id)}">${pill(r.score)}<span class="grow"><b>${esc(r.customer)}</b><span class="small muted">${esc(r.owner)}${r.daysLeft !== null ? ` · ${r.daysLeft < 0 ? `${-r.daysLeft} d over` : `${r.daysLeft} d left`}` : ''}</span><span class="small why">${r.why.map(esc).join(' · ')}</span></span></a>`).join('') || '<p class="ok-t pad">Nothing at risk.</p>';
  const moversHtml = m.movers.map((x) => `<a class="irow" href="${go(x.id)}"><span class="mv ${x.delta > 0 ? 'ok-t' : 'bad-t'}">${x.delta > 0 ? '▲' : '▼'}${Math.abs(x.delta)}</span><span class="grow"><b>${esc(x.customer)}</b><span class="small muted">${esc(x.owner)} · ${x.from} → ${x.to}</span>${x.why ? `<span class="small why">${esc(x.why)}</span>` : ''}</span></a>`).join('') || `<p class="muted pad">${m.trend.since ? 'No POV moved by 5 points or more since last week.' : 'Movers show once a week of readings is kept (one is taken every day).'}</p>`;
  const gapsHtml = d.commonGaps.map((g) => `<div class="irow"><span class="dot ${g.level}"></span><span class="grow">${esc(g.text)}</span><b class="num">${g.count}</b></div>`).join('') || '<p class="ok-t pad">No gaps right now.</p>';

  // ——— Forecast ———
  const c = m.categories;
  const n = Math.max(1, c.commit.count + c.best.count + c.pipeline.count);
  const catRow = (k, label, tone, x) => `<div class="cat"><span class="cl"><i class="${tone}"></i>${label}</span><b>${x.count}</b><span class="muted small">${rv.linked && x.amount ? cur(x.amount) : ''}</span></div>`;
  const endingHtml = m.ending.map((e) => `<a class="irow" href="${go(e.id)}"><span class="when"><b>${e.daysLeft}</b><span>d</span></span><span class="grow"><b>${esc(e.customer)}</b><span class="small muted">${esc(e.owner)} · ${esc(day(e.endDate))} · ${e.met}/${e.total} criteria${rv.linked && e.amount ? ` · ${cur(e.amount)}` : ''}</span></span>${pill(e.score)}</a>`).join('') || '<p class="muted pad">No POV ends in the next 30 days.</p>';

  // ——— Team ———
  const rightTab = ['load', 'rollup', 'caps'].includes(ui.right) ? ui.right : 'load';
  const LOAD = { stretched: ['bad', 'Stretched'], busy: ['warn', 'Busy'], room: ['ok', 'Has room'] };
  const loadHtml = `<table class="itable"><thead><tr><th>SE</th><th class="n" title="POVs running">Running</th><th class="n" title="Ending within 14 days">≤14 d</th><th class="n" title="Must-haves still open">Musts</th><th class="n" title="Average score of their running POVs">Score</th><th></th></tr></thead><tbody>${m.workload.map((w) => `<tr><td><b>${esc(w.name)}</b>${w.critical ? `<span class="crit" title="Critical gaps in their POVs">${w.critical}</span>` : ''}</td><td class="n">${w.running}</td><td class="n">${w.endingSoon}</td><td class="n">${w.openMust}</td><td class="n">${pill(w.avgScore)}</td><td><span class="badge ${LOAD[w.load][0]}">${LOAD[w.load][1]}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nobody carries a POV.</td></tr>'}</tbody></table>`;
  const BY = [['region', 'Region'], ['team', 'Team'], ['se', 'SE'], ['tenant', 'Tenant region']];
  const by = BY.some(([k]) => k === ui.by) ? ui.by : 'region';
  const rows = { region: d.byRegion, team: d.byTeam, se: d.bySe, tenant: d.byTenantRegion }[by];
  const obar = (g) => {
    const s = Math.max(1, g.likely + g.atRisk + g.unlikely);
    return `<div class="obar" title="${g.likely} likely · ${g.atRisk} at risk · ${g.unlikely} unlikely"><span class="ok" style="flex:${g.likely / s}"></span><span class="warn" style="flex:${g.atRisk / s}"></span><span class="bad" style="flex:${g.unlikely / s}"></span></div>`;
  };
  const rollHtml = `<div class="seg mini" role="group" aria-label="Group by">${BY.map(([k, l]) => `<button data-by="${k}" aria-pressed="${by === k}">${l}</button>`).join('')}</div>
    <table class="itable"><thead><tr><th></th><th class="n">POVs</th><th style="min-width:110px">Outlook</th><th class="n" title="The sum of each POV’s chance of success">Exp. successes</th>${rv.linked ? '<th class="n" title="From the imported Salesforce report">Amount (report)</th>' : ''}<th class="n">Won/lost</th><th class="n">Critical</th></tr></thead><tbody>${rows.map((g) => `<tr><td><b>${esc(g.name)}</b></td><td class="n">${g.povs}</td><td>${obar(g)}</td><td class="n">${fmt(g.expected)}</td>${rv.linked ? `<td class="n">${g.pipeline ? cur(g.pipeline) : '—'}</td>` : ''}<td class="n">${g.won}/${g.lost}</td><td class="n ${g.critical ? 'bad-t' : ''}">${g.critical}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing yet.</td></tr>'}</tbody></table>`;
  const capsHtml = m.capabilities.map((x) => `<div class="caprow" title="${x.met} met of ${x.tested} tested in ${x.povs} POV${x.povs === 1 ? '' : 's'}${x.missed ? `, ${x.missed} not met` : ''}"><span class="grow">${esc(x.name)}<span class="small muted"> · ${x.povs} POV${x.povs === 1 ? '' : 's'}</span></span><span class="capbar"><i class="${x.rate >= 70 ? 'ok' : x.rate >= 40 ? 'warn' : 'bad'}" style="width:${Math.max(3, x.rate)}%"></i></span><b class="num">${x.rate}%</b></div>`).join('') || '<p class="muted pad">No success criteria tested yet.</p>';

  main.innerHTML = `<div class="ins2">
    <div class="ins2-bar"><span class="muted small">Kendra scores each POV’s chance of technical success from its pace against its end date, its must-haves, the tenant’s activity, customer engagement and its gaps, and says why. It is not a sales forecast.${rv.linked ? ` Amounts are from the Salesforce report imported ${rv.reportAt ? esc(day(rv.reportAt)) : ''}; Kendra does not read Salesforce.` : ''}${m.trend.since ? ` Changes are since ${esc(day(m.trend.since))}.` : ''}</span><span class="spacer"></span>
      <select id="iRegion" aria-label="Region"><option value="">Every region</option>${regions.map((r) => `<option ${ui.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    <div class="kpis">${kpis.map((k) => `<div class="kpi ${k.tone}" title="${esc(k.hint)}"><span class="kl">${k.label}</span><b class="kv">${k.value}</b>${k.d}${k.sp}</div>`).join('')}</div>
    <div class="ins2-grid">
      <section class="panel ipanel"><div class="head"><h3>Needs attention</h3></div>
        <div class="itabs" role="tablist">${[['risk', `At risk <span>${d.atRisk.length}</span>`], ['movers', `Movers <span>${m.movers.length}</span>`], ['gaps', `Gaps <span>${d.commonGaps.length}</span>`]].map(([k, l]) => `<button role="tab" data-left="${k}" aria-selected="${leftTab === k}">${l}</button>`).join('')}</div>
        <div class="ibody">${{ risk: atRiskHtml, movers: moversHtml, gaps: gapsHtml }[leftTab]}</div></section>
      <section class="panel ipanel"><div class="head"><h3 title="Kendra’s own score of each POV, not a sales forecast">Where the POVs are heading</h3><span class="small muted">${n === 1 && !c.commit.count && !c.best.count && !c.pipeline.count ? '' : `${c.commit.count + c.best.count + c.pipeline.count} POVs scored`}</span></div>
        <div class="fbar" role="img" aria-label="${c.commit.count} likely to succeed, ${c.best.count} at risk, ${c.pipeline.count} unlikely"><span class="ok" style="flex:${c.commit.count / n}"></span><span class="warn" style="flex:${c.best.count / n}"></span><span class="bad" style="flex:${c.pipeline.count / n}"></span></div>
        <div class="cats">${catRow('commit', 'Likely to succeed', 'ok', c.commit)}${catRow('best', 'At risk', 'warn', c.best)}${catRow('pipeline', 'Unlikely', 'bad', c.pipeline)}</div>
        <div class="sub-head">Ending in the next 30 days <span class="muted">${m.ending.length}</span></div>
        <div class="ibody">${endingHtml}</div></section>
      <section class="panel ipanel"><div class="head"><h3>Team</h3></div>
        <div class="itabs" role="tablist">${[['load', 'SE workload'], ['rollup', 'Roll-up'], ['caps', 'Capabilities']].map(([k, l]) => `<button role="tab" data-right="${k}" aria-selected="${rightTab === k}">${l}</button>`).join('')}</div>
        <div class="ibody">${{ load: loadHtml, rollup: rollHtml, caps: `<p class="small muted pad" style="padding-bottom:4px">How often each capability is proven where it is tested: the lowest stall POVs.</p>${capsHtml}` }[rightTab]}</div></section>
    </div></div>`;
  for (const b of main.querySelectorAll('[data-left]')) b.addEventListener('click', () => ((ui.left = b.dataset.left), save(), rerender()));
  for (const b of main.querySelectorAll('[data-right]')) b.addEventListener('click', () => ((ui.right = b.dataset.right), save(), rerender()));
  for (const b of main.querySelectorAll('[data-by]')) b.addEventListener('click', () => ((ui.by = b.dataset.by), save(), rerender()));
  main.querySelector('#iRegion').addEventListener('change', (e) => ((ui.region = e.target.value), save(), rerender()));
}
