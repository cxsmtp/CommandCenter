import { $, esc, api, state, can, local, toast, attempt, openDialog, closeDialog, sheetsSettled } from './core.js';
import { renderDashboard } from './views/dashboard.js';
import { renderOpportunity } from './views/opportunity.js';
import { renderTeam } from './views/team.js';
import { renderCatalog } from './views/catalog.js';
import { renderSettings } from './views/settings.js';
import { openNewOpportunity } from './views/new-opportunity.js';
import { renderInsights } from './views/insights.js';
import { renderAudit } from './views/audit.js';

// ——— The detail drawer: a POV opened from a list, on the right half, the list still in view ———
let drawerFor = '';
let drawerReturn = null;
async function renderDrawer(r) {
  let el = document.getElementById('drawer');
  if (!r.open || !['dashboard', 'insights'].includes(r.view)) {
    if (el) {
      el.remove();
      document.body.classList.remove('drawer-open');
      drawerReturn?.focus?.();
      drawerFor = '';
    }
    return;
  }
  if (!el) {
    drawerReturn = document.activeElement;
    el = Object.assign(document.createElement('aside'), { id: 'drawer', className: 'drawer' });
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'POV details');
    el.innerHTML = `<div class="drawer-bar"><button class="btn ghost sm" data-drawer="close" aria-label="Close (Esc)">✕ Close</button><span class="spacer"></span><a class="btn ghost sm" data-drawer="full">Open full page ↗</a></div><div class="drawer-body"></div>`;
    document.body.append(el);
    document.body.classList.add('drawer-open');
  }
  const body = el.querySelector('.drawer-body');
  el.querySelector('[data-drawer="full"]').setAttribute('href', `#/opp/${encodeURIComponent(r.open)}/${r.openTab || 'overview'}`);
  const keep = drawerFor === r.open ? body.scrollTop : 0;
  await renderOpportunity(body, r.open, r.openTab, { crumbs: () => {}, drawer: { base: `#/${r.view}`, open: r.open } });
  body.scrollTop = keep;
  if (drawerFor !== r.open) el.querySelector('[data-drawer="close"]').focus();
  drawerFor = r.open;
}
export function closeDrawer() {
  const r = route();
  location.hash = `#/${r.view}`;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('drawer') && !document.querySelector('#dialog[open]')) closeDrawer();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-drawer="close"]')) closeDrawer();
});

const root = $('#root');

// ——— Looks and modes ———
const LUXE = new Set(['maison', 'calibre', 'joaillier', 'hypercar']);
const media = matchMedia('(prefers-color-scheme: dark)');
export function applyLook(prefs = {}) {
  const s = state.session?.settings ?? {};
  const theme = prefs.theme || s.defaultTheme || 'orbit';
  const mode = prefs.mode || s.defaultMode || 'dark';
  document.documentElement.dataset.look = theme;
  document.documentElement.toggleAttribute('data-lux', LUXE.has(theme));
  document.documentElement.dataset.theme = mode === 'dark' || (mode === 'auto' && media.matches) ? 'dark' : 'light';
  local.set('cc.look', { theme, mode });
}
media.addEventListener('change', () => applyLook(state.session?.user?.prefs));

