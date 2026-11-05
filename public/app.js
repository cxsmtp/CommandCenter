import { $, esc, api, state, can, local, toast, attempt } from './core.js';
import { renderDashboard } from './views/dashboard.js';
import { renderOpportunity } from './views/opportunity.js';
import { renderTeam } from './views/team.js';
import { renderCatalog } from './views/catalog.js';
import { renderSettings } from './views/settings.js';
import { openNewOpportunity } from './views/new-opportunity.js';

const root = $('#root');

// ——— Looks and modes ———
const media = matchMedia('(prefers-color-scheme: dark)');
export function applyLook(prefs = {}) {
  const s = state.session?.settings ?? {};
  const theme = prefs.theme || s.defaultTheme || 'command';
  const mode = prefs.mode || s.defaultMode || 'auto';
  document.documentElement.dataset.look = theme;
  document.documentElement.dataset.theme = mode === 'dark' || (mode === 'auto' && media.matches) ? 'dark' : 'light';
  local.set('cc.look', { theme, mode });
}
media.addEventListener('change', () => applyLook(state.session?.user?.prefs));

// ——— Routing ———
export function route() {
  const [, view = '', id = '', tab = ''] = location.hash.split('?')[0].split('/');
  return { view: view || 'dashboard', id, tab };
}
const NAV = [
  ['Work', [['dashboard', '◉', 'Command center'], ['team', '⌬', 'Teams']]],
  ['Set up', [['catalog', '☰', 'Capabilities'], ['settings', '⚙', 'Settings']]],
];

function shell() {
  const u = state.session.user;
  const r = route();
  const attention = state.overview?.totals?.needsAttention ?? 0;
  root.innerHTML = `<div class="shell">
    <nav class="nav" id="nav" aria-label="Main">
      <div class="brand"><span class="brand-dot"></span>${esc(state.session.settings.orgName || 'CommandCenter')}</div>
      ${NAV.map(([group, items]) => `<div class="nav-group">${group}</div>${items.map(([id, ico, label]) => `<a href="#/${id}" ${r.view === id || (id === 'dashboard' && r.view === 'opp') ? 'aria-current="page"' : ''}><span class="ico">${ico}</span>${label}${id === 'dashboard' && attention ? `<span class="badge-n" title="Need attention">${attention}</span>` : ''}</a>`).join('')}`).join('')}
      <div class="nav-group">Act</div>
      ${can('opps.create') ? '<a href="#" data-action="new-opp"><span class="ico">＋</span>New opportunity</a>' : ''}
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
  </div>`;
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
  for (const a of document.querySelectorAll('.nav a[href^="#/"]')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${r.view}` || (r.view === 'opp' && a.getAttribute('href') === '#/dashboard'));
  if (r.view === 'opp') await renderOpportunity($('#main'), r.id, r.tab, { crumbs });
  else if (r.view === 'team') await renderTeam($('#main'), { crumbs });
  else if (r.view === 'catalog') await renderCatalog($('#main'), { crumbs });
  else if (r.view === 'settings') await renderSettings($('#main'), r.id, { crumbs, applyLook });
  else await renderDashboard($('#main'), { crumbs });
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
  es.addEventListener('update', () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      // Never re-draw under someone's typing or an open dialog.
      if ($('#dialog').open || document.activeElement?.matches('input, textarea, select')) return;
      state.overview = null;
      render();
    }, 800);
  });
  es.onerror = () => {
    es.close();
    setTimeout(() => state.session?.user && connectStream(), 5000);
  };
}

// ——— Clicks shared by every view ———
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-action]');
  const action = a?.dataset.action;
  if (action === 'menu') return $('#nav').classList.toggle('open');
  if (action === 'signout') {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    location.reload();
    return;
  }
  if (action === 'new-opp') {
    e.preventDefault();
    const id = await openNewOpportunity();
    if (id) location.hash = `#/opp/${id}`;
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
addEventListener('hashchange', () => {
  $('#nav')?.classList.remove('open');
  scrollTo(0, 0);
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
    <div class="brand" style="padding:0"><span class="brand-dot"></span><h1 style="font-size:20px">${esc(state.session?.settings?.orgName || 'CommandCenter')}</h1></div>
    <p class="muted" style="margin:0">Every opportunity and POV, from discovery to the win.</p>
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
