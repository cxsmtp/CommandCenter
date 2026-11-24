// One opportunity, from discovery to the outcome: the micro view a manager drills into and the SE works in.
import { $, $$, esc, fmt, api, state, can, ago, when, day, tc, toast, attempt, download, copy, openDialog, closeDialog, formData, HEALTH, sevBar, sevLegend, progressBar, ring, scanTypeBadge, stageBadge, daysBadge, alertList, table, peopleOptions, ask } from '../core.js';
import { feed } from './dashboard.js';
import { aiTab, wireAiTab } from './ai-tab.js';
import { getCatalog, capabilityPicker } from './new-opportunity.js';

const TABS = [
  ['overview', 'Overview'],
  ['criteria', 'Criteria'],
  ['tenant', 'Tenant'],
  ['ai', 'AI & value'],
  ['notes', 'Notes & tasks'],
  ['email', 'Customer'],
  ['report', 'Results'],
];
// Where the tabs that were folded into others now live.
const MOVED = { discovery: 'email', sessions: 'notes', history: 'report' };
let current = null; // the detail last read
let catalog = null;

// In a drawer (opened from a list), tabs and links stay in the drawer; on its own page, they move the page.
let drawerCtx = null;
const tabHref = (t, extra = '') => (drawerCtx ? `${drawerCtx.base}?open=${encodeURIComponent(oid())}&tab=${t}${extra ? `&x=${extra}` : ''}` : `#/opp/${oid()}/${t}${extra ? `?${extra}` : ''}`);
const wants = (x) => new RegExp(`[?&](x=)?${x}(&|$)`).test(location.hash);

