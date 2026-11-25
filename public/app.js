import { $, esc, api, state, can, local, toast, attempt, openDialog, closeDialog, sheetsSettled } from './core.js';
import { renderDashboard } from './views/dashboard.js';
import { renderOpportunity } from './views/opportunity.js';
import { renderSettings } from './views/settings.js';
import { openNewOpportunity } from './views/new-opportunity.js';
import { renderInsights } from './views/insights.js';

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
  // The Admin may set one look for everyone (Settings → Organisation); otherwise each person's own, else the default.
  const own = s.lookForAll ? {} : prefs;
  const theme = own.theme || s.defaultTheme || 'orbit';
  const mode = own.mode || s.defaultMode || 'light';
  document.documentElement.dataset.look = theme;
  document.documentElement.toggleAttribute('data-lux', LUXE.has(theme));
  document.documentElement.dataset.theme = mode === 'dark' || (mode === 'auto' && media.matches) ? 'dark' : 'light';
  local.set('cc.look', { theme, mode });
}
media.addEventListener('change', () => applyLook(state.session?.user?.prefs));

// ——— Routing ———
/** Where Kendra opens: leaders on Insights, SEs on their accounts (the Portfolio), or the person's own choice. */
export function homeView() {
  const u = state.session?.user;
  if (u?.prefs?.home === 'insights' || u?.prefs?.home === 'dashboard') return u.prefs.home;
  return u && u.role !== 'associate' ? 'insights' : 'dashboard';
}
export function route() {
  const [path, query = ''] = location.hash.split('?');
  let [, view = '', id = '', tab = ''] = path.split('/');
  // Pages that moved into Settings keep their old addresses.
  const moved = { team: 'teams', people: 'people', catalog: 'capabilities', audit: 'audit' };
  if (moved[view]) [view, id] = ['settings', moved[view]];
  const q = new URLSearchParams(query);
  return { view: view || homeView(), id, tab, open: q.get('open') ?? '', openTab: q.get('tab') ?? '' };
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
  ftr: svg('<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M8 21h8M12 17v4M7.5 13l3-3 2 2 4-4"/>'),
};
// As in the FTR command center: a short menu; People, Teams, Capabilities, the Audit log and the rest are in Settings.
const NAV = [['Work', [['dashboard', ICON.dashboard, 'Portfolio'], ['insights', ICON.insights, 'Insights'], ['settings', ICON.settings, 'Settings']]]];

// The Kendra mark; its tooltip says what the name means.
const KENDRA_MEANING = 'Kendra (केन्द्र, Sanskrit for “centre”): the centre for the best solution engineers to manage the growth.';
const logoSrc = () => (state.session?.settings?.brand?.logoAt ? `/api/brand/logo?v=${encodeURIComponent(state.session.settings.brand.logoAt)}` : '/logo.png');
const markHtml = () => `<img class="brand-logo" src="${logoSrc()}" alt="${esc(state.session?.settings?.orgName || 'Kendra')}" title="${KENDRA_MEANING}" width="40" height="40">`;
/** The browser tab's icon: the Admin's (Settings → Branding), else Kendra's. */
function applyIcon() {
  const at = state.session?.settings?.brand?.iconAt;
  for (const l of document.querySelectorAll('link[rel="icon"]')) {
    if (!l.dataset.orig) l.dataset.orig = l.getAttribute('href');
    l.setAttribute('href', at ? `/api/brand/icon?v=${encodeURIComponent(at)}` : l.dataset.orig);
  }
}
function shell() {
  const u = state.session.user;
  const r = route();
  const attention = state.overview?.totals?.needsAttention ?? 0;
  root.innerHTML = `<div class="shell">
    <nav class="nav" id="nav" aria-label="Main">
      <div class="brand" title="${KENDRA_MEANING}">${markHtml()}<span><span class="brand-name">${esc(state.session.settings.orgName || 'Kendra')}</span><span class="brand-tag">${esc(state.session.settings.brand?.tagline ?? 'One line of sight')}</span></span></div>
      ${NAV.map(([group, items]) => `<div class="nav-group">${group}</div>${items.filter(([, , , need]) => !need || can(need)).map(([id, ico, label]) => `<a href="#/${id}" ${r.view === id || (id === 'dashboard' && r.view === 'opp') ? 'aria-current="page"' : ''}><span class="ico">${ico}</span>${label}${id === 'dashboard' && attention ? `<span class="badge-n" title="Need attention">${attention}</span>` : ''}</a>`).join('')}`).join('')}
      ${state.session.linked?.ftr ? `<div class="nav-group">Linked</div><a href="/link/ftr?to=%2F" target="_blank" rel="noopener" title="The FTR Credits Command Center, signed in as you"><span class="ico">${ICON.ftr}</span>FTR command center<span class="ext">↗</span></a>` : ''}
      <div class="nav-group">Act</div>
      ${can('opps.create') ? `<a href="#" data-action="new-opp"><span class="ico">${ICON.plus}</span>New opportunity</a>` : ''}
      <div class="nav-foot"><b>${esc(u.name)}</b>${esc(u.roleLabel)}<span class="nav-links"><a class="nav-help" href="#/settings/help">Get help</a><button data-action="signout">Sign out</button></span>${state.session.version ? `<a class="nav-version" href="#/settings/${can('settings.manage') ? 'updates' : 'about'}" title="${can('settings.manage') ? 'Update & recovery' : 'About Kendra'}">Kendra ${esc(state.session.version)}</a>` : ''}${state.session.stage === 'staging' ? '<span class="stage-pill" title="This installation is marked Staging: new versions are tried here first">Staging</span>' : ''}</div>
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
      <a href="#/settings/people" ${r.view === 'settings' && ['people', 'teams'].includes(r.id) ? 'aria-current="page"' : ''}>${ICON.team}People</a>
      <button type="button" data-action="more" ${r.view === 'settings' && !['people', 'teams'].includes(r.id) ? 'aria-current="page"' : ''}>${ICON.more}More</button>
    </nav>
  </div>`;
}

