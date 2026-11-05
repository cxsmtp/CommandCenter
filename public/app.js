import { colourIndex } from './tenant-colour.js';

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
const store = {
  get(k, d = null) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// "New since you last looked": the time of the previous visit, kept in this browser.
const lastSeen = store.get('cc.lastSeen', 0);
const markSeen = () => store.set('cc.lastSeen', Date.now());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && markSeen());
addEventListener('pagehide', markSeen);

let overview = null;
let detail = null;
let feedFilter = store.get('cc.feedFilter', 'all');
let tableSort = {};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'X-Requested-With': 'CommandCenter', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error(data.error || 'Sign in first.');
  }
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function ago(iso) {
  const t = Date.parse(iso ?? '');
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const tc = (c) => `var(--tc-${colourIndex(c)})`;
const route = () => {
  const m = location.hash.match(/^#\/pov\/([\w-]+)/);
  return m ? { view: 'pov', id: m[1] } : { view: 'all' };
};

const HEALTH = { healthy: 'Healthy', attention: 'Failed scans', idle: 'Quiet (3+ days)', failed: 'Cannot read', loading: 'Reading…' };
const STAGE = { active: 'Active', paused: 'Paused', won: 'Won', lost: 'Lost', closed: 'Closed' };
const KIND = {
  completed: ['✓', 'Scan completed'],
  failed: ['✕', 'Scan failed'],
  partial: ['◐', 'Scan partially completed'],
  canceled: ['⊘', 'Scan canceled'],
  running: ['▶', 'Scan running'],
  queued: ['…', 'Scan queued'],
  project: ['＋', 'Project created'],
  other: ['•', 'Scan'],
};

function renderTabs() {
  const r = route();
  const povs = overview?.povs ?? [];
  $('#tabs').innerHTML =
    `<button class="tab" data-go="#/" ${r.view === 'all' ? 'aria-current="page"' : ''}>All POVs <span class="muted">${povs.length}</span></button>` +
    povs
      .map((p) => `<button class="tab" data-go="#/pov/${esc(p.id)}" ${r.view === 'pov' && r.id === p.id ? 'aria-current="page"' : ''}><span class="chip" style="background:${tc(p.colour)}"></span>${esc(p.name)}${p.health === 'failed' || p.health === 'attention' ? ' <span class="dot ' + p.health + '"></span>' : ''}</button>`)
      .join('');
}

function renderRefreshNote() {
  const next = (overview?.povs ?? []).map((p) => Date.parse(p.nextAt ?? '')).filter(Boolean);
  const busy = (overview?.povs ?? []).some((p) => p.refreshing);
  if (busy) return ($('#refreshNote').textContent = 'Reading Checkmarx One…');
  if (!next.length) return ($('#refreshNote').textContent = overview ? `Every ${overview.intervalMinutes} min` : '');
  const s = Math.max(0, Math.round((Math.min(...next) - Date.now()) / 1000));
  $('#refreshNote').textContent = `Next read in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · every ${overview.intervalMinutes} min`;
}
setInterval(renderRefreshNote, 1000);

function sevBar(f) {
  if (!f || !f.total) return '<div class="sevbar"></div>';
  const parts = ['critical', 'high', 'medium', 'low'].map((s) => `<span class="s-${s}" style="width:${(100 * f[s]) / Math.max(1, f.critical + f.high + f.medium + f.low)}%" title="${s}: ${f[s]}"></span>`);
  return `<div class="sevbar">${parts.join('')}</div>`;
}
function sevLegend(f, delta) {
  if (!f) return '<div class="sev-legend">Findings not read</div>';
  const d = (v) => (v > 0 ? ` <span class="delta-up">▲${v}</span>` : v < 0 ? ` <span class="delta-down">▼${-v}</span>` : '');
  return `<div class="sev-legend"><span>Critical <b>${fmt(f.critical)}</b>${delta ? d(delta.critical) : ''}</span><span>High <b>${fmt(f.high)}</b>${delta ? d(delta.high) : ''}</span><span>Medium <b>${fmt(f.medium)}</b></span><span>Low <b>${fmt(f.low)}</b></span></div>`;
}
function spark(trend) {
  const pts = (trend ?? []).map((t) => t.ch);
  if (pts.length < 2) return '';
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 108 + 1).toFixed(1)},${(26 - ((v - min) / Math.max(1, max - min)) * 24).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 110 28" aria-label="Critical and high over time"><path d="${d}"/></svg>`;
}

function card(p) {
  const s = p.summary;
  const days = p.daysLeft;
  const dayBadge = p.stage === 'active' && days !== null ? `<span class="badge ${days < 0 ? 'bad' : days <= 7 ? 'warn' : ''}">${days < 0 ? `${-days} d over` : days === 0 ? 'ends today' : `${days} d left`}</span>` : '';
  return `<article class="card" style="--tc:${tc(p.colour)}" data-go="#/pov/${esc(p.id)}" tabindex="0">
    <div class="card-head">
      <div>
        <div class="card-title">${esc(p.name)}</div>
        <div class="card-sub">${esc([p.customer, p.tenant, p.regionLabel].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="badges">${dayBadge}<span class="badge">${esc(STAGE[p.stage] ?? p.stage)}</span></div>
    </div>
    <div class="health"><span class="dot ${p.refreshing ? 'loading' : p.health}"></span>${esc(p.refreshing ? 'Reading…' : HEALTH[p.health] ?? p.health)}${s?.lastActivityAt ? ` · last activity ${ago(s.lastActivityAt)}` : ''}</div>
    ${
      s
        ? `<div class="stats">
      <div class="stat"><div class="v">${fmt(s.projects)}</div><div class="l">Projects${s.newProjects7d ? ` (+${s.newProjects7d})` : ''}</div></div>
      <div class="stat"><div class="v">${fmt(s.scans24h)}</div><div class="l">Scans 24h</div></div>
      <div class="stat"><div class="v">${fmt(s.running + s.queued)}</div><div class="l">Running now</div></div>
      <div class="stat ${s.failed24h ? 'bad' : ''}"><div class="v">${fmt(s.failed24h)}</div><div class="l">Failed 24h</div></div>
    </div>
    ${sevBar(s.findings)}${sevLegend(s.findings, s.delta)}`
        : ''
    }
    ${p.error && p.health === 'failed' ? `<div class="error-line">${esc(p.error.message)}</div>` : ''}
    <div class="card-foot"><span>${s ? `Read ${ago(s.at)}${s.people?.length ? ` · ${esc(s.people.map((x) => x.name).slice(0, 2).join(', '))}` : ''}` : ''}</span>${spark(p.trend)}</div>
  </article>`;
}

function feed(events, povs, { showPov = true } = {}) {
  const byId = new Map(povs.map((p) => [p.id, p]));
  const filters = [['all', 'All'], ['failed', 'Failed'], ['running', 'Running'], ['completed', 'Completed'], ['project', 'Projects']];
  const match = (e) => feedFilter === 'all' || e.kind === feedFilter || (feedFilter === 'running' && e.kind === 'queued') || (feedFilter === 'failed' && (e.kind === 'partial' || e.kind === 'canceled'));
  const list = events.filter(match).slice(0, 150);
  const isFresh = (e) => lastSeen && Date.parse(e.at) > lastSeen;
  const fresh = events.filter(isFresh).length;
  return `<section class="panel">
    <div class="section-head"><h3>Activity · last 7 days</h3><span class="muted">${fresh ? `${fresh} new since your last visit` : ''}</span></div>
    <div class="filters">${filters.map(([k, l]) => `<button class="filter" data-filter="${k}" aria-pressed="${feedFilter === k}">${l}</button>`).join('')}</div>
    <ul class="feed">${
      list.length
        ? list
            .map((e) => {
              const [icon, label] = KIND[e.kind] ?? KIND.other;
              const p = byId.get(e.povId);
              const meta = [showPov && p ? p.name : '', e.branch, e.initiator, e.origin, (e.engines ?? []).join(', ')].filter(Boolean).join(' · ');
              return `<li class="${isFresh(e) ? 'fresh' : ''}" ${showPov ? `data-go="#/pov/${esc(e.povId)}"` : ''}>
                <span class="icon k-${e.kind}" ${p ? `style="color:${e.kind === 'project' ? tc(p.colour) : ''}"` : ''}>${icon}</span>
                <div class="what"><div class="t">${esc(label)} · <b>${esc(e.project || e.projectId)}</b></div><div class="m">${esc(meta)}</div>${e.reason ? `<div class="m k-failed">${esc(e.reason)}</div>` : ''}</div>
                <span class="when" title="${esc(when(e.at))}">${ago(e.at)}</span>
              </li>`;
            })
            .join('')
        : '<li class="empty" style="display:block">Nothing here yet.</li>'
    }</ul>
  </section>`;
}

function renderAll() {
  const o = overview;
  if (!o) return (main.innerHTML = '<div class="empty">Loading…</div>');
  if (!o.povs.length) {
    main.innerHTML = `<div class="hero-empty"><h2>Every POV, in one place</h2><p>Add the Checkmarx One API key of each POV tenant. CommandCenter reads every tenant every ${o.intervalMinutes} minutes — scans running, failed and finished, new projects, findings — and shows them all here.</p><button class="btn primary" data-action="add">+ Add your first POV</button></div>`;
    return;
  }
  const t = o.totals;
  const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${fmt(value)}</div></div>`;
  const active = o.povs.filter((p) => p.stage === 'active');
  const other = o.povs.filter((p) => p.stage !== 'active');
  const rank = { failed: 0, attention: 1, loading: 2, healthy: 3, idle: 4 };
  active.sort((a, b) => (rank[a.health] ?? 5) - (rank[b.health] ?? 5) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  main.innerHTML = `
    <div class="kpis">
      ${kpi('Active POVs', t.active)}
      ${kpi('Need attention', t.needsAttention, t.needsAttention ? 'bad' : '')}
      ${kpi('Ending in 7 days', t.endingSoon, t.endingSoon ? 'warn' : '')}
      ${kpi('Running now', t.running)}
      ${kpi('Scans 24h', t.scans24h)}
      ${kpi('Failed 24h', t.failed24h, t.failed24h ? 'bad' : '')}
      ${kpi('Critical', t.critical)}
      ${kpi('High', t.high)}
    </div>
    <div class="layout">
      <div class="stack">
        <section><div class="section-head"><h2>Active POVs</h2><span class="muted">${fmt(t.projects)} projects across ${t.povs} tenants</span></div>
          <div class="cards">${active.map(card).join('') || '<div class="empty">No active POV.</div>'}</div></section>
        ${other.length ? `<section><div class="section-head"><h2>Paused and closed</h2></div><div class="cards">${other.map(card).join('')}</div></section>` : ''}
      </div>
      ${feed(o.events, o.povs)}
    </div>`;
}

function sortable(id, columns, rows) {
  const s = tableSort[id] ?? { col: null, dir: 1 };
  const sorted = s.col === null ? rows : [...rows].sort((a, b) => {
    const x = columns[s.col].key(a);
    const y = columns[s.col].key(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * s.dir;
  });
  return `<div class="table-wrap"><table data-table="${id}"><thead><tr>${columns.map((c, i) => `<th class="${c.n ? 'n' : ''}" data-col="${i}">${c.label}${s.col === i ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${
    sorted.length ? sorted.map((r) => `<tr>${columns.map((c) => `<td class="${c.n ? 'n' : ''}">${c.html(r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="muted">None.</td></tr>`
  }</tbody></table></div>`;
}

const tableDefs = {
  projects: [
    { label: 'Project', key: (p) => p.name, html: (p) => esc(p.name) },
    { label: 'Last scan (7d)', key: (p) => p.lastScan?.status ?? '', html: (p) => (p.lastScan ? `<span class="status ${esc(p.lastScan.status)}">${esc(p.lastScan.status)}</span> <span class="muted">${ago(p.lastScan.updatedAt ?? p.lastScan.createdAt)}</span>` : '<span class="muted">—</span>') },
    { label: 'Results from', key: (p) => Date.parse(p.findings?.scanAt ?? '') || 0, html: (p) => (p.findings ? `<span class="muted">${ago(p.findings.scanAt)}</span>` : '<span class="muted">never completed</span>') },
    { label: 'Critical', n: true, key: (p) => p.findings?.critical ?? -1, html: (p) => fmt(p.findings?.critical) },
    { label: 'High', n: true, key: (p) => p.findings?.high ?? -1, html: (p) => fmt(p.findings?.high) },
    { label: 'Medium', n: true, key: (p) => p.findings?.medium ?? -1, html: (p) => fmt(p.findings?.medium) },
    { label: 'Low', n: true, key: (p) => p.findings?.low ?? -1, html: (p) => fmt(p.findings?.low) },
    { label: 'Created', key: (p) => Date.parse(p.createdAt ?? '') || 0, html: (p) => `<span class="muted">${ago(p.createdAt)}</span>` },
  ],
  scans: [
    { label: 'Started', key: (s) => Date.parse(s.createdAt ?? '') || 0, html: (s) => `<span title="${esc(when(s.createdAt))}">${ago(s.createdAt)}</span>` },
    { label: 'Project', key: (s) => s.projectName, html: (s) => esc(s.projectName || s.projectId) },
    { label: 'Status', key: (s) => s.status, html: (s) => `<span class="status ${esc(s.status)}">${esc(s.status)}</span>${s.reason ? `<div class="muted k-failed">${esc(s.reason)}</div>` : ''}` },
    { label: 'Branch', key: (s) => s.branch, html: (s) => esc(s.branch) },
    { label: 'Engines', key: (s) => (s.engines ?? []).join(','), html: (s) => esc((s.engines ?? []).join(', ')) },
    { label: 'By', key: (s) => s.initiator, html: (s) => esc(s.initiator) },
    { label: 'From', key: (s) => s.origin, html: (s) => esc(s.origin) },
    { label: 'Took', n: true, key: (s) => (Date.parse(s.updatedAt) - Date.parse(s.createdAt)) || 0, html: (s) => (/completed|failed|partial|canceled/i.test(s.status) && s.updatedAt ? `${Math.max(0, Math.round((Date.parse(s.updatedAt) - Date.parse(s.createdAt)) / 60000))} min` : '—') },
  ],
};

let projectQuery = '';
function renderPov() {
  const d = detail;
  if (!d) return (main.innerHTML = '<div class="empty">Loading…</div>');
  const p = d.card;
  const s = p.summary;
  const projects = projectQuery ? d.projects.filter((x) => x.name.toLowerCase().includes(projectQuery.toLowerCase())) : d.projects;
  main.innerHTML = `
    <div class="pov-head">
      <div>
        <h1><span class="chip" style="background:${tc(p.colour)};width:14px;height:14px"></span>${esc(p.name)} <span class="badge">${esc(STAGE[p.stage])}</span></h1>
        <div class="pov-meta">
          <span>${esc(p.customer || 'No customer set')}</span>
          <span>Tenant <b>${esc(p.tenant)}</b> · ${esc(p.regionLabel)}</span>
          <span>${esc(p.startDate || '?')} → ${esc(p.endDate || 'no end date')}${p.daysLeft !== null && p.stage === 'active' ? ` (${p.daysLeft < 0 ? `${-p.daysLeft} d over` : `${p.daysLeft} d left`})` : ''}</span>
          ${p.owner ? `<span>${esc(p.owner)}</span>` : ''}
          ${d.identity?.user ? `<span>Key acts as ${esc(d.identity.user)}</span>` : ''}
          ${p.keyExpiresAt ? `<span class="${Date.parse(p.keyExpiresAt) - Date.now() < 14 * 864e5 ? 'k-failed' : ''}">Key expires ${esc(new Date(p.keyExpiresAt).toLocaleDateString())}</span>` : ''}
        </div>
      </div>
      <div class="row">
        <a class="btn ghost" href="${esc(p.baseUrl)}" target="_blank" rel="noopener noreferrer">Open Checkmarx One ↗</a>
        <button class="btn" data-action="refresh-pov">${p.refreshing ? 'Reading…' : 'Refresh'}</button>
        <button class="btn" data-action="edit">Edit</button>
      </div>
    </div>
    ${p.error && p.health === 'failed' ? `<div class="notes error-line">Last read failed ${ago(p.error.at)}: ${esc(p.error.message)}</div>` : ''}
    ${s?.errors?.length ? `<div class="notes muted">Partly read: ${esc(s.errors.map((e) => `${e.part}: ${e.message}`).join(' · '))}</div>` : ''}
    ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="label">Projects</div><div class="value">${fmt(s?.projects)}</div></div>
      <div class="kpi"><div class="label">Running now</div><div class="value">${fmt(s ? s.running + s.queued : null)}</div></div>
      <div class="kpi"><div class="label">Scans 24h</div><div class="value">${fmt(s?.scans24h)}</div></div>
      <div class="kpi"><div class="label">Scans 7d</div><div class="value">${fmt(s?.scans7d)}</div></div>
      <div class="kpi ${s?.failed24h ? 'bad' : ''}"><div class="label">Failed 24h</div><div class="value">${fmt(s?.failed24h)}</div></div>
      <div class="kpi"><div class="label">Critical</div><div class="value">${fmt(s?.findings?.critical)}</div></div>
      <div class="kpi"><div class="label">High</div><div class="value">${fmt(s?.findings?.high)}</div></div>
      <div class="kpi"><div class="label">Last activity</div><div class="value" style="font-size:18px">${s ? ago(s.lastActivityAt) : '—'}</div></div>
    </div>
    <div class="layout">
      <div class="stack">
        ${d.active.length ? `<section class="panel"><div class="section-head"><h3>Running and queued</h3></div>${sortable('active', tableDefs.scans, d.active)}</section>` : ''}
        <section class="panel"><div class="section-head"><h3>Projects</h3><input class="search" id="projectSearch" placeholder="Filter projects" value="${esc(projectQuery)}"></div>${sortable('projects', tableDefs.projects, projects)}</section>
        <section class="panel"><div class="section-head"><h3>Scans · last 7 days</h3><span class="muted">${s?.people?.length ? `Most active: ${esc(s.people.map((x) => `${x.name} (${x.scans})`).join(', '))}` : ''}</span></div>${sortable('scans', tableDefs.scans, d.scans)}</section>
      </div>
      ${feed(d.events, [p], { showPov: false })}
    </div>`;
  const search = $('#projectSearch');
  search?.addEventListener('input', (e) => {
    projectQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderPov();
    const again = $('#projectSearch');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}

function render() {
  renderTabs();
  renderRefreshNote();
  if (route().view === 'pov') renderPov();
  else renderAll();
}

async function load() {
  const r = route();
  try {
    overview = await api('/overview');
    if (r.view === 'pov') {
      if (!overview.povs.some((p) => p.id === r.id)) {
        location.hash = '#/';
        return;
      }
      if (detail?.card?.id !== r.id) projectQuery = '';
      detail = await api(`/povs/${r.id}`);
    }
    render();
  } catch (error) {
    if (!/Sign in/.test(error.message)) main.innerHTML = `<div class="empty error-line">${esc(error.message)}</div>`;
  }
}

// Live: the server says when a POV was read; reload at most once a second.
let pending = null;
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('update', () => {
    clearTimeout(pending);
    pending = setTimeout(load, 600);
  });
  es.onerror = () => {
    es.close();
    setTimeout(connectStream, 5000);
  };
}

// ——— Clicks ———
document.addEventListener('click', async (e) => {
  const th = e.target.closest('th[data-col]');
  if (th) {
    const id = th.closest('table').dataset.table;
    const col = Number(th.dataset.col);
    const cur = tableSort[id];
    tableSort[id] = { col, dir: cur?.col === col ? -cur.dir : 1 };
    return render();
  }
  const f = e.target.closest('[data-filter]');
  if (f) {
    feedFilter = f.dataset.filter;
    store.set('cc.feedFilter', feedFilter);
    return render();
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'add') return openAdd();
  if (action === 'edit') return openEdit();
  if (action === 'refresh-pov') {
    await api(`/povs/${route().id}/refresh`, { method: 'POST' });
    return load();
  }
  const go = e.target.closest('[data-go]');
  if (go && !e.target.closest('a')) location.hash = go.dataset.go;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.card[data-go]')) location.hash = e.target.dataset.go;
});
addEventListener('hashchange', () => {
  detail = null;
  render();
  load();
});
$('#addPov').addEventListener('click', openAdd);
$('#refreshAll').addEventListener('click', async () => {
  await api('/refresh', { method: 'POST' });
  load();
});

// ——— Add POVs (one key per line) ———
let checked = [];
function openAdd() {
  $('#keys').value = '';
  $('#inspectResult').innerHTML = '';
  $('#saveKeys').disabled = true;
  checked = [];
  $('#addDialog').showModal();
  $('#keys').focus();
}
const overrides = () => ({ iamUrl: $('#ovIam').value.trim(), baseUrl: $('#ovBase').value.trim(), tenant: $('#ovTenant').value.trim() });
$('#keys').addEventListener('input', () => {
  $('#saveKeys').disabled = true;
  checked = [];
});
$('#inspectKeys').addEventListener('click', async () => {
  const keys = [...new Set($('#keys').value.split(/\s+/).map((k) => k.trim()).filter(Boolean))];
  const box = $('#inspectResult');
  box.innerHTML = '<div class="muted">Checking with Checkmarx One…</div>';
  checked = await Promise.all(
    keys.map(async (apiKey) => {
      try {
        const r = await api('/keys/inspect', { method: 'POST', body: { apiKey, overrides: overrides() } });
        return { apiKey, ok: true, ...r };
      } catch (error) {
        return { apiKey, ok: false, error: error.message };
      }
    }),
  );
  const existing = new Set((overview?.povs ?? []).map((p) => `${p.tenant}|${p.iamUrl}`));
  box.innerHTML = checked
    .map((c, i) => {
      if (!c.ok) return `<div class="item bad"><span>Key ${i + 1}: ${esc(c.error)}</span></div>`;
      const dup = existing.has(`${c.connection.tenant}|${c.connection.iamUrl}`);
      if (dup) c.ok = false;
      return `<div class="item ${dup ? 'bad' : ''}">
        <span><b>${esc(c.connection.tenant)}</b> · ${esc(c.connection.regionLabel)}${c.identity?.user ? ` · as ${esc(c.identity.user)}` : ''}${c.connection.expiresAt ? ` · key expires ${esc(new Date(c.connection.expiresAt).toLocaleDateString())}` : ''}${dup ? ' · <span class="k-failed">already added</span>' : ''}</span>
        ${dup ? '<span></span>' : `<span class="row"><input data-i="${i}" data-f="customer" placeholder="Customer"><input data-i="${i}" data-f="endDate" type="date" title="POV end date"></span>`}
      </div>`;
    })
    .join('');
  $('#saveKeys').disabled = !checked.some((c) => c.ok);
});
$('#saveKeys').addEventListener('click', async () => {
  const btn = $('#saveKeys');
  btn.disabled = true;
  const fields = (i, f) => $(`#inspectResult input[data-i="${i}"][data-f="${f}"]`)?.value ?? '';
  const failures = [];
  for (const [i, c] of checked.entries()) {
    if (!c.ok) continue;
    try {
      const customer = fields(i, 'customer');
      await api('/povs', { method: 'POST', body: { apiKey: c.apiKey, overrides: overrides(), customer, name: customer || c.connection.tenant, endDate: fields(i, 'endDate') } });
    } catch (error) {
      failures.push(`${c.connection.tenant}: ${error.message}`);
    }
  }
  if (failures.length) {
    $('#inspectResult').insertAdjacentHTML('afterbegin', `<div class="item bad"><span>${esc(failures.join(' · '))}</span></div>`);
  } else $('#addDialog').close();
  load();
});

// ——— Edit / remove ———
function openEdit() {
  const p = detail?.card;
  if (!p) return;
  const form = $('#editForm');
  for (const f of ['name', 'customer', 'stage', 'startDate', 'endDate', 'owner', 'notes']) form.elements[f].value = p[f] ?? '';
  form.elements.apiKey.value = '';
  $('#editError').textContent = '';
  $('#editDialog').showModal();
}
$('#saveEdit').addEventListener('click', async () => {
  const form = $('#editForm');
  const body = Object.fromEntries(['name', 'customer', 'stage', 'startDate', 'endDate', 'owner', 'notes', 'apiKey'].map((f) => [f, form.elements[f].value]));
  if (!body.apiKey.trim()) delete body.apiKey;
  try {
    await api(`/povs/${route().id}`, { method: 'PATCH', body });
    $('#editDialog').close();
    load();
  } catch (error) {
    $('#editError').textContent = error.message;
  }
});
$('#removePov').addEventListener('click', async () => {
  const p = detail?.card;
  if (!p || !confirm(`Remove "${p.name}" and its stored API key from CommandCenter? Nothing is changed in Checkmarx One.`)) return;
  await api(`/povs/${p.id}`, { method: 'DELETE' });
  $('#editDialog').close();
  location.hash = '#/';
});

// ——— Sign-in (only when CC_PASSCODE is set) ———
function showLogin() {
  if (!$('#loginDialog').open) $('#loginDialog').showModal();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/login', { method: 'POST', body: { passcode: $('#passcode').value } });
    $('#loginDialog').close();
    start();
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
});

let started = false;
async function start() {
  const session = await api('/session');
  if (!session.authed) return showLogin();
  if (started) return load();
  started = true;
  render();
  await load();
  connectStream();
  // Relative times ("5 min ago") stay true between reads.
  setInterval(() => document.visibilityState === 'visible' && render(), 30_000);
}
start();
