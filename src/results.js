/**
 * The POV results page: one self-contained HTML file (its data, styles and script inside, nothing loaded from
 * anywhere), to open in Kendra, share with the customer or keep in SharePoint.
 *
 *   Slide 1  the Checkmarx One platform slide, as designed, with only this POV's engines and their status;
 *            any engine opens its record: progress, artifacts (the scans that proved it, evidence, notes, links)
 *            and every timestamp, up to the POV's completion
 *   Slides   the answer · success criteria · what Checkmarx One showed · sessions · next steps
 *   PDF      printing the page gives every slide, one per page, then one page per engine with its record
 */

import { impactTiles } from './impact.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const u = (px) => `${((px * 100) / 1332).toFixed(3)}cqw`; // the slide's own pixel grid, scaled with the page
const day = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const stamp = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—');

const mixHex = (a, b, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, '0')).join('');
/** The title's violet-to-coral gradient, a letter at a time: crisp on screen, in print and in the PDF. */
const gradient = (t) => [...t].map((ch, i, all) => `<span style="color:${mixHex('bf4bd6', 'f2592d', i / Math.max(1, all.length - 1))}">${esc(ch)}</span>`).join('');
const STATE_LABEL = { done: 'Completed successfully', demo: 'Demonstrated by the SE', progress: 'In progress', planned: 'Planned', missed: 'Not met', na: 'Not applicable' };
const TICK = (c = '#3CCF8E') => `<svg viewBox="0 0 20 20" class="mk" aria-hidden="true"><path d="M3.5 10.5l4.2 4.2L16.8 5.3" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOCK = (c) => `<svg viewBox="0 0 20 20" class="mk" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="${c}22" stroke="${c}" stroke-width="2"/><path d="M10 5.6V10l3.2 2" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 20 20" class="mk" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="#8A8197" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const PLAY = `<svg viewBox="0 0 20 20" class="mk" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="#3CCF8E22" stroke="#3CCF8E" stroke-width="2"/><path d="M8.3 6.6v6.8l5.4-3.4z" fill="#3CCF8E"/></svg>`;
export const MARKS = { done: TICK(), demo: PLAY, progress: CLOCK('#F5A524'), planned: CLOCK('#F5C518'), missed: CROSS };
const STAR = '<span class="star" title="AI-powered" aria-label="AI-powered">✦</span>';

const ICONS = {
  code: '<path d="M12 2.8l7 2.6v5.4c0 4.4-3 7.8-7 9.4-4-1.6-7-5-7-9.4V5.4z"/><path d="M10 9.5L8 11.5l2 2M14 9.5l2 2-2 2"/>',
  supply: '<rect x="3.5" y="9" width="8" height="6" rx="3"/><rect x="12.5" y="9" width="8" height="6" rx="3"/><path d="M9 12h6"/>',
  aisc: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3.5V7M9 12h.01M15 12h.01M9.5 15.5h5"/>',
  runtime: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.2h3.2M12 8v4.2l2.8 1.8"/>',
  'dev-assist': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 15l2-6 2 6M9.2 13h2.6M15 9v6"/>',
  'ai-triage': '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  'ai-remediation': '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="10" r="2"/><path d="M7 8v8M17 12c0 3-4 3-8.5 4.8"/>',
  'risk-orchestration': '<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M7 9h4v4H7zM13.5 9h3.5M13.5 12h3.5M9 20h6"/>',
  analytics: '<path d="M5 19V12M9 19V9M13 19v-5"/><circle cx="16.5" cy="9.5" r="3"/><path d="M18.7 11.7l2.3 2.3"/>',
  policy: '<path d="M7 3.5h8l3 3V20H7z"/><path d="M15 3.5V7h3M10 10.5h5M10 13.5h5M10 16.5h3"/>',
  mcp: '<path d="M9 3.5v4M15 3.5v4M7 7.5h10v4a5 5 0 0 1-10 0z"/><path d="M12 16.5V21"/>',
};
const icon = (key, color) => `<span class="ic" style="--c:${color}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[key] ?? ICONS.code}</svg></span>`;

