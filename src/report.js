/**
 * The success-criteria report: one standalone HTML page (no scripts, prints to PDF from any browser) with the answer
 * first, then each criterion with its status and evidence, the sessions held and what the tenant showed.
 * The layout is a starting point until the team's own report formats are supplied.
 */
import { CATEGORIES } from './catalog.js';
import { CRITERION_STATUS, SESSION_TYPES, STAGES, progressOf } from './opportunities.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const COLOR = { met: '#2f8a4c', not_met: '#c2362f', in_progress: '#b7791f', not_started: '#8a8f96', na: '#8a8f96' };

export function successReport(opp, { owner, live, evidence = {}, org = 'Command Center', categories = CATEGORIES }) {
  const catLabel = Object.fromEntries([...categories, ['custom', 'Other']]);
  const p = progressOf(opp);
  const groups = new Map();
  for (const c of opp.criteria ?? []) {
    const k = catLabel[c.category] ?? 'Other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const s = live?.summary;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opp.customer)} — POV success criteria</title>
<style>
  :root { --ink:#1b1f24; --muted:#646b73; --line:#e2dfd6; --accent:#0e8a8a; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); margin: 0; background: #fff; }
  .page { max-width: 900px; margin: 0 auto; padding: 40px 32px; }
  header { border-bottom: 3px solid var(--accent); padding-bottom: 16px; margin-bottom: 24px; }
  h1 { margin: 0 0 4px; font-size: 26px; } h2 { font-size: 17px; margin: 28px 0 10px; } h3 { font-size: 14px; margin: 18px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .muted { color: var(--muted); }
  .answer { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .answer div { border: 1px solid var(--line); border-radius: 10px; padding: 12px; } .answer b { display: block; font-size: 24px; }
  .bar { height: 10px; background: #eee; border-radius: 5px; overflow: hidden; } .bar span { display: block; height: 100%; background: var(--accent); }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; } th { font-size: 12px; color: var(--muted); }
  .st { font-weight: 600; white-space: nowrap; } .ev { font-size: 12px; color: var(--muted); }
  footer { margin-top: 36px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 10px; }
  @media print { .page { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body><div class="page">
<header>
  <div class="muted">Checkmarx One proof of value</div>
  <h1>${esc(opp.customer)}</h1>
  <div class="muted">${esc(opp.name !== opp.customer ? opp.name : '')} ${esc(STAGES[opp.stage])} · ${day(opp.startDate)} – ${day(opp.endDate)} · ${esc(owner?.name ?? '')}${opp.tenant ? ` · tenant ${esc(opp.tenant.tenant)} (${esc(opp.tenant.regionLabel)})` : ''}</div>
</header>
<div class="bar"><span style="width:${p.percent}%"></span></div>
<div class="answer">
  <div><b>${p.percent}%</b>criteria completed successfully</div>
  <div><b>${p.met} / ${p.total}</b>met</div>
  <div><b>${p.mustMet} / ${p.must}</b>must-haves met</div>
  <div><b>${p.notMet}</b>not met</div>
</div>
${opp.summary ? `<h2>Summary</h2><p>${esc(opp.summary).replace(/\n/g, '<br>')}</p>` : ''}
<h2>Success criteria</h2>
${[...groups]
  .map(([k, list]) => `<h3>${esc(k)}</h3><table><thead><tr><th style="width:42%">Criterion</th><th>Status</th><th>Evidence and notes</th></tr></thead><tbody>${list
    .map((c) => {
      const ev = evidence[c.id];
      return `<tr><td>${esc(c.title)}${c.priority === 'nice' ? ' <span class="muted">(nice to have)</span>' : ''}</td><td class="st" style="color:${COLOR[c.status]}">${esc(CRITERION_STATUS[c.status])}${c.confirmedAt ? `<div class="ev">${day(c.confirmedAt)}</div>` : ''}</td><td>${esc(c.notes)}${ev?.evidence?.length ? `<div class="ev">${ev.evidence.map(esc).join('<br>')}</div>` : ''}${c.evidenceLink ? `<div class="ev"><a href="${esc(c.evidenceLink)}">${esc(c.evidenceLink)}</a></div>` : ''}</td></tr>`;
    })
    .join('')}</tbody></table>`)
  .join('')}
${s ? `<h2>What the POV tenant showed</h2><table><tbody>
  <tr><td>Projects</td><td>${s.projects ?? '—'}</td></tr>
  <tr><td>Scans (last 7 days)</td><td>${s.scans7d}${s.fusion7d ? ` · ${s.fusion7d} Fusion` : ''}${s.last7d ? ` · ${s.last7d} LAST` : ''}</td></tr>
  <tr><td>Engines used</td><td>${esc((s.engines ?? []).join(', ') || '—')}</td></tr>
  <tr><td>Scans came from</td><td>${esc((s.origins ?? []).map((o) => `${o.name} (${o.count})`).join(', ') || '—')}</td></tr>
  ${s.findings ? `<tr><td>Open results on latest scans</td><td>${s.findings.critical} critical · ${s.findings.high} high · ${s.findings.medium} medium · ${s.findings.low} low</td></tr>` : ''}
</tbody></table>` : ''}
${opp.sessions?.length ? `<h2>Sessions</h2><table><tbody>${[...opp.sessions].sort((a, b) => a.date.localeCompare(b.date)).map((x) => `<tr><td style="width:120px">${day(x.date)}</td><td><b>${esc(x.title)}</b> <span class="muted">${esc(SESSION_TYPES[x.type] ?? '')}</span>${x.attendees ? `<div class="ev">${esc(x.attendees)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
<footer>Made by ${esc(org)} on ${day(new Date().toISOString())}. Status is as confirmed by the Solution Engineer; tenant figures are as Checkmarx One reported them${s ? ` at ${esc(new Date(s.at).toUTCString())}` : ''}.</footer>
</div></body></html>`;
}
