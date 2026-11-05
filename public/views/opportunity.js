// One opportunity, from discovery to the outcome: the micro view a manager drills into and the SE works in.
import { $, $$, esc, fmt, api, state, can, ago, when, day, tc, toast, attempt, download, copy, openDialog, closeDialog, formData, HEALTH, sevBar, sevLegend, progressBar, scanTypeBadge, stageBadge, daysBadge, alertList, table, peopleOptions } from '../core.js';
import { feed } from './dashboard.js';
import { getCatalog, capabilityPicker } from './new-opportunity.js';

const TABS = [
  ['overview', 'Overview'],
  ['tenant', 'Live tenant'],
  ['criteria', 'Success criteria'],
  ['discovery', 'Discovery'],
  ['sessions', 'Sessions'],
  ['notes', 'Notes & tasks'],
  ['email', 'Stakeholders & email'],
  ['report', 'Report'],
  ['history', 'History'],
];
let current = null; // the detail last read
let catalog = null;

export async function renderOpportunity(main, id, tab, { crumbs }) {
  const [d, cat] = await Promise.all([api(`/opportunities/${encodeURIComponent(id)}`), getCatalog()]);
  current = d;
  catalog = cat;
  const o = d.opportunity;
  const r = d.row;
  const active = TABS.some(([k]) => k === tab) ? tab : 'overview';
  crumbs(`<a href="#/dashboard">Command center</a> <span class="muted">/</span> <span class="chip" style="background:${tc(r.colour)}"></span> <b>${esc(o.customer)}</b>`);
  const stages = Object.entries(state.meta.stages).filter(([k]) => k !== 'on_hold');
  const at = stages.findIndex(([k]) => k === o.stage);
  main.innerHTML = `
    <div class="opp-head">
      <div>
        <h1>${esc(o.customer)} ${stageBadge(o.stage)} ${daysBadge(r)} ${r.muted ? '<span class="badge">Muted</span>' : ''}</h1>
        <div class="meta">
          ${o.name !== o.customer ? `<span>${esc(o.name)}</span>` : ''}
          <span>SE <b>${esc(r.owner.name)}</b>${r.managers.length ? ` → ${r.managers.map((m) => esc(m.name)).join(' → ')}` : ''}</span>
          ${o.startDate || o.endDate ? `<span>POV ${day(o.startDate)} – ${day(o.endDate)}</span>` : ''}
          ${o.amount ? `<span>${esc(o.amount)}</span>` : ''}
          ${o.salesforceUrl ? `<a href="${esc(o.salesforceUrl)}" target="_blank" rel="noopener noreferrer">Salesforce ↗</a>` : ''}
          ${o.sharepointUrl ? `<a href="${esc(o.sharepointUrl)}" target="_blank" rel="noopener noreferrer">SharePoint ↗</a>` : ''}
          ${o.tenant ? `<a href="${esc(o.tenant.baseUrl)}" target="_blank" rel="noopener noreferrer">Checkmarx One ↗</a>` : ''}
        </div>
      </div>
      <div class="row center">${d.canEdit ? '<button class="btn" data-act="edit">Edit details</button>' : '<span class="badge">View only</span>'}</div>
    </div>
    <div class="stagebar" role="group" aria-label="Stage">${stages.map(([k, label], i) => `<button data-stage="${k}" class="${i < at ? 'done' : i === at ? 'current' : ''}" ${d.canEdit ? '' : 'disabled'}>${esc(label)}</button>`).join('')}</div>
    <div class="tabs" role="tablist">${TABS.map(([k, label]) => `<button role="tab" aria-selected="${k === active}" data-tab="${k}">${label}${k === 'criteria' && r.progress.total ? ` <span class="muted">${r.progress.percent}%</span>` : ''}${k === 'tenant' && r.live ? ` <span class="dot ${r.live.health}"></span>` : ''}</button>`).join('')}</div>
    <div id="tabBody">${VIEWS[active](d)}</div>`;

  for (const b of $$('[data-tab]', main)) b.addEventListener('click', () => (location.hash = `#/opp/${o.id}/${b.dataset.tab}`));
  for (const b of $$('[data-stage]', main))
    b.addEventListener('click', async () => {
      if (b.dataset.stage === o.stage) return;
      let outcomeReason;
      if (b.dataset.stage === 'completed') {
        const result = await askResult();
        if (!result) return;
        return save({ stage: 'completed', povResult: result }, result === 'successful' ? 'POV marked successful' : 'POV completed');
      }
      if (['won', 'lost'].includes(b.dataset.stage)) {
        outcomeReason = prompt(`Why was it ${b.dataset.stage}? (optional)`);
        if (outcomeReason === null) return;
      }
      await save({ stage: b.dataset.stage, outcomeReason }, `Stage: ${state.meta.stages[b.dataset.stage]}`);
    });
  main.querySelector('[data-act="edit"]')?.addEventListener('click', editDetails);
  WIRES[active]?.(main, d);
}

const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
const oid = () => current.opportunity.id;
async function save(body, ok = 'Saved') {
  const r = await attempt(() => api(`/opportunities/${oid()}`, { method: 'PATCH', body }), ok);
  if (r) rerender();
  return r;
}
async function item(kind, body, ok = 'Saved') {
  const r = await attempt(() => api(`/opportunities/${oid()}/${kind}${body.id ? `/${body.id}` : ''}`, { method: 'POST', body }), ok);
  if (r) rerender();
  return r;
}
async function removeItem(kind, itemId, what) {
  if (!confirm(`Remove ${what}?`)) return;
  if (await attempt(() => api(`/opportunities/${oid()}/${kind}/${itemId}`, { method: 'DELETE' }), 'Removed')) rerender();
}
const ro = () => (current.canEdit ? '' : 'disabled');
const capName = (id) => catalog.catalog.find((c) => c.id === id)?.name ?? id;
const person = (id) => current.people[id] ?? '';