/** The page. `data` is resultsData()'s answer (src/server.js). */
export function resultsPage(data, { nonce = '' } = {}) {
  const d = data;
  const v = d.platform;
  const pillar = (k) => v.pillars.find((p) => p.key === k);
  const eng = (it) => `<button class="eng s-${it.state}" data-e="${esc(it.criterionId)}" title="${esc(STATE_LABEL[it.state])} — open its record">${esc(it.label)}${MARKS[it.state]}</button>`;

  // ——— Slide 1, on the original grid ———
  const cap = pillar('capture');
  // Items stack from the top of each column with one spacing for all three, so rows line up and nothing leaves gaps.
  const STARS = { aisc: 3, runtime: 1 };
  const most = Math.max(1, ...v.pillars.map((pl) => (pl.key === 'capture' ? (pl.groups ?? []).filter((g) => g.items.length).length : (pl.rows ?? []).length)));
  const PITCH = Math.min(66, 238 / most);
  const at = (i) => 368 + i * PITCH;
  const slots = Object.fromEntries((cap?.groups ?? []).filter((g) => g.items.length).map((g, i) => [g.key, [at(i) - 3, STARS[g.key] ?? 0, '']]));
  const capture = cap
    ? `<div class="hd" style="left:${u(80)};top:${u(275)};--c:#F25928"><b>CAPTURE ALL RISKS</b><span>Fusion Scanning Architecture ${STAR}</span><i style="width:${u(192)}"></i></div>
      ${cap.groups.map((g) => `<div class="grp" style="left:${u(78)};top:${u(slots[g.key]?.[0] - 9)}">${icon(g.key, '#F25928')}<div><div class="gt">${esc(g.title)}${slots[g.key]?.[1] ? ' ' + STAR.repeat(slots[g.key][1]) : ''}</div><div class="gi">${g.items.map(eng).join('<span class="dotsep">·</span>')}</div></div></div>`).join('')}`
    : '';
  const rowCol = (key, x, hy, title, sub, color, uw, ys, ids) => {
    const p = pillar(key);
    if (!p) return '';
    // Every row in the POV, in order, stacked from the top (the catalogue's own order, nothing left as a gap).
    ids = p.rows.map((r) => r.id);
    ys = ids.map((_, i) => at(i) + 9);
    const extra = [];
    return `<div class="hd" style="left:${u(x)};top:${u(hy - 12)};--c:${color}"><b>${title}</b><span>${sub}</span><i style="width:${u(uw)}"></i></div>
      ${ids
        .map((id, i) => {
          const r = p.rows.find((x) => x.id === id);
          if (!r) return '';
          return `<div class="row" style="left:${u(x - 1)};top:${u(ys[i] - 21)}">${icon(id, color)}<div><button class="rt s-${r.state}" data-e="${esc(r.criterionId)}">${esc(r.label)}${r.ai ? ' ' + STAR : ''}${MARKS[r.state]}</button>${r.sub ? `<div class="rs">${esc(r.sub)}</div>` : ''}</div></div>`;
        })
        .join('')}
      ${extra.length ? `<div class="gi extra" style="left:${u(x + 56)};top:${u(ys[ys.length - 1] + 26)}">${extra.map(eng).join('<span class="dotsep">·</span>')}</div>` : ''}`;
  };
  const slide1 = `<section class="slide s1" aria-label="Checkmarx One — the engines of this POV">
    <div class="stage">
      <h1 style="top:${u(28)}">AppSec for the ${gradient('Age of AI-Generated Risk')}</h1>
      <div class="tag" style="left:${u(260)};top:${u(135)}">One Platform.</div><div class="tag" style="left:${u(559)};top:${u(135)}">Every Surface.</div><div class="tag" style="left:${u(862)};top:${u(135)}">One Risk View.</div>
      <div class="frame" style="left:${u(55)};top:${u(221)};width:${u(1245)};height:${u(410)}"></div>
      <div class="pill" style="left:${u(556)};top:${u(201)};width:${u(220)};height:${u(43)}">Checkmarx One</div>
      ${capture}
      ${rowCol('prevent', 531, 287, 'ELIMINATE &amp; PREVENT RISKS', 'Assist Family of Agents', '#7A45FF', 193, [377, 443, 510], ['dev-assist', 'ai-triage', 'ai-remediation'])}
      ${rowCol('govern', 945, 287, 'GOVERN &amp; UNIFY RISKS', 'Orchestration/Posture Management', '#B22BCB', 195, [372, 439, 508, 569], ['risk-orchestration', 'analytics', 'policy', 'mcp'])}
      <div class="key" style="left:${u(80)};top:${u(603)}">${MARKS.done} Completed successfully ${MARKS.demo} Demonstrated by the SE ${MARKS.progress} In progress ${MARKS.planned} Planned ${STAR} AI-powered <span class="hint">· select an engine for its record</span></div>
      <div class="band" style="top:${u(669)};height:${u(60)}"><b>Checkmarx</b><span>${esc(d.customer)} · Proof of Value</span><em>1</em></div>
    </div>
  </section>`;

  // ——— The other slides, in the same hand ———
  let n = 1;
  const slide = (kicker, title, body) => `<section class="slide sx"><div class="stage"><div class="kick">${kicker}</div><h2>${title}</h2><i class="rule"></i><div class="body">${body}</div><div class="band"><b>Checkmarx</b><span>${esc(d.customer)} · Proof of Value</span><em>${++n}</em></div></div></section>`;
  const p = d.progress;
  const s = d.tenant;
  const flowSlide = d.flow?.hasAny ? flowHtml(d.flow, ++n, d) : '';
  const slide2 = slide(
    `${esc(d.customer)} · ${day(d.startDate)} – ${day(d.endDate)}`,
    p.percent === 100 ? 'Every success criterion completed successfully' : `${p.met} of ${p.total} success criteria completed successfully`,
    `<div class="figs">
      <div><b>${gradient(`${p.percent}%`)}</b><span>criteria completed</span></div>
      <div><b>${gradient(`${p.mustMet}/${p.must}`)}</b><span>must-haves completed</span></div>
      <div><b>${gradient(String(s ? s.scans7d : '—'))}</b><span>scans in the last 7 days</span></div>
      <div><b>${gradient(s?.users?.total != null ? `${s.users.active + s.users.quiet}/${s.users.total}` : '—')}</b><span>people active</span></div>
    </div>
    ${d.completedAt ? `<p class="done-line">${MARKS.done} POV ${d.povResult === 'successful' ? 'completed successfully' : 'completed'} on <b>${stamp(d.completedAt)}</b></p>` : `<p class="done-line">${MARKS.progress} POV in progress · ${d.endDate ? `ends ${day(d.endDate)}` : 'no end date set'}</p>`}
    ${d.summary ? `<p class="summary">${esc(d.summary)}${d.summaryAt ? ` <span class="m">(written ${stamp(d.summaryAt)})</span>` : ''}</p>` : ''}`,
  );
  // ——— What the POV changed: the Analytics dashboard's numbers, with the start of the POV where they moved ———
  const tiles = impactTiles(d.analytics);
  const impactSlide = tiles.length
    ? slide('In the tenant', 'What the POV changed', `<div class="figs impact">${tiles.map((t) => `<div><b>${gradient(t.value)}</b><span>${esc(t.label)}</span><em>${esc(t.sub)}</em></div>`).join('')}</div><p class="m small">From the Checkmarx One Analytics dashboard${d.analytics.start?.at ? `; the start is its first reading, ${stamp(d.analytics.start.at)}` : ''}.</p>`)
    : '';
  const crit = d.criteria;
  // ——— Business goals: what the customer set out to achieve, and how far the POV took each ———
  const byId = Object.fromEntries(crit.map((c) => [c.id, c]));
  const goals = d.goals ?? [];
  const goalSlides = goals.length
    ? [
        slide(
          'Business goals',
          'What we set out to prove',
          `<div class="goals">${goals.map((g) => `<div class="goal"><div class="gh"><b>${esc(g.title)}</b><span class="gp">${g.done}/${g.total}</span></div>${g.statement ? `<p>${esc(g.statement)}</p>` : ''}<i class="bar"><i style="width:${Math.round((g.done / Math.max(1, g.total)) * 100)}%"></i></i></div>`).join('')}</div>`,
        ),
        ...goals
          .filter((g) => g.key !== 'other')
          .map((g) =>
            slide(
              `Business goal${g.driver ? ` · ${esc(g.driver)}` : ''}`,
              esc(g.title),
              `${g.statement ? `<p class="summary" style="margin-top:0">${esc(g.statement)}</p>` : ''}<table class="tbl"><thead><tr><th>Criteria</th><th>Test item</th><th>Benefit</th><th class="c">Result</th></tr></thead><tbody>${g.ids
                .slice(0, 7)
                .map((id) => byId[id])
                .filter(Boolean)
                .map((c) => `<tr><td><button class="lnk" data-e="${esc(c.id)}">${esc(c.title)}</button></td><td class="m">${esc(c.test || '—')}</td><td class="m">${esc(c.benefit || '—')}</td><td class="st s-${c.state}">${MARKS[c.state] ?? ''} ${esc(STATE_LABEL[c.state])}</td></tr>`)
                .join('')}</tbody></table>${g.measures?.length ? `<p class="m small"><b>Success measures:</b> ${g.measures.slice(0, 4).map(esc).join(' · ')}</p>` : ''}`,
            ),
          ),
      ]
    : [];
  const critSlides = [];
  for (let i = 0; i < Math.max(1, crit.length); i += 10) {
    critSlides.push(
      slide(
        `Success criteria${crit.length > 10 ? ` · ${i / 10 + 1} of ${Math.ceil(crit.length / 10)}` : ''}`,
        'Success criteria',
        `<table class="tbl"><thead><tr><th>Group</th><th>Criterion</th><th class="c">Status</th><th>Completed on</th><th>Evidence</th></tr></thead><tbody>${crit
          .slice(i, i + 10)
          .map((c) => `<tr><td class="m">${esc(c.group)}</td><td><button class="lnk" data-e="${esc(c.id)}">${esc(c.title)}</button>${c.ai ? ' ' + STAR : ''}${c.priority === 'nice' ? ' <span class="m">(nice to have)</span>' : ''}</td><td class="st s-${c.state}">${MARKS[c.state] ?? ''} ${esc(STATE_LABEL[c.state])}</td><td class="m">${c.confirmedAt ? stamp(c.confirmedAt) : '—'}</td><td class="m">${esc([...(c.evidence?.level === 'detected' ? c.evidence.evidence : []), c.scans.length ? `${c.scans.length} proving scan${c.scans.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ').slice(0, 160)) || '—'}</td></tr>`)
          .join('') || '<tr><td colspan="5" class="m">No success criteria yet.</td></tr>'}</tbody></table>`,
      ),
    );
  }
  const slide4 = s
    ? slide(
        'In the POV tenant',
        'What Checkmarx One showed',
        `<table class="tbl kv"><tbody>
          <tr><td>Projects</td><td>${s.projects ?? '—'}</td></tr>
          <tr><td>Scans (last 7 days)</td><td>${s.scans7d}${s.fusion7d ? ` · ${s.fusion7d} Fusion` : ''}${s.last7d ? ` · ${s.last7d} LAST` : ''}</td></tr>
          <tr><td>Engines used</td><td>${esc((s.engines ?? []).join(', ') || '—')}</td></tr>
          <tr><td>Scans came from</td><td>${esc((s.origins ?? []).map((o) => `${o.name} (${o.count})`).join(', ') || '—')}</td></tr>
          <tr><td>Open results on latest scans</td><td>${s.findings ? `${s.findings.critical} critical · ${s.findings.high} high · ${s.findings.medium} medium · ${s.findings.low} low` : '—'}</td></tr>
          <tr><td>AI actions (30 days)</td><td>${s.credits?.actions ? `${s.credits.actions.triage} triage · ${s.credits.actions.remediation} remediation` : '—'}</td></tr>
          <tr><td>People active</td><td>${s.users?.total != null ? `${s.users.active} active · ${s.users.quiet} this week · of ${s.users.total}` : '—'}</td></tr>
        </tbody></table><p class="m small">As Checkmarx One reported it on ${stamp(s.at)}.</p>`,
      )
    : '';
  // ——— Expansion: what is proven and ready to roll out, and what comes next on the platform ———
  const x = d.expansion;
  const expansionSlide = x
    ? slide(
        'Expansion',
        'From proof to rollout',
        `<div class="exp"><div><div class="kick" style="position:static">Proven in this POV</div><ul class="steps small-steps">${(x.proven.length ? x.proven : ['The POV is still running: proven work appears here as criteria are completed.']).slice(0, 6).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          <div class="figs mini">${[[x.projects, 'projects scanned'], [x.integrations.length || null, 'integrations in use'], [x.people, 'people on the platform']].filter(([v]) => v != null).map(([v, l]) => `<div><b>${gradient(String(v))}</b><span>${l}</span></div>`).join('')}</div>
          ${x.organisation ? `<p class="m small">Rollout scope: ${esc(x.organisation)}</p>` : ''}</div>
          <div><div class="kick" style="position:static">Next on the platform</div><ul class="next-list">${x.next.slice(0, 6).map((n) => `<li><b>${esc(n.name)}</b>${n.isNew ? ' <span class="new">New</span>' : ''}<span class="m small">${esc(n.group)}${n.goal ? ` · ${esc(n.goal)}` : ''}</span>${n.benefit ? `<span class="small">${esc(n.benefit)}</span>` : ''}</li>`).join('')}</ul></div></div>`,
      )
    : '';
  const slide5 = d.sessions.length ? slide('Sessions', 'How we got here', `<table class="tbl"><tbody>${d.sessions.map((x) => `<tr><td class="m" style="width:22%">${day(x.date)}</td><td>${esc(x.title)}</td><td class="m">${esc(x.type)}</td></tr>`).join('')}</tbody></table>`) : '';
  const slide6 = slide('From here', 'Next steps', `<ul class="steps">${(d.next.length ? d.next : ['Agree the rollout plan and the first teams', 'Confirm the commercial proposal', 'Schedule the onboarding']).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);

  // ——— One page per engine, for the PDF ———
  const appendix = crit.map((c) => `<section class="slide sx print-only"><div class="stage"><div class="kick">Engine record · ${esc(c.group)}</div><h2>${esc(c.title)} ${c.ai ? STAR : ''}</h2><i class="rule"></i><div class="body rec">${record(c, d)}</div><div class="band"><b>Checkmarx</b><span>${esc(d.customer)} · Proof of Value</span><em>${++n}</em></div></div></section>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.customer)} — Checkmarx One POV results</title>
<style>${CSS}</style></head><body>
<header class="bar"><div><b>${esc(d.customer)}</b> · Checkmarx One proof of value <span class="m">· ${(d.team?.length ? d.team : d.owner ? [d.owner] : []).map((p) => `${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ''}`).join(', ')} · ${stamp(d.generatedAt)}</span></div><button class="btn" id="pdf">Download PDF</button></header>
<main>${slide1}${flowSlide}${slide2}${impactSlide}${goalSlides.join('')}${critSlides.join('')}${slide4}${expansionSlide}${slide5}${slide6}${appendix}</main>
<aside class="drawer" id="drawer" aria-hidden="true" role="dialog" aria-label="Engine record"><button class="x" id="close" aria-label="Close">×</button><div id="rec"></div></aside>
<div class="scrim" id="scrim"></div>
<script${nonce ? ` nonce="${nonce}"` : ''}>
const DATA = ${JSON.stringify({ records: Object.fromEntries(crit.map((c) => [c.id, record(c, d)])), titles: Object.fromEntries(crit.map((c) => [c.id, c.title])) }).replace(/</g, '\\u003c')};
const VIDEOS = ${JSON.stringify(Object.fromEntries(crit.filter((c) => c.demo?.video?.src).map((c) => [c.id, { src: c.demo.video.src, type: c.demo.video.type }]))).replace(/</g, '\\u003c')};
const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
function play(id, where) {
  const v = VIDEOS[id];
  if (!v || !where) return;
  where.innerHTML = '';
  const el = document.createElement('video');
  el.controls = true; el.autoplay = true; el.playsInline = true;
  el.setAttribute('controlsList', 'nodownload noplaybackrate');
  el.disablePictureInPicture = true;
  el.oncontextmenu = (e) => e.preventDefault();
  el.src = v.src;
  where.appendChild(el);
}
function open(id) { const r = DATA.records[id]; if (!r) return; document.getElementById('rec').innerHTML = '<h2>' + DATA.titles[id].replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</h2>' + r; drawer.classList.add('open'); scrim.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.getElementById('close').focus(); }
function shut() { document.querySelectorAll('#rec video').forEach((v) => v.pause()); drawer.classList.remove('open'); scrim.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-play]');
  if (p) return play(p.dataset.play, p.parentElement.querySelector('.vid'));
  const b = e.target.closest('[data-e]');
  if (b) open(b.dataset.e);
});
document.getElementById('close').onclick = shut; scrim.onclick = shut;
document.addEventListener('keydown', (e) => e.key === 'Escape' && shut());
document.getElementById('pdf').onclick = () => { shut(); window.print(); };
</script></body></html>`;
}

/** The integration flow slide: the customer's tools stage by stage, and what Checkmarx One adds at each. */
const FLOW_ICONS = {
  code: '<path d="M8.5 8L4.5 12l4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13"/>',
  commit: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3.5-4.5 3.5-10 5.4"/>',
  build: '<path d="M4 7h16v10H4z"/><path d="M8 11l2 2-2 2M12.5 15h3.5"/>',
  run: '<path d="M12 3.5c3.5 2 5 5.5 4.5 9.5l-2.5 3h-4l-2.5-3C7 9 8.5 5.5 12 3.5z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 16l-2 4M14.5 16l2 4"/>',
  govern: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 7.8-7.5 9.5-4.3-1.7-7.5-5-7.5-9.5V6z"/><path d="M8.5 12l2.4 2.4 4.6-4.8"/>',
};
const SEEN = '<svg viewBox="0 0 20 20" class="mk" aria-hidden="true"><circle cx="10" cy="10" r="4.2" fill="#5ce1ff"/><circle cx="10" cy="10" r="7.5" fill="none" stroke="#5ce1ff" stroke-opacity=".4" stroke-width="1.4"/></svg>';
function flowHtml(flow, num, d) {
  const colours = ['#f25928', '#e0477a', '#c13fb4', '#8f3ee6', '#6b34fd'];
  const chip = (t, kind) => {
    const mark = MARKS[t.state] ?? (t.state === 'seen' ? SEEN : '');
    const inner = `${esc(t.label)}${t.ai ? ` ${STAR}` : ''}${t.scans ? ` <span class="fx-n">${t.scans}</span>` : ''}${mark}`;
    const title = t.state === 'seen' ? 'Seen in the tenant' : t.state === 'uses' ? 'In use (from the discovery)' : STATE_LABEL[t.state] ?? '';
    return t.criterionId ? `<button class="fx-chip ${kind} s-${t.state}" data-e="${esc(t.criterionId)}" title="${esc(title)} — open its record">${inner}</button>` : `<span class="fx-chip ${kind} s-${t.state}" title="${esc(title)}">${inner}</span>`;
  };
  const cols = flow.stages
    .map((st, i) => `<div class="fx-st${st.empty ? ' fx-empty' : ''}" style="--c:${colours[i]}">
      <div class="fx-head"><span class="fx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${FLOW_ICONS[st.icon]}</svg></span><div><div class="fx-num">0${i + 1}</div><b>${esc(st.title)}</b><span>${esc(st.sub)}</span></div></div>
      <div class="fx-lbl">Customer’s tools</div>
      <div class="fx-chips">${st.tools.map((t) => chip(t, 'tool')).join('') || '<span class="fx-none">—</span>'}${st.moreTools ? `<span class="fx-more">+${st.moreTools}</span>` : ''}</div>
      <div class="fx-lbl cx">Checkmarx One</div>
      <div class="fx-chips">${st.engines.map((e) => chip(e, 'eng')).join('') || '<span class="fx-none">—</span>'}${st.moreEngines ? `<span class="fx-more">+${st.moreEngines}</span>` : ''}</div>
      <div class="fx-val">${st.metric ? `<div class="fx-metric"><b>${gradient(Number(st.metric.value).toLocaleString('en-US'))}</b><span>${esc(st.metric.label)}</span></div>` : ''}${st.value.map((v) => `<p>${esc(v)}</p>`).join('') || (st.empty ? '<p class="m">Not in this POV’s scope.</p>' : '')}</div>
    </div>`)
    .join('<div class="fx-arrow" aria-hidden="true"><i></i></div>');
  return `<section class="slide sx sf" aria-label="Integration flow"><div class="stage">
    <div class="kick">${esc(d.customer)} · From code to cloud</div>
    <h2>Where Checkmarx One works in ${esc(d.customer)}’s flow</h2><i class="rule"></i>
    <div class="body fx">${cols}</div>
    <div class="fx-loop"><span>Findings, AI fixes and tickets flow back to the developer</span></div>
    <div class="fx-key">${MARKS.done} Completed successfully ${MARKS.demo} Demonstrated by the SE ${MARKS.progress} In progress ${MARKS.planned} Planned ${SEEN} Seen in the tenant ${STAR} AI-powered <span class="hint">· select an item for its record</span></div>
    <div class="band"><b>Checkmarx</b><span>${esc(d.customer)} · Proof of Value</span><em>${num}</em></div>
  </div></section>`;
}

/** One engine's record: where it stands, the timestamps, the artifacts. */
function record(c, d) {
  const t = c.timeline;
  const added = t.find((x) => /^Added success criterion/.test(x.what))?.at ?? null;
  const last = t.length ? t[t.length - 1].at : null;
  return `<div class="state s-${c.state}">${MARKS[c.state] ?? ''} <b>${esc(STATE_LABEL[c.state])}</b>${c.priority === 'nice' ? ' · nice to have' : ' · must have'}${c.ai ? ` · ${STAR} AI-powered` : ''}</div>
  <dl class="times">
    <div><dt>Agreed</dt><dd>${stamp(added)}</dd></div>
    <div><dt>Last change</dt><dd>${stamp(last)}</dd></div>
    <div><dt>Completed successfully</dt><dd>${c.confirmedAt ? `${stamp(c.confirmedAt)}${c.confirmedBy ? ` · ${esc(c.confirmedBy)}` : ''}` : '—'}</dd></div>
    <div><dt>POV completed</dt><dd>${stamp(d.completedAt)}</dd></div>
  </dl>
  ${c.demo ? `<h3>Demonstrated by the SE</h3><div class="demo"><p><b>${esc(c.demo.by || 'The SE')}</b> showed it on <b>${day(c.demo.date)}</b>${c.demo.environment ? `, in ${esc(c.demo.environment)}` : ''}${c.state === 'demo' ? ', rather than in the customer’s tenant' : ''}.</p>${c.demo.attendees ? `<p class="m">Seen by ${esc(c.demo.attendees)}</p>` : ''}${c.demo.notes ? `<p class="pre">${esc(c.demo.notes)}</p>` : ''}${c.demo.video ? `<button class="play" data-play="${esc(c.id)}">${PLAY} Play the demo <span class="m">${esc(c.demo.video.name)} · ${c.demo.video.size < 1048576 ? `${Math.max(1, Math.round(c.demo.video.size / 1024))} KB` : `${(c.demo.video.size / 1048576).toFixed(1)} MB`}</span></button><div class="vid" id="vid-${esc(c.id)}"></div><p class="m small print-note">The demo video plays in the HTML page.</p>` : ''}${c.demo.recordingUrl ? `<p><a href="${esc(c.demo.recordingUrl)}" target="_blank" rel="noopener noreferrer">Session recording ↗</a></p>` : ''}</div>` : ''}
  ${c.cxName ? `<h3>In Checkmarx One</h3><p>${esc(c.cxName)}</p>` : ''}
  ${c.proof ? `<h3>What was shown</h3><p>${esc(c.proof)}</p>` : ''}
  <h3>Evidence from Checkmarx One</h3>${c.evidence?.evidence?.length ? `<ul>${c.evidence.evidence.map((x) => `<li>${esc(x)}${c.evidence.level === 'mentioned' ? ' <span class="m">(from the notes)</span>' : ''}</li>`).join('')}</ul>` : '<p class="m">None read from the tenant: confirmed by the Solution Engineer.</p>'}
  ${c.scans.length ? `<h3>Scans that proved it</h3><table class="tbl mini"><thead><tr><th>When</th><th>Project</th><th>Branch</th><th>By</th><th>From</th><th>Why</th></tr></thead><tbody>${c.scans.map((s) => `<tr><td>${stamp(s.at)}</td><td>${esc(s.project)}</td><td>${esc(s.branch)}</td><td>${esc(s.initiator)}</td><td>${esc(s.origin)}</td><td>${esc(s.why.join(', '))}</td></tr>`).join('')}</tbody></table>` : ''}
  ${c.notes ? `<h3>Notes</h3><p class="pre">${esc(c.notes)}</p>` : ''}
  ${c.evidenceLink ? `<h3>Artifact</h3><p><a href="${esc(c.evidenceLink)}" target="_blank" rel="noopener noreferrer">${esc(c.evidenceLink)}</a></p>` : ''}
  ${c.tech ? `<h3>How it is checked</h3><p class="m">${esc(c.tech)}</p>` : ''}
  <h3>Timeline</h3>${t.length ? `<ol class="tl">${t.map((x) => `<li><time>${stamp(x.at)}</time> ${esc(x.what)}${x.by ? ` <span class="m">· ${esc(x.by)}</span>` : ''}</li>`).join('')}</ol>` : '<p class="m">—</p>'}`;
}

const CSS = `
.goals{display:grid;grid-template-columns:1fr 1fr;gap:${u(16)} ${u(28)}}
.goal .gh{display:flex;justify-content:space-between;gap:${u(12)};align-items:baseline}.goal b{font-size:${u(20)}}.goal .gp{font-size:${u(18)};color:#B9B0CC}
.goal p{margin:${u(4)} 0 ${u(8)};font-size:${u(14)};color:#B9B0CC;line-height:1.35}
.bar{display:block;height:${u(6)};border-radius:${u(3)};background:#3A2352;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#bf4bd6,#f2592d)}
.exp{display:grid;grid-template-columns:1fr 1fr;gap:${u(40)}}.small-steps li{font-size:${u(16)}}
.figs.mini{margin-top:${u(14)};grid-template-columns:repeat(3,1fr)}.figs.impact{grid-template-columns:repeat(3,1fr)}.figs.impact b{font-size:${u(44)}}.figs.impact em{display:block;font-style:normal;font-size:${u(12)};color:var(--dim);margin-top:${u(4)}}.figs.mini b{font-size:${u(34)}}
.next-list{list-style:none;margin:${u(8)} 0 0;padding:0;display:grid;gap:${u(10)}}.next-list li{display:flex;flex-direction:column;gap:${u(2)};border-left:${u(3)} solid #6B34FD;padding-left:${u(10)}}
.next-list .new{font-size:${u(11)};color:#F25928;text-transform:uppercase;letter-spacing:.06em}
:root { --bg:#140920; --panel:#1d1030; --line:#3a2352; --ink:#fff; --dim:#b9b0cc; --violet:#6b34fd; --orange:#f25928; --magenta:#b22bcb; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #0b0612; color: var(--ink); font: 15px/1.45 Aptos, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
.m { color: var(--dim); } .small { font-size: 12px; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 24px; background: #0b0612ee; border-bottom: 1px solid var(--line); font-size: 14px; }
.btn { font: inherit; font-weight: 700; background: var(--violet); color: #fff; border: 1px solid #a98bff; border-radius: 999px; padding: 8px 18px; cursor: pointer; }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 80px; display: flex; flex-direction: column; gap: 28px; }
.slide { container-type: inline-size; width: 100%; aspect-ratio: 1332 / 729; background: var(--bg); position: relative; overflow: hidden; box-shadow: 0 10px 40px #0008; }
.stage { position: absolute; inset: 0; }
.stage > * { position: absolute; }
.s1 h1 { left: 0; right: 0; margin: 0; text-align: center; font-weight: 400; font-size: ${u(60)}; letter-spacing: -0.01em; white-space: nowrap; }
.tag { font-weight: 700; font-size: ${u(26)}; }
.frame { border: ${u(3)} solid transparent; border-radius: ${u(14)}; background: linear-gradient(var(--bg), var(--bg)) padding-box, linear-gradient(90deg, #f25933, #c24cd2 60%, #8c3df8) border-box; }
.pill { display: flex; align-items: center; justify-content: center; background: var(--violet); border: 1px solid #a98bff; border-radius: 999px; font-size: ${u(22)}; }
.hd { display: flex; flex-direction: column; gap: ${u(2)}; }
.hd b { color: var(--c); font-size: ${u(19)}; letter-spacing: 0.01em; }
.hd span { font-size: ${u(19)}; }
.hd i { display: block; height: 1px; background: var(--c); margin-top: ${u(8)}; }
.star { color: #ffd44d; text-shadow: 0 0 ${u(6)} #ffb80088; }
.grp, .row { display: flex; gap: ${u(9)}; align-items: flex-start; width: ${u(420)}; }
.ic { flex: none; width: ${u(42)}; height: ${u(42)}; border-radius: 50%; border: 1.5px solid var(--c); background: color-mix(in srgb, var(--c) 12%, var(--bg)); display: grid; place-items: center; color: var(--c); }
.ic svg { width: 56%; height: 56%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.gt { font-weight: 700; font-size: ${u(17)}; margin-top: ${u(2)}; }
.gi { display: flex; flex-wrap: wrap; align-items: center; gap: ${u(2)} ${u(4)}; margin-top: ${u(3)}; font-size: ${u(11.5)}; }
.gi.extra { width: ${u(330)}; }
.dotsep { color: var(--dim); margin: 0 ${u(3)}; }
.eng, .rt { font: inherit; background: none; border: 0; padding: ${u(1)} ${u(3)}; margin: 0 -${u(3)}; color: var(--dim); cursor: pointer; display: inline-flex; align-items: center; gap: ${u(3)}; border-radius: ${u(4)}; }
.eng:hover, .rt:hover, .eng:focus-visible, .rt:focus-visible { background: #ffffff14; outline: none; }
.eng.s-done, .eng.s-demo { color: #fff; font-weight: 700; text-shadow: 0 0 ${u(8)} #ffffff55; }
.rt { color: #fff; font-weight: 700; font-size: ${u(17)}; margin-top: ${u(6)}; }
.rs { font-size: ${u(11)}; color: var(--dim); margin-top: ${u(1)}; }
.mk { width: 1.05em; height: 1.05em; flex: none; vertical-align: -0.15em; }
.rt .mk { width: 0.95em; height: 0.95em; }
.key { display: flex; align-items: center; gap: ${u(6)}; font-size: ${u(11)}; color: var(--dim); }
.key .hint { opacity: 0.75; }
.band { left: 0; right: 0; bottom: 0; height: ${u(60)}; background: var(--violet); display: flex; align-items: center; justify-content: space-between; padding: 0 ${u(52)}; font-size: ${u(14)}; }
.band span { font-size: ${u(11)}; opacity: 0.85; } .band em { font-style: normal; font-size: ${u(11)}; }
.sx .kick { left: ${u(60)}; top: ${u(40)}; color: var(--orange); font-weight: 700; font-size: ${u(14)}; letter-spacing: 0.12em; text-transform: uppercase; }
.sx h2 { left: ${u(60)}; top: ${u(64)}; margin: 0; font-weight: 400; font-size: ${u(44)}; right: ${u(60)}; }
.sx .rule { left: ${u(60)}; top: ${u(132)}; width: ${u(200)}; height: ${u(3)}; background: linear-gradient(90deg, #f25933, #8c3df8); }
.sx .body { left: ${u(60)}; right: ${u(60)}; top: ${u(160)}; bottom: ${u(80)}; font-size: ${u(17)}; overflow: hidden; }
.figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: ${u(18)}; }
.figs div { border: 1px solid var(--line); border-radius: ${u(14)}; padding: ${u(22)}; background: var(--panel); text-align: center; }
.figs b { display: block; font-size: ${u(54)}; font-weight: 400; }
.figs > div > span { font-size: ${u(13)}; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; }
.done-line { display: flex; align-items: center; gap: ${u(8)}; margin: ${u(26)} 0 ${u(8)}; }
.summary { color: var(--dim); max-width: 92%; }
.tbl { width: 100%; border-collapse: collapse; font-size: ${u(14)}; }
.tbl th { text-align: left; color: var(--dim); font-weight: 700; font-size: ${u(11)}; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid #6b34fd; padding: ${u(8)} ${u(10)}; }
.tbl td { border-bottom: 1px solid var(--line); padding: ${u(8)} ${u(10)}; vertical-align: top; }
.tbl.kv td:first-child { color: var(--dim); width: 32%; text-transform: uppercase; font-size: ${u(12)}; letter-spacing: 0.08em; }
.st { white-space: nowrap; font-weight: 700; text-align: center; vertical-align: middle; } .tbl th.c { text-align: center; } .st.s-done, .st.s-demo { color: #3ccf8e; } .st.s-progress { color: #f5a524; } .st.s-planned { color: #f5c518; } .st.s-missed { color: #8a8197; }
.lnk { font: inherit; color: #fff; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; text-decoration: underline; text-decoration-color: #6b34fd; text-underline-offset: 3px; }
.steps { margin: 0; padding-left: 1.2em; font-size: ${u(22)}; } .steps li { margin-bottom: ${u(14)}; } .steps li::marker { color: var(--orange); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); background: #170c26; border-left: 1px solid #6b34fd; transform: translateX(100%); transition: transform 0.25s ease; z-index: 20; overflow-y: auto; padding: 28px 28px 40px; box-shadow: -20px 0 60px #000a; }
.drawer.open { transform: none; }
.drawer h2 { margin: 0 32px 10px 0; font-weight: 400; font-size: 26px; }
.drawer .x { position: absolute; top: 14px; right: 16px; background: none; border: 0; color: var(--dim); font-size: 28px; cursor: pointer; }
.scrim { position: fixed; inset: 0; background: #0008; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 15; }
.scrim.open { opacity: 1; pointer-events: auto; }
.state { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.times { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
.times div { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.times dt { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; } .times dd { margin: 2px 0 0; font-size: 13px; }
.rec h3, .drawer h3 { font-size: 11px; color: var(--orange); text-transform: uppercase; letter-spacing: 0.12em; margin: 18px 0 6px; }
.drawer p, .drawer li { font-size: 14px; } .drawer ul { padding-left: 1.1em; margin: 0; }
.tbl.mini { font-size: 12px; } .tbl.mini th { font-size: 10px; padding: 6px; } .tbl.mini td { padding: 6px; }
.tl { list-style: none; padding: 0; margin: 0; border-left: 2px solid var(--line); }
.tl li { position: relative; padding: 0 0 10px 14px; font-size: 13px; } .tl li::before { content: ''; position: absolute; left: -6px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: #6b34fd; }
.tl time { color: var(--dim); display: block; font-size: 11px; }
.pre { white-space: pre-wrap; }
.demo { border: 1px solid #3ccf8e55; background: #3ccf8e0d; border-radius: 10px; padding: 10px 12px; }
.demo p { margin: 0 0 6px; }
.play { font: inherit; display: inline-flex; align-items: center; gap: 8px; background: #3ccf8e22; color: #fff; border: 1px solid #3ccf8e88; border-radius: 999px; padding: 6px 14px; cursor: pointer; font-weight: 700; margin: 4px 0 8px; }
.play .mk { width: 1.3em; height: 1.3em; }
.vid video { width: 100%; border-radius: 10px; border: 1px solid var(--line); background: #000; display: block; margin-bottom: 6px; }
.print-note { display: none; }
.rec { font-size: ${u(13)} !important; columns: 2; column-gap: ${u(40)}; } .rec .times { break-inside: avoid; } .rec .tbl.mini { font-size: ${u(10)}; }
.print-only { display: none; }
.sf h2 { font-size: ${u(36)}; }
.sf .rule { top: ${u(118)}; }
.fx { top: ${u(140)} !important; bottom: ${u(122)} !important; display: grid; grid-template-columns: 1fr ${u(18)} 1fr ${u(18)} 1fr ${u(18)} 1fr ${u(18)} 1fr; align-items: stretch; overflow: visible !important; }
.fx-st { border: 1px solid color-mix(in srgb, var(--c) 45%, var(--line)); border-top: ${u(3)} solid var(--c); border-radius: ${u(12)}; background: linear-gradient(180deg, color-mix(in srgb, var(--c) 10%, var(--panel)), var(--panel) 40%); padding: ${u(10)} ${u(10)} ${u(8)}; display: flex; flex-direction: column; gap: ${u(5)}; min-width: 0; overflow: hidden; }
.fx-empty { opacity: 0.45; }
.fx-head { display: flex; gap: ${u(8)}; align-items: center; margin-bottom: ${u(2)}; }
.fx-head b { display: block; font-size: ${u(15)}; line-height: 1.1; }
.fx-head span { font-size: ${u(9.5)}; color: var(--dim); }
.fx-num { font-size: ${u(9)}; color: var(--c); font-weight: 700; letter-spacing: 0.1em; }
.fx-ic { flex: none; width: ${u(34)}; height: ${u(34)}; border-radius: 50%; border: 1.5px solid var(--c); display: grid; place-items: center; color: var(--c); background: color-mix(in srgb, var(--c) 14%, var(--bg)); }
.fx-ic svg { width: 58%; height: 58%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.fx-lbl { font-size: ${u(8.5)}; text-transform: uppercase; letter-spacing: 0.14em; color: var(--dim); margin-top: ${u(3)}; }
.fx-lbl.cx { color: #b9a2ff; }
.fx-chips { display: flex; flex-wrap: wrap; gap: ${u(4)}; }
.fx-chip { font: inherit; font-size: ${u(10)}; display: inline-flex; align-items: center; gap: ${u(3)}; padding: ${u(2)} ${u(6)}; border-radius: 999px; border: 1px solid var(--line); background: #ffffff08; color: var(--dim); white-space: nowrap; }
button.fx-chip { cursor: pointer; } button.fx-chip:hover { border-color: #a98bff; }
.fx-chip.eng { border-color: #6b34fd88; background: #6b34fd22; color: #e5dcff; }
.fx-chip.s-done, .fx-chip.s-demo { color: #fff; font-weight: 700; border-color: #3ccf8e88; }
.fx-chip.s-seen { color: #dff8ff; border-color: #5ce1ff66; }
.fx-chip .mk { width: 0.95em; height: 0.95em; }
.fx-n { font-size: 0.85em; color: #5ce1ff; }
.fx-more, .fx-none { font-size: ${u(10)}; color: var(--dim); padding: ${u(2)} ${u(4)}; }
.fx-val { margin-top: auto; border-top: 1px solid var(--line); padding-top: ${u(6)}; }
.fx-val p { margin: 0 0 ${u(4)}; font-size: ${u(9.5)}; line-height: 1.35; color: #ddd6ea; }
.fx-metric b { display: block; font-size: ${u(24)}; font-weight: 400; line-height: 1.1; }
.fx-metric > span { display: block; font-size: ${u(8.5)}; color: var(--dim); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: ${u(4)}; }
.fx-arrow { position: relative; }
.fx-arrow i { position: absolute; left: -${u(2)}; right: -${u(2)}; top: 50%; height: ${u(2)}; background: linear-gradient(90deg, #f2592888, #8c3df8); }
.fx-arrow i::after { content: ''; position: absolute; right: 0; top: -${u(4)}; border-left: ${u(7)} solid #8c3df8; border-top: ${u(5)} solid transparent; border-bottom: ${u(5)} solid transparent; }
.fx-loop { left: ${u(110)}; right: ${u(110)}; bottom: ${u(96)}; height: ${u(18)}; border: ${u(2)} solid #8c3df866; border-top: 0; border-radius: 0 0 ${u(14)} ${u(14)}; display: flex; justify-content: center; }
.fx-loop span { position: relative; top: ${u(10)}; background: var(--bg); padding: 0 ${u(10)}; font-size: ${u(10)}; color: var(--dim); }
.fx-loop::before { content: ''; position: absolute; left: -${u(6)}; top: -${u(8)}; border-bottom: ${u(8)} solid #8c3df8aa; border-left: ${u(5)} solid transparent; border-right: ${u(5)} solid transparent; }
.fx-key { left: ${u(60)}; bottom: ${u(66)}; display: flex; align-items: center; gap: ${u(6)}; font-size: ${u(10)}; color: var(--dim); }
@media (max-width: 700px) { .bar { flex-wrap: wrap; } }
@page { size: 13.333in 7.297in; margin: 0; }
@media print {
  .play, .vid { display: none !important; } .print-note { display: block !important; }
  .fx-key .hint { display: none; }
  html, body { background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bar, .drawer, .scrim { display: none !important; }
  main { padding: 0; gap: 0; max-width: none; display: block; }
  .slide { width: 13.333in; height: 7.297in; aspect-ratio: auto; box-shadow: none; break-after: page; page-break-after: always; }
  .print-only { display: block; }
  .key .hint { display: none; }
}`;