// ——— Routing ———
export function route() {
  const [path, query = ''] = location.hash.split('?');
  const [, view = '', id = '', tab = ''] = path.split('/');
  const q = new URLSearchParams(query);
  return { view: view || 'dashboard', id, tab, open: q.get('open') ?? '', openTab: q.get('tab') ?? '' };
}
const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  dashboard: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>'),
  team: svg('<circle cx="12" cy="5.5" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M12 7.7V12M12 12l-5 4M12 12l5 4"/>'),
  catalog: svg('<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z"/><path d="M3.5 12L12 16.5 20.5 12M3.5 16L12 20.5 20.5 16"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  out: svg('<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  audit: svg('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),
  insights: svg('<path d="M4 19h16"/><path d="M7 15l3.5-4 3 2.5L18 8"/><circle cx="18" cy="8" r="1.4"/>'),
};
const NAV = [
  ['Work', [['dashboard', ICON.dashboard, 'Portfolio'], ['insights', ICON.insights, 'Insights'], ['team', ICON.team, 'Teams']]],
  ['Set up', [['catalog', ICON.catalog, 'Capabilities'], ['audit', ICON.audit, 'Audit', 'audit.view'], ['settings', ICON.settings, 'Settings']]],
];

const MARK = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><ellipse cx="16" cy="16" rx="5.2" ry="12.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><path d="M16 2.2v27.6" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="9" r="2.4" fill="currentColor"/></svg>';
function shell() {
  const u = state.session.user;
  const r = route();
  const attention = state.overview?.totals?.needsAttention ?? 0;
  root.innerHTML = `<div class="shell">
    <nav class="nav" id="nav" aria-label="Main">
      <div class="brand">${MARK}<span><span class="brand-name">${esc(state.session.settings.orgName || 'Meridian')}</span><span class="brand-tag">One line of sight</span></span></div>
      ${NAV.map(([group, items]) => `<div class="nav-group">${group}</div>${items.filter(([, , , need]) => !need || can(need)).map(([id, ico, label]) => `<a href="#/${id}" ${r.view === id || (id === 'dashboard' && r.view === 'opp') ? 'aria-current="page"' : ''}><span class="ico">${ico}</span>${label}${id === 'dashboard' && attention ? `<span class="badge-n" title="Need attention">${attention}</span>` : ''}</a>`).join('')}`).join('')}
      <div class="nav-group">Act</div>
      ${can('opps.create') ? `<a href="#" data-action="new-opp"><span class="ico">${ICON.plus}</span>New opportunity</a>` : ''}
      <div class="nav-foot"><b>${esc(u.name)}</b>${esc(u.roleLabel)}<br><button data-action="signout">Sign out</button></div>
    </nav>
    <div>
      <header class="topbar">
        <button class="btn ghost menu-btn" data-action="menu" aria-label="Menu">☰</button>
        <div class="crumbs" id="crumbs"></div>
        <span class="refresh-note" id="refreshNote" aria-live="polite"></span>
        <button class="btn ghost" data-action="refresh-all" title="Read every POV tenant you can see, now">Refresh</button>
      </header>
      <main id="main"></main>
    </div>
    <nav class="tabbar" aria-label="Main">
      <a href="#/dashboard" ${r.view === 'dashboard' || r.view === 'opp' ? 'aria-current="page"' : ''}>${ICON.dashboard}Portfolio${attention ? `<span class="badge-n">${attention}</span>` : ''}</a>
      <a href="#/insights" ${r.view === 'insights' ? 'aria-current="page"' : ''}>${ICON.insights}Insights</a>
      ${can('opps.create') ? `<button type="button" class="tab-new" data-action="new-opp"><span class="ico">${ICON.plus}</span>New</button>` : '<span></span>'}
      <a href="#/team" ${r.view === 'team' ? 'aria-current="page"' : ''}>${ICON.team}Teams</a>
      <button type="button" data-action="more" ${['catalog', 'settings', 'audit'].includes(r.view) ? 'aria-current="page"' : ''}>${ICON.more}More</button>
    </nav>
  </div>`;
}

/** The phone's "More": everything that is not on the tab bar, and who is signed in. */
function openMore() {
  const u = state.session.user;
  openDialog(
    `<div class="dbody more-sheet"><div class="row center"><div style="flex:1"><b>${esc(u.name)}</b><div class="small muted">${esc(u.roleLabel)} · ${esc(u.email)}</div></div><button class="btn" data-close>Done</button></div>
      <nav class="more-list">
        <a href="#/catalog">${ICON.catalog}<span>Capabilities & templates</span></a>
        ${can('audit.view') ? `<a href="#/audit">${ICON.audit}<span>Audit</span></a>` : ''}
        <a href="#/settings">${ICON.settings}<span>Settings</span></a>
        <button type="button" data-action="refresh-all">${ICON.refresh}<span>Read every POV tenant now</span></button>
        <button type="button" data-action="signout">${ICON.out}<span>Sign out</span></button>
      </nav></div>`,
    { onOpen: (d) => {
      d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
      for (const a of d.querySelectorAll('a')) a.addEventListener('click', () => closeDialog());
    } },
  );
}

const crumbs = (html) => {
  const el = $('#crumbs');
  if (el) el.innerHTML = html;
};

let rendering = Promise.resolve();
export function render() {
  rendering = rendering.then(renderNow).catch((e) => toast(e.message, { bad: true }));
  return rendering;
}
async function renderNow() {
  if (!state.session?.user) return;
  if (!$('#main')) shell();
  const r = route();
  for (const a of document.querySelectorAll('.nav a[href^="#/"], .tabbar a[href^="#/"]')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${r.view}` || (r.view === 'opp' && a.getAttribute('href') === '#/dashboard'));
  document.querySelector('.tabbar [data-action="more"]')?.toggleAttribute('aria-current', ['catalog', 'settings', 'audit'].includes(r.view));
  if (r.view === 'opp') await renderOpportunity($('#main'), r.id, r.tab, { crumbs });
  else if (r.view === 'team') await renderTeam($('#main'), { crumbs });
  else if (r.view === 'catalog') await renderCatalog($('#main'), { crumbs });
  else if (r.view === 'settings') await renderSettings($('#main'), r.id, { crumbs, applyLook });
  else if (r.view === 'insights') await renderInsights($('#main'), { crumbs });
  else if (r.view === 'audit') await renderAudit($('#main'), { crumbs });
  else await renderDashboard($('#main'), { crumbs, open: r.open });
  await renderDrawer(r);
  refreshNote();
}

function refreshNote() {
  const el = $('#refreshNote');
  if (!el || !state.overview) return;
  const rows = state.overview.rows ?? [];
  if (rows.some((x) => x.live?.refreshing)) return (el.textContent = 'Reading Checkmarx One…');
  const next = rows.map((x) => Date.parse(x.live?.nextAt ?? '')).filter(Boolean);
  if (!next.length) return (el.textContent = `Tenants read every ${state.overview.intervalMinutes} min`);
  const s = Math.max(0, Math.round((Math.min(...next) - Date.now()) / 1000));
  el.textContent = `Next read ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · every ${state.overview.intervalMinutes} min`;
}
setInterval(refreshNote, 1000);

// ——— Live updates ———
let pending;
function connectStream() {
  const es = new EventSource('/api/stream');
  // With hundreds of tenants a read lands every few seconds: the page draws again at most every 5 s, and only while
  // it is on screen (once more when it comes back).
  let dirty = false;
  let lastDraw = 0;
  const draw = () => {
    if (!dirty || document.visibilityState !== 'visible') return;
    // Never re-draw under someone's typing or an open dialog.
    if ($('#dialog').open || document.activeElement?.matches('input, textarea, select')) return void setTimeout(draw, 3000);
    dirty = false;
    lastDraw = Date.now();
    state.overview = null;
    render();
  };
  document.addEventListener('visibilitychange', draw);
  es.addEventListener('update', () => {
    dirty = true;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      draw();
    }, Math.max(800, 5000 - (Date.now() - lastDraw)));
  });
  es.onerror = () => {
    es.close();
    // Find out at once whether this was a restart (api() waits it out) or the end of the session (it asks to sign in).
    setTimeout(() => state.session?.user && api('/session').then(() => connectStream()).catch(() => {}), 2000);
  };
}

// ——— Clicks shared by every view ———
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]');
  const action = a?.dataset.action;
  if (action === 'menu') return $('#nav').classList.toggle('open');
  if (action === 'more') return openMore();
  if (action === 'signout') {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    location.reload();
    return;
  }
  if (action === 'new-opp') {
    e.preventDefault();
    const id = await openNewOpportunity();
    if (id) {
      await sheetsSettled();
      location.hash = `#/opp/${id}`;
    }
    return;
  }
  if (action === 'refresh-all') {
    await attempt(() => api('/refresh', { method: 'POST' }), 'Reading every POV tenant…');
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go && !e.target.closest('a, button, input, select, textarea, label')) {
    location.hash = go.dataset.go;
    $('#nav')?.classList.remove('open');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-go][tabindex]')) location.hash = e.target.dataset.go;
});
let lastView = '';
addEventListener('hashchange', () => {
  $('#nav')?.classList.remove('open');
  // Opening or moving inside the drawer keeps the list where it was.
  const r = route();
  if (r.view !== lastView || r.view === 'opp') scrollTo(0, 0);
  lastView = r.view;
  render();
});
document.addEventListener('cc:rerender', () => render());
document.addEventListener('cc:signed-out', () => {
  state.session = { ...(state.session ?? {}), user: null };
  showLogin();
});
// Relative times stay true between reads.
setInterval(() => document.visibilityState === 'visible' && !$('#dialog').open && !document.activeElement?.matches('input, textarea, select') && render(), 60_000);