// ——— Overview ———
function overview(d) {
  const o = d.opportunity;
  const r = d.row;
  const s = r.live?.summary;
  const openTasks = (o.tasks ?? []).filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const notes = [...(o.notes ?? [])].sort((a, b) => (b.pinned - a.pinned) || b.at.localeCompare(a.at)).slice(0, 4);
  const success = o.povResult === 'successful';
  return `${success ? `<section class="panel success-banner"><div class="body row center"><div style="flex:1;min-width:260px"><div class="small muted" style="text-transform:uppercase;letter-spacing:.18em">The POV was successful</div><h2 style="margin-top:4px">Share the final presentation</h2><div class="small muted">${r.progress.met} of ${r.progress.total} criteria met. The deck is made from the criteria, the sessions and what Checkmarx One showed.</div></div><button class="btn" data-act="deck">Download presentation</button>${current.canEdit ? '<button class="btn primary" data-act="share-deck">Email it to the stakeholders</button>' : ''}</div></section>` : ''}
  ${o.stage === 'completed' && !o.povResult && current.canEdit ? '<section class="panel"><div class="body row center"><span style="flex:1">The POV is complete. Was it successful?</span><button class="btn primary" data-result="successful">Successful</button><button class="btn" data-result="unsuccessful">Not successful</button></div></section>' : ''}
  <div class="layout"><div class="stack">
    ${r.alerts.length ? `<section class="panel"><div class="head"><h3>Needs attention</h3>${r.muted ? '<span class="badge">Muted</span>' : ''}</div><div class="body">${alertList(r.alerts, r.muted)}</div></section>` : ''}
    <section class="panel"><div class="head"><h3>Success criteria</h3><a href="#/opp/${esc(o.id)}/criteria" class="small">Open</a></div><div class="body">
      ${r.progress.total ? progressBar(r.progress) : '<span class="muted">None yet. Add what the customer wants to see.</span>'}
      ${r.progress.total ? `<div class="row small" style="margin-top:10px">${Object.entries(state.meta.criterionStatus).map(([k, label]) => `<span class="badge"><span class="status ${k}">${(o.criteria ?? []).filter((c) => c.status === k).length}</span> ${esc(label)}</span>`).join('')}</div>` : ''}
    </div></section>
    ${s ? `<section class="panel"><div class="head"><h3>POV tenant · ${esc(o.tenant.tenant)}</h3><span class="health small"><span class="dot ${r.live.health}"></span>${esc(HEALTH[r.live.health])} · read ${ago(s.at)}</span></div><div class="body stack" style="gap:10px">
      <div class="stats"><div class="stat"><div class="v">${fmt(s.projects)}</div><div class="l">Projects</div></div><div class="stat"><div class="v">${fmt(s.scans7d)}</div><div class="l">Scans 7d</div></div><div class="stat"><div class="v">${fmt(s.running + s.queued)}</div><div class="l">Running</div></div><div class="stat ${s.failed24h ? 'bad' : ''}"><div class="v">${fmt(s.failed24h)}</div><div class="l">Failed 24h</div></div></div>
      ${sevBar(s.findings)}${sevLegend(s.findings, s.delta)}
      <div class="row small">${s.fusion7d ? `<span class="badge fusion">Fusion ${s.fusion7d}</span>` : ''}${s.last7d ? `<span class="badge last">LAST ${s.last7d}</span>` : ''}${s.credits?.available != null ? `<span class="badge">Credits available ${fmt(s.credits.available)}</span>` : ''}${(s.origins ?? []).map((x) => `<span class="badge">${esc(x.name)} · ${x.count}</span>`).join('')}</div>
    </div></section>` : !o.tenant ? `<section class="panel"><div class="head"><h3>POV tenant</h3></div><div class="body"><p class="muted" style="margin-top:0">No Checkmarx One tenant yet. When the POV starts, paste its API key: the tenant is read every ${state.overview?.intervalMinutes ?? 10} minutes.</p>${current.canEdit ? '<button class="btn primary" data-act="connect">Connect a tenant</button>' : ''}</div></section>` : ''}
    <section class="panel"><div class="head"><h3>Summary for the customer and the report</h3></div><div class="body">
      <textarea id="summary" rows="4" style="width:100%" ${ro()} placeholder="Where the POV stands, in a few lines.">${esc(o.summary ?? '')}</textarea>
      ${current.canEdit ? '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="save-summary">Save summary</button></div>' : ''}
    </div></section>
  </div><div class="stack">
    <section class="panel"><div class="head"><h3>Next tasks</h3><a href="#/opp/${esc(o.id)}/notes" class="small">All</a></div><div class="body list">${openTasks.slice(0, 6).map((t) => `<div class="row center"><span class="${t.due && t.due < new Date().toISOString().slice(0, 10) ? 'bad-t' : ''}">${esc(t.title)}</span><span class="spacer"></span><span class="small muted">${t.due ? day(t.due) : ''}</span></div>`).join('') || '<span class="muted">Nothing open.</span>'}</div></section>
    <section class="panel"><div class="head"><h3>Latest notes</h3><a href="#/opp/${esc(o.id)}/notes" class="small">All</a></div><div class="body list">${notes.map((n) => `<div class="item"><div class="small muted">${n.pinned ? 'Pinned · ' : ''}${esc(person(n.by))} · ${ago(n.at)}</div><div class="notes-box">${esc(n.text.length > 400 ? `${n.text.slice(0, 400)}…` : n.text)}</div></div>`).join('') || '<span class="muted">No notes yet.</span>'}</div></section>
    <section class="panel"><div class="head"><h3>Stakeholders</h3><a href="#/opp/${esc(o.id)}/email" class="small">Manage</a></div><div class="body list">${(o.stakeholders ?? []).map((p) => `<div><b>${esc(p.name)}</b> <span class="small muted">${esc(p.title)} · ${p.side === 'internal' ? 'internal' : 'customer'}</span>${p.email ? `<div class="small"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></div>` : ''}</div>`).join('') || '<span class="muted">None yet.</span>'}</div></section>
  </div></div>`;
}

