// Settings: your profile and look, and (by permission) the organisation, the email server and the roles.
import { $, $$, esc, api, state, can, attempt, toast, formData } from '../core.js';

const LOOKS = {
  orbit: ['Orbit — launch control', ['#03050b', '#5ce1ff', '#8b7cff']],
  maison: ['Maison — the leather atelier', ['#f2ebdf', '#2a1c13', '#b08d57']],
  calibre: ['Calibre — fine watchmaking', ['#f3f1ec', '#0f1a31', '#a98f5f']],
  joaillier: ['Joaillier — high jewellery', ['#f6efe9', '#5a0f1c', '#b8923e']],
  hypercar: ['Hypercar — racing blue on carbon', ['#eceff3', '#070a12', '#0b3a8c']],
  command: ['Command', ['#f4f2ec', '#1b1f24', '#0e8a8a']],
  cabin: ['Cabin', ['#f3efe8', '#1c1712', '#a8742a']],
  circuit: ['Circuit', ['#eef0f2', '#121417', '#d7262e']],
  residence: ['Residence', ['#f7f3ea', '#2a2418', '#8a6d1a']],
  chronometer: ['Chronometer', ['#eef1f4', '#18212b', '#2f5f8f']],
  signal: ['Signal', ['#ffffff', '#000000', '#0047ff']],
  studio: ['Studio', ['#f5f4fa', '#1d1933', '#6b4fd6']],
  classic: ['Classic', ['#f5f7fa', '#ffffff', '#2563eb']],
};
const TABS = [
  ['profile', 'Profile & look', () => true],
  ['organisation', 'Organisation', () => can('settings.manage')],
  ['email', 'Email server', () => can('settings.manage')],
  ['roles', 'Roles & permissions', () => can('roles.manage')],
];

export async function renderSettings(main, tab, { crumbs, applyLook }) {
  crumbs('<h2 style="font-size:16px">Settings</h2>');
  const tabs = TABS.filter(([, , ok]) => ok());
  const active = tabs.some(([k]) => k === tab) ? tab : 'profile';
  const data = await api('/settings');
  main.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === active}" data-tab="${k}">${l}</button>`).join('')}</div><div id="sBody"></div>`;
  for (const b of $$('[data-tab]', main)) b.addEventListener('click', () => (location.hash = `#/settings/${b.dataset.tab}`));
  const body = $('#sBody');
  ({ profile, organisation, email, roles })[active](body, data, applyLook);
}