// ——— Sign-in ———
function showLogin(message = '') {
  root.innerHTML = `<div class="login"><form class="panel" id="loginForm">
    <div class="brand" style="padding:0">${MARK}<h1 style="font-size:20px">${esc(state.session?.settings?.orgName || 'Meridian')}</h1></div>
    <p class="muted" style="margin:0">Every POV, the technical value it proves and the revenue it moves — in one line of sight.</p>
    <label class="field">Email<input name="email" type="email" autocomplete="username" required autofocus></label>
    <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="form-error" id="loginError" role="alert">${esc(message)}</p>
    <button class="btn primary">Sign in</button>
    <p class="muted small" style="margin:0">First start? The Admin's password is in the server log.</p>
  </form></div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
      await start();
    } catch (error) {
      $('#loginError').textContent = error.message;
    }
  });
}

function mustChangePassword() {
  root.innerHTML = `<div class="login"><form class="panel" id="pwForm">
    <h1 style="font-size:20px">Choose your password</h1>
    <p class="muted" style="margin:0">You signed in with a password someone else set. Choose your own (10 characters or more).</p>
    <label class="field">Current password<input name="current" type="password" autocomplete="current-password" required></label>
    <label class="field">New password<input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
    <p class="form-error" id="pwError" role="alert"></p>
    <button class="btn primary">Save and continue</button>
  </form></div>`;
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/me/password', { method: 'POST', body: { current: e.target.current.value, next: e.target.next.value } });
      await start();
    } catch (error) {
      $('#pwError').textContent = error.message;
    }
  });
}

let streaming = false;
async function start() {
  state.session = await api('/session');
  applyLook(state.session.user?.prefs);
  if (!state.session.user) return showLogin();
  if (state.session.user.mustChangePassword) return mustChangePassword();
  const [meta, people] = await Promise.all([api('/meta'), api('/users')]);
  state.meta = meta;
  state.users = people.users;
  state.tree = people.tree;
  root.innerHTML = '';
  await render();
  if (!streaming) {
    streaming = true;
    connectStream();
  }
}

start().catch((e) => showLogin(e.message));