// ——— Live tenant ———
function tenant(d) {
  const o = d.opportunity;
  if (!o.tenant) return `<div class="hero-empty"><h2>No Checkmarx One tenant yet</h2><p>Paste the POV tenant's API key. Its scans, failures, Fusion and LAST scans, credits and the integrations used are then read every ${state.overview?.intervalMinutes ?? 10} minutes, and the success criteria pick up the evidence.</p>${current.canEdit ? '<button class="btn primary" data-act="connect">Connect a tenant</button>' : ''}</div>`;
  const r = d.row;
  const s = r.live?.summary;
  const t = d.tenant;
  const muteUntil = o.mute?.until;
  const scanCols = [
    { label: 'Started', key: (x) => Date.parse(x.createdAt) || 0, html: (x) => `<span title="${esc(when(x.createdAt))}">${ago(x.createdAt)}</span>` },
    { label: 'Project', key: (x) => x.projectName, html: (x) => esc(x.projectName || x.projectId) },
    { label: 'Status', key: (x) => x.status, html: (x) => `<span class="status ${esc(x.status)}">${esc(x.status)}</span>${x.reason ? `<div class="small bad-t">${esc(x.reason)}</div>` : ''}` },
    { label: 'Type', key: (x) => x.scanType, html: (x) => scanTypeBadge(x.scanType) || '<span class="muted small">—</span>' },
    { label: 'Engines', key: (x) => (x.engines ?? []).join(','), html: (x) => esc((x.engines ?? []).join(', ')) },
    { label: 'Branch', key: (x) => x.branch, html: (x) => esc(x.branch) },
    { label: 'By', key: (x) => x.initiator, html: (x) => esc(x.initiator) },
    { label: 'From', key: (x) => x.origin, html: (x) => esc(x.origin || x.sourceType) },
    { label: 'Took', n: true, key: (x) => Date.parse(x.updatedAt) - Date.parse(x.createdAt) || 0, html: (x) => (/completed|failed|partial|canceled/i.test(x.status) && x.updatedAt ? `${Math.max(0, Math.round((Date.parse(x.updatedAt) - Date.parse(x.createdAt)) / 60000))} min` : '—') },
    { label: 'Logs', html: (x) => (can('tenant.logs') ? (x.engines ?? []).filter((e) => e !== 'ai').map((e) => `<button class="btn sm" data-log="${esc(x.id)}|${esc(e)}" title="Download the ${esc(e)} log">${esc(e)}</button>`).join(' ') : '') },
  ];
  const projCols = [
    { label: 'Project', key: (p) => p.name, html: (p) => `${esc(p.name)}${p.repoUrl ? `<div class="small muted">${esc(p.repoUrl)}</div>` : ''}` },
    { label: 'Last scan (7d)', key: (p) => p.lastScan?.status ?? '', html: (p) => (p.lastScan ? `<span class="status ${esc(p.lastScan.status)}">${esc(p.lastScan.status)}</span> ${scanTypeBadge(p.lastScan.scanType)} <span class="small muted">${ago(p.lastScan.updatedAt ?? p.lastScan.createdAt)}</span>` : '<span class="muted">—</span>') },
    { label: 'Critical', n: true, key: (p) => p.findings?.critical ?? -1, html: (p) => fmt(p.findings?.critical) },
    { label: 'High', n: true, key: (p) => p.findings?.high ?? -1, html: (p) => fmt(p.findings?.high) },
    { label: 'Medium', n: true, key: (p) => p.findings?.medium ?? -1, html: (p) => fmt(p.findings?.medium) },
    { label: 'Low', n: true, key: (p) => p.findings?.low ?? -1, html: (p) => fmt(p.findings?.low) },
    { label: 'Credits 30d', n: true, key: (p) => p.credits?.credits ?? -1, html: (p) => (p.credits ? `${fmt(Math.round(p.credits.credits * 10) / 10)}${p.credits.triage || p.credits.remediation ? `<div class="small muted">${p.credits.triage} triage · ${p.credits.remediation} fix</div>` : ''}` : '—') },
    { label: 'Created', key: (p) => Date.parse(p.createdAt) || 0, html: (p) => `<span class="small muted">${ago(p.createdAt)}</span>` },
    { label: 'Alerts', html: (p) => (current.canEdit ? `<button class="btn sm" data-mute-project="${esc(p.id)}">${p.muted ? 'Unmute' : 'Mute'}</button>` : p.muted ? 'Muted' : '') },
  ];
  const c = t?.credits;
  const ai = t?.ai;
  const hosts = [...new Set((t?.projects ?? []).map((p) => { try { return new URL(p.repoUrl).host; } catch { return ''; } }).filter(Boolean))];
  return `
    <div class="toolbar">
      <span class="health"><span class="dot ${r.live.refreshing ? 'loading' : r.live.health}"></span>${esc(r.live.refreshing ? 'Reading…' : HEALTH[r.live.health])}${s ? ` · read ${ago(s.at)}` : ''}${r.live.nextAt ? ` · next ${ago(r.live.nextAt)}` : o.stage !== 'pov' ? ' · read on request (POV not running)' : ''}</span>
      <span class="spacer"></span>
      <button class="btn" data-act="refresh">Refresh now</button>
      ${can('tenant.logs') ? '<button class="btn" data-act="bundle" title="Every failed scan of the last 7 days, with its engine logs, in one file">Troubleshooting bundle</button>' : ''}
      ${current.canEdit ? `<select id="mute" aria-label="Mute alerts"><option value="">${muteUntil ? (muteUntil === 'forever' ? 'Muted until unmuted' : `Muted until ${when(muteUntil)}`) : 'Alerts on'}</option><option value="off">Unmute</option><option value="1">Mute 1 hour</option><option value="8">Mute 8 hours</option><option value="24">Mute 24 hours</option><option value="168">Mute 7 days</option><option value="forever">Mute until unmuted</option></select>` : ''}
      ${current.canEdit ? '<button class="btn ghost" data-act="connect">Replace key</button><button class="btn ghost danger" data-act="disconnect">Disconnect</button>' : ''}
    </div>
    ${r.live.error && r.live.health === 'failed' ? `<div class="panel body bad-t" style="margin-bottom:14px">Last read failed ${ago(r.live.error.at)}: ${esc(r.live.error.message)}</div>` : ''}
    ${t?.errors?.length ? `<div class="panel body small muted" style="margin-bottom:14px">Partly read: ${esc(t.errors.map((e) => `${e.part}: ${e.message}`).join(' · '))}</div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="label">Tenant</div><div class="value" style="font-size:16px">${esc(o.tenant.tenant)}</div><div class="sub">${esc(o.tenant.regionLabel)}${t?.identity?.user ? ` · as ${esc(t.identity.user)}` : ''}</div></div>
      <div class="kpi ${o.tenant.keyExpiresAt && Date.parse(o.tenant.keyExpiresAt) - Date.now() < 14 * 864e5 ? 'warn' : ''}"><div class="label">Key expires</div><div class="value" style="font-size:16px">${o.tenant.keyExpiresAt ? day(o.tenant.keyExpiresAt) : 'never'}</div></div>
      <div class="kpi"><div class="label">Projects</div><div class="value">${fmt(s?.projects)}</div><div class="sub">${s?.newProjects7d ? `+${s.newProjects7d} this week` : ''}</div></div>
      <div class="kpi"><div class="label">Running now</div><div class="value">${fmt(s ? s.running + s.queued : null)}</div></div>
      <div class="kpi"><div class="label">Scans 24h / 7d</div><div class="value">${fmt(s?.scans24h)} / ${fmt(s?.scans7d)}</div></div>
      <div class="kpi ${s?.failed24h ? 'bad' : ''}"><div class="label">Failed 24h</div><div class="value">${fmt(s?.failed24h)}</div></div>
      <div class="kpi"><div class="label">Fusion / LAST 7d</div><div class="value">${fmt(s?.fusion7d)} / ${fmt(s?.last7d)}</div></div>
      <div class="kpi"><div class="label">Critical / High</div><div class="value">${fmt(s?.findings?.critical)} / ${fmt(s?.findings?.high)}</div></div>
    </div>
    <div class="grid3" style="margin-bottom:16px">
      <section class="panel"><div class="head"><h3>Credits</h3><span class="small muted">GET /api/credits</span></div><div class="body">
        ${c ? `<div class="stats"><div class="stat"><div class="v">${fmt(c.available)}</div><div class="l">Available</div></div><div class="stat"><div class="v">${fmt(c.used)}</div><div class="l">Used</div></div><div class="stat"><div class="v">${fmt(c.total)}</div><div class="l">Total</div></div><div class="stat"><div class="v">${fmt(Math.round(c.used30d ?? 0))}</div><div class="l">Used 30 d</div></div></div>
        ${c.total ? `<div class="progress" style="margin:10px 0"><span style="width:${Math.min(100, (100 * (c.used ?? 0)) / c.total)}%"></span></div>` : ''}
        <div class="small muted">AI actions in 30 days: ${fmt(c.actions?.triage)} triage · ${fmt(c.actions?.remediation)} remediation${c.actions?.other ? ` · ${fmt(c.actions.other)} other` : ''}${c.state ? ` · enforcement ${esc(c.state)}` : ''}</div>` : '<span class="muted">This tenant does not report credits (no AI licence, or the key lacks the permission).</span>'}
      </div></section>
      <section class="panel"><div class="head"><h3>Integrations & engines seen</h3><span class="small muted">last 7 days</span></div><div class="body stack" style="gap:8px">
        <div><span class="small muted">Scans came from</span><div class="row small">${(s?.origins ?? []).map((x) => `<span class="badge">${esc(x.name)} · ${x.count}</span>`).join('') || '<span class="muted">—</span>'}</div></div>
        <div><span class="small muted">Engines in completed scans</span><div class="row small">${(s?.engines ?? []).map((e) => `<span class="badge">${esc(e)}</span>`).join('') || '<span class="muted">—</span>'}</div></div>
        <div><span class="small muted">Code hosts of projects</span><div class="row small">${hosts.map((h) => `<span class="badge">${esc(h)}</span>`).join('') || '<span class="muted">—</span>'}</div></div>
        <div><span class="small muted">AI settings</span><div class="row small">${ai ? `<span class="badge ${ai.fusionEnabled ? 'fusion' : ''}">Fusion ${ai.fusionEnabled === null ? 'not set' : ai.fusionEnabled ? 'on' : 'off'}</span><span class="badge ${ai.llmBased ? 'last' : ''}">LLM-based scanning ${ai.llmBased === null ? 'not set' : ai.llmBased ? 'on' : 'off'}</span>${ai.model ? `<span class="badge">Model ${esc(ai.model)}</span>` : ''}` : '<span class="muted">Not readable with this key</span>'}</div></div>
      </div></section>
      <section class="panel"><div class="head"><h3>Activity</h3></div>${feed(t?.events ?? [], [d.row], { showOpp: false })}</section>
    </div>
    ${peopleSection(t?.people)}
    <div class="stack">
      ${t?.active?.length ? `<section class="panel"><div class="head"><h3>Running and queued</h3></div>${table('t-active', scanCols.slice(0, 8), t.active)}</section>` : ''}
      <section class="panel"><div class="head"><h3>Scans · last 7 days</h3><span class="small muted">${(s?.people ?? []).map((p) => `${esc(p.name)} (${p.scans})`).join(', ')}</span></div>${table('t-scans', scanCols, t?.scans ?? [])}</section>
      <section class="panel"><div class="head"><h3>Projects</h3><input type="search" id="projQ" placeholder="Filter projects"></div><div id="projTable">${table('t-projects', projCols, t?.projects ?? [])}</div></section>
      ${c?.byProject?.length ? `<section class="panel"><div class="head"><h3>Credit consumption by project · 30 days</h3></div>${table('t-credits', [
        { label: 'Project', key: (x) => x.name, html: (x) => esc(x.name) },
        { label: 'Credits', n: true, key: (x) => x.credits, html: (x) => fmt(Math.round(x.credits * 10) / 10) },
        { label: 'AI triage', n: true, key: (x) => x.triage, html: (x) => fmt(x.triage) },
        { label: 'AI remediation', n: true, key: (x) => x.remediation, html: (x) => fmt(x.remediation) },
        { label: 'Other', n: true, key: (x) => x.other, html: (x) => fmt(x.other) },
      ], c.byProject)}</section>` : ''}
    </div>`;
}

// ——— People in the tenant (IAM) ———
const PEOPLE_STATUS = { active: ['Active', 'ok'], quiet: ['This week', 'warn'], inactive: ['Inactive', 'bad'], never: ['Never signed in', 'bad'], unknown: ['Not known', ''] };
function peopleSection(p) {
  if (!p) return '';
  const cols = [
    { label: 'Person', key: (u) => u.name || u.email || u.username, html: (u) => `<b>${esc(u.name || u.email || u.username)}</b>${u.name && (u.email || u.username) ? `<div class="small muted">${esc(u.email || u.username)}</div>` : ''}${u.inIam ? '' : '<div class="small muted">not in IAM (service or CI account)</div>'}` },
    { label: 'Status', key: (u) => ['active', 'quiet', 'inactive', 'unknown', 'never'].indexOf(u.status), html: (u) => `<span class="badge ${PEOPLE_STATUS[u.status][1]}">${PEOPLE_STATUS[u.status][0]}</span>${u.enabled === false ? ' <span class="badge">disabled</span>' : ''}` },
    { label: 'Sign-ins 7d', n: true, key: (u) => u.logins7d ?? -1, html: (u) => (u.logins7d === null ? '—' : fmt(u.logins7d)) },
    { label: 'Scans 7d', n: true, key: (u) => u.scans7d, html: (u) => fmt(u.scans7d) },
    { label: 'Last active', key: (u) => Date.parse(u.lastActiveAt) || 0, html: (u) => (u.lastActiveAt ? `<span title="${esc(when(u.lastActiveAt))}">${ago(u.lastActiveAt)}</span>` : '—') },
    { label: 'Account since', key: (u) => Date.parse(u.createdAt) || 0, html: (u) => (u.createdAt ? day(u.createdAt) : '—') },
  ];
  const note = !p.iamRead ? 'This key cannot read the tenant’s IAM directory (it needs the IAM “view-users” role), so only the people who started scans are listed.' : !p.eventsKnown ? 'Sign-ins are not known: the tenant’s IAM does not keep login events, or the key may not read them (“view-events”). Activity comes from scans.' : 'From the tenant’s IAM (users and sign-ins) and the scans each person started.';
  return `<section class="panel" style="margin-bottom:16px"><div class="head"><h3>People in the tenant</h3><div class="row center small">${p.total !== null ? `<span class="badge">${p.total} users</span>` : ''}<span class="badge ok">${p.active} active</span><span class="badge warn">${p.quiet} this week</span><span class="badge bad">${p.inactive} inactive</span></div></div>
    <div class="body small muted" style="padding-bottom:0">${esc(note)}</div>${table('t-people', cols, p.users, { empty: 'Nobody yet.' })}</section>`;
}

async function askResult() {
  let result = '';
  await openDialog(`<div class="dbody"><h2>The POV is complete</h2><p class="muted" style="margin:0">Was it successful? A successful POV gets its final presentation, ready to share with the stakeholders.</p><div class="dialog-actions"><button class="btn ghost" data-r="">Cancel</button><button class="btn" data-r="unsuccessful">Not successful</button><button class="btn primary" data-r="successful">Successful</button></div></div>`, {
    onOpen(d) {
      for (const b of d.querySelectorAll('[data-r]')) b.addEventListener('click', () => ((result = b.dataset.r), closeDialog()));
    },
  });
  return result;
}

// ——— Success criteria ———
function criteria(d) {
  const o = d.opportunity;
  const cats = new Map([...state.meta.categories, ['custom', 'Custom']]);
  const groups = new Map();
  for (const c of o.criteria ?? []) {
    const k = cats.get(c.category) ?? 'Custom';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const evLine = (c) => {
    const ev = d.evidence[c.id];
    if (!ev || ev.level === 'none') return '';
    return `<div class="ev ev-${ev.level}">${ev.level === 'detected' ? '● Detected in the tenant' : '○ Mentioned in notes'}: ${ev.evidence.map(esc).join(' · ')}${ev.level === 'detected' && c.status !== 'met' && current.canEdit ? ` <button class="btn sm" data-met="${esc(c.id)}">Confirm met</button>` : ''}</div>`;
  };
  return `<div class="toolbar">
      <div style="min-width:280px;flex:1">${progressBar(d.row.progress)}</div>
      ${current.canEdit ? '<button class="btn primary" data-act="add-caps">Add from capabilities</button><button class="btn" data-act="add-custom">Custom criterion</button>' : ''}
    </div>
    ${groups.size ? [...groups].map(([label, list]) => `<section class="panel" style="margin-bottom:14px"><div class="head"><h3>${esc(label)}</h3><span class="small muted">${list.filter((c) => c.status === 'met').length}/${list.filter((c) => c.status !== 'na').length} met</span></div><div class="body list">${list.map((c) => `
      <div class="item crit">
        <div>
          <div><b>${esc(c.title)}</b> ${c.priority === 'nice' ? '<span class="badge">nice to have</span>' : '<span class="badge accent">must</span>'} ${c.due ? `<span class="badge">${day(c.due)}</span>` : ''}</div>
          ${(() => {
            const cap = c.capabilityId ? catalog.catalog.find((x) => x.id === c.capabilityId) : null;
            const own = [...(c.engines ?? []).map((e) => `engine "${e}"`), ...(c.origins ?? []).map((o) => `origin "${o}"`)];
            return `${cap ? `<div class="small muted">Checkmarx One: ${esc(cap.cxName)} ${cap.isNew ? '<span class="badge accent">New</span>' : ''}</div>` : ''}
              ${cap?.proof || cap?.tech || own.length ? `<details class="small proof"><summary>How it is proven</summary>${cap?.proof ? `<div><b>Show the customer:</b> ${esc(cap.proof)}</div>` : ''}${cap?.tech ? `<div><b>How CommandCenter checks:</b> ${esc(cap.tech)}</div>` : ''}${own.length ? `<div><b>Also counted for this criterion:</b> ${esc(own.join(', '))}</div>` : ''}</details>` : ''}`;
          })()}
          ${evLine(c)}
          ${c.notes ? `<div class="small notes-box" style="margin-top:4px">${esc(c.notes)}</div>` : ''}
          ${c.evidenceLink ? `<div class="small"><a href="${esc(c.evidenceLink)}" target="_blank" rel="noopener noreferrer">Evidence ↗</a></div>` : ''}
          ${c.confirmedAt ? `<div class="small muted">Confirmed by ${esc(person(c.confirmedBy))} ${ago(c.confirmedAt)}</div>` : ''}
        </div>
        <div class="stack" style="gap:6px">
          <select data-status="${esc(c.id)}" ${ro()} aria-label="Status">${Object.entries(state.meta.criterionStatus).map(([k, l]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${current.canEdit ? `<div class="row"><button class="btn sm" data-edit-crit="${esc(c.id)}">Edit</button><button class="btn sm ghost danger" data-del-crit="${esc(c.id)}">Remove</button></div>` : ''}
        </div>
      </div>`).join('')}</div></section>`).join('') : '<div class="empty panel">No success criteria yet. Add the capabilities the customer wants to see; CommandCenter then looks for the evidence in the tenant and in your notes.</div>'}`;
}

// ——— Discovery ———
function discovery(d) {
  const x = d.opportunity.discovery ?? {};
  const area = (k, label, rows = 3, ph = '') => `<label class="field">${label}<textarea name="${k}" rows="${rows}" ${ro()} placeholder="${esc(ph)}">${esc(x[k] ?? '')}</textarea></label>`;
  const picks = (k, cat, label) => `<fieldset class="item"><legend class="small muted">${label}</legend><div class="row">${catalog.catalog.filter((c) => c.category === cat).map((c) => `<label class="check"><input type="checkbox" data-list="1" name="${k}" value="${esc(c.id)}" ${(x[k] ?? []).includes(c.id) ? 'checked' : ''} ${ro()}>${esc(c.name.split(' (')[0].split(' — ')[0])}</label>`).join('')}</div></fieldset>`;
  return `<form id="discForm" class="stack">
    <div class="toolbar"><span class="muted small">Everything heard in discovery. Keywords here count as hints for the success criteria.</span><span class="spacer"></span>
      <button type="button" class="btn" data-act="copy-disc">Copy as text</button>
      <button type="button" class="btn" data-act="draft-disc">Draft recap email</button>
      ${current.canEdit ? '<button class="btn primary">Save discovery</button>' : ''}</div>
    <div class="grid2">
      ${area('goals', 'What they want to achieve', 4, 'Business drivers, compliance, the problem behind the project')}
      ${area('painPoints', 'Challenges today', 4, 'False positives, slow scans, developer adoption…')}
      ${area('currentTools', 'Tools in place today', 3, 'Current SAST/SCA vendors, contract dates')}
      ${area('environment', 'Environment', 3, 'Cloud / on-prem, network restrictions, SSO')}
      ${area('languages', 'Languages & frameworks', 2)}
      ${area('teamSize', 'Teams, developers, applications', 2)}
      ${area('timeline', 'Timeline & budget', 2)}
      ${area('decisionProcess', 'Decision process & people', 2)}
      ${area('competition', 'Competition', 2)}
    </div>
    ${picks('scm', 'scm', 'Source code management')}
    ${picks('ci', 'ci', 'CI/CD & build')}
    ${picks('tracking', 'tracking', 'Defect tracking & feedback')}
    ${picks('ide', 'ide', 'IDEs')}
    <fieldset class="item"><legend class="small muted">Capabilities they asked to see</legend>${capabilityPicker(catalog, { chosen: x.requested ?? [] }).replaceAll('name="capabilities"', 'name="requested"')}
      ${current.canEdit ? '<button type="button" class="btn sm" data-act="req-to-crit">Make these success criteria</button>' : ''}</fieldset>
    <div class="grid2">${area('notes', 'Other notes', 5)}${area('nextSteps', 'Next steps', 5)}</div>
  </form>`;
}

function discoveryText(o) {
  const x = o.discovery ?? {};
  const names = (ids) => (ids ?? []).map(capName).join(', ') || '—';
  return [`${o.customer} — discovery`, '', ['What they want to achieve', x.goals], ['Challenges today', x.painPoints], ['Tools in place today', x.currentTools], ['Environment', x.environment], ['Languages & frameworks', x.languages], ['Teams', x.teamSize], ['Timeline & budget', x.timeline], ['Decision process', x.decisionProcess], ['Competition', x.competition]].map((v) => (Array.isArray(v) ? `${v[0]}\n${v[1] || '—'}\n` : v)).join('\n') + `\nSource code management: ${names(x.scm)}\nCI/CD: ${names(x.ci)}\nDefect tracking: ${names(x.tracking)}\nIDEs: ${names(x.ide)}\nAsked to see: ${names(x.requested)}\n\nNotes\n${x.notes || '—'}\n\nNext steps\n${x.nextSteps || '—'}\n`;
}

// ——— Sessions ———
function sessions(d) {
  const list = [...(d.opportunity.sessions ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="toolbar"><span class="muted small">Discovery calls, technical sessions, workshops, checkpoints and the readout.</span><span class="spacer"></span>${current.canEdit ? '<button class="btn primary" data-act="add-session">Session</button>' : ''}</div>
    <div class="list">${list.map((x) => `<div class="item"><div class="top"><div><b>${esc(x.title)}</b> <span class="badge">${esc(state.meta.sessionTypes[x.type] ?? x.type)}</span></div><span class="small muted">${day(x.date)}</span></div>
      ${x.attendees ? `<div class="small muted">${esc(x.attendees)}</div>` : ''}
      ${x.notes ? `<div class="notes-box" style="margin-top:6px">${esc(x.notes)}</div>` : ''}
      ${x.followUps ? `<div style="margin-top:6px"><b class="small">Follow-ups</b><div class="notes-box small">${esc(x.followUps)}</div></div>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn sm" data-copy-session="${esc(x.id)}">Copy</button>${current.canEdit ? `<button class="btn sm" data-edit-session="${esc(x.id)}">Edit</button><button class="btn sm ghost danger" data-del-session="${esc(x.id)}">Remove</button>` : ''}</div></div>`).join('') || '<div class="empty panel">No sessions yet.</div>'}</div>`;
}

// ——— Notes & tasks ———
function notes(d) {
  const o = d.opportunity;
  const list = [...(o.notes ?? [])].sort((a, b) => (b.pinned - a.pinned) || b.at.localeCompare(a.at));
  const tasks = [...(o.tasks ?? [])].sort((a, b) => a.done - b.done || (a.due || '9999').localeCompare(b.due || '9999'));
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="layout"><div class="stack">
    ${current.canEdit ? `<form id="noteForm" class="panel body stack" style="gap:8px"><textarea name="text" rows="3" placeholder="A note: what happened, what was decided, what to remember." required></textarea><div class="row"><label class="check"><input type="checkbox" name="pinned"> Pin</label><span class="spacer"></span><button class="btn primary">Add note</button></div></form>` : ''}
    <div class="list">${list.map((n) => `<div class="item"><div class="top"><span class="small muted">${n.pinned ? 'Pinned · ' : ''}${esc(person(n.by))} · <span title="${esc(when(n.at))}">${ago(n.at)}</span></span><span class="row"><button class="btn sm" data-copy-note="${esc(n.id)}">Copy</button>${current.canEdit ? `<button class="btn sm" data-pin-note="${esc(n.id)}">${n.pinned ? 'Unpin' : 'Pin'}</button><button class="btn sm ghost danger" data-del-note="${esc(n.id)}">Remove</button>` : ''}</span></div><div class="notes-box">${esc(n.text)}</div></div>`).join('') || '<div class="empty panel">No notes yet.</div>'}</div>
  </div>
  <section class="panel"><div class="head"><h3>Tasks</h3></div><div class="body stack" style="gap:8px">
    ${current.canEdit ? `<form id="taskForm" class="row"><input name="title" placeholder="New task" required style="flex:1;min-width:140px"><input type="date" name="due" aria-label="Due"><button class="btn">Add</button></form>` : ''}
    ${tasks.map((t) => `<div class="row center"><label class="check" style="flex:1"><input type="checkbox" data-task="${esc(t.id)}" ${t.done ? 'checked' : ''} ${ro()}><span style="${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</span></label><span class="small ${!t.done && t.due && t.due < today ? 'bad-t' : 'muted'}">${t.due ? day(t.due) : ''}</span>${current.canEdit ? `<button class="btn sm ghost" data-del-task="${esc(t.id)}" aria-label="Remove">✕</button>` : ''}</div>`).join('') || '<span class="muted">No tasks.</span>'}
  </div></section></div>`;
}

// ——— Stakeholders & email ———
function email(d) {
  const o = d.opportunity;
  const cols = [
    { label: 'Name', key: (p) => p.name, html: (p) => `<b>${esc(p.name)}</b><div class="small muted">${esc(p.title)}</div>` },
    { label: 'Email', key: (p) => p.email, html: (p) => (p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '—') },
    { label: 'Side', key: (p) => p.side, html: (p) => (p.side === 'internal' ? 'Internal (cc)' : 'Customer (to)') },
    { label: 'Gets emails', key: (p) => p.notify, html: (p) => (p.notify ? '✓' : '—') },
    { label: '', html: (p) => (current.canEdit ? `<button class="btn sm" data-edit-person="${esc(p.id)}">Edit</button> <button class="btn sm ghost danger" data-del-person="${esc(p.id)}">Remove</button>` : '') },
  ];
  return `<section class="panel" style="margin-bottom:16px"><div class="head"><h3>Stakeholders</h3>${current.canEdit ? '<button class="btn sm" data-act="add-person">Stakeholder</button>' : ''}</div>${table('people', cols, o.stakeholders ?? [], { empty: 'Add the customer’s champion, decision makers and your account team.' })}</section>
  <div class="layout"><section class="panel"><div class="head"><h3>Write an email</h3><div class="row center">${Object.entries(state.meta.templates).map(([k, l]) => `<button class="btn sm" data-template="${k}">${esc(l)}</button>`).join('')}</div></div>
    <form id="mailForm" class="body stack" style="gap:8px">
      <input type="hidden" name="template">
      <label class="field">To<input name="to" placeholder="name@customer.com, …"></label>
      <label class="field">Cc<input name="cc"></label>
      <label class="field">Subject<input name="subject"></label>
      <label class="field">Message<textarea name="body" rows="18" class="copy-area"></textarea></label>
      <label class="check"><input type="checkbox" name="attachDeck" id="attachDeck"> Attach the final presentation (.pptx)</label>
      <div class="row">
        ${can('mail.send') && current.canEdit ? `<button class="btn primary" data-mail="send" ${d.mailConfigured ? '' : 'disabled title="No email server is set up (Settings → Email)"'}>Send</button>` : ''}
        <button class="btn" type="button" data-mail="eml" title="Opens in Outlook or your mail app, ready to send">Download .eml</button>
        <button class="btn" type="button" data-mail="mailto">Open in mail app</button>
        <button class="btn" type="button" data-mail="copy">Copy</button>
      </div>
      ${d.mailConfigured ? '' : '<p class="small muted" style="margin:0">No email server is set up, so Send is off: download the .eml or copy it into your own mail.</p>'}
    </form></section>
    <section class="panel"><div class="head"><h3>Outbox</h3></div><ul class="feed">${d.outbox.map((m) => `<li data-outbox="${esc(m.id)}" style="cursor:pointer"><span class="icon">${m.status === 'sent' ? '✉' : m.status === 'draft' ? '✎' : '⇩'}</span><div><div class="t">${esc(m.subject)}</div><div class="m">${esc(m.status)} · ${esc((m.to ?? []).join(', '))}${m.by ? ` · ${esc(person(m.by))}` : ' · scheduled draft'}</div></div><span class="when">${ago(m.at)}</span></li>`).join('') || '<li class="empty" style="display:block">Nothing yet.</li>'}</ul></section></div>`;
}

// ——— Report ———
function report(d) {
  const o = d.opportunity;
  return `<section class="panel"><div class="body stack">
    <p style="margin:0">The success-criteria report: the answer first, every criterion with its status and evidence, the sessions held and what the tenant showed. It prints to PDF from the browser.</p>
    <div class="row"><a class="btn primary" href="/api/opportunities/${esc(o.id)}/report" target="_blank" rel="noopener">Open the report</a><button class="btn" data-act="dl-report">Download HTML</button><button class="btn" data-act="deck">Final presentation (.pptx)</button>${o.sharepointUrl ? `<a class="btn" href="${esc(o.sharepointUrl)}" target="_blank" rel="noopener noreferrer">Open SharePoint ↗</a>` : ''}</div>
    <p class="small muted" style="margin:0">To keep it with the customer's documents, save it as PDF and put it in the SharePoint site${o.sharepointUrl ? '' : ' (add its link under Edit details)'}. Publishing to SharePoint by itself needs a Microsoft Graph app registration; the report layout will follow the formats you supply.</p>
  </div></section>`;
}

// ——— History ———
function history(d) {
  const list = [...(d.opportunity.history ?? [])].reverse();
  return `<section class="panel"><ul class="feed" style="max-height:none">${list.map((h) => `<li><span class="icon">✎</span><div><div class="t">${esc(h.what)}</div><div class="m">${esc(person(h.by))}</div></div><span class="when" title="${esc(when(h.at))}">${ago(h.at)}</span></li>`).join('') || '<li class="empty" style="display:block">No changes yet.</li>'}</ul></section>`;
}

const VIEWS = { overview, tenant, criteria, discovery, sessions, notes, email, report, history };

// ——— Wiring ———
const on = (root, sel, fn) => $$(sel, root).forEach((el) => el.addEventListener('click', (e) => fn(el, e)));

const WIRES = {
  overview(main) {
    on(main, '[data-act="save-summary"]', () => save({ summary: $('#summary').value }));
    on(main, '[data-act="deck"]', () => attempt(() => download(`/opportunities/${oid()}/deck`), 'Presentation downloaded'));
    on(main, '[data-act="share-deck"]', () => (location.hash = `#/opp/${oid()}/email?completion`));
    on(main, '[data-result]', (b) => save({ povResult: b.dataset.result }, b.dataset.result === 'successful' ? 'POV marked successful' : 'Saved'));
    on(main, '[data-act="connect"]', connectTenant);
  },
  tenant(main, d) {
    on(main, '[data-act="connect"]', connectTenant);
    on(main, '[data-act="refresh"]', async () => {
      if (await attempt(() => api(`/opportunities/${oid()}/refresh`, { method: 'POST' }), 'Reading the tenant…')) setTimeout(rerender, 400);
    });
    on(main, '[data-act="disconnect"]', async () => {
      if (!confirm('Disconnect this tenant and delete its stored API key? Nothing changes in Checkmarx One.')) return;
      if (await attempt(() => api(`/opportunities/${oid()}/tenant`, { method: 'DELETE' }), 'Disconnected')) rerender();
    });
    on(main, '[data-act="bundle"]', () => attempt(() => download(`/opportunities/${oid()}/troubleshoot`), 'Bundle downloaded'));
    on(main, '[data-log]', (b) => {
      const [scan, engine] = b.dataset.log.split('|');
      attempt(() => download(`/opportunities/${oid()}/logs/${encodeURIComponent(scan)}/${encodeURIComponent(engine)}`), 'Log downloaded');
    });
    $('#mute')?.addEventListener('change', async (e) => {
      const v = e.target.value;
      if (!v) return;
      const until = v === 'off' ? null : v === 'forever' ? 'forever' : new Date(Date.now() + Number(v) * 3600e3).toISOString();
      if (await attempt(() => api(`/opportunities/${oid()}/mute`, { method: 'PUT', body: { until, projects: d.opportunity.mute?.projects ?? [] } }), until ? 'Muted' : 'Unmuted')) rerender();
    });
    on(main, '[data-mute-project]', async (b) => {
      const id = b.dataset.muteProject;
      const set = new Set(d.opportunity.mute?.projects ?? []);
      set.has(id) ? set.delete(id) : set.add(id);
      if (await attempt(() => api(`/opportunities/${oid()}/mute`, { method: 'PUT', body: { until: d.opportunity.mute?.until ?? null, projects: [...set] } }))) rerender();
    });
    $('#projQ')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const tr of $$('#projTable tbody tr')) tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
    });
  },
  criteria(main, d) {
    on(main, '[data-act="add-caps"]', addCapabilities);
    on(main, '[data-act="add-custom"]', () => editCriterion(null));
    on(main, '[data-edit-crit]', (b) => editCriterion(d.opportunity.criteria.find((c) => c.id === b.dataset.editCrit)));
    on(main, '[data-del-crit]', (b) => removeItem('criteria', b.dataset.delCrit, 'this success criterion'));
    on(main, '[data-met]', (b) => {
      const c = d.opportunity.criteria.find((x) => x.id === b.dataset.met);
      item('criteria', { ...c, status: 'met' }, `"${c.title}" met`);
    });
    for (const s of $$('[data-status]', main))
      s.addEventListener('change', () => {
        const c = d.opportunity.criteria.find((x) => x.id === s.dataset.status);
        item('criteria', { ...c, status: s.value }, `${state.meta.criterionStatus[s.value]}`);
      });
  },
  discovery(main, d) {
    const form = $('#discForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = formData(form);
      for (const k of ['scm', 'ci', 'tracking', 'ide', 'requested']) data[k] ??= [];
      save({ discovery: data }, 'Discovery saved');
    });
    on(main, '[data-act="copy-disc"]', () => copy(discoveryText(d.opportunity)));
    on(main, '[data-act="draft-disc"]', () => (location.hash = `#/opp/${oid()}/email?discovery`));
    on(main, '[data-act="req-to-crit"]', async () => {
      const ids = $$('input[name="requested"]:checked', form).map((x) => x.value);
      if (!ids.length) return toast('Tick what they asked to see first.', { bad: true });
      if (await attempt(() => api(`/opportunities/${oid()}/criteria/bulk`, { method: 'POST', body: { capabilityIds: ids } }), 'Added as success criteria')) rerender();
    });
  },
  sessions(main, d) {
    on(main, '[data-act="add-session"]', () => editSession(null));
    on(main, '[data-edit-session]', (b) => editSession(d.opportunity.sessions.find((x) => x.id === b.dataset.editSession)));
    on(main, '[data-del-session]', (b) => removeItem('sessions', b.dataset.delSession, 'this session'));
    on(main, '[data-copy-session]', (b) => {
      const x = d.opportunity.sessions.find((s) => s.id === b.dataset.copySession);
      copy(`${x.title} — ${day(x.date)}\n${x.attendees ? `Attendees: ${x.attendees}\n` : ''}\n${x.notes}\n${x.followUps ? `\nFollow-ups\n${x.followUps}\n` : ''}`);
    });
  },
  notes(main, d) {
    $('#noteForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      item('notes', formData(e.target), 'Note added');
    });
    $('#taskForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      item('tasks', formData(e.target), 'Task added');
    });
    on(main, '[data-copy-note]', (b) => copy(d.opportunity.notes.find((n) => n.id === b.dataset.copyNote).text));
    on(main, '[data-pin-note]', (b) => {
      const n = d.opportunity.notes.find((x) => x.id === b.dataset.pinNote);
      item('notes', { ...n, pinned: !n.pinned });
    });
    on(main, '[data-del-note]', (b) => removeItem('notes', b.dataset.delNote, 'this note'));
    on(main, '[data-del-task]', (b) => removeItem('tasks', b.dataset.delTask, 'this task'));
    for (const c of $$('[data-task]', main))
      c.addEventListener('change', () => {
        const t = d.opportunity.tasks.find((x) => x.id === c.dataset.task);
        item('tasks', { ...t, done: c.checked }, c.checked ? 'Done' : 'Reopened');
      });
  },
  email(main, d) {
    const form = $('#mailForm');
    const fill = (m) => {
      form.template.value = m.template ?? '';
      form.to.value = (m.to ?? []).join(', ');
      form.cc.value = (m.cc ?? []).join(', ');
      form.subject.value = m.subject ?? '';
      form.body.value = m.body ?? '';
      form.attachDeck.checked = m.template === 'completion';
    };
    const load = async (template) => {
      const m = await attempt(() => api(`/opportunities/${oid()}/email/draft`, { method: 'POST', body: { template } }));
      if (m) fill(m);
    };
    on(main, '[data-template]', (b) => load(b.dataset.template));
    on(main, '[data-outbox]', (li) => fill(d.outbox.find((m) => m.id === li.dataset.outbox)));
    if (location.hash.endsWith('?discovery')) load('discovery');
    if (location.hash.endsWith('?completion')) load('completion');
    const msg = () => formData(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm(`Send "${form.subject.value}" to ${form.to.value}?`)) return;
      if (await attempt(() => api(`/opportunities/${oid()}/email/send`, { method: 'POST', body: msg() }), 'Sent')) rerender();
    });
    on(main, '[data-mail="eml"]', () => attempt(() => download(`/opportunities/${oid()}/email/eml`, msg(), 'email.eml')));
    on(main, '[data-mail="mailto"]', () => {
      const m = msg();
      const href = `mailto:${encodeURIComponent(m.to).replace(/%2C/g, ',')}?${new URLSearchParams({ cc: m.cc, subject: m.subject, body: m.body }).toString().replace(/\+/g, '%20')}`;
      if (href.length > 1900) toast('Long emails may be cut off by mailto; Download .eml keeps all of it.');
      location.href = href;
    });
    on(main, '[data-mail="copy"]', () => {
      const m = msg();
      copy(`To: ${m.to}\n${m.cc ? `Cc: ${m.cc}\n` : ''}Subject: ${m.subject}\n\n${m.body}`);
    });
    on(main, '[data-act="add-person"]', () => editPerson(null));
    on(main, '[data-edit-person]', (b) => editPerson(d.opportunity.stakeholders.find((x) => x.id === b.dataset.editPerson)));
    on(main, '[data-del-person]', (b) => removeItem('stakeholders', b.dataset.delPerson, 'this stakeholder'));
  },
  report(main) {
    on(main, '[data-act="dl-report"]', () => attempt(() => download(`/opportunities/${oid()}/report?download=1`)));
    on(main, '[data-act="deck"]', () => attempt(() => download(`/opportunities/${oid()}/deck`), 'Presentation downloaded'));
  },
};