function profile(body, data, applyLook) {
  const u = state.session.user;
  const p = u.prefs ?? {};
  const theme = p.theme || data.settings.defaultTheme;
  const mode = p.mode || data.settings.defaultMode;
  body.innerHTML = `<div class="grid2">
    <section class="panel"><div class="head"><h3>Your look</h3></div><div class="body stack">
      <div class="looks">${Object.entries(LOOKS).map(([k, [label, sw]]) => `<button class="look" data-look="${k}" aria-pressed="${theme === k}"><div class="sw">${sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="nm">${label}</div></button>`).join('')}</div>
      <div class="row center"><span class="small muted">Mode</span><div class="seg">${['auto', 'light', 'dark'].map((m) => `<button data-mode="${m}" aria-pressed="${mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <span class="small muted">Command center opens as</span><div class="seg">${[['', 'By role'], ['cards', 'Cards'], ['table', 'Line items']].map(([v, l]) => `<button data-pview="${v}" aria-pressed="${(p.view ?? '') === v}">${l}</button>`).join('')}</div></div>
    </div></section>
    <section class="panel"><div class="head"><h3>Profile</h3></div><form id="profForm" class="body stack" style="gap:10px">
      <label class="field">Name<input name="name" value="${esc(u.name)}"></label>
      <label class="field">Title (signs your emails)<input name="title" value="${esc(u.title ?? '')}"></label>
      <div class="small muted">${esc(u.email)} · ${esc(u.roleLabel)}</div>
      <div><button class="btn primary">Save profile</button></div>
    </form>
    <form id="pwForm" class="body stack" style="gap:10px;border-top:1px solid var(--line)">
      <h3>Password</h3>
      <div class="row"><label class="field">Current<input type="password" name="current" autocomplete="current-password" required></label><label class="field">New (10+ characters)<input type="password" name="next" minlength="10" autocomplete="new-password" required></label></div>
      <div><button class="btn">Change password</button></div>
    </form></section></div>`;
  const savePrefs = async (prefs) => {
    const r = await attempt(() => api('/me', { method: 'PATCH', body: { prefs } }));
    if (r) {
      state.session.user = r.user;
      applyLook(r.user.prefs);
      document.dispatchEvent(new CustomEvent('cc:rerender'));
    }
  };
  for (const b of $$('[data-look]', body)) b.addEventListener('click', () => savePrefs({ theme: b.dataset.look }));
  for (const b of $$('[data-mode]', body)) b.addEventListener('click', () => savePrefs({ mode: b.dataset.mode }));
  for (const b of $$('[data-pview]', body)) b.addEventListener('click', () => savePrefs({ view: b.dataset.pview || 'auto' }));
  $('#profForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await attempt(() => api('/me', { method: 'PATCH', body: formData(e.target) }), 'Saved');
    if (r) state.session.user = r.user;
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await attempt(() => api('/me/password', { method: 'POST', body: formData(e.target) }), 'Password changed')) e.target.reset();
  });
}

function organisation(body, data) {
  const s = data.settings;
  body.innerHTML = `<form id="orgForm" class="panel body stack" style="max-width:720px">
    <label class="field">Name shown in the menu and on reports<input name="orgName" value="${esc(s.orgName)}"></label>
    <label class="field">Read each running POV tenant every (minutes)<input type="number" name="refreshMinutes" min="1" max="1440" value="${esc(s.refreshMinutes)}"></label>
    <div class="row"><label class="field">Default look<select name="defaultTheme">${Object.entries(LOOKS).map(([k, [l]]) => `<option value="${k}" ${s.defaultTheme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Default mode<select name="defaultMode">${['auto', 'light', 'dark'].map((m) => `<option ${s.defaultMode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
    <label class="check"><input type="checkbox" name="weeklyDrafts" ${s.weeklyDrafts ? 'checked' : ''}> Every Monday, write a weekly status draft for each running POV (waiting in its Email tab, never sent by itself)</label>
    <div><button class="btn primary">Save</button></div>
  </form>`;
  $('#orgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await attempt(() => api('/settings', { method: 'PUT', body: formData(e.target) }), 'Saved');
    if (r) state.session.settings = r.settings;
  });
}

function email(body, data) {
  const s = data.smtp;
  body.innerHTML = `<form id="smtpForm" class="panel body stack" style="max-width:720px">
    <p class="muted" style="margin:0">CommandCenter sends the SE's emails through this account, with the SE as Reply-To. Without it, SEs download .eml files or copy the text into their own mail.</p>
    <div class="row"><label class="field">SMTP host<input name="host" value="${esc(s.host)}" placeholder="smtp.office365.com"></label><label class="field" style="max-width:120px">Port<input type="number" name="port" value="${esc(s.port)}"></label><label class="check"><input type="checkbox" name="secure" ${s.secure ? 'checked' : ''}> TLS from the start (port 465)</label></div>
    <div class="row"><label class="field">User<input name="user" value="${esc(s.user)}" autocomplete="off"></label><label class="field">Password${s.hasPassword ? ' (kept; type to replace)' : ''}<input type="password" name="pass" autocomplete="new-password"></label></div>
    <label class="field">From<input name="from" value="${esc(s.from)}" placeholder="POV Command Center &lt;pov@company.com&gt;"></label>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="smtpTest">Send me a test</button></div>
  </form>`;
  $('#smtpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    if (!b.pass) delete b.pass;
    await attempt(() => api('/settings/smtp', { method: 'PUT', body: b }), 'Saved');
  });
  $('#smtpTest').addEventListener('click', async () => {
    const r = await attempt(() => api('/settings/smtp/test', { method: 'POST', body: {} }));
    if (r) toast(`Test email sent to ${r.to}`);
  });
}

function roles(body, data) {
  const { matrix, permissions, labels } = data.roles;
  const roleKeys = Object.keys(matrix);
  body.innerHTML = `<form id="roleForm" class="panel">
    <div class="head"><span class="muted small">What each role may do. Admins may do everything. What people can see always follows the reporting tree: themselves and everyone below them.</span></div>
    <div class="table-wrap"><table class="matrix"><thead><tr><th>Permission</th>${roleKeys.map((r) => `<th>${esc(labels[r])}</th>`).join('')}</tr></thead><tbody>
    ${Object.entries(permissions).map(([p, label]) => `<tr><td>${esc(label)}<div class="small muted mono">${esc(p)}</div></td>${roleKeys.map((r) => `<td><input type="checkbox" data-role="${r}" value="${p}" ${matrix[r]?.includes(p) ? 'checked' : ''} aria-label="${esc(labels[r])}: ${esc(label)}"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div><div class="body"><button class="btn primary">Save roles</button></div></form>`;
  $('#roleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = Object.fromEntries(roleKeys.map((r) => [r, $$(`input[data-role="${r}"]:checked`, body).map((x) => x.value)]));
    await attempt(() => api('/settings/roles', { method: 'PUT', body: { matrix: m } }), 'Roles saved');
  });
}