export async function renderOpportunity(main, id, tab, { crumbs, drawer = null }) {
  drawerCtx = drawer;
  const [d, cat] = await Promise.all([api(`/opportunities/${encodeURIComponent(id)}`), getCatalog()]);
  current = d;
  catalog = cat;
  const o = d.opportunity;
  const r = d.row;
  const active = TABS.some(([k]) => k === (MOVED[tab] ?? tab)) ? MOVED[tab] ?? tab : 'overview';
  crumbs(`<a href="#/dashboard">Portfolio</a> <span class="muted">/</span> <span class="chip" style="background:${tc(r.colour)}"></span> <b>${esc(o.customer)}</b>`);
  const next = d.canEdit ? nextAction(d) : null;
  const links = [o.salesforceUrl ? `<a href="${esc(o.salesforceUrl)}" target="_blank" rel="noopener noreferrer">Salesforce ↗</a>` : '', o.sharepointUrl ? `<a href="${esc(o.sharepointUrl)}" target="_blank" rel="noopener noreferrer">SharePoint ↗</a>` : '', o.tenant ? `<a href="${esc(o.tenant.baseUrl)}" target="_blank" rel="noopener noreferrer">Checkmarx One ↗</a>` : ''].filter(Boolean);
  main.innerHTML = `
    <div class="opp-top">
      <div class="grow">
        <h1>${esc(o.customer)}</h1>
        <div class="opp-line">
          ${d.canEdit ? `<label class="stage-pick" title="Move to another stage"><span class="sr">Stage</span><select id="stagePick">${Object.entries(state.meta.stages).map(([k, l]) => `<option value="${k}" ${k === o.stage ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : stageBadge(o.stage)}
          ${daysBadge(r)}${r.muted ? '<span class="badge">Muted</span>' : ''}
          <span class="muted">${esc(r.owner.name)}${o.name !== o.customer ? ` · ${esc(o.name)}` : ''}</span>
        </div>
        ${links.length || o.salesforce ? `<div class="opp-links">${links.join('')}${sfChip(o.salesforce)}</div>` : ''}
      </div>
      <div class="actions">${next ? `<button class="btn primary" data-next="${next.key}">${esc(next.label)}</button>` : ''}${d.canEdit ? '<button class="btn" data-act="edit">Edit</button><button class="btn ghost" data-act="opp-menu" aria-label="More">•••</button>' : '<span class="badge">View only</span>'}</div>
    </div>
    <div class="tabs" role="tablist">${TABS.map(([k, label]) => `<button role="tab" aria-selected="${k === active}" data-tab="${k}">${label}${k === 'criteria' && r.progress.total ? ` <span class="muted">${r.progress.met}/${r.progress.total}</span>` : ''}${k === 'tenant' && r.live ? ` <span class="dot ${r.live.health}"></span>` : ''}</button>`).join('')}</div>
    <div id="tabBody">${VIEWS[active](d)}</div>`;

  for (const b of $$('[data-tab]', main)) b.addEventListener('click', () => (location.hash = tabHref(b.dataset.tab)));
  main.querySelector('#stagePick')?.addEventListener('change', async (e) => {
    const to = e.target.value;
    e.target.value = o.stage; // until it is saved
    if (to === 'completed') {
      const result = await askResult();
      if (!result) return;
      return save({ stage: 'completed', povResult: result }, result === 'successful' ? 'POV marked successful' : 'POV completed');
    }
    let outcomeReason;
    if (['won', 'lost'].includes(to)) {
      outcomeReason = await ask(`Why was it ${to}?`, { input: '', placeholder: 'Optional: a line for the record', ok: 'Save' });
      if (outcomeReason === null) return;
    }
    await save({ stage: to, outcomeReason }, `Stage: ${state.meta.stages[to]}`);
  });
  main.querySelector('[data-next]')?.addEventListener('click', () => doFix(next.key));
  main.querySelector('[data-act="opp-menu"]')?.addEventListener('click', oppMenu);
  main.querySelector('[data-act="edit"]')?.addEventListener('click', editDetails);
  WIRES[active]?.(main, d);
  on(main, '[data-sf-log]', async (b) => {
    b.disabled = true;
    const r = await attempt(() => api(`/opportunities/${oid()}/salesforce/log`, { method: 'POST', body: { kind: b.dataset.sfLog, itemId: b.dataset.item || undefined } }));
    b.disabled = false;
    if (r) {
      toast('Sent to Salesforce');
      rerender();
    }
  });
}

// ——— Salesforce: the figures from the latest report, and logging to Salesforce ———
const money = (a) => (a?.value ? `${a.currency && a.currency !== 'USD' ? `${a.currency} ` : '$'}${a.value >= 1e6 ? `${(a.value / 1e6).toFixed(1)}M` : a.value >= 1e3 ? `${Math.round(a.value / 1e3)}k` : Math.round(a.value)}` : '');
const sfChip = (sf) => (sf ? `<span class="sf-chip" title="From the Salesforce report of ${esc(when(sf.reportAt))}"><span class="sf-cloud" aria-hidden="true"></span>${esc([sf.stage, money(sf.amount), sf.closeDate ? `closes ${day(sf.closeDate)}` : ''].filter(Boolean).join(' · '))}</span>` : '');
const sfButton = (kind, itemId = '', logged = '') => (current.canEdit ? `<button class="btn sm ghost sf-log" data-sf-log="${kind}" ${itemId ? `data-item="${esc(itemId)}"` : ''} title="${logged ? `Sent to Salesforce ${esc(ago(logged))}` : 'Send to Salesforce as an activity'}">${logged ? '✓ Salesforce' : '→ Salesforce'}</button>` : '');
function sfPanel(o) {
  const sf = o.salesforce;
  const rows = sf ? [['Stage', sf.stage], ['Amount', money(sf.amount)], ['Close date', sf.closeDate ? day(sf.closeDate) : ''], ['Probability', sf.probability !== undefined ? `${sf.probability}%` : ''], ['Forecast', sf.forecast], ['Next step', sf.nextStep], ['Owner', sf.owner]].filter(([, v]) => v) : [];
  const last = (o.sfLog ?? []).at(-1);
  return `<section class="panel"><div class="head"><h3>Salesforce</h3>${o.salesforceUrl ? `<a class="small" href="${esc(o.salesforceUrl)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}</div><div class="body stack" style="gap:8px">
    ${rows.length ? `<dl class="sf-fields">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><div class="small muted">From the report of ${esc(when(sf.reportAt))}${sf.source === 'mailbox' ? ' (read from the report mailbox)' : ''}</div>` : '<span class="muted small">No Salesforce figures yet. Bring in a report from the Portfolio (Salesforce report) and they appear here.</span>'}
    <div class="row center">${sfButton('status')}<span class="small muted">${last ? `Last sent ${esc(ago(last.at))}: ${esc(last.kind)}` : 'Sends where the POV stands as an activity'}</span></div>
  </div></section>`;
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
  if (!(await ask(`Remove ${what}?`, { ok: 'Remove', danger: true }))) return;
  if (await attempt(() => api(`/opportunities/${oid()}/${kind}/${itemId}`, { method: 'DELETE' }), 'Removed')) rerender();
}
const ro = () => (current.canEdit ? '' : 'disabled');
const capName = (id) => catalog.catalog.find((c) => c.id === id)?.name ?? id;
const person = (id) => current.people[id] ?? '';

// ——— What to do next: from the gaps, each with the step that fixes it ———
const FIX = {
  tenant: 'connect', read: 'connect', key: 'connect', criteria: 'add-caps', 'must-open': 'go-criteria', engines: 'go-criteria', asked: 'add-caps', tools: 'go-criteria',
  overdue: 'edit', end: 'edit', salesforce: 'edit', sharepoint: 'edit', people: 'go-tenant', quiet: 'go-tenant', pool: 'go-tenant',
  stakeholders: 'add-person', tasks: 'go-notes', result: 'result', 'sf-lost': 'open-sf', 'sf-close': 'open-sf', 'sf-past': 'open-sf', 'sf-won': 'won',
};
const FIX_LABEL = { connect: 'Connect', 'add-caps': 'Add', 'go-criteria': 'Open', edit: 'Edit', 'go-tenant': 'Open', 'add-person': 'Add', 'go-notes': 'Open', result: 'Record', 'open-sf': 'Salesforce ↗', won: 'Mark won' };
/** The one thing to do now, for the button beside the name. */
function nextAction(d) {
  const o = d.opportunity;
  const r = d.row;
  if (o.povResult === 'successful' && !['won', 'lost'].includes(o.stage)) return { key: 'share', label: 'Share the results' };
  if (o.stage === 'completed' && !o.povResult) return { key: 'result', label: 'Record the result' };
  if (!r.progress.total) return { key: 'add-caps', label: 'Add success criteria' };
  if (['pov', 'technical'].includes(o.stage) && !o.tenant) return { key: 'connect', label: 'Connect the tenant' };
  if (o.stage === 'pov' && (r.daysLeft !== null && r.daysLeft <= 0 || (r.progress.must && r.progress.mustMet === r.progress.must))) return { key: 'result', label: 'Complete the POV' };
  return { key: 'note', label: 'Add a note' };
}
async function doFix(key, gap = null) {
  if (key === 'connect') return connectTenant();
  if (key === 'add-caps') return addCapabilities();
  if (key === 'edit') return editDetails();
  if (key === 'add-person') return editPerson(null);
  if (key === 'share') return (location.hash = tabHref('email', 'completion'));
  if (key === 'won') return save({ stage: 'won' }, 'Marked won');
  if (key === 'open-sf') return current.opportunity.salesforceUrl && open(current.opportunity.salesforceUrl, '_blank', 'noopener');
  if (key === 'note') {
    const text = await ask('Add a note', { input: '', placeholder: 'What happened, what was decided, what to remember', ok: 'Add note' });
    if (text?.trim()) item('notes', { text }, 'Note added');
    return;
  }
  if (key === 'result') {
    const result = await askResult();
    if (result) save({ stage: 'completed', povResult: result }, result === 'successful' ? 'POV marked successful' : 'POV completed');
    return;
  }
  if (key.startsWith('go-')) location.hash = tabHref(key.slice(3));
}
async function oppMenu() {
  const o = current.opportunity;
  await openDialog(
    `<div class="dbody"><h2>${esc(o.customer)}</h2><nav class="more-list">
      <button type="button" data-m="edit"><span>Edit details</span><small class="muted">Name, dates, owner, Salesforce and SharePoint links</small></button>
      <button type="button" data-m="note"><span>Add a note</span></button>
      <button type="button" data-m="sf"><span>Send the status to Salesforce</span><small class="muted">Through your Email to Salesforce address</small></button>
      <button type="button" data-m="results"><span>Open the results page</span></button>
      <button type="button" data-m="delete" class="bad-t"><span>Delete this opportunity</span></button>
    </nav><div class="dialog-actions"><button class="btn" data-close>Close</button></div></div>`,
    {
      onOpen(dl) {
        dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        for (const b of dl.querySelectorAll('[data-m]'))
          b.addEventListener('click', () => {
            closeDialog();
            const m = b.dataset.m;
            setTimeout(async () => {
              if (m === 'edit') editDetails();
              else if (m === 'note') doFix('note');
              else if (m === 'results') open(`/api/opportunities/${o.id}/results`, '_blank', 'noopener');
              else if (m === 'delete') removeOpportunity();
              else if (m === 'sf' && (await attempt(() => api(`/opportunities/${oid()}/salesforce/log`, { method: 'POST', body: { kind: 'status' } }), 'Sent to Salesforce'))) rerender();
            }, 60);
          });
      },
    },
  );
}

/** A first draft of the summary, written from what is known; the SE only edits it. */
function draftSummary(d) {
  const o = d.opportunity;
  const r = d.row;
  const p = r.progress;
  const s = r.live?.summary;
  const parts = [];
  if (p.total) parts.push(`${p.met} of ${p.total} success criteria are completed successfully (${p.percent}%)${p.must ? `, including ${p.mustMet} of ${p.must} must-haves` : ''}.`);
  if (s) parts.push(`In the POV tenant, ${s.scans7d} scans ran in the last 7 days across ${s.projects} projects${s.fusion7d ? `, ${s.fusion7d} of them with Fusion` : ''}${(s.origins ?? []).length ? `, from ${s.origins.slice(0, 3).map((x) => x.name).join(', ')}` : ''}.`);
  const done = (o.criteria ?? []).filter((c) => c.status === 'met').slice(0, 4).map((c) => c.title);
  if (done.length) parts.push(`Shown working: ${done.join(', ')}.`);
  const open_ = (o.criteria ?? []).filter((c) => c.priority === 'must' && c.status !== 'met').slice(0, 3).map((c) => c.title);
  if (open_.length) parts.push(`Still to show: ${open_.join(', ')}${r.daysLeft !== null && o.stage === 'pov' ? `, with ${r.daysLeft} days left` : ''}.`);
  if (r.nextTask) parts.push(`Next: ${r.nextTask.title}${r.nextTask.due ? ` (${day(r.nextTask.due)})` : ''}.`);
  return parts.join(' ');
}

// ——— Overview ———
function overview(d) {
  const o = d.opportunity;
  const r = d.row;
  const s = r.live?.summary;
  const p = r.progress;
  const openTasks = (o.tasks ?? []).filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const success = o.povResult === 'successful';
  const todo = [
    ...r.alerts.filter(() => !r.muted).map((a) => ({ level: a.level, text: a.what, fix: '', key: a.what.includes('failed') ? 'go-tenant' : '' })),
    ...(r.gaps ?? []).filter((g) => !(g.key === 'result' && o.stage === 'completed')).map((g) => ({ level: g.level, text: g.text, fix: g.fix, key: FIX[g.key] ?? '' })),
  ];
  const shown = todo.filter((t) => t.level !== 'info');
  const later = todo.filter((t) => t.level === 'info');
  const line = (t) => `<div><span class="dot ${t.level === 'info' ? '' : t.level}"></span><span class="t">${esc(t.text)}${t.fix ? `<small>${esc(t.fix)}</small>` : ''}</span>${t.key && current.canEdit ? `<button class="btn sm" data-fix="${t.key}">${FIX_LABEL[t.key] ?? 'Open'}</button>` : ''}</div>`;
  return `${success ? `<section class="panel success-banner"><div class="body row center"><div style="flex:1;min-width:220px"><b>The POV was successful</b><div class="small muted">${p.met} of ${p.total} criteria completed successfully. Share the final presentation with the stakeholders.</div></div><button class="btn" data-act="deck">Presentation</button>${current.canEdit ? '<button class="btn primary" data-act="share-deck">Email it</button>' : ''}</div></section>` : ''}
  ${o.stage === 'completed' && !o.povResult && current.canEdit ? '<section class="panel"><div class="body row center"><span style="flex:1">The POV is complete. Was it successful?</span><button class="btn primary" data-result="successful">Successful</button><button class="btn" data-result="unsuccessful">Not successful</button></div></section>' : ''}
  <div class="layout"><div class="stack">
    <section class="panel"><div class="head"><h3>To do</h3><span class="small muted">${shown.length ? `${shown.length} thing${shown.length > 1 ? 's' : ''}` : ''}</span></div>
      <div class="todo">${shown.map(line).join('') || '<div class="all-good">✓ Nothing needs you on this one.</div>'}</div>
      ${later.length ? `<details class="todo-later"><summary class="small muted">${later.length} small thing${later.length > 1 ? 's' : ''} for later</summary><div class="todo">${later.map(line).join('')}</div></details>` : ''}
    </section>
    <section class="panel"><div class="head"><h3>Success criteria</h3><a href="${tabHref('criteria')}" class="small">Open</a></div><div class="body">
      ${p.total ? `<div class="crit-sum">${ring(p, { size: 64 })}<div><b>${p.met} of ${p.total} completed</b>${p.must ? `<div class="small muted">Must-haves ${p.mustMet} of ${p.must}</div>` : ''}${r.forecast?.criteria?.label ? `<div class="small ${r.forecast.criteria.state === 'late' ? 'bad-t' : r.forecast.criteria.state === 'at-risk' ? 'warn-t' : 'muted'}">${esc(r.forecast.criteria.label)}</div>` : ''}</div></div>` : `<p class="muted" style="margin:0 0 10px">None yet. A template picks them in two clicks.</p>${current.canEdit ? '<button class="btn primary" data-fix="add-caps">Add success criteria</button>' : ''}`}
    </div></section>
    ${s ? `<section class="panel"><div class="head"><h3>Tenant · ${esc(o.tenant.tenant)}</h3><a href="${tabHref('tenant')}" class="small">Open</a></div><div class="body">
      <div class="health small" style="margin-bottom:10px"><span class="dot ${r.live.health}"></span>${esc(HEALTH[r.live.health])} · read ${ago(s.at)}</div>
      <div class="stats"><div class="stat"><div class="v">${fmt(s.scans7d)}</div><div class="l">Scans, 7 days</div></div><div class="stat ${s.failed24h ? 'bad' : ''}"><div class="v">${fmt(s.failed24h)}</div><div class="l">Failed today</div></div><div class="stat"><div class="v">${fmt(s.fusion7d)}</div><div class="l">Fusion scans</div></div></div>
    </div></section>` : ''}
    <section class="panel"><div class="head"><h3>Summary for the customer</h3><span class="small muted" id="sumState"></span></div><div class="body">
      <textarea id="summary" rows="4" style="width:100%" ${ro()} placeholder="Where the POV stands, in a few lines.">${esc(o.summary ?? '')}</textarea>
      ${current.canEdit ? `<div class="row center" style="margin-top:8px"><button class="btn sm" data-act="draft-summary">${o.summary ? 'Write it again for me' : 'Write it for me'}</button><span class="small muted">Saved as you type. Used in the report and the emails.</span></div>` : ''}
    </div></section>
  </div><div class="stack">
    <section class="panel"><div class="head"><h3>Next tasks</h3><a href="${tabHref('notes')}" class="small">All</a></div><div class="body list">${openTasks.slice(0, 5).map((t) => `<div class="row center"><span class="${t.due && t.due < new Date().toISOString().slice(0, 10) ? 'bad-t' : ''}">${esc(t.title)}</span><span class="spacer"></span><span class="small muted">${t.due ? day(t.due) : ''}</span></div>`).join('') || '<span class="muted">Nothing open.</span>'}
      ${current.canEdit ? '<form id="quickTask" class="quick-add"><input name="title" placeholder="Add a task…" aria-label="New task"><button class="btn sm">Add</button></form>' : ''}</div></section>
    ${o.salesforce || o.salesforceUrl ? sfPanel(o) : ''}
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
    <div class="crit-top">
      <div><span class="health"><span class="dot ${r.live.refreshing ? 'loading' : r.live.health}"></span>${esc(r.live.refreshing ? 'Reading…' : HEALTH[r.live.health])}${s ? ` · read ${ago(s.at)}` : ''}</span>
        <div class="small muted">${esc(o.tenant.tenant)} · ${esc(o.tenant.regionLabel)}${o.tenant.keyExpiresAt ? ` · key expires ${day(o.tenant.keyExpiresAt)}` : ''}${muteUntil ? ` · alerts muted` : ''}</div></div>
      <span class="spacer"></span>
      <button class="btn" data-act="refresh">Refresh now</button>
      <button class="btn ghost" data-act="tenant-tools" aria-label="More">•••</button>
    </div>
    ${r.live.error && r.live.health === 'failed' ? `<div class="panel body bad-t" style="margin-bottom:14px">Last read failed ${ago(r.live.error.at)}: ${esc(r.live.error.message)}</div>` : ''}
    ${t?.errors?.length ? `<div class="panel body small muted" style="margin-bottom:14px">Partly read: ${esc(t.errors.map((e) => `${e.part}: ${e.message}`).join(' · '))}</div>` : ''}
    <div class="headline headline-4">
      <div><b>${fmt(s?.scans7d)}</b><span>scans this week</span></div>
      <div class="${s?.failed24h ? 'bad' : ''}"><b>${fmt(s?.failed24h)}</b><span>failed today</span></div>
      <div><b>${fmt(s ? s.running + s.queued : null)}</b><span>running now</span></div>
      <div class="${s?.findings?.critical ? 'bad' : ''}"><b>${fmt(s?.findings?.critical)}<small class="muted"> / ${fmt(s?.findings?.high)}</small></b><span>critical / high</span></div>
    </div>
    <div class="grid3" style="margin-bottom:16px">
      <section class="panel"><div class="head"><h3>Credits</h3></div><div class="body">
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
    </div>
    <details class="panel fold-panel"><summary><h3>Activity</h3><span class="small muted">${(t?.events ?? []).length} events, last 7 days</span></summary>${feed(t?.events ?? [], [d.row], { showOpp: false })}</details>
    ${t?.people ? `<details class="panel fold-panel"><summary><h3>People</h3><span class="small muted">${t.people.users?.length ?? 0} in the tenant</span></summary>${peopleSection(t.people)}</details>` : ''}
    <div class="stack">
      ${t?.active?.length ? `<section class="panel"><div class="head"><h3>Running and queued</h3></div>${table('t-active', scanCols.slice(0, 8), t.active)}</section>` : ''}
      <details class="panel fold-panel"><summary><h3>Scans</h3><span class="small muted">${(t?.scans ?? []).length} in the last 7 days${(t?.scans ?? []).length > 20 ? ' · newest 20' : ''}</span></summary>${table('t-scans', scanCols, (t?.scans ?? []).slice(0, 20))}</details>
      <details class="panel fold-panel"><summary><h3>Projects</h3><span class="small muted">${(t?.projects ?? []).length}</span></summary><div class="body" style="padding-bottom:0"><input type="search" id="projQ" placeholder="Find a project" style="width:100%"></div><div id="projTable">${table('t-projects', projCols, t?.projects ?? [])}</div></details>
      ${c?.byProject?.length ? `<details class="panel fold-panel"><summary><h3>Credits by project</h3><span class="small muted">last 30 days</span></summary>${table('t-credits', [
        { label: 'Project', key: (x) => x.name, html: (x) => esc(x.name) },
        { label: 'Credits', n: true, key: (x) => x.credits, html: (x) => fmt(Math.round(x.credits * 10) / 10) },
        { label: 'AI triage', n: true, key: (x) => x.triage, html: (x) => fmt(x.triage) },
        { label: 'AI remediation', n: true, key: (x) => x.remediation, html: (x) => fmt(x.remediation) },
        { label: 'Other', n: true, key: (x) => x.other, html: (x) => fmt(x.other) },
      ], c.byProject)}</details>` : ''}
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
const CRIT_ICON = { met: ['✓', 'ok'], in_progress: ['◐', 'warn'], not_started: ['○', 'muted'], missed: ['✕', 'bad'], na: ['–', 'muted'] };
let critFilter = 'todo';
/** One short line on where a criterion stands: what proves it, or what is missing. */
function critNote(c, ev) {
  if (c.status === 'met' && c.statusSource === 'tenant') return ['ok-t', 'Done by itself in the tenant'];
  if (c.status === 'met' && c.proofType === 'demo') return ['ok-t', 'Shown in a demo'];
  if (c.status === 'met') return ['ok-t', `Done${c.confirmedAt ? ` · ${ago(c.confirmedAt)}` : ''}`];
  if (ev?.level === 'detected') return ['ok-t', 'Found in the tenant'];
  if (c.demo) return ['', 'Demo recorded'];
  if (ev?.level === 'mentioned') return ['muted', 'Mentioned in your notes'];
  return ['muted', c.priority === 'must' ? 'Must have' : 'Nice to have'];
}
function criteria(d) {
  const o = d.opportunity;
  const p = d.row.progress;
  const all = o.criteria ?? [];
  const isDone = (c) => ['met', 'na'].includes(c.status);
  const todo = all.filter((c) => !isDone(c));
  const shown = critFilter === 'todo' ? todo : critFilter === 'done' ? all.filter(isDone) : all;
  const cats = new Map([...state.meta.categories, ['custom', 'Your own']]);
  const groups = new Map();
  for (const c of shown.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'must' ? -1 : 1))) {
    const k = cats.get(c.category) ?? 'Your own';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  if (!all.length) return `<div class="hero-empty"><h2>No success criteria yet</h2><p>Pick a template or the capabilities the customer wants to see. Meridian then marks each one done by itself when the tenant proves it.</p>${current.canEdit ? '<button class="btn primary" data-act="add-caps">Add success criteria</button>' : ''}</div>`;
  return `<div class="crit-top">
      <div class="crit-sum">${ring(p, { size: 52 })}<div><b>${p.met} of ${p.total} done</b>${p.must ? `<div class="small muted">Must-haves ${p.mustMet} of ${p.must}</div>` : ''}</div></div>
      <span class="spacer"></span>
      ${current.canEdit ? '<button class="btn primary" data-act="add-caps">Add</button><button class="btn" data-act="add-custom">Your own</button>' : ''}
    </div>
    <div class="seg crit-filter" role="group" aria-label="Show">${[['todo', `To do · ${todo.length}`], ['done', `Done · ${all.length - todo.length}`], ['all', 'All']].map(([k, l]) => `<button data-cf="${k}" aria-pressed="${critFilter === k}">${l}</button>`).join('')}</div>
    ${shown.length ? [...groups].map(([label, list]) => `<div class="group-title"><h2>${esc(label)}</h2></div><div class="crit-list">${list.map((c) => {
      const ev = d.evidence[c.id];
      const [icon, tone] = CRIT_ICON[c.status] ?? CRIT_ICON.not_started;
      const [nt, note] = critNote(c, ev);
      const quick = current.canEdit && c.status !== 'met' && ev?.level === 'detected' ? `<button class="btn sm" data-met="${esc(c.id)}">Mark done</button>` : '';
      return `<div class="crit-row" data-open-crit="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.title)}">
        <span class="crit-icon ${tone}" aria-hidden="true">${icon}</span>
        <span class="crit-t"><b>${esc(c.title)}</b><small class="${nt}">${esc(note)}</small></span>
        ${quick}<span class="crit-go" aria-hidden="true">›</span>
      </div>`;
    }).join('')}</div>`).join('') : `<p class="empty-line">${critFilter === 'todo' ? '✓ Every criterion is done.' : 'Nothing here yet.'}</p>`}`;
}

/** Everything about one criterion, in its own sheet. */
function openCriterion(c) {
  const d = current;
  const ev = d.evidence[c.id];
  const cap = c.capabilityId ? catalog.catalog.find((x) => x.id === c.capabilityId) : null;
  const statuses = Object.entries(state.meta.criterionStatus);
  return openDialog(
    `<div class="dbody crit-sheet">
      <div class="row center"><h2 style="flex:1">${esc(c.title)}</h2><button class="btn" data-close>Done</button></div>
      <div class="small muted">${c.priority === 'must' ? 'Must have' : 'Nice to have'}${cap ? ` · in Checkmarx One: ${esc(cap.cxName)}` : ''}</div>
      <div class="status-pick" role="group" aria-label="Status">${statuses.map(([k, l]) => `<button type="button" data-set="${k}" aria-pressed="${c.status === k}" ${ro()}>${esc(l)}</button>`).join('')}</div>
      ${c.status === 'met' && c.statusSource === 'tenant' ? `<p class="ev ev-detected" style="margin:0">✓ Marked done by itself: ${(c.autoEvidence ?? []).map(esc).join(' · ')}. Choose another status to override it.</p>` : ev && ev.level !== 'none' ? `<p class="ev ev-${ev.level}" style="margin:0">${ev.level === 'detected' ? '● Found in the tenant' : '○ Mentioned in your notes'}: ${ev.evidence.map(esc).join(' · ')}</p>` : '<p class="small muted" style="margin:0">Nothing in the tenant proves it yet.</p>'}
      ${cap?.proof ? `<details class="small"><summary>How to show it</summary><p>${esc(cap.proof)}</p>${cap.tech ? `<p class="muted">How Meridian checks: ${esc(cap.tech)}</p>` : ''}</details>` : ''}
      <div>${demoLine(c) || (current.canEdit ? `<button class="btn sm" data-demo="${esc(c.id)}">Record a demo</button> <span class="small muted">If you showed it yourself instead of in their tenant</span>` : '')}</div>
      <label class="field">Notes<textarea id="critNotes" rows="3" ${ro()} placeholder="What the customer saw, what they said">${esc(c.notes ?? '')}</textarea></label>
      ${current.canEdit ? `<div class="dialog-actions"><button type="button" class="btn ghost danger" data-del>Remove</button><span class="spacer"></span><button type="button" class="btn ghost" data-adv>More settings</button></div>` : ''}
    </div>`,
    {
      onOpen(dl) {
        const done = async (body, msg) => {
          closeDialog();
          await item('criteria', { ...c, ...body }, msg);
        };
        dl.querySelector('[data-close]').addEventListener('click', async () => {
          const notes = dl.querySelector('#critNotes')?.value ?? '';
          if (notes !== (c.notes ?? '')) return done({ notes }, 'Saved');
          closeDialog();
        });
        for (const b of dl.querySelectorAll('[data-set]')) b.addEventListener('click', () => done({ status: b.dataset.set, notes: dl.querySelector('#critNotes').value }, state.meta.criterionStatus[b.dataset.set]));
        dl.querySelector('[data-demo]')?.addEventListener('click', () => (closeDialog(), setTimeout(() => recordDemo(c), 60)));
        dl.querySelector('[data-del]')?.addEventListener('click', () => (closeDialog(), setTimeout(() => removeItem('criteria', c.id, 'this success criterion'), 60)));
        dl.querySelector('[data-adv]')?.addEventListener('click', () => (closeDialog(), setTimeout(() => editCriterion(c), 60)));
        on(dl, '[data-watch]', (b) => {
          const box = b.closest('.demo-box').querySelector('.demo-player');
          box.innerHTML = `<video controls autoplay playsinline controlslist="nodownload" disablepictureinpicture src="/api/opportunities/${oid()}/criteria/${b.dataset.watch}/demo-video"></video>`;
        });
      },
    },
  );
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
    <div class="list">${list.map((x) => `<div class="item"><div class="top"><div><b>${esc(x.title)}</b> <span class="badge">${esc(state.meta.sessionTypes[x.type] ?? x.type)}</span> ${(x.status || (x.date <= new Date().toISOString().slice(0, 10) ? 'done' : 'planned')) === 'done' ? '<span class="badge ok">Completed</span>' : '<span class="badge warn">Planned</span>'}</div><span class="small muted">${day(x.date)}</span></div>
      ${x.attendees ? `<div class="small muted">${esc(x.attendees)}</div>` : ''}
      ${x.did ? `<div style="margin-top:6px"><b class="small">What we did</b><div class="notes-box small">${esc(x.did)}</div></div>` : ''}
      ${x.theirNext || x.ourNext ? `<div class="row small" style="margin-top:6px;align-items:flex-start">${x.theirNext ? `<div class="grow"><b>Next from the customer</b><div class="notes-box">${esc(x.theirNext)}</div></div>` : ''}${x.ourNext ? `<div class="grow"><b>From our side</b><div class="notes-box">${esc(x.ourNext)}</div></div>` : ''}</div>` : ''}
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
    <div class="list">${list.map((n) => `<div class="item"><div class="top"><span class="small muted">${n.pinned ? 'Pinned · ' : ''}${esc(person(n.by))} · <span title="${esc(when(n.at))}">${ago(n.at)}</span></span><span class="row"><button class="btn sm" data-copy-note="${esc(n.id)}">Copy</button>${sfButton('note', n.id, n.sfLoggedAt)}${current.canEdit ? `<button class="btn sm" data-pin-note="${esc(n.id)}">${n.pinned ? 'Unpin' : 'Pin'}</button><button class="btn sm ghost danger" data-del-note="${esc(n.id)}">Remove</button>` : ''}</span></div><div class="notes-box">${esc(n.text)}</div></div>`).join('') || '<div class="empty panel">No notes yet.</div>'}</div>
  </div>
  <section class="panel"><div class="head"><h3>Tasks</h3></div><div class="body stack" style="gap:8px">
    ${current.canEdit ? `<form id="taskForm" class="row"><input name="title" placeholder="New task" required style="flex:1;min-width:140px"><input type="date" name="due" aria-label="Due"><button class="btn">Add</button></form>` : ''}
    ${tasks.map((t) => `<div class="row center"><label class="check" style="flex:1"><input type="checkbox" data-task="${esc(t.id)}" ${t.done ? 'checked' : ''} ${ro()}><span style="${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</span></label><span class="small ${!t.done && t.due && t.due < today ? 'bad-t' : 'muted'}">${t.due ? day(t.due) : ''}</span>${sfButton('task', t.id, t.sfLoggedAt)}${current.canEdit ? `<button class="btn sm ghost" data-del-task="${esc(t.id)}" aria-label="Remove">✕</button>` : ''}</div>`).join('') || '<span class="muted">No tasks.</span>'}
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
  <div class="layout"><section class="panel"><div class="head"><h3>Write an email</h3></div><div class="body"><p class="small muted" style="margin:0 0 8px">Pick one: Meridian writes it from the POV, with the stakeholders filled in.</p><div class="row center">${Object.entries(state.meta.templates).map(([k, l]) => `<button class="btn sm" data-template="${k}">${esc(l)}</button>`).join('')}</div></div>
    <form id="mailForm" class="body stack" style="gap:8px" ${wants('completion') ? '' : 'hidden'}>
      <input type="hidden" name="template">
      <label class="field">To<input name="to" placeholder="name@customer.com, …"></label>
      <label class="field">Cc<input name="cc"></label>
      <label class="field">Subject<input name="subject"></label>
      <label class="field">Message<textarea name="body" rows="18" class="copy-area"></textarea></label>
      <label class="check"><input type="checkbox" name="attachDeck" id="attachDeck"> Attach the final presentation (.pptx)</label>
      <div class="row">
        ${can('mail.send') && current.canEdit ? `<button class="btn primary" data-mail="send" ${d.mailConfigured ? '' : 'disabled title="No email server is set up (Settings → Email)"'}>Send</button>` : ''}
        <button class="btn ghost sm" type="button" data-mail="eml" title="Opens in Outlook or your mail app, ready to send">Download .eml</button>
        <button class="btn ghost sm" type="button" data-mail="mailto">Open in mail app</button>
        <button class="btn ghost sm" type="button" data-mail="copy">Copy</button>
      </div>
      ${d.mailConfigured ? '' : '<p class="small muted" style="margin:0">No email server is set up, so Send is off: download the .eml or copy it into your own mail.</p>'}
    </form></section>
    <section class="panel"><div class="head"><h3>Outbox</h3></div><ul class="feed">${d.outbox.map((m) => `<li data-outbox="${esc(m.id)}" style="cursor:pointer"><span class="icon">${m.status === 'sent' ? '✉' : m.status === 'draft' ? '✎' : '⇩'}</span><div><div class="t">${esc(m.subject)}</div><div class="m">${esc(m.status)} · ${esc((m.to ?? []).join(', '))}${m.by ? ` · ${esc(person(m.by))}` : ' · scheduled draft'}</div></div><span class="when">${ago(m.at)}</span></li>`).join('') || '<li class="empty" style="display:block">Nothing yet.</li>'}</ul></section></div>`;
}

// ——— Report ———
function report(d) {
  const o = d.opportunity;
  return `${wipPanel(d)}<section class="panel"><div class="body stack">
    <p style="margin:0"><b>The results page</b> opens with the Checkmarx One platform slide, showing only this POV's engines with their status. Select any engine for its record: progress, the scans and evidence that prove it, notes, links and every timestamp up to the POV's completion. The other slides follow. Printing it gives a PDF of every slide, then one page per engine.</p>
    <div class="row"><a class="btn primary" href="/api/opportunities/${esc(o.id)}/results" target="_blank" rel="noopener">Open the results page</a><button class="btn" data-act="dl-results">Download the page (HTML)</button><button class="btn" data-act="deck">Download the presentation (.pptx)</button></div>
    <label class="field" style="max-width:520px">Customer presentation <span class="small muted">the design and slides of the WIP deck and the final report</span><select id="deckPick"${current.canEdit ? '' : ' disabled'}><option value="">Team’s choice</option></select></label>
    <div class="item"><div class="top"><b>Final results</b>${d.finals.length ? `<span class="small muted">kept ${esc(when(d.finals[0].at))}${d.finals.length > 1 ? ` · ${d.finals.length} copies` : ''}</span>` : ''}</div>
      ${d.finals.length ? `<p class="small muted" style="margin:6px 0">The results page exactly as it stood when the POV was marked successful: later activity in the tenant does not change it.</p><div class="row"><a class="btn" href="/api/opportunities/${esc(o.id)}/results?final=1" target="_blank" rel="noopener">Open the final copy</a><button class="btn" data-act="dl-final">Download it</button>${current.canEdit ? '<button class="btn ghost" data-act="freeze">Keep a new final copy now</button>' : ''}</div>` : `<p class="small muted" style="margin:6px 0">Kept by itself when the POV is marked successful.${current.canEdit ? ' Or keep one now.' : ''}</p>${current.canEdit ? '<div class="row"><button class="btn" data-act="freeze">Keep the results as final now</button></div>' : ''}`}
    </div>
    <hr style="border:0;border-top:1px solid var(--line);width:100%">
    <p style="margin:0"><b>The RW report</b>: the POV guide as one page to share with the customer. Their business goals with every success criterion (numbered, with milestone, tracker references and status), their toolchain, the platform components with the criteria that test them, the plan with its approval gates, and the team. What is not known yet shows as "To confirm".</p>
    <div class="row"><a class="btn" href="/api/opportunities/${esc(o.id)}/rw" target="_blank" rel="noopener">Open the RW report</a><button class="btn" data-act="dl-rw">Download HTML</button></div>
    <hr style="border:0;border-top:1px solid var(--line);width:100%">
    <p style="margin:0">The success-criteria report: the answer first, every criterion with its status and evidence, the sessions held and what the tenant showed. It prints to PDF from the browser.</p>
    <div class="row"><a class="btn" href="/api/opportunities/${esc(o.id)}/report" target="_blank" rel="noopener">Open the report</a><button class="btn" data-act="dl-report">Download HTML</button>${o.sharepointUrl ? `<a class="btn" href="${esc(o.sharepointUrl)}" target="_blank" rel="noopener noreferrer">Open SharePoint ↗</a>` : ''}</div>
    <p class="small muted" style="margin:0">To keep it with the customer's documents, save it as PDF and put it in the SharePoint site${o.sharepointUrl ? '' : ' (add its link under Edit details)'}. Publishing to SharePoint by itself needs a Microsoft Graph app registration; the report layout will follow the formats you supply.</p>
  </div></section>`;
}

// ——— The POV work-in-progress deck ———
function wipPanel(d) {
  const o = d.opportunity;
  const a = o.apma;
  const tc = o.toolchain ?? {};
  const tools = (state.meta.toolchain ?? []).flatMap((t) => tc[t.key]?.tools ?? []);
  const meetings = o.sessions ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const held = meetings.filter((m) => (m.status || (m.date <= today ? 'done' : 'planned')) === 'done').length;
  const gaps = [!tools.length && 'the customer’s toolchain', !meetings.length && 'the meetings', !(o.stakeholders ?? []).some((p) => p.povRole) && 'POV roles for the people'].filter(Boolean);
  return `<section class="panel" style="margin-bottom:16px"><div class="head"><h3>POV work-in-progress deck</h3><span class="small muted">the document you share with the customer during the POV</span></div><div class="body stack">
    <p style="margin:0">Built from this POV each time you download it: the executive overview, the platform, the toolchain, ${a ? 'the APMA assessment, ' : ''}plan and timeline (${meetings.length} meetings, ${held} held), the environment, the test plan for each business goal with today’s status, and the notes of each meeting held.</p>
    ${gaps.length && current.canEdit ? `<p class="small" style="margin:0"><span class="warn-t">Still empty:</span> ${gaps.join(', ')}.</p>` : ''}
    <div class="row"><button class="btn primary" data-act="wip">Download the WIP deck (.pptx)</button>${current.canEdit && o.sharepointUrl ? '<button class="btn" data-act="sp-publish">Publish to SharePoint</button>' : ''}${current.canEdit ? '<button class="btn" data-act="wip-plan">Plan, toolchain &amp; environment</button>' : ''}</div>
    <div class="item"><div class="top"><b>APMA assessment</b><span class="small muted">optional</span></div>
      ${a ? `<p class="small" style="margin:6px 0">${a.dimensions.filter((x) => x.current != null).map((x) => `${esc(x.name)} <b>${x.current}</b> → ${x.desired}`).join(' · ')}</p>
        <div class="row">${a.file ? `<a class="btn sm" href="/api/opportunities/${esc(o.id)}/apma" target="_blank" rel="noopener">Open the report</a>` : ''}${current.canEdit ? '<button class="btn sm" data-act="apma-up">Replace</button><button class="btn sm ghost danger" data-act="apma-del">Remove</button>' : ''}</div>`
        : `<p class="small muted" style="margin:6px 0">Drop the customer’s APMA report (PDF): its maturity scores, the interview and the recommended first steps fill the APMA slide.</p>${current.canEdit ? '<div class="row"><button class="btn sm" data-act="apma-up">Add the APMA report</button></div>' : ''}`}
      <input type="file" id="apmaFile" accept="application/pdf,.pdf" hidden></div>
    <div class="item"><div class="top"><b>POV screenshots</b><span class="small muted">${(o.screenshots ?? []).length ? `${o.screenshots.length} · each is a slide, in this order` : 'optional'}</span></div>
      ${(o.screenshots ?? []).length ? `<ul class="shots">${o.screenshots.map((x, i) => `<li><img src="/api/opportunities/${esc(o.id)}/screenshots/${esc(x.id)}" alt="" loading="lazy"><span>Checkmarx ONE – <b>${esc(x.caption)}</b></span>${current.canEdit ? `<span class="row"><button class="btn sm ghost" data-shot-up="${esc(x.id)}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn sm ghost" data-shot-down="${esc(x.id)}" ${i < o.screenshots.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button class="btn sm ghost" data-shot-name="${esc(x.id)}">Rename</button><button class="btn sm ghost danger" data-shot-del="${esc(x.id)}">Remove</button></span>` : ''}</li>`).join('')}</ul>` : '<p class="small muted" style="margin:6px 0">Screenshots from the tenant (the Analytics dashboard, the compliance page, triage, an SCA exploitable path, the integrations) become the deck’s POV screenshots slides, before the appendix.</p>'}
      ${current.canEdit ? '<div class="row"><button class="btn sm" data-act="shot-add">Add screenshots</button></div>' : ''}
      <input type="file" id="shotFile" accept="image/png,image/jpeg" multiple hidden></div>
    <div class="item"><div class="top"><b>The RW report</b><span class="small muted">the POV guide as one page (HTML)</span></div>
      <div class="row" style="margin-top:6px"><a class="btn sm" href="/api/opportunities/${esc(o.id)}/rw" target="_blank" rel="noopener">Open the RW report</a><button class="btn sm" data-act="dl-rw">Download HTML</button></div></div>
  </div></section>`;
}

function editPlan() {
  const o = current.opportunity;
  const p = o.plan ?? {};
  const tc = o.toolchain ?? {};
  const TC = state.meta.toolchain ?? [];
  const lines = (a) => (a ?? []).join('\n');
  const picked = (k, n) => (tc[k]?.tools ?? []).includes(n);
  return openDialog(
    `<form id="planForm"><h2>Plan, toolchain &amp; environment</h2>
      <h3 class="sec-title" style="margin-top:0">The customer’s toolchain</h3>
      ${TC.map((t) => `<div class="field"><span>${esc(t.label)} <span class="muted small">· access needed</span> <input name="acc_${t.key}" value="${esc(tc[t.key]?.access || t.access)}" style="display:inline-block;width:auto;min-width:170px;padding:2px 8px;font-size:13px" aria-label="Access needed"></span>
        <div class="wz-chips">${t.tools.map(([n]) => `<button type="button" class="wz-chip ${picked(t.key, n) ? 'must' : ''}" data-tc="${t.key}" data-name="${esc(n)}" aria-pressed="${picked(t.key, n)}">${esc(n)}</button>`).join('')}</div>
        <input name="extra_${t.key}" value="${esc((tc[t.key]?.tools ?? []).filter((n) => !t.tools.some(([x]) => x === n)).join(', '))}" placeholder="Others, separated by commas" style="margin-top:6px"></div>`).join('')}
      <label class="field">Languages and frameworks<input name="languages" value="${esc(tc.languages || o.discovery?.languages || '')}"></label>
      <h3 class="sec-title">Objectives</h3>
      <div class="row"><label class="field">Scope <span class="muted small">one per line; the business goals if empty</span><textarea name="scope" rows="4">${esc(lines(p.scope))}</textarea></label>
        <label class="field">Support<textarea name="support" rows="4">${esc(lines(p.support?.length ? p.support : state.meta.planDefaults?.support))}</textarea></label>
        <label class="field">Success<textarea name="success" rows="4">${esc(lines(p.success?.length ? p.success : state.meta.planDefaults?.success))}</textarea></label></div>
      <div class="row"><label class="field">Out of scope<input name="outOfScope" value="${esc(p.outOfScope ?? '')}"></label><label class="field">Account name in the tenant<input name="accountName" value="${esc(p.accountName ?? '')}" placeholder="${esc(o.tenant?.tenant ?? '')}"></label></div>
      <h3 class="sec-title">Environment</h3>
      <div class="row"><label class="field">Repositories in scope <span class="muted small">names or a short list</span><input name="repositories" value="${esc(p.repositories ?? '')}" placeholder="e.g. payments-api, web-portal, 3 mobile apps"></label>
        <label class="field">DAST and API targets<input name="targets" value="${esc(p.targets ?? '')}" placeholder="e.g. staging web app, orders API"></label></div>
      <label class="field">Executive overview letter <span class="muted small">leave empty and Meridian writes it from the POV; paragraphs separated by an empty line</span><textarea name="letter" rows="6">${esc(p.letter ?? '')}</textarea></label>
      <label class="field">Closing line of the letter<input name="quote" value="${esc(p.quote ?? '')}" placeholder="“From code to confidence: building security from the ground up with Checkmarx.”"></label>
      <p class="small muted">Meetings and their notes are under Notes → Sessions; people and their POV roles under Customer → Stakeholders.</p>
      <p class="form-error" id="planErr" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
    {
      wide: true,
      onOpen(dl) {
        const f = dl.querySelector('#planForm');
        dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        for (const b of dl.querySelectorAll('[data-tc]'))
          b.addEventListener('click', () => {
            const on = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', String(on));
            b.classList.toggle('must', on);
          });
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = (n) => f.querySelector(`[name="${n}"]`)?.value ?? '';
          const toolchain = Object.fromEntries(TC.map((t) => [t.key, { tools: [...[...dl.querySelectorAll(`[data-tc="${t.key}"][aria-pressed="true"]`)].map((b) => b.dataset.name), ...v(`extra_${t.key}`).split(',').map((x) => x.trim()).filter(Boolean)], access: v(`acc_${t.key}`) }]));
          toolchain.languages = v('languages');
          const split = (n) => v(n).split('\n').map((x) => x.trim()).filter(Boolean);
          try {
            await api(`/opportunities/${oid()}`, { method: 'PATCH', body: { toolchain, plan: { scope: split('scope'), support: split('support'), success: split('success'), outOfScope: v('outOfScope'), accountName: v('accountName'), repositories: v('repositories'), targets: v('targets'), letter: v('letter'), quote: v('quote') } } });
            closeDialog('ok');
            toast('Saved');
            rerender();
          } catch (error) {
            $('#planErr').textContent = error.message;
          }
        });
      },
    },
  );
}

// ——— History ———
function history(d) {
  const list = [...(d.opportunity.history ?? [])].reverse();
  return `<section class="panel"><ul class="feed" style="max-height:none">${list.map((h) => `<li><span class="icon">✎</span><div><div class="t">${esc(h.what)}</div><div class="m">${esc(person(h.by))}</div></div><span class="when" title="${esc(when(h.at))}">${ago(h.at)}</span></li>`).join('') || '<li class="empty" style="display:block">No changes yet.</li>'}</ul></section>`;
}

const VIEWS = {
  overview,
  tenant,
  ai: () => aiTab(),
  criteria,
  notes: (d) => `${notes(d)}<h2 class="sec-title">Sessions with the customer</h2>${sessions(d)}`,
  email: (d) => `${(d.opportunity.goals ?? []).length ? '<section class="panel talk-panel" id="talkTrack" hidden></section>' : ''}${email(d)}<details class="panel fold-panel" ${wants('discovery') ? 'open' : ''}><summary><h3>Discovery</h3><span class="small muted">goals, tools, what they want to see</span></summary><div class="body">${discovery(d)}</div></details>`,
  report: (d) => `${report(d)}<details class="panel fold-panel"><summary><h3>Everything that happened</h3><span class="small muted">${(d.opportunity.history ?? []).length} entries</span></summary>${history(d)}</details>`,
};

// ——— Wiring ———
const on = (root, sel, fn) => $$(sel, root).forEach((el) => el.addEventListener('click', (e) => fn(el, e)));

const WIRES = {
  ai(main) {
    wireAiTab(main, oid(), { canEdit: current.canEdit, rerender });
  },
  overview(main, d) {
    on(main, '[data-fix]', (b) => doFix(b.dataset.fix));
    const box = $('#summary');
    const state_ = $('#sumState');
    let t;
    const store = () =>
      api(`/opportunities/${oid()}`, { method: 'PATCH', body: { summary: box.value } })
        .then(() => (state_.textContent = 'Saved ✓'))
        .catch((e) => (state_.textContent = `Not saved: ${e.message}`));
    box?.addEventListener('input', () => {
      state_.textContent = 'Saving…';
      clearTimeout(t);
      t = setTimeout(store, 800);
    });
    on(main, '[data-act="draft-summary"]', () => {
      box.value = draftSummary(d);
      store();
    });
    $('#quickTask')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.title.value.trim()) item('tasks', { title: e.target.title.value }, 'Task added');
    });
    on(main, '[data-act="deck"]', () => attempt(() => download(`/opportunities/${oid()}/deck`), 'Presentation downloaded'));
    on(main, '[data-act="share-deck"]', () => (location.hash = tabHref('email', 'completion')));
    on(main, '[data-result]', (b) => save({ povResult: b.dataset.result }, b.dataset.result === 'successful' ? 'POV marked successful' : 'Saved'));
    on(main, '[data-act="connect"]', connectTenant);
  },
  tenant(main, d) {
    on(main, '[data-act="connect"]', connectTenant);
    on(main, '[data-act="refresh"]', async () => {
      if (await attempt(() => api(`/opportunities/${oid()}/refresh`, { method: 'POST' }), 'Reading the tenant…')) setTimeout(rerender, 400);
    });
    on(main, '[data-act="disconnect"]', async () => {
      if (!(await ask('Disconnect this tenant and delete its stored API key? Nothing changes in Checkmarx One.', { ok: 'Disconnect', danger: true }))) return;
      if (await attempt(() => api(`/opportunities/${oid()}/tenant`, { method: 'DELETE' }), 'Disconnected')) rerender();
    });
    on(main, '[data-act="bundle"]', () => attempt(() => download(`/opportunities/${oid()}/troubleshoot`), 'Bundle downloaded'));
    on(main, '[data-log]', (b) => {
      const [scan, engine] = b.dataset.log.split('|');
      attempt(() => download(`/opportunities/${oid()}/logs/${encodeURIComponent(scan)}/${encodeURIComponent(engine)}`), 'Log downloaded');
    });
    on(main, '[data-act="tenant-tools"]', () => {
      const mu = d.opportunity.mute?.until;
      const mute = async (until) => {
        closeDialog();
        if (await attempt(() => api(`/opportunities/${oid()}/mute`, { method: 'PUT', body: { until, projects: d.opportunity.mute?.projects ?? [] } }), until ? 'Alerts muted' : 'Alerts on')) rerender();
      };
      openDialog(
        `<div class="dbody"><h2>Tenant</h2><nav class="more-list">
          ${mu ? '<button type="button" data-mu="off"><span>Turn alerts back on</span></button>' : '<button type="button" data-mu="24"><span>Mute alerts for a day</span><small class="muted">Failed scans and quiet days stop showing as needing you</small></button><button type="button" data-mu="168"><span>Mute alerts for a week</span></button>'}
          <button type="button" data-tt="sbom" data-fmt="cyclonedx"><span>Download an SBOM (CycloneDX)</span><small class="muted">From the latest SCA scan: the evidence for the SBOM criterion</small></button>
          <button type="button" data-tt="sbom" data-fmt="spdx"><span>Download an SBOM (SPDX)</span></button>
          ${can('tenant.logs') ? '<button type="button" data-tt="bundle"><span>Download the troubleshooting bundle</span><small class="muted">Every failed scan of the last 7 days, with its engine logs</small></button>' : ''}
          ${current.canEdit ? '<button type="button" data-tt="connect"><span>Replace the API key</span></button><button type="button" data-tt="disconnect" class="bad-t"><span>Disconnect the tenant</span><small class="muted">Deletes the stored key; nothing changes in Checkmarx One</small></button>' : ''}
        </nav><div class="dialog-actions"><button class="btn" data-close>Close</button></div></div>`,
        {
          onOpen(dl) {
            dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
            for (const b of dl.querySelectorAll('[data-mu]')) b.addEventListener('click', () => mute(b.dataset.mu === 'off' ? null : new Date(Date.now() + Number(b.dataset.mu) * 3600e3).toISOString()));
            for (const b of dl.querySelectorAll('[data-tt="sbom"]')) b.addEventListener('click', () => (closeDialog(), attempt(() => download(`/opportunities/${oid()}/sbom?format=${b.dataset.fmt}`), 'SBOM downloaded')));
            dl.querySelector('[data-tt="bundle"]')?.addEventListener('click', () => (closeDialog(), attempt(() => download(`/opportunities/${oid()}/troubleshoot`), 'Bundle downloaded')));
            dl.querySelector('[data-tt="connect"]')?.addEventListener('click', () => (closeDialog(), setTimeout(connectTenant, 60)));
            dl.querySelector('[data-tt="disconnect"]')?.addEventListener('click', async () => {
              closeDialog();
              await new Promise((r) => setTimeout(r, 60));
              if (!(await ask('Disconnect this tenant and delete its stored API key? Nothing changes in Checkmarx One.', { ok: 'Disconnect', danger: true }))) return;
              if (await attempt(() => api(`/opportunities/${oid()}/tenant`, { method: 'DELETE' }), 'Disconnected')) rerender();
            });
          },
        },
      );
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
    on(main, '[data-cf]', (b) => ((critFilter = b.dataset.cf), rerender()));
    on(main, '[data-met]', (b, e) => {
      e.stopPropagation();
      const c = d.opportunity.criteria.find((x) => x.id === b.dataset.met);
      item('criteria', { ...c, status: 'met' }, `"${c.title}" done`);
    });
    for (const row of $$('[data-open-crit]', main)) {
      const go = (e) => !e.target.closest('button') && openCriterion(d.opportunity.criteria.find((x) => x.id === row.dataset.openCrit));
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go(e)));
    }
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
    on(main, '[data-act="draft-disc"]', () => (location.hash = tabHref('email', 'discovery')));
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
    // What to say: the value messages and use cases behind this POV's business goals (from the SEAL library).
    const box = $('#talkTrack');
    if (box)
      api(`/library/talk?goals=${encodeURIComponent(d.opportunity.goals.map((g) => g.key).join(','))}`)
        .then(({ talk }) => {
          if (!talk.length) return;
          box.hidden = false;
          box.innerHTML = `<div class="head"><h3>What to say</h3><span class="small muted">for the business goals of this POV</span></div><div class="body">${talk
            .map((t) => `<details class="talk" ${talk.length === 1 ? 'open' : ''}><summary>${esc(t.goal.title)}${t.goal.persona ? ` <span class="small muted">· ${esc(t.goal.persona)}</span>` : ''}</summary>${t.values
              .map((v) => `<div class="talk-one"><div class="small muted">${esc(v.persona)}</div>${v.concern ? `<blockquote>${esc(v.concern)}</blockquote>` : ''}<p><b>${esc(v.title)}.</b> ${esc(v.message)}</p>${v.proof?.length ? `<ul>${v.proof.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${v.land ? `<p class="small"><b>How to land it:</b> ${esc(v.land)}</p>` : ''}</div>`)
              .join('')}${t.useCases.length ? `<div class="talk-one"><b>Use cases:</b> ${t.useCases.map((u) => esc(u.title)).join(' · ')}${t.useCases[0].winThemes?.length ? `<ul>${t.useCases.flatMap((u) => u.winThemes).slice(0, 4).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>` : ''}</details>`)
            .join('')}</div>`;
        })
        .catch(() => {});
    const form = $('#mailForm');
    const fill = (m) => {
      form.template.value = m.template ?? '';
      form.to.value = (m.to ?? []).join(', ');
      form.cc.value = (m.cc ?? []).join(', ');
      form.subject.value = m.subject ?? '';
      form.body.value = m.body ?? '';
      form.attachDeck.checked = m.template === 'completion';
      form.hidden = false;
    };
    const load = async (template) => {
      const m = await attempt(() => api(`/opportunities/${oid()}/email/draft`, { method: 'POST', body: { template } }));
      if (m) fill(m);
    };
    on(main, '[data-template]', (b) => load(b.dataset.template));
    on(main, '[data-outbox]', (li) => fill(d.outbox.find((m) => m.id === li.dataset.outbox)));
    if (wants('discovery')) load('discovery');
    if (wants('completion')) load('completion');
    const msg = () => formData(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!(await ask(`Send "${form.subject.value}" to ${form.to.value}?`, { ok: 'Send' }))) return;
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
    on(main, '[data-act="dl-rw"]', () => attempt(() => download(`/opportunities/${oid()}/rw?download=1`)));
    // Screenshots: added (several at once, each named after its file), renamed, moved, removed.
    const shotIn = main.querySelector('#shotFile');
    on(main, '[data-act="shot-add"]', () => shotIn?.click());
    shotIn?.addEventListener('change', async () => {
      for (const f of [...shotIn.files]) {
        const r = await fetch(`/api/opportunities/${oid()}/screenshots?caption=${encodeURIComponent(f.name.replace(/\.(png|jpe?g)$/i, '').replace(/[_-]+/g, ' '))}`, { method: 'POST', headers: { 'X-Requested-With': 'Meridian', 'Content-Type': f.type || 'application/octet-stream' }, body: f });
        if (!r.ok) {
          toast((await r.json().catch(() => ({}))).error ?? `${f.name} could not be added`, { bad: true });
          break;
        }
      }
      shotIn.value = '';
      rerender();
    });
    const shotMove = (id, move) => attempt(() => api(`/opportunities/${oid()}/screenshots/${id}`, { method: 'PUT', body: { move } })).then((r) => r && rerender());
    on(main, '[data-shot-up]', (e) => shotMove(e.target.closest('[data-shot-up]').dataset.shotUp, -1));
    on(main, '[data-shot-down]', (e) => shotMove(e.target.closest('[data-shot-down]').dataset.shotDown, 1));
    on(main, '[data-shot-name]', (e) => {
      const id = e.target.closest('[data-shot-name]').dataset.shotName;
      const x = (current.opportunity.screenshots ?? []).find((y) => y.id === id);
      dialogForm('shotForm', 'Name the screenshot', `<label class="field">Slide title: Checkmarx ONE – …<input name="caption" required value="${esc(x?.caption ?? '')}" placeholder="e.g. Analytics and Dashboard"></label>`, (b) => api(`/opportunities/${oid()}/screenshots/${id}`, { method: 'PUT', body: b }));
    });
    on(main, '[data-shot-del]', async (e) => {
      const id = e.target.closest('[data-shot-del]').dataset.shotDel;
      if (!(await ask('Remove this screenshot from the POV?', { ok: 'Remove', danger: true }))) return;
      if (await attempt(() => api(`/opportunities/${oid()}/screenshots/${id}`, { method: 'DELETE' }), 'Removed')) rerender();
    });
    on(main, '[data-act="dl-results"]', () => attempt(() => download(`/opportunities/${oid()}/results?download=1`), 'Results page downloaded'));
    on(main, '[data-act="dl-final"]', () => attempt(() => download(`/opportunities/${oid()}/results?download=1&final=1`), 'Final results downloaded'));
    on(main, '[data-act="freeze"]', async () => {
      if (await attempt(() => api(`/opportunities/${oid()}/results/freeze`, { method: 'POST' }), 'Final results kept')) rerender();
    });
    on(main, '[data-act="deck"]', () => attempt(() => download(`/opportunities/${oid()}/deck`), 'Presentation downloaded'));
    // The presentation template: the team's choice, or one picked for this POV.
    api('/deck-templates')
      .then((dt) => {
        const sel = $('#deckPick');
        if (!sel) return;
        const o = current.opportunity;
        sel.innerHTML = `<option value="">Team’s choice</option>${dt.templates.map((t) => `<option value="${esc(t.id)}" ${o.deckTemplateId === t.id || (!o.deckTemplateId && o.reportStyle === 'classic' && t.id === 'builtin-classic') ? 'selected' : ''}>${esc(t.name)}${t.design ? ' (team design)' : ''}</option>`).join('')}`;
        sel.addEventListener('change', async () => {
          if (await attempt(() => api(`/opportunities/${oid()}`, { method: 'PATCH', body: { deckTemplateId: sel.value, reportStyle: '' } }), 'Presentation saved')) rerender();
        });
      })
      .catch(() => {});
    on(main, '[data-act="wip"]', () => attempt(() => download(`/opportunities/${oid()}/wip`), 'WIP deck downloaded'));
    on(main, '[data-act="wip-plan"]', () => editPlan());
    on(main, '[data-act="sp-publish"]', () => {
      const last = d.opportunity.sharepointPublished;
      openDialog(
        `<form id="spP" class="dbody"><h2>Publish to SharePoint</h2><p class="small muted">Into the POV’s site, in its documents folder. Today’s date goes in each file’s name, so earlier copies stay.</p>
          <label class="check"><input type="checkbox" name="wip" checked> The WIP deck</label>
          <label class="check"><input type="checkbox" name="deck" checked> The results presentation</label>
          <label class="check"><input type="checkbox" name="results" checked> The results page (HTML)</label>
          <label class="check"><input type="checkbox" name="rw" checked> The RW report: the POV guide (HTML)</label>
          ${last ? `<p class="small muted">Last published ${esc(when(last.at))} by ${esc(last.by)} to ${esc(last.folder)}.</p>` : ''}
          <p class="form-error" id="spErr" role="alert"></p>
          <div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Publish</button></div></form>`,
        {
          onOpen(dl) {
            dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
            dl.querySelector('#spP').addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = e.target;
              const btn = f.querySelector('.btn.primary');
              btn.disabled = true;
              btn.textContent = 'Publishing…';
              try {
                const r = await api(`/opportunities/${oid()}/sharepoint`, { method: 'POST', body: { what: ['wip', 'deck', 'results', 'rw'].filter((k) => f[k].checked) } });
                closeDialog();
                toast(`Published ${r.files.length} document${r.files.length === 1 ? '' : 's'} to ${r.folder}`);
                rerender();
              } catch (err) {
                $('#spErr').textContent = err.message;
                btn.disabled = false;
                btn.textContent = 'Publish';
              }
            });
          },
        },
      );
    });
    const apmaIn = $('#apmaFile');
    on(main, '[data-act="apma-up"]', () => apmaIn.click());
    apmaIn?.addEventListener('change', async () => {
      const file = apmaIn.files[0];
      if (!file) return;
      const res = await fetch(`/api/opportunities/${oid()}/apma`, { method: 'POST', headers: { 'X-Requested-With': 'Meridian', 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return toast(j.error ?? 'That file could not be read', { bad: true });
      toast(j.otherCustomer ? 'Read — but this report looks like it was written for another company. Check it is the right file.' : j.found === 5 ? 'APMA assessment read: all five dimensions' : `APMA assessment read: ${j.found} of 5 dimensions found`, { bad: Boolean(j.otherCustomer) });
      rerender();
    });
    on(main, '[data-act="apma-del"]', async () => {
      if (!(await ask('Remove the APMA assessment from this POV? The WIP deck no longer has its APMA slide.', { ok: 'Remove', danger: true }))) return;
      if (await attempt(() => api(`/opportunities/${oid()}/apma`, { method: 'DELETE' }), 'Removed')) rerender();
    });
  },
};
// The folded tabs wire both of their parts.
{
  const n = WIRES.notes;
  const e = WIRES.email;
  const r = WIRES.report;
  WIRES.notes = (main, d) => (n?.(main, d), WIRES.sessions?.(main, d));
  WIRES.email = (main, d) => (e?.(main, d), WIRES.discovery?.(main, d));
  WIRES.report = (main, d) => r?.(main, d);
}

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
     <label class="field">Deal size<input name="amount" value="${esc(o.amount ?? '')}" placeholder="e.g. $420k ARR"></label>
     <div class="row"><button type="button" class="btn ghost danger" id="delOpp">Delete this opportunity</button></div>`,
    (b) => api(`/opportunities/${oid()}`, { method: 'PATCH', body: b }),
  ).then(() => {});
}
async function removeOpportunity() {
  if (!(await ask(`Delete "${current.opportunity.customer}" with all its notes, criteria and stored key? This cannot be undone.`, { ok: 'Delete', danger: true }))) return;
  if (await attempt(() => api(`/opportunities/${oid()}`, { method: 'DELETE' }), 'Deleted')) location.hash = '#/dashboard';
}
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'delOpp') return;
  if (!(await ask(`Delete "${current.opportunity.customer}" with all its notes, criteria and stored key? This cannot be undone.`, { ok: 'Delete', danger: true }))) return;
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
    `<p class="muted" style="margin:0">Paste the Checkmarx One API key of the POV tenant. The tenant, region and hosts come from the key; it is checked with Checkmarx One and stored encrypted on this server. Read-only use: Meridian never changes anything in the tenant.</p>
     <textarea name="apiKey" class="mono" rows="4" required spellcheck="false" autocomplete="off" placeholder="eyJhbGciOi…"></textarea>
     ${o.tenant ? '<label class="check"><input type="checkbox" name="replaceTenant"> Connect a different tenant</label>' : ''}
     <details><summary class="small muted" style="cursor:pointer">Single-tenant or on-prem addresses</summary><div class="row" style="margin-top:8px"><label class="field">IAM URL<input name="iamUrl"></label><label class="field">API URL<input name="baseUrl"></label><label class="field">Tenant<input name="tenant"></label></div></details>`,
    (b) => api(`/opportunities/${oid()}/tenant`, { method: 'POST', body: { apiKey: b.apiKey, replaceTenant: b.replaceTenant, overrides: { iamUrl: b.iamUrl, baseUrl: b.baseUrl, tenant: b.tenant } } }),
  ).then((v) => v === 'ok' && toast('Connected. Reading the tenant…'));
}

async function addCapabilities() {
  const { criteriaWizard } = await import('./criteria-wizard.js');
  if (await criteriaWizard({ mode: 'add', opp: current.opportunity })) {
    toast('Success criteria added');
    rerender();
  }
}

// ——— Demonstrated by the SE ———
function demoLine(c) {
  const dm = c.demo;
  const button = current.canEdit ? `<button class="btn sm" data-demo="${esc(c.id)}">${dm ? 'Edit the demo' : 'Record a demo'}</button>` : '';
  if (!dm) return current.canEdit && c.status !== 'met' ? `<div class="row" style="margin-top:6px">${button}<span class="small muted">Shown by you instead of in the customer’s tenant?</span></div>` : '';
  return `<div class="demo-box">
    <div class="small"><b class="ok-t">▶ Demonstrated by ${esc(person(dm.by) || 'the SE')}</b> on ${day(dm.date)}${dm.environment ? ` · ${esc(dm.environment)}` : ''}${dm.attendees ? ` · seen by ${esc(dm.attendees)}` : ''}</div>
    ${dm.notes ? `<div class="small notes-box muted">${esc(dm.notes)}</div>` : ''}
    <div class="row center" style="margin-top:6px">${dm.video ? `<button class="btn sm" data-watch="${esc(c.id)}">▶ Watch (${esc(dm.video.name)}, ${dm.video.size < 1048576 ? `${Math.max(1, Math.round(dm.video.size / 1024))} KB` : `${(dm.video.size / 1048576).toFixed(1)} MB`})</button>${current.canEdit ? `<button class="btn sm ghost" data-unvideo="${esc(c.id)}">Remove video</button>` : ''}` : ''}${dm.recordingUrl ? `<a class="btn sm ghost" href="${esc(dm.recordingUrl)}" target="_blank" rel="noopener noreferrer">Session recording ↗</a>` : ''}${button}</div>
    <div class="demo-player"></div>
  </div>`;
}

function recordDemo(c) {
  const dm = c.demo ?? {};
  return openDialog(
    `<form id="demoForm"><h2>Demonstrated by the SE</h2>
      <p class="muted" style="margin:0">For <b>${esc(c.title)}</b>, shown by you (in your own demo environment, or on a screen share) instead of in the customer’s tenant. Reports show it as <b>Demonstrated by the SE</b>, apart from what was completed in the tenant.</p>
      <div class="row"><label class="field">Date<input type="date" name="date" value="${esc(dm.date ?? new Date().toISOString().slice(0, 10))}" required></label><label class="field">Where it was shown<input name="environment" value="${esc(dm.environment ?? '')}" placeholder="e.g. SE demo tenant, screen share"></label></div>
      <label class="field">Who saw it<input name="attendees" value="${esc(dm.attendees ?? '')}" placeholder="e.g. Priya Rao (AppSec lead), Tom Lee"></label>
      <label class="field">What was shown<textarea name="notes" rows="3">${esc(dm.notes ?? '')}</textarea></label>
      <label class="field">Session recording link (Teams, Zoom, SharePoint)<input type="url" name="recordingUrl" value="${esc(dm.recordingUrl ?? '')}"></label>
      <label class="field">A short demo video (MP4 or WebM, up to 25 MB)${dm.video ? ` — replaces ${esc(dm.video.name)}` : ''}<input type="file" name="video" accept="video/mp4,video/webm,video/quicktime"></label>
      <p class="small muted" style="margin:0">The video plays inside the results page (also when it is downloaded or shared); it is not offered as a file to download.</p>
      <label class="check"><input type="checkbox" name="markCompleted" ${c.status === 'met' && c.proofType !== 'demo' ? '' : 'checked'}> Count it as completed successfully (demonstrated)</label>
      <p class="form-error" id="demoErr" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`,
    {
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('#demoForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          const file = f.video.files[0];
          const err = $('#demoErr');
          if (file && file.size > 25 * 1048576) return (err.textContent = 'The video is larger than 25 MB: trim it or export it smaller (720p is plenty).');
          const btn = f.querySelector('.btn.primary');
          btn.disabled = true;
          try {
            await api(`/opportunities/${oid()}/criteria/${c.id}/demo`, { method: 'POST', body: { date: f.date.value, environment: f.environment.value, attendees: f.attendees.value, notes: f.notes.value, recordingUrl: f.recordingUrl.value, markCompleted: f.markCompleted.checked } });
            if (file) {
              btn.textContent = 'Uploading the video…';
              const r = await fetch(`/api/opportunities/${oid()}/criteria/${c.id}/demo-video?name=${encodeURIComponent(file.name)}`, { method: 'PUT', headers: { 'X-Requested-With': 'Meridian', 'Content-Type': file.type || 'video/mp4' }, body: file });
              if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`);
            }
            closeDialog('ok');
            toast('Demo recorded');
            rerender();
          } catch (error) {
            err.textContent = error.message;
            btn.disabled = false;
            btn.textContent = 'Save';
          }
        });
      },
    },
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
     <label class="field">Test item <span class="muted small">what is done in the POV</span><textarea name="test" rows="2">${esc(c?.test ?? '')}</textarea></label>
     <label class="field">Benefit <span class="muted small">what the customer gains</span><textarea name="benefit" rows="2">${esc(c?.benefit ?? '')}</textarea></label>
     <div class="row"><label class="field">Milestone<select name="milestone"><option value="">—</option>${['M1', 'M2', 'M3', 'M1 / M2'].map((m) => `<option ${c?.milestone === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label><label class="field">Customer tracker references <span class="muted small">e.g. 2, 8, 12</span><input name="refs" value="${esc(c?.refs ?? '')}"></label></div>
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
     <label class="field">Status<select name="status"><option value="">By its date (Completed once it has passed)</option><option value="done" ${x?.status === 'done' ? 'selected' : ''}>Completed</option><option value="planned" ${x?.status === 'planned' ? 'selected' : ''}>Planned</option></select></label>
     <label class="field">What we did <span class="muted small">one point per line: the meeting notes slide</span><textarea name="did" rows="5">${esc(x?.did ?? '')}</textarea></label>
     <div class="row"><label class="field">Next steps from the customer<textarea name="theirNext" rows="3">${esc(x?.theirNext ?? '')}</textarea></label><label class="field">From the Checkmarx side<textarea name="ourNext" rows="3">${esc(x?.ourNext ?? '')}</textarea></label></div>
     <label class="field">Other notes<textarea name="notes" rows="4">${esc(x?.notes ?? '')}</textarea></label>
     <label class="field">Follow-ups<textarea name="followUps" rows="2">${esc(x?.followUps ?? '')}</textarea></label>`,
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
     <label class="field">POV role<select name="povRole"><option value="">—</option>${(state.meta.povRoles ?? []).map((r) => `<option ${p?.povRole === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
     <label class="check"><input type="checkbox" name="notify" ${p?.notify !== false ? 'checked' : ''}> Include in POV emails</label>`,
    (b) => api(`/opportunities/${oid()}/stakeholders${p ? `/${p.id}` : ''}`, { method: 'POST', body: b }),
  );
}