/** The phone's "More": everything that is not on the tab bar, and who is signed in. */
function openMore() {
  const u = state.session.user;
  openDialog(
    `<div class="dbody more-sheet"><div class="row center"><div style="flex:1"><b>${esc(u.name)}</b><div class="small muted">${esc(u.roleLabel)} · ${esc(u.email)}</div></div><button class="btn" data-close>Done</button></div>
      <nav class="more-list">
        <a href="#/settings/capabilities">${ICON.catalog}<span>Capabilities & templates</span></a>
        ${can('audit.view') ? `<a href="#/settings/audit">${ICON.audit}<span>Audit log</span></a>` : ''}
        <a href="#/settings">${ICON.settings}<span>Settings</span></a>
        <button type="button" data-action="refresh-all">${ICON.refresh}<span>Read every POV tenant now</span></button>
        <button type="button" data-action="signout">${ICON.out}<span>Sign out</span></button>
        ${state.session.version ? `<a href="#/settings/${can('settings.manage') ? 'updates' : 'about'}" class="small muted" style="padding:10px 14px">Kendra ${esc(state.session.version)}</a>` : ''}
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
  for (const a of document.querySelectorAll('.nav a[href^="#/"]')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${r.view}` || (r.view === 'opp' && a.getAttribute('href') === '#/dashboard'));
  for (const a of document.querySelectorAll('.tabbar a[href^="#/"]')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${r.view}` || (r.view === 'opp' && a.getAttribute('href') === '#/dashboard') || (r.view === 'settings' && ['people', 'teams'].includes(r.id) && a.getAttribute('href') === '#/settings/people'));
  document.querySelector('.tabbar [data-action="more"]')?.toggleAttribute('aria-current', r.view === 'settings' && !['people', 'teams'].includes(r.id));
  if (r.view === 'opp') await renderOpportunity($('#main'), r.id, r.tab, { crumbs });
  else if (r.view === 'settings') await renderSettings($('#main'), r.id, { crumbs, applyLook });
  else if (r.view === 'insights') await renderInsights($('#main'), { crumbs });
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
    setTimeout(() => state.session?.user && api('/session').then((s) => (newVersion(s), connectStream())).catch(() => {}), 2000);
  };
}

// ——— A new version on the server: the open page moves to it (an open tab keeps running the code it loaded) ———
let loadedVersion = null;
let versionBar = null;
function newVersion(s) {
  const v = s?.version;
  if (!v || !loadedVersion || v === loadedVersion) return;
  const busy = document.querySelector('dialog[open]') || (document.activeElement?.matches?.('input, textarea, select, [contenteditable]') && document.activeElement.value);
  if (!busy || document.hidden) return void location.reload();
  if (versionBar) return;
  versionBar = Object.assign(document.createElement('div'), { id: 'sessionWarn', role: 'status' });
  versionBar.innerHTML = `Kendra ${esc(v)} is ready. <button class="btn sm primary" type="button">Reload</button>`;
  versionBar.querySelector('button').addEventListener('click', () => location.reload());
  document.body.append(versionBar);
}
// Every two minutes, and whenever the tab comes back into view.
setInterval(() => state.session?.user && api('/session').then(newVersion).catch(() => {}), 120_000);
document.addEventListener('visibilitychange', () => !document.hidden && state.session?.user && api('/session').then(newVersion).catch(() => {}));

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
// ——— Before signing in: "Forgot your password?", a new password from the emailed link, joining with a work address ———
function authCard(inner) {
  root.innerHTML = `<div class="login"><div class="panel stack" style="gap:12px">${inner}</div></div>`;
}
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
function selfService() {
  const path = location.hash.split('?')[0];
  if (path === '#/forgot' || (path === '#/join' && !hashParams().get('token'))) {
    const join = path === '#/join';
    authCard(`<div class="brand" style="padding:0">${markHtml()}<h1 style="font-size:20px">${join ? `Join ${esc(state.session?.settings?.orgName || 'Kendra')}` : 'Forgot your password?'}</h1></div>
      <p class="muted" style="margin:0">${join ? 'Enter your work email. If it may join, a link is emailed to you: open it to give your name, who you report to and a password.' : 'Enter the email you sign in with. If it has an account, a link to choose a new password is emailed to it.'}</p>
      <form id="ssForm" class="stack" style="gap:10px"><label class="field">Work email<input name="email" type="email" autocomplete="username" required autofocus></label>
      <p class="form-error" id="ssErr" role="alert"></p><button class="btn primary">${join ? 'Email me a link to join' : 'Email me a link'}</button></form>
      <p class="small" style="margin:0"><a href="#/login?linked=none">Back to sign in</a></p>`);
    $('#ssForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api(join ? '/auth/join' : '/auth/forgot', { method: 'POST', body: { email: e.target.email.value } });
        authCard(`<h1 style="font-size:20px">Check your inbox</h1><p class="muted" style="margin:0">${esc(r.message)}</p><p class="small" style="margin:0"><a href="#/login?linked=none">Back to sign in</a></p>`);
      } catch (error) {
        $('#ssErr').textContent = error.message;
      }
    });
    return true;
  }
  if (path === '#/reset' || path === '#/join') {
    const token = hashParams().get('token') ?? '';
    const join = path === '#/join';
    (async () => {
      let info;
      try {
        info = await api(join ? '/auth/join/check' : '/auth/reset/check', { method: 'POST', body: { token } });
      } catch (error) {
        return authCard(`<h1 style="font-size:20px">This link no longer works</h1><p class="muted" style="margin:0">${esc(error.message)}</p><p class="small" style="margin:0"><a href="#/${join ? 'join' : 'forgot'}">Ask for a new one</a> · <a href="#/login?linked=none">Sign in</a></p>`);
      }
      authCard(`<div class="brand" style="padding:0">${markHtml()}<h1 style="font-size:20px">${join ? 'Join' : 'Choose a new password'}</h1></div>
        <p class="muted" style="margin:0">${join ? `As <b>${esc(info.email)}</b>.` : `For ${esc(info.email)}. Every place it is signed in is signed out.`}</p>
        <form id="ssForm" class="stack" style="gap:10px">
          ${join ? `<label class="field">Your name<input name="name" required autofocus></label><label class="field">Title<input name="title" placeholder="e.g. Solution Engineer"></label>
            <label class="field">Who you report to<select name="managerId"><option value="">Choose…</option>${info.managers.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} · ${esc(m.role)}${m.region ? ` · ${esc(m.region)}` : ''}</option>`).join('')}</select></label>` : ''}
          <label class="field">${join ? 'Password' : 'New password'} <span class="small muted">10 characters or more</span><input name="password" type="password" autocomplete="new-password" minlength="10" required ${join ? '' : 'autofocus'}></label>
          <p class="form-error" id="ssErr" role="alert"></p><button class="btn primary">${join ? 'Join and sign in' : 'Save the new password'}</button></form>`);
      $('#ssForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          if (join) {
            await api('/auth/join/finish', { method: 'POST', body: { token, name: f.name.value, title: f.title.value, managerId: f.managerId.value, password: f.password.value } });
            location.hash = '#/';
            await start();
          } else {
            await api('/auth/reset', { method: 'POST', body: { token, password: f.password.value } });
            authCard('<h1 style="font-size:20px">Your password is changed</h1><p class="muted" style="margin:0">Sign in with it now.</p><p style="margin:0"><a class="btn primary" href="#/login?linked=none">Sign in</a></p>');
          }
        } catch (error) {
          $('#ssErr').textContent = error.message;
        }
      });
    })();
    return true;
  }
  return false;
}
addEventListener('hashchange', () => !state.session?.user && (selfService() || (/^#\/login/.test(location.hash) && showLogin())));

function showLogin(message = '') {
  if (selfService()) return;
  const ftr = state.session?.linked?.ftr;
  let tried = false;
  try {
    tried = sessionStorage.getItem('kendra.linkTried') === '1';
  } catch {}
  if (ftr && !tried && !/[?&]linked=none/.test(location.hash) && !message) {
    try {
      sessionStorage.setItem('kendra.linkTried', '1');
    } catch {}
    const back = location.hash && !location.hash.startsWith('#/login') ? `/${location.hash}` : '/';
    location.replace(`${ftr}/link/kendra/authorize?to=${encodeURIComponent(back)}`);
    root.innerHTML = '<div class="login"><div class="panel" style="padding:24px">Checking your FTR command center sign-in…</div></div>';
    return;
  }

  root.innerHTML = `<div class="login"><form class="panel" id="loginForm">
    <div class="brand" style="padding:0">${markHtml()}<h1 style="font-size:20px">${esc(state.session?.settings?.orgName || 'Kendra')}</h1></div>
    <p class="muted" style="margin:0">Every POV, the technical value it proves and the revenue it moves — in one line of sight.</p>
    <label class="field">Email<input name="email" type="email" autocomplete="username" required autofocus></label>
    <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="form-error" id="loginError" role="alert">${esc(message)}</p>
    <button class="btn primary">Sign in</button>
    <p class="small" style="margin:0" id="ssLinks"></p>
    <p class="muted small" style="margin:0">First start? The Admin's password is in the server log.</p>
  </form></div>`;
  api('/auth/options').then((o) => {
    const bits = [o.reset ? '<a href="#/forgot">Forgot your password?</a>' : '', o.join ? `<a href="#/join">New here? Join with your ${o.join.domains.map((d) => `@${esc(d)}`).join(' or ')} email</a>` : ''].filter(Boolean);
    const el = document.getElementById('ssLinks');
    if (el) el.innerHTML = bits.join(' · ');
  }).catch(() => {});
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
  loadedVersion = loadedVersion ?? state.session.version ?? null;
  applyLook(state.session.user?.prefs);
  applyIcon();
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

// ——— A warning before a session ends ———
// Five minutes before, a bar offers to stay signed in (one request renews the session); the sign-in box would
// otherwise only open on the next click, with nothing lost either way.
let warnBar = null;
let lastPeek = 0;
setInterval(() => {
  const exp = Date.parse(state.session?.expiresAt ?? '');
  if (!state.session?.user || !exp) return;
  const left = exp - Date.now();
  if (left > 5 * 60_000 || left <= 0) {
    warnBar?.remove();
    warnBar = null;
    return;
  }
  // Use renews a session: ask (without renewing it) whether it really ends soon before saying so.
  if (!warnBar && Date.now() - lastPeek > 25_000) {
    lastPeek = Date.now();
    fetch('/api/session', { headers: { 'X-Requested-With': 'Kendra', 'X-Peek': '1' } })
      .then((r) => r.json())
      .then((s) => {
        if (s?.expiresAt) state.session.expiresAt = s.expiresAt;
      })
      .catch(() => {});
    return; // shown on the next look if it still ends within five minutes
  }
  if (warnBar) return void (warnBar.querySelector('b').textContent = `${Math.max(1, Math.round(left / 60_000))} min`);
  warnBar = Object.assign(document.createElement('div'), { id: 'sessionWarn', role: 'alert' });
  warnBar.innerHTML = `Your session ends in <b>${Math.max(1, Math.round(left / 60_000))} min</b>. <button class="btn sm primary" type="button">Stay signed in</button>`;
  warnBar.querySelector('button').addEventListener('click', async () => {
    const s = await api('/session').catch(() => null);
    if (s?.expiresAt) state.session.expiresAt = s.expiresAt;
    warnBar?.remove();
    warnBar = null;
  });
  document.body.append(warnBar);
}, 30_000);