// ——— Dialogs ———
function dialogForm(id, title, inner, onSubmit, { wide = false } = {}) {
  return openDialog(`<form id="${id}"><h2>${title}</h2>${inner}<p class="form-error" id="${id}Err" role="alert"></p><div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, {
    wide,
    onOpen(d) {
      d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
      d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await onSubmit(formData(e.target), e.target);
          closeDialog('ok');
          rerender();
        } catch (error) {
          $(`#${id}Err`).textContent = error.message;
        }
      });
    },
  });
}

function editDetails() {
  const o = current.opportunity;
  return dialogForm(
    'details',
    'Opportunity details',
    `<div class="row"><label class="field">Customer<input name="customer" value="${esc(o.customer)}" required></label><label class="field">Name<input name="name" value="${esc(o.name)}"></label></div>
     <div class="row">${can('opps.reassign') ? `<label class="field">SE (owner)<select name="ownerId">${peopleOptions(o.ownerId)}</select></label>` : ''}<label class="field">Stage<select name="stage">${Object.entries(state.meta.stages).map(([k, l]) => `<option value="${k}" ${o.stage === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="field">Value<input name="amount" value="${esc(o.amount)}" placeholder="e.g. $250k ARR"></label></div>
     <div class="row"><label class="field">POV start<input type="date" name="startDate" value="${esc(o.startDate)}"></label><label class="field">POV end<input type="date" name="endDate" value="${esc(o.endDate)}"></label></div>
     <label class="field">Salesforce opportunity link<input name="salesforceUrl" type="url" value="${esc(o.salesforceUrl)}"></label>
     <label class="field">SharePoint site link<input name="sharepointUrl" type="url" value="${esc(o.sharepointUrl)}"></label>
     <div class="row"><button type="button" class="btn ghost danger" id="delOpp">Delete this opportunity</button></div>`,
    (b) => api(`/opportunities/${oid()}`, { method: 'PATCH', body: b }),
  ).then(() => {});
}
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'delOpp') return;
  if (!confirm(`Delete "${current.opportunity.customer}" with all its notes, criteria and stored key? This cannot be undone.`)) return;
  if (await attempt(() => api(`/opportunities/${oid()}`, { method: 'DELETE' }), 'Deleted')) {
    closeDialog();
    location.hash = '#/dashboard';
  }
});

function connectTenant() {
  const o = current.opportunity;
  return dialogForm(
    'tenantForm',
    o.tenant ? 'Replace the API key' : 'Connect the POV tenant',
    `<p class="muted" style="margin:0">Paste the Checkmarx One API key of the POV tenant. The tenant, region and hosts come from the key; it is checked with Checkmarx One and stored encrypted on this server. Read-only use: CommandCenter never changes anything in the tenant.</p>
     <textarea name="apiKey" class="mono" rows="4" required spellcheck="false" autocomplete="off" placeholder="eyJhbGciOi…"></textarea>
     ${o.tenant ? '<label class="check"><input type="checkbox" name="replaceTenant"> Connect a different tenant</label>' : ''}
     <details><summary class="small muted" style="cursor:pointer">Single-tenant or on-prem addresses</summary><div class="row" style="margin-top:8px"><label class="field">IAM URL<input name="iamUrl"></label><label class="field">API URL<input name="baseUrl"></label><label class="field">Tenant<input name="tenant"></label></div></details>`,
    (b) => api(`/opportunities/${oid()}/tenant`, { method: 'POST', body: { apiKey: b.apiKey, replaceTenant: b.replaceTenant, overrides: { iamUrl: b.iamUrl, baseUrl: b.baseUrl, tenant: b.tenant } } }),
  ).then((v) => v === 'ok' && toast('Connected. Reading the tenant…'));
}

async function addCapabilities() {
  const cat = await getCatalog();
  const have = current.opportunity.criteria.map((c) => c.capabilityId).filter(Boolean);
  return dialogForm(
    'capsForm',
    'Add success criteria',
    `<p class="muted" style="margin:0">Tick the capabilities the customer wants proven. Each becomes a criterion; CommandCenter looks for its evidence in the tenant and in your notes.</p>
     <label class="field" style="max-width:220px">Priority<select name="priority"><option value="must">Must have</option><option value="nice">Nice to have</option></select></label>${capabilityPicker(cat, { disabled: have })}
     <fieldset class="item"><legend class="small muted">Not in the list? Add an engine or capability</legend>
       <div class="row"><label class="field">Name<input name="newName" placeholder="e.g. AI Red Teaming"></label><label class="field">Group<select name="newCategory">${cat.categories.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label></div>
       <div class="row"><label class="field">Engine name in Checkmarx One scans<input name="newEngines" placeholder="e.g. llm-scanner"></label><label class="field">Keywords<input name="newKeywords" placeholder="e.g. red team, jailbreak"></label></div>
       <p class="small muted" style="margin:0">${can('catalog.manage') ? 'It is added to the capability catalogue for everyone, and as a criterion here.' : 'It is added as a criterion here, with these rules; ask a manager to add it to the catalogue for everyone.'}</p>
     </fieldset>`,
    async (b) => {
      if (b.newName?.trim()) {
        if (can('catalog.manage')) {
          const r = await api('/catalog', { method: 'POST', body: { name: b.newName, category: b.newCategory, cxName: b.newName, detect: { engines: b.newEngines, keywords: b.newKeywords } } });
          b.capabilities = [...(b.capabilities ?? []), r.capability.id];
          await getCatalog(true);
        } else {
          await api(`/opportunities/${oid()}/criteria`, { method: 'POST', body: { title: b.newName, category: b.newCategory, engines: b.newEngines, keywords: b.newKeywords, priority: b.priority } });
        }
      }
      return api(`/opportunities/${oid()}/criteria/bulk`, { method: 'POST', body: { capabilityIds: (b.capabilities ?? []).filter((x) => !have.includes(x)), priority: b.priority } });
    },
    { wide: true },
  );
}

function editCriterion(c) {
  return dialogForm(
    'critForm',
    c ? 'Edit success criterion' : 'Custom success criterion',
    `<label class="field">Criterion<input name="title" value="${esc(c?.title ?? '')}" required placeholder="e.g. Scan 5 core applications in under 30 minutes each"></label>
     <div class="row"><label class="field">Priority<select name="priority"><option value="must">Must have</option><option value="nice" ${c?.priority === 'nice' ? 'selected' : ''}>Nice to have</option></select></label>
     <label class="field">Status<select name="status">${Object.entries(state.meta.criterionStatus).map(([k, l]) => `<option value="${k}" ${c?.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
     <label class="field">Due<input type="date" name="due" value="${esc(c?.due ?? '')}"></label></div>
     <div class="row"><label class="field">Engine names that prove it (comma separated)<input name="engines" value="${esc((c?.engines ?? []).join(', '))}" placeholder="e.g. llm-scanner, aibom"></label><label class="field">Scan origins that prove it<input name="origins" value="${esc((c?.origins ?? []).join(', '))}" placeholder="e.g. jenkins, cursor"></label></div>
     <label class="field">Keywords that count as evidence (comma separated)<input name="keywords" value="${esc((c?.keywords ?? []).join(', '))}" placeholder="jira, ticket"></label>
     <label class="field">Notes<textarea name="notes" rows="4">${esc(c?.notes ?? '')}</textarea></label>
     <label class="field">Evidence link (screenshot, document)<input name="evidenceLink" type="url" value="${esc(c?.evidenceLink ?? '')}"></label>`,
    (b) => api(`/opportunities/${oid()}/criteria${c ? `/${c.id}` : ''}`, { method: 'POST', body: { ...(c ?? { category: 'custom' }), ...b } }),
  );
}

function editSession(x) {
  return dialogForm(
    'sessForm',
    x ? 'Edit session' : 'New session',
    `<div class="row"><label class="field">Date<input type="date" name="date" value="${esc(x?.date ?? new Date().toISOString().slice(0, 10))}" required></label><label class="field">Type<select name="type">${Object.entries(state.meta.sessionTypes).map(([k, l]) => `<option value="${k}" ${x?.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
     <label class="field">Title<input name="title" value="${esc(x?.title ?? '')}" placeholder="e.g. Jenkins and GitHub integration session"></label>
     <label class="field">Attendees<input name="attendees" value="${esc(x?.attendees ?? '')}"></label>
     <label class="field">Notes<textarea name="notes" rows="8">${esc(x?.notes ?? '')}</textarea></label>
     <label class="field">Follow-ups<textarea name="followUps" rows="3">${esc(x?.followUps ?? '')}</textarea></label>`,
    (b) => api(`/opportunities/${oid()}/sessions${x ? `/${x.id}` : ''}`, { method: 'POST', body: b }),
    { wide: true },
  );
}

function editPerson(p) {
  return dialogForm(
    'personForm',
    p ? 'Edit stakeholder' : 'New stakeholder',
    `<div class="row"><label class="field">Name<input name="name" value="${esc(p?.name ?? '')}" required></label><label class="field">Title<input name="title" value="${esc(p?.title ?? '')}"></label></div>
     <div class="row"><label class="field">Email<input type="email" name="email" value="${esc(p?.email ?? '')}"></label><label class="field">Side<select name="side"><option value="customer">Customer (emails go to them)</option><option value="internal" ${p?.side === 'internal' ? 'selected' : ''}>Internal (copied)</option></select></label></div>
     <label class="check"><input type="checkbox" name="notify" ${p?.notify !== false ? 'checked' : ''}> Include in POV emails</label>`,
    (b) => api(`/opportunities/${oid()}/stakeholders${p ? `/${p.id}` : ''}`, { method: 'POST', body: b }),
  );
}
