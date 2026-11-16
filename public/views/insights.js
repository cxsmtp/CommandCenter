// Insights: where every POV the viewer can see is heading, and what stands in the way. For managers and executives
// looking across dozens of POVs: the answer first, then the gaps, the POVs at risk, and roll-ups by region, team and SE.
import { esc, fmt, api, state, local } from '../core.js';

const ui = local.get('cc.insights', {});
const save = () => local.set('cc.insights', ui);

export async function renderInsights(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Insights</h2>');
  const q = new URLSearchParams();
  if (ui.region) q.set('region', ui.region);
  const d = await api(`/insights?${q}`);
  const t = d.totals;
  const bar = (likely, atRisk, unlikely) => {
    const n = Math.max(1, likely + atRisk + unlikely);
    return `<div class="obar" role="img" aria-label="${likely} likely, ${atRisk} at risk, ${unlikely} unlikely"><span class="ok" style="flex:${likely / n}"></span><span class="warn" style="flex:${atRisk / n}"></span><span class="bad" style="flex:${unlikely / n}"></span></div>`;
  };
  const rollup = (title, rows, note = '') => `<section class="panel"><div class="head"><h3>${title}</h3><span class="small muted">${note}</span></div><div class="table-wrap"><table class="ins-table"><thead><tr><th></th><th class="n">POVs</th><th class="n">Running</th><th style="min-width:160px">Outlook</th><th class="n">Expected wins</th><th class="n">Avg score</th><th class="n">Won / lost</th><th class="n">Critical gaps</th></tr></thead><tbody>${
    rows.map((g) => `<tr><td><b>${esc(g.name)}</b></td><td class="n">${g.povs}</td><td class="n">${g.running}</td><td>${bar(g.likely, g.atRisk, g.unlikely)}<div class="small muted">${g.likely} likely · ${g.atRisk} at risk · ${g.unlikely} unlikely</div></td><td class="n"><b>${fmt(g.expected)}</b></td><td class="n">${g.avgScore ?? '—'}</td><td class="n">${g.won} / ${g.lost}</td><td class="n ${g.critical ? 'bad-t' : ''}">${g.critical}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing yet.</td></tr>'
  }</tbody></table></div></section>`;
  const regions = [...new Set([...d.regions, ...d.tenantRegions])];
  main.innerHTML = `
    <div class="toolbar"><span class="muted">Predicted from each POV's pace against its end date, its must-haves, the tenant's activity, customer engagement and its gaps; every score says why.</span><span class="spacer"></span>
      <select id="iRegion" aria-label="Region"><option value="">Every region</option>${regions.map((r) => `<option ${ui.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    <section class="ins-hero">
      <div class="ins-group g-outlook"><div class="ins-label">Outlook</div>
        <div class="ins-figs"><div><b class="ok-t">${t.likely}</b><span>likely success</span></div><div><b class="warn-t">${t.atRisk}</b><span>at risk</span></div><div><b class="bad-t">${t.unlikely}</b><span>unlikely</span></div></div>
        ${bar(t.likely, t.atRisk, t.unlikely)}</div>
      <div class="ins-group g-forecast"><div class="ins-label">Forecast</div>
        <div class="ins-figs"><div><b>${fmt(t.expectedWins)}</b><span>expected wins of ${t.likely + t.atRisk + t.unlikely} POVs scored</span></div><div><b>${t.ending30}</b><span>end in 30 days</span></div><div><b>${fmt(t.ending30Expected)}</b><span>of those should win</span></div></div></div>
      <div class="ins-group g-pipeline"><div class="ins-label">Pipeline</div>
        <div class="ins-figs"><div><b>${t.open}</b><span>open</span></div><div><b>${t.running}</b><span>POVs running</span></div><div><b>${t.won}<small> / ${t.lost}</small></b><span>won / lost</span></div></div></div>
      <div class="ins-group g-gaps"><div class="ins-label">Gaps</div>
        <div class="ins-figs"><div><b class="${t.critical ? 'bad-t' : 'ok-t'}">${t.critical}</b><span>critical gaps now</span></div></div></div>
    </section>
    <div class="grid2">
      <section class="panel"><div class="head"><h3>Most common gaps</h3><span class="small muted">across the open POVs</span></div><div class="body list">${
        d.commonGaps.map((g) => `<div class="row center"><span class="dot ${g.level}"></span><span style="flex:1">${esc(g.text)}</span><b class="num">${g.count}</b></div>`).join('') || '<span class="ok-t">No gaps right now.</span>'
      }</div></section>
      <section class="panel"><div class="head"><h3>POVs at risk</h3><span class="small muted">lowest score first</span></div><div class="table-wrap"><table><tbody>${
        d.atRisk.map((r) => `<tr class="click" data-go="#/insights?open=${esc(r.id)}" tabindex="0"><td><b>${esc(r.customer)}</b><div class="small muted">${esc(r.owner)}${r.daysLeft !== null ? ` · ${r.daysLeft < 0 ? `${-r.daysLeft} d over` : `${r.daysLeft} d left`}` : ''}</div></td><td><span class="outlook ${r.score >= 40 ? 'warn' : 'bad'}"><b>${r.score}</b><span>${esc(r.label)}</span></span></td><td class="small">${r.why.map(esc).join('<br>')}</td></tr>`).join('') || '<tr><td class="ok-t">None at risk.</td></tr>'
      }</tbody></table></div></section>
    </div>
    <div class="stack" style="margin-top:16px">
      ${rollup('By region', d.byRegion, 'the SE’s sales region')}
      ${rollup('By team', d.byTeam, 'each team lead’s SEs')}
      ${rollup('By SE', d.bySe)}
      ${rollup('By tenant region', d.byTenantRegion, 'where the Checkmarx One tenant runs')}
    </div>`;
  main.querySelector('#iRegion').addEventListener('change', (e) => {
    ui.region = e.target.value;
    save();
    document.dispatchEvent(new CustomEvent('cc:rerender'));
  });
}
