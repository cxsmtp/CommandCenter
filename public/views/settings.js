// Settings: your profile and look; and (by permission) the organisation, connections, the server's security, health,
// backups, updates and recovery; and About.
import { $, $$, esc, api, state, can, attempt, toast, formData, when, ago, ask, day } from '../core.js';

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
// Settings, grouped as in CxMissionZero: a side menu by subject, each page one job.
const MANAGE = () => can('settings.manage');
const TABS = [
  ['You', [['profile', 'Profile & look', () => true]]],
  ['Organisation', [['organisation', 'Organisation', MANAGE], ['roles', 'Roles & permissions', () => can('roles.manage')], ['salesforce', 'Salesforce', MANAGE]]],
  ['Connections', [['email', 'Email server', MANAGE], ['network', 'Network & certificates', MANAGE], ['linked', 'Linked apps', MANAGE]]],
  ['Server', [['security', 'Security & sign-in', MANAGE], ['system', 'Health & backups', MANAGE], ['updates', 'Update & recovery', MANAGE]]],
  ['', [['about', 'About', () => true]]],
];

export async function renderSettings(main, tab, { crumbs, applyLook }) {
  crumbs('<h2 style="font-size:16px">Settings</h2>');
  const groups = TABS.map(([g, items]) => [g, items.filter(([, , ok]) => ok())]).filter(([, items]) => items.length);
  const all = groups.flatMap(([, items]) => items);
  const active = all.some(([k]) => k === tab) ? tab : 'profile';
  const data = await api('/settings');
  main.innerHTML = `<div class="set-layout"><nav class="set-nav" aria-label="Settings">${groups.map(([g, items]) => `${g ? `<div class="set-group">${esc(g)}</div>` : '<div class="set-sep"></div>'}${items.map(([k, l]) => `<a href="#/settings/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}`).join('')}</nav>
    <div class="set-main"><h1 class="set-title">${esc(all.find(([k]) => k === active)[1])}</h1><div id="sBody"></div></div></div>`;
  const body = $('#sBody');
  ({ profile, organisation, email, roles, salesforce, system, security, network, updates, about, linked })[active](body, data, applyLook);
}

function profile(body, data, applyLook) {
  const u = state.session.user;
  const p = u.prefs ?? {};
  const theme = p.theme || data.settings.defaultTheme;
  const mode = p.mode || data.settings.defaultMode;
  body.innerHTML = `<div class="grid2">
    <div class="stack"><section class="panel"><div class="head"><h3>Your look</h3></div><div class="body stack">
      ${data.settings.lookForAll ? '<p class="small muted" style="margin:0">Your Admin set one look for everyone (Settings → Organisation).</p>' : ''}
      <div class="stack" ${data.settings.lookForAll ? 'inert style="opacity:.45"' : ''}>
      <div class="looks">${Object.entries(LOOKS).slice(0, 4).map(([k, [label, sw]]) => `<button class="look" data-look="${k}" aria-pressed="${theme === k}"><div class="sw">${sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="nm">${label}</div></button>`).join('')}</div>
      <details ${Object.keys(LOOKS).indexOf(theme) >= 4 ? 'open' : ''}><summary class="small muted">More looks</summary><div class="looks" style="margin-top:10px">${Object.entries(LOOKS).slice(4).map(([k, [label, sw]]) => `<button class="look" data-look="${k}" aria-pressed="${theme === k}"><div class="sw">${sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="nm">${label}</div></button>`).join('')}</div></details>
      <div class="row center"><span class="small muted">Mode</span><div class="seg">${['auto', 'light', 'dark'].map((m) => `<button data-mode="${m}" aria-pressed="${mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div></div>
      </div>
      <div class="pref-rows"><span class="small muted">Kendra opens on</span><div class="seg">${[['', 'By role'], ['insights', 'Insights'], ['dashboard', 'Portfolio']].map(([v, l]) => `<button data-phome="${v}" aria-pressed="${(p.home ?? '') === v}">${l}</button>`).join('')}</div>
        <span class="small muted">Portfolio opens as</span><div class="seg">${[['', 'By role'], ['cards', 'Cards'], ['table', 'Line items']].map(([v, l]) => `<button data-pview="${v}" aria-pressed="${(p.view ?? '') === v}">${l}</button>`).join('')}</div></div>
    </div></section>
    <section class="panel" id="sfMe"></section></div>
    <section class="panel"><div class="head"><h3>Profile</h3></div><form id="profForm" class="body stack" style="gap:10px">
      <label class="field">Name<input name="name" value="${esc(u.name)}"></label>
      <label class="field">Title (signs your emails)<input name="title" value="${esc(u.title ?? '')}"></label>
      <label class="field">Sales region<input name="region" list="myRegions" value="${esc(u.region ?? '')}" placeholder="e.g. EMEA"><datalist id="myRegions">${['NA', 'LATAM', 'EMEA', 'UK & I', 'DACH', 'Nordics', 'APAC', 'ANZ', 'India', 'Japan', 'Middle East'].map((r) => `<option value="${r}">`).join('')}</datalist></label>
      <div class="small muted">${esc(u.email)} · ${esc(u.roleLabel)}</div>
      <div><button class="btn primary">Save profile</button></div>
    </form>
    <form id="pwForm" class="body stack" style="gap:10px;border-top:1px solid var(--line)">
      <h3>Password</h3>
      <div class="row"><label class="field">Current<input type="password" name="current" autocomplete="current-password" required></label><label class="field">New (10+ characters)<input type="password" name="next" minlength="10" autocomplete="new-password" required></label></div>
      <div><button class="btn">Change password</button></div>
    </form></section></div>`;
  sfMe($('#sfMe'));
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
  for (const b of $$('[data-phome]', body)) b.addEventListener('click', () => savePrefs({ home: b.dataset.phome || 'auto' }));
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

function organisation(body, data, applyLook) {
  const s = data.settings;
  body.innerHTML = `<div class="grid2 org-cols"><div class="stack" id="orgLeft"><form id="orgForm" class="panel body stack" style="padding:16px">
    <label class="field">Name shown in the menu and on reports<input name="orgName" value="${esc(s.orgName)}"></label>
    <label class="field">Read each running POV tenant every (minutes)<input type="number" name="refreshMinutes" min="1" max="1440" value="${esc(s.refreshMinutes)}"></label>
    <div class="row"><label class="field">Default look<select name="defaultTheme">${Object.entries(LOOKS).map(([k, [l]]) => `<option value="${k}" ${s.defaultTheme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Default mode<select name="defaultMode">${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'As the device']].map(([m, l]) => `<option value="${m}" ${s.defaultMode === m ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="check"><input type="checkbox" name="lookForAll" ${s.lookForAll ? 'checked' : ''}> Use this look and mode for everyone (people cannot choose their own)</label>
    <label class="field">Results presentation<select name="reportStyle"><option value="classic" ${s.reportStyle !== 'team' ? 'selected' : ''}>Classic (Kendra’s own design)</option><option value="team" ${s.reportStyle === 'team' ? 'selected' : ''}>Team template (the WIP design, in the uploaded template)</option></select></label>
    <label class="check"><input type="checkbox" name="weeklyDrafts" ${s.weeklyDrafts ? 'checked' : ''}> Every Monday, write a weekly status draft for each running POV (waiting in its Email tab, never sent by itself)</label>
    <div><button class="btn primary">Save</button></div>
  </form></div><div class="stack" id="orgRight"></div></div>`;
  wipTemplate($('#orgLeft', body));
  sharePointPanel($('#orgRight', body));
  $('#orgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await attempt(() => api('/settings', { method: 'PUT', body: formData(e.target) }), 'Saved');
    if (r) {
      state.session.settings = r.settings;
      applyLook(state.session.user.prefs);
    }
  });
}

function email(body, data) {
  const s = data.smtp;
  body.innerHTML = `<form id="smtpForm" class="panel body stack" style="max-width:720px">
    <p class="muted" style="margin:0">Kendra sends the SE's emails through this account, with the SE as Reply-To. Without it, SEs download .eml files or copy the text into their own mail.</p>
    <div class="row"><label class="field">SMTP host<input name="host" value="${esc(s.host)}" placeholder="smtp.office365.com"></label><label class="field" style="max-width:120px">Port<input type="number" name="port" value="${esc(s.port)}"></label><label class="check"><input type="checkbox" name="secure" ${s.secure ? 'checked' : ''}> TLS from the start (port 465)</label></div>
    <div class="row"><label class="field">User<input name="user" value="${esc(s.user)}" autocomplete="off"></label><label class="field">Password${s.hasPassword ? ' (kept; type to replace)' : ''}<input type="password" name="pass" autocomplete="new-password"></label></div>
    <label class="field">From<input name="from" value="${esc(s.from)}" placeholder="Kendra &lt;pov@company.com&gt;"></label>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="smtpTest">Send me a test</button></div>
  </form>`;
  $('#smtpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    if (!b.pass) delete b.pass;
    const r = await attempt(() => api('/settings/smtp', { method: 'PUT', body: b }));
    if (!r) return;
    if (r.verified) toast('Saved, and the email server accepted the sign-in');
    else if (r.restored) toast(`These settings did not work (${r.error}). The last working ones were put back, so email keeps going.`, { bad: true });
    else toast(`Saved, but the email server did not accept them: ${r.error}`, { bad: true });
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
    ${Object.entries(permissions).map(([p, label]) => `<tr><td>${esc(label)} <span class="small muted mono">${esc(p)}</span></td>${roleKeys.map((r) => `<td><input type="checkbox" data-role="${r}" value="${p}" ${matrix[r]?.includes(p) ? 'checked' : ''} aria-label="${esc(labels[r])}: ${esc(label)}"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div><div class="body"><button class="btn primary">Save roles</button></div></form>`;
  $('#roleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = Object.fromEntries(roleKeys.map((r) => [r, $$(`input[data-role="${r}"]:checked`, body).map((x) => x.value)]));
    await attempt(() => api('/settings/roles', { method: 'PUT', body: { matrix: m } }), 'Roles saved');
  });
}

// ——— System & backups: is it healthy, what did it fix by itself, the backups, and updates ———
const LEVEL = { ok: ['ok', 'Good'], warn: ['warn', 'Look'], bad: ['bad', 'Act'] };
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function system(body) {
  const h = await api('/system/health');
  const worst = h.checks[0]?.level ?? 'ok';
  body.innerHTML = `<div class="stack">
    <section class="panel sys-head ${worst}"><div class="body row center" style="gap:14px">
      <span class="sys-dot ${worst}"></span>
      <div><h3 style="margin:0">${worst === 'ok' ? 'Everything is healthy' : worst === 'warn' ? 'Healthy, with things worth a look' : 'Something needs you'}</h3>
      <div class="small muted">Checked now · the server corrects what it can by itself every minute, and emails the Admins when something stays wrong · key ${esc(h.key.fingerprint)}</div></div>
      <span class="spacer"></span><a class="btn" href="/api/system/report" download>Troubleshooting report</a><button class="btn" data-act="recheck">Check again</button></div></section>

    <section class="panel"><div class="head"><h3>Health</h3></div><div class="checks">
      ${h.checks.filter((c) => c.level !== 'ok').map((c) => `<div class="check-row ${c.level}"><span class="badge ${LEVEL[c.level][0]}">${LEVEL[c.level][1]}</span><div><b>${esc(c.label)}</b><div>${esc(c.text)}</div>${c.fix ? `<div class="small muted">${esc(c.fix)}</div>` : ''}</div></div>`).join('')}
    </div><div class="checks-ok">
      ${h.checks.filter((c) => c.level === 'ok').map((c) => `<div class="ok-row" title="${esc(c.text)}"><span class="badge ok">Good</span><b>${esc(c.label)}</b><span class="small muted">${esc(c.text)}</span></div>`).join('')}
    </div></section>

    <div class="grid2 sys-pair">
    <section class="panel"><div class="head"><h3 title="Taken by itself every few hours, before every update and every restore. Each one is opened and checked when it is taken. Records stay encrypted and the key is never in a backup: keep the key safe somewhere else.">Backups <span class="small muted" style="text-transform:none;letter-spacing:0">ⓘ</span></h3><div class="row center"><a class="btn" href="/api/system/backup/download">Download the data (encrypted)</a><button class="btn" data-act="drill" title="Restore the newest backup into a scratch folder and read it back">Run a restore drill</button><button class="btn primary" data-act="backup">Back up now</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Taken</th><th>Why</th><th>Version</th><th class="n">Files</th><th class="n">Size</th><th>Check</th>${h.offsite ? '<th>Off the server</th>' : ''}<th></th></tr></thead><tbody>
      ${h.backups.map((b) => `<tr><td>${esc(b.at ? when(b.at) : b.name)}<div class="small muted">${b.at ? esc(ago(b.at)) : ''}</div></td><td>${esc(b.label === 'auto' ? 'Automatic' : b.label === 'manual' ? 'By hand' : b.label === 'before-restore' ? 'Before a restore' : b.label.startsWith('before-') ? `Before update ${b.label.slice(7)}` : b.label)}</td><td class="mono">${esc(b.version)}</td><td class="n">${b.files}</td><td class="n">${size(b.bytes)}</td>
        <td>${b.verified === true ? (b.sameKey ? '<span class="badge ok">Readable</span>' : '<span class="badge warn">Another key</span>') : b.verified === false ? `<span class="badge bad" title="${esc(b.problems.join('\n'))}">Failed</span>` : '<span class="badge">Not checked</span>'}</td>
        ${h.offsite ? `<td>${b.offsite ? '<span class="badge ok">Copied</span>' : '<span class="badge warn">Missing</span>'}</td>` : ''}
        <td class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm ghost" data-verify="${esc(b.name)}">Check</button>${h.launched ? `<button class="btn sm" data-restore="${esc(b.name)}" data-at="${esc(b.at ? when(b.at) : b.name)}">Restore</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No backup yet — the first is taken a minute after the server starts.</td></tr>'}
      </tbody></table></div></section>

    <section class="panel"><div class="head"><h3>Corrected by itself</h3></div><div class="body stack" style="gap:8px">
        ${[...h.corrections.map((c) => ({ at: c.at, text: `${c.what} — ${c.action}` })), ...h.repairs.map((r) => ({ at: r.at, text: r.from ? `${r.name} was damaged — repaired from ${r.from}` : `${r.name} was damaged — no good copy, set aside` }))].sort((a, b) => b.at.localeCompare(a.at)).map((c) => `<div><div class="small muted">${esc(when(c.at))}</div>${esc(c.text)}</div>`).join('') || '<span class="muted">Nothing needed correcting since the server started.</span>'}
      </div></section>
    </div>
    </div>`;
  const again = () => system(body);
  $('[data-act="recheck"]', body).addEventListener('click', again);
  $('[data-act="backup"]', body).addEventListener('click', async () => (await attempt(() => api('/system/backup', { method: 'POST', body: {} }), 'Backup taken and checked')) && again());
  for (const b of $$('[data-verify]', body))
    b.addEventListener('click', async () => {
      const r = await attempt(() => api(`/system/backups/${encodeURIComponent(b.dataset.verify)}/verify`, { method: 'POST', body: {} }));
      if (r) toast(r.ok ? 'Readable: every record opens and matches its checksum' : `Not restorable: ${r.problems.join('; ')}`, { bad: !r.ok });
    });
  for (const b of $$('[data-restore]', body))
    b.addEventListener('click', async () => {
      if (!(await ask(`Put back the data as it was at ${b.dataset.at}? Everything since then is replaced (a backup of it is taken first, so this can be undone). The server restarts.`, { ok: 'Restore', danger: true }))) return;
      if (await attempt(() => api('/system/restore', { method: 'POST', body: { name: b.dataset.restore } }), 'Restored — restarting')) setTimeout(() => location.reload(), 6000);
    });
  $('[data-act="drill"]', body).addEventListener('click', async () => {
    const r = await attempt(() => api('/system/drill', { method: 'POST', body: {} }));
    if (r) {
      toast(r.ok ? 'Restore drill passed: the newest backup opens and reads back' : `Restore drill failed: ${r.message}`, { bad: !r.ok });
      again();
    }
  });
}

// ——— Linked apps: one sign-in for Kendra and the FTR Credits Command Center ———
async function linked(body) {
  const l = await api('/settings/link');
  const here = l.here || location.origin;
  body.innerHTML = `<div class="grid2">
    <section class="panel"><div class="head"><h3>FTR Credits Command Center</h3>${l.ready ? '<span class="badge ok">Linked</span>' : '<span class="badge">Not linked</span>'}</div>
      <form id="linkForm" class="body stack" style="gap:12px">
        <p class="small muted" style="margin:0">Someone signed in to one opens the other already signed in, as the same person (their email): from the menu, or by opening it directly. They need an account, turned on, in both; nobody is created this way.</p>
        <label class="field">Its address<input name="ftrUrl" value="${esc(l.ftrUrl)}" placeholder="https://ftr.company.com" required></label>
        <label class="field">Shared key <span class="small muted">${l.hasKey ? 'set (paste a new one to replace it)' : 'paste the key the FTR command center made, or make one here'}</span><input name="key" autocomplete="off" spellcheck="false" placeholder="${l.hasKey ? '••••••••••••••••' : '43 letters and digits'}"></label>
        <div id="newKey"></div>
        <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-act="new-key">Make a new key</button>${l.ready ? '<a class="btn ghost" href="/link/ftr?to=%2F" target="_blank" rel="noopener">Try it ↗</a><button type="button" class="btn ghost danger" data-act="unlink">Unlink</button>' : ''}</div>
        ${l.at ? `<p class="small muted" style="margin:0">Set ${esc(ago(l.at))}${l.by ? ` by ${esc(l.by)}` : ''}.</p>` : ''}
      </form></section>
    <section class="panel"><div class="head"><h3>On the FTR command center</h3></div><div class="body"><ol class="facts-list">
      <li>Settings → Linked apps: give it Kendra’s address, <span class="mono">${esc(here)}</span>.</li>
      <li>Paste the same shared key on both sides (make it on one, copy it to the other).</li>
      <li>Try it: the menu of each shows the other; opening one while signed in to the other signs you in.</li></ol>
      <p class="small muted">Each sign-in travels as a pass signed with the key, for one app, good for a minute and used once; both audit trails record it. Unlink here or there to stop it.</p></div></section></div>`;
  const form = $('#linkForm', body);
  const save = async (extra = {}) => {
    const b = formData(form);
    const r = await attempt(() => api('/settings/link', { method: 'PUT', body: { ftrUrl: b.ftrUrl, ...(b.key ? { key: b.key } : {}), ...extra } }), 'Saved');
    if (r?.key) {
      $('#newKey', body).innerHTML = `<div class="notice-box"><b>The new shared key</b> (shown once): copy it into the FTR command center.<div class="row center" style="margin-top:6px"><input readonly class="mono" value="${esc(r.key)}" style="flex:1"><button type="button" class="btn sm" data-copy>Copy</button></div></div>`;
      $('[data-copy]', body).addEventListener('click', () => navigator.clipboard?.writeText(r.key).then(() => toast('Copied')));
    } else if (r) linked(body);
    return r;
  };
  form.addEventListener('submit', (e) => (e.preventDefault(), save()));
  $('[data-act="new-key"]', body).addEventListener('click', async () => {
    if (l.hasKey && !(await ask('Make a new shared key? The old one stops working, so paste the new one in the FTR command center too.', { ok: 'Make a new key' }))) return;
    save({ newKey: true });
  });
  $('[data-act="unlink"]', body)?.addEventListener('click', async () => {
    if (!(await ask('Unlink the FTR command center? Signing in to one no longer signs you in to the other.', { ok: 'Unlink', danger: true }))) return;
    if (await attempt(() => api('/settings/link', { method: 'PUT', body: { remove: true } }), 'Unlinked')) linked(body);
  });
}

// ——— Security & sign-in ———
function security(body, data) {
  const sec = data.settings.security ?? { sessionHours: 12, maxAttempts: 10 };
  body.innerHTML = `<div class="stack">
    <section class="panel"><div class="head"><h3>Sessions</h3></div><form id="secForm" class="body stack" style="gap:12px;max-width:720px">
      <div class="row"><label class="field">A sign-in lasts, while in use <span class="small muted">hours, 1 to 168</span><input type="number" name="sessionHours" min="1" max="168" value="${esc(sec.sessionHours)}" required></label>
        <label class="field">Attempts before a pause <span class="small muted">per person and address, per 15 minutes</span><input type="number" name="maxAttempts" min="3" max="100" value="${esc(sec.maxAttempts)}" required></label></div>
      <p class="small muted" style="margin:0">Each use extends the sign-in; it ends after this long without use, and after 30 days in any case. Five minutes before it ends, people are offered to stay signed in. Sign-ins survive restarts and updates.</p>
      <div class="row"><button class="btn primary">Save</button></div></form></section>
    <section class="panel"><div class="head"><h3>How sign-in is protected</h3></div><div class="body"><ul class="facts-list">
      <li><b>Passwords</b> of at least 10 characters, stored as salted scrypt hashes; a first password must be changed at the first sign-in.</li>
      <li><b>Changing a password</b> ends every other sign-in of that person.</li>
      <li><b>Cookies</b> are HTTP-only and SameSite=Strict; every change also needs Kendra’s own request header, so another site cannot act for you.</li>
      <li><b>Locked out?</b> On the server: <span class="mono">node src/reset-password.js you@company.com</span> sets a new temporary password.</li>
      <li><b>Every request</b> is in the audit trail (Audit), chained so a change to it shows.</li></ul></div></section></div>`;
  $('#secForm', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    await attempt(() => api('/settings/security', { method: 'PUT', body: { sessionHours: Number(b.sessionHours), maxAttempts: Number(b.maxAttempts) } }), 'Saved');
  });
}

// ——— Network & certificates ———
async function network(body) {
  const n = await api('/settings/network');
  const net = n.network;
  const sheet = n.allowlist.map((a) => `${a.direction === 'in' ? 'IN ' : 'OUT'}  ${a.host}:${a.port}  ${a.why}`).join('\n');
  body.innerHTML = `<div class="stack">
    ${n.restartNeeded ? `<section class="panel notice warn"><div class="body row center"><div style="flex:1"><b>Restart to apply</b><div class="small muted">The proxy or the trusted certificates changed: they take effect when the server restarts (a few seconds).</div></div>${n.launched ? '<button class="btn primary" data-act="restart">Restart now</button>' : '<span class="small muted">Restart the container to apply.</span>'}</div></section>` : ''}
    <div class="grid2">
    <section class="panel"><div class="head"><h3>Company proxy</h3>${net.proxy ? (net.active ? '<span class="badge ok">In use</span>' : '<span class="badge warn">Saved, applies at the next restart</span>') : net.active ? '<span class="badge">From the server’s environment</span>' : '<span class="badge">None</span>'}</div>
      <form id="netForm" class="body stack" style="gap:12px;max-width:760px">
        <label class="field">Proxy address <span class="small muted">for every call out (Checkmarx One, GitHub releases, Microsoft Graph); empty for none</span><input name="proxy" value="${esc(net.proxy)}" placeholder="http://proxy.company.com:8080"></label>
        <div class="row"><label class="field">User<input name="proxyUser" value="${esc(net.proxyUser)}" autocomplete="off" placeholder="optional"></label><label class="field">Password<input name="proxyPass" type="password" autocomplete="new-password" placeholder="${net.hasProxyPass ? 'kept (type to replace)' : ''}"></label></div>
        <label class="field">Go direct to <span class="small muted">NO_PROXY: hosts or domains, comma separated</span><input name="noProxy" value="${esc(net.noProxy)}" placeholder="localhost, .company.local"></label>
        <div class="row"><button class="btn primary" name="go" value="restart">Save and restart</button><button class="btn" name="go" value="save">Save</button></div>
      </form></section>
    <section class="panel"><div class="head"><h3>Trusted certificates</h3><button class="btn sm" data-act="cert-add">Add a certificate</button></div>
      <div class="body small muted" style="padding-bottom:0">A company proxy that inspects HTTPS (Zscaler, Netskope, Palo Alto…) shows its own certificate: add its root here, as a PEM file, so calls out are trusted.</div>
      <div class="table-wrap"><table><thead><tr><th>Certificate</th><th>Issued by</th><th>Valid until</th><th>Added</th><th></th></tr></thead><tbody>${n.certs.map((c) => `<tr><td>${esc(c.subject)}${c.ca ? ' <span class="badge">CA</span>' : ''}<div class="small muted mono">${esc(c.fingerprint.slice(0, 29))}…</div></td><td>${esc(c.issuer)}</td><td>${esc(day(c.validTo))}</td><td>${c.addedAt ? `${esc(ago(c.addedAt))}${c.addedBy ? `<div class="small muted">${esc(c.addedBy)}</div>` : ''}` : '—'}</td><td><button class="btn sm ghost danger" data-cert-del="${esc(c.fingerprint)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None: the usual public certificates are trusted.</td></tr>'}</tbody></table></div>
      <input type="file" id="certFile" accept=".pem,.crt,.cer,text/plain" hidden></section>
    </div>
    <section class="panel"><div class="head"><h3>What the network must allow</h3><div class="row"><button class="btn sm" data-act="copy-sheet">Copy</button><a class="btn sm" download="kendra-network.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(sheet)}">Download</a></div></div>
      <div class="body small muted" style="padding-bottom:0">For the network team: every connection this server makes, from its own settings and the tenants it reads.</div>
      <div class="table-wrap sheet"><table><thead><tr><th>Direction</th><th>Host</th><th class="n">Port</th><th>Why</th></tr></thead><tbody>${n.allowlist.map((a) => `<tr><td>${a.direction === 'in' ? 'In' : 'Out'}</td><td class="mono">${esc(a.host)}</td><td class="n">${esc(a.port)}</td><td>${esc(a.why)}</td></tr>`).join('')}</tbody></table></div></section>
</div>`;
  const again = () => network(body);
  const restart = async () => (await attempt(() => api('/system/restart', { method: 'POST', body: {} }), 'Restarting')) && setTimeout(() => location.reload(), 6000);
  $('[data-act="restart"]', body)?.addEventListener('click', restart);
  $('#netForm', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    const go = e.submitter?.value === 'restart';
    const r = await attempt(() => api('/settings/network', { method: 'PUT', body: { proxy: b.proxy, proxyUser: b.proxyUser, proxyPass: b.proxyPass, noProxy: b.noProxy, restart: go } }), go ? 'Saved — restarting' : 'Saved');
    if (r?.restarting) setTimeout(() => location.reload(), 6000);
    else if (r) again();
  });
  $('[data-act="copy-sheet"]', body).addEventListener('click', () => navigator.clipboard?.writeText(sheet).then(() => toast('Copied'), () => toast('Could not copy', { bad: true })));
  const fileIn = $('#certFile', body);
  $('[data-act="cert-add"]', body).addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    const pem = await f.text();
    const r = await attempt(() => api('/settings/certs', { method: 'POST', body: { pem } }));
    if (r) {
      toast(r.added ? `${r.added} certificate${r.added === 1 ? '' : 's'} trusted` : 'Already trusted');
      again();
    }
  });
  for (const b of $$('[data-cert-del]', body))
    b.addEventListener('click', async () => {
      if (!(await ask('Stop trusting this certificate? Calls through a proxy that uses it will fail.', { ok: 'Remove', danger: true }))) return;
      if (await attempt(() => api(`/settings/certs/${encodeURIComponent(b.dataset.certDel)}`, { method: 'DELETE' }), 'Removed')) again();
    });
}

// ——— Update & recovery ———
const EVENT = { install: 'Installed', started: 'Started', failed: 'Failed to install', rollback: 'Went back', 'auto-rollback': 'Rolled back by itself', crash: 'Stopped unexpectedly', integrity: 'Files changed: not run' };
async function updates(body) {
  const [u, ig] = await Promise.all([api('/updates'), api('/system/integrity')]);
  const i = ig.integrity;
  const installed = new Set(u.installed ?? []);
  const tone = i?.checked && !i.ok ? 'bad' : 'ok';
  const shown = Number(body.dataset.more || 10);
  const notes = (t) => esc(String(t || '').replace(/\r/g, '').trim()).replace(/\n{2,}/g, '</p><p>').replace(/\n- /g, '<br>• ').replace(/\n/g, ' ');
  body.innerHTML = `<div class="stack">
    <section class="panel sys-head ${u.updateAvailable ? 'warn' : 'ok'}"><div class="body row center" style="gap:14px;flex-wrap:wrap">
      <span class="sys-dot ${u.updateAvailable ? 'warn' : 'ok'}"></span>
      <div style="flex:1;min-width:240px"><h3 style="margin:0">Running <span class="mono">${esc(u.current)}</span>${u.updateAvailable ? ` · <span class="accent-t">${esc(u.available[0].version)} available</span>` : u.checkError ? ' · <span class="warn-t">could not check</span>' : ' · up to date'}</h3>
        <div class="small muted">${u.lastCheck ? `Last checked ${esc(ago(u.lastCheck))}` : 'Not checked yet'}${u.checkError ? ` · ${esc(u.checkError)}` : ''}${u.signed ? ' · releases must be signed' : ''}</div></div>
      <button class="btn" data-act="check">Check now</button>${u.updateAvailable && u.launched ? `<button class="btn primary" data-install="${esc(u.available[0].version)}">Install ${esc(u.available[0].version)}</button>` : ''}</div></section>
    ${u.lastFailure ? `<section class="panel notice bad"><div class="body"><b>${esc(u.lastFailure.version)} did not start</b> and the server went back by itself; it is never installed by itself again.<div class="small muted">${esc(u.lastFailure.message ?? '')}</div></div></section>` : ''}
    <div class="grid2">
      <section class="panel"><div class="head"><h3>Keep up to date</h3></div><div class="body stack" style="gap:10px">
        <label class="check"><input type="checkbox" id="autoOn" ${u.auto.enabled ? 'checked' : ''}> Install new versions by itself, checking every <select id="autoEvery">${[5, 10, 15, 30, 60, 240, 1440].map((m) => `<option value="${m}" ${u.auto.everyMinutes === m ? 'selected' : ''}>${m < 60 ? `${m} minutes` : m === 60 ? 'hour' : m === 1440 ? 'day' : `${m / 60} hours`}</option>`).join('')}</select></label>
        <p class="small muted" style="margin:0">A checked backup is taken first; people see a pause of a few seconds. A version that does not start is rolled back by itself and never tried again.${u.heldBack ? ` Held back: ${esc(u.heldBack)} and older (you went back from it).` : ''}</p>
        ${u.launched ? '' : '<p class="small warn-t" style="margin:0">This server was not started by the launcher (the container image or npm start), so it cannot update itself.</p>'}
        <div class="row">${u.previous && u.launched ? `<button class="btn ghost" data-act="rollback">Go back to ${esc(u.previous)}</button>` : ''}${u.launched ? '<button class="btn ghost" data-act="restart">Restart the server</button>' : ''}<a class="btn ghost" href="/api/system/report" download>Troubleshooting report</a></div>
      </div></section>
      <section class="panel"><div class="head"><h3>Software integrity</h3><span class="badge ${tone}">${i?.checked ? (i.ok ? 'Genuine' : 'Files changed') : 'Image version'}</span></div><div class="body stack" style="gap:10px">
        <p style="margin:0">${i?.checked ? (i.ok ? `Every file of ${esc(u.current)} matches what was installed.` : `${i.changed.length} file${i.changed.length === 1 ? '' : 's'} changed since it was installed: <span class="mono small">${esc(i.changed.slice(0, 6).join(', '))}</span>`) : `${esc(u.current)} is the container image’s own version; its files were checked when the image was built.`}</p>
        <p class="small muted" style="margin:0">Each installed version keeps a fingerprint of its files: they are checked before it starts, every 6 hours and when you ask; the Admins are emailed if one changes.${i?.at ? ` Last checked ${esc(ago(i.at))}.` : ''}</p>
        <div class="row"><button class="btn sm" data-act="integrity">Check now</button></div>
      </div></section>
    </div>
    <section class="panel"><div class="head"><h3>Versions</h3><span class="small muted">every release, newest first</span></div>
      <div class="versions">${(u.available ?? []).slice(0, shown).map((r) => `<details class="version${r.version === u.current ? ' current' : ''}"><summary><span class="mono"><b>${esc(r.version)}</b></span>${r.version === u.current ? '<span class="badge ok">Running</span>' : r.newer ? '<span class="badge accent">Newer</span>' : installed.has(r.version) ? '<span class="badge">Installed</span>' : ''}${(u.failed ?? []).includes(r.version) ? '<span class="badge bad">Did not start</span>' : ''}<span class="v-title">${esc(String(r.notes || r.name || '').split('\n')[0].slice(0, 120))}</span><span class="small muted">${r.publishedAt ? esc(when(r.publishedAt)) : ''}</span>
          ${u.launched && r.version !== u.current ? `<button class="btn sm${r.newer ? ' primary' : ' ghost'}" data-install="${esc(r.version)}">${r.newer ? 'Install' : 'Switch to it'}</button>` : '<span></span>'}</summary>
          <div class="v-notes"><p>${notes(String(r.notes || '').split('\n').slice(1).join('\n')) || '<span class="muted">No notes.</span>'}</p>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="small">On GitHub ↗</a>` : ''}</div></details>`).join('') || '<p class="muted" style="padding:14px">No release read yet: press Check now.</p>'}</div>
      ${(u.available ?? []).length > shown ? `<div class="body"><button class="btn sm" data-act="more">Show 10 more</button></div>` : ''}</section>
    <section class="panel"><div class="head"><h3>Recent events</h3></div><div class="table-wrap"><table><thead><tr><th>When</th><th>What</th><th>Version</th><th>Detail</th></tr></thead><tbody>
      ${(u.history ?? []).map((h) => `<tr><td>${esc(when(h.at))}<div class="small muted">${esc(ago(h.at))}</div></td><td>${esc(EVENT[h.event] ?? h.event)}</td><td class="mono">${esc(h.version ?? '')}${h.from ? ` <span class="muted">from ${esc(h.from)}</span>` : ''}</td><td class="small">${esc(h.message ?? (h.by ? `by ${h.by}` : ''))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}
    </tbody></table></div></section></div>`;
  const again = () => updates(body);
  const reloadSoon = () => setTimeout(() => location.reload(), 8000);
  $('[data-act="check"]', body).addEventListener('click', async () => (await attempt(() => api('/updates/check', { method: 'POST', body: {} }))) && again());
  $('[data-act="integrity"]', body).addEventListener('click', async () => {
    const r = await attempt(() => api('/system/integrity?now=1'));
    if (r) toast(r.integrity.checked ? (r.integrity.ok ? 'Genuine: every file matches' : 'Files changed since install') : 'The image’s own version: nothing to compare');
    again();
  });
  $('[data-act="more"]', body)?.addEventListener('click', () => ((body.dataset.more = String(shown + 10)), again()));
  const saveAuto = () => attempt(() => api('/updates/auto', { method: 'PUT', body: { enabled: $('#autoOn').checked, everyMinutes: Number($('#autoEvery').value) } }), 'Saved');
  $('#autoOn', body).addEventListener('change', saveAuto);
  $('#autoEvery', body).addEventListener('change', saveAuto);
  for (const b of $$('[data-install]', body))
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      const v = b.dataset.install;
      if ((await ask(`Install ${v}? A checked backup is taken first; people see a short pause while the server restarts.`, { ok: 'Install' })) && (await attempt(() => api('/updates/install', { method: 'POST', body: { version: v } }), 'Installing — restarting'))) reloadSoon();
    });
  $('[data-act="rollback"]', body)?.addEventListener('click', async () => {
    if ((await ask(`Go back to ${u.previous}?`, { ok: 'Go back' })) && (await attempt(() => api('/updates/rollback', { method: 'POST', body: {} }), 'Going back — restarting'))) reloadSoon();
  });
  $('[data-act="restart"]', body)?.addEventListener('click', async () => {
    if ((await ask('Restart the server? People see a pause of a few seconds; nothing is lost.', { ok: 'Restart' })) && (await attempt(() => api('/system/restart', { method: 'POST', body: {} }), 'Restarting'))) setTimeout(() => location.reload(), 6000);
  });
}

// ——— About ———
async function about(body, data) {
  const a = await api('/system/about');
  body.innerHTML = `<div class="stack">
    <section class="panel about-card"><div class="body">
      <div class="row center" style="gap:16px"><img src="/logo.png" alt="" width="72" height="72" style="border-radius:50%"><div><div class="about-name">Kendra</div><div class="muted"><b>केन्द्र</b>, Sanskrit for “centre”: the centre for the best solution engineers to manage the growth.</div></div></div>
      <dl class="about-facts"><dt>Version</dt><dd class="mono">${esc(a.version)}</dd><dt>Organisation</dt><dd>${esc(data.settings.orgName)}</dd><dt>Running since</dt><dd>${esc(when(a.startedAt))} <span class="muted">(${esc(ago(a.startedAt))})</span></dd><dt>Node.js</dt><dd class="mono">${esc(a.node)}</dd>${a.repo ? `<dt>Releases from</dt><dd class="mono">${esc(a.repo)}</dd>` : ''}${a.dataDir ? `<dt>Data folder</dt><dd class="mono">${esc(a.dataDir)}</dd>` : ''}<dt>Licence</dt><dd>${esc(a.licence)}</dd></dl>
      ${can('settings.manage') ? '<div class="row" style="margin-top:14px"><a class="btn" href="#/settings/updates">Update &amp; recovery</a><a class="btn ghost" href="#/settings/system">Health &amp; backups</a></div>' : ''}
    </div></section>
    <section class="panel"><div class="head"><h3>Your data stays yours</h3></div><div class="body"><ul class="facts-list">
      <li><b>On your server.</b> Kendra runs where you put it and keeps everything in its own data folder, encrypted (AES-256).</li>
      <li><b>No telemetry.</b> Nothing calls home. It connects only to what you connect it to: the Checkmarx One tenants of your POVs, your email server, GitHub for its own releases, and Microsoft Graph or Salesforce if you set them up (Network &amp; certificates lists them).</li>
      <li><b>Reads, never writes, a tenant</b> — except AI triage and remediation, and only when a person plans them, sees the credits they cost and confirms.</li>
      <li><b>Keys never leave the server:</b> API keys, passwords and addresses are sealed, and never sent back to a browser.</li></ul></div></section></div>`;
}

// ——— Your Email to Salesforce address ———
async function sfMe(el) {
  const me = await api('/me/salesforce');
  el.innerHTML = `<div class="head"><h3>Email to Salesforce</h3>${me.set ? '<span class="badge ok">Connected</span>' : ''}</div><form id="sfMeForm" class="body stack" style="gap:10px;max-width:760px">
    <p class="muted small" style="margin:0">Your private address from Salesforce (<b>Settings → Email → My Email to Salesforce</b>). Kendra sends it your tasks, notes, stage changes and POV results, and copies it on the POV emails you send, so they are saved in Salesforce as activities. It is stored encrypted and shown to no one.</p>
    <label class="field">Your Email to Salesforce address<input name="address" type="email" autocomplete="off" placeholder="${me.set ? esc(`${me.hint} (kept — type to replace)`) : 'emailtosalesforce@….salesforce.com'}"></label>
    <label class="check"><input type="checkbox" name="copy" ${me.copy ? 'checked' : ''}> Copy it on the POV emails I send from Kendra</label>
    ${me.sender ? `<p class="small" style="margin:0">Once in Salesforce: add <b class="mono">${esc(me.sender)}</b> to <b>My Acceptable Email Addresses</b> on the same page — Salesforce only takes mail from addresses on that list.</p>` : '<p class="small warn-t" style="margin:0">The email server is not set up yet: an Admin sets it under Settings → Email server.</p>'}
    <div class="row"><button class="btn primary">Save</button>${me.set ? '<button type="button" class="btn ghost" data-act="sf-clear">Remove</button>' : ''}</div>
  </form>`;
  $('#sfMeForm', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    const body = { copy: Boolean(b.copy) };
    if (b.address) body.address = b.address;
    if (await attempt(() => api('/me/salesforce', { method: 'PUT', body }), 'Saved')) sfMe(el);
  });
  $('[data-act="sf-clear"]', el)?.addEventListener('click', async () => {
    if ((await ask('Stop sending to Salesforce?', { ok: 'Stop', danger: true })) && (await attempt(() => api('/me/salesforce', { method: 'PUT', body: { address: '' } }), 'Removed'))) sfMe(el);
  });
}

// ——— Salesforce (Admin): what is logged by itself, and the report mailbox ———
async function salesforce(body) {
  const s = await api('/salesforce/settings');
  const mb = s.mailbox;
  const last = s.last;
  body.innerHTML = `<div class="stack" style="max-width:900px">
    <form id="sfLogForm" class="panel"><div class="head"><h3>Logged by itself</h3></div><div class="body stack" style="gap:8px">
      <p class="muted small" style="margin:0">Through each SE’s own Email to Salesforce address (they add it under Profile). Nothing is sent for people who have not added one.</p>
      <label class="check"><input type="checkbox" name="logStages" ${s.logStages ? 'checked' : ''}> When a POV changes stage, send Salesforce the change and where the POV stands</label>
      <label class="check"><input type="checkbox" name="logResults" ${s.logResults ? 'checked' : ''}> When a POV is marked successful, send Salesforce the result</label>
      ${s.publicUrl ? '' : '<p class="small muted" style="margin:0">Tip: set CC_PUBLIC_URL to Kendra’s address so each Salesforce activity links back to the POV.</p>'}
      <div><button class="btn primary">Save</button></div></div></form>

    <form id="sfBoxForm" class="panel"><div class="head"><h3>Report mailbox</h3>${mb.enabled ? '<span class="badge ok">On</span>' : '<span class="badge">Off</span>'}</div><div class="body stack" style="gap:10px">
      <p class="muted small" style="margin:0">Salesforce keeps every POV’s stage, amount and close date current with no API: subscribe a mailbox to the opportunities report, and Kendra reads it.<br>
      <b>1.</b> In Salesforce, open the Opportunities report (columns: Opportunity ID, Opportunity Name, Account Name, Stage, Amount, Close Date, Probability, Next Step) → <b>Subscribe</b> → daily, recipient: this mailbox. Attach the file (.xlsx) if your org allows it; if not, the table in the email is read.<br>
      <b>2.</b> Give Kendra the mailbox below (IMAP; for Microsoft 365, a shared mailbox with IMAP on). Only mail from the allowed senders is read; it is marked read and moved to “Kendra imported”.</p>
      <label class="check"><input type="checkbox" name="enabled" ${mb.enabled ? 'checked' : ''}> Read the mailbox every <input type="number" name="everyMinutes" min="5" max="1440" value="${esc(mb.everyMinutes)}" style="width:70px"> minutes</label>
      <div class="row"><label class="field">IMAP host<input name="host" value="${esc(mb.host)}" placeholder="outlook.office365.com"></label><label class="field" style="max-width:110px">Port<input type="number" name="port" value="${esc(mb.port)}"></label><label class="check"><input type="checkbox" name="secure" ${mb.secure ? 'checked' : ''}> TLS</label></div>
      <div class="row"><label class="field">User<input name="user" value="${esc(mb.user)}" autocomplete="off"></label><label class="field">Password${mb.hasPassword ? ' (kept; type to replace)' : ''}<input type="password" name="pass" autocomplete="new-password"></label></div>
      <div class="row"><label class="field">Folder<input name="folder" value="${esc(mb.folder)}"></label><label class="field">Allowed sender domains<input name="senders" value="${esc(mb.senders)}" placeholder="salesforce.com"></label></div>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-act="mb-test">Test the sign-in</button><button type="button" class="btn" data-act="mb-run">Read it now</button></div>
      <div id="mbOut" class="small">${last ? lastRun(last) : '<span class="muted">Not read yet.</span>'}</div>
    </div></form></div>`;
  $('#sfLogForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    await attempt(() => api('/salesforce/settings', { method: 'PUT', body: { logStages: Boolean(b.logStages), logResults: Boolean(b.logResults) } }), 'Saved');
  });
  const boxBody = () => {
    const b = formData($('#sfBoxForm'));
    const m = { enabled: Boolean(b.enabled), host: b.host, port: Number(b.port), secure: Boolean(b.secure), user: b.user, folder: b.folder, senders: b.senders, everyMinutes: Number(b.everyMinutes) };
    if (b.pass) m.pass = b.pass;
    return { mailbox: m };
  };
  $('#sfBoxForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await attempt(() => api('/salesforce/settings', { method: 'PUT', body: boxBody() }), 'Saved')) salesforce(body);
  });
  $('[data-act="mb-test"]', body).addEventListener('click', async () => {
    await attempt(() => api('/salesforce/settings', { method: 'PUT', body: boxBody() }));
    const r = await attempt(() => api('/salesforce/mailbox/test', { method: 'POST', body: {} }));
    if (r) toast(`Signed in · ${r.folder}: ${r.messages} messages`);
  });
  $('[data-act="mb-run"]', body).addEventListener('click', async () => {
    await attempt(() => api('/salesforce/settings', { method: 'PUT', body: boxBody() }));
    $('#mbOut').innerHTML = '<span class="muted">Reading…</span>';
    const r = await attempt(() => api('/salesforce/mailbox/run', { method: 'POST', body: {} }));
    if (r) $('#mbOut').innerHTML = lastRun(r);
  });
}

const lastRun = (r) => `<div><b>Last read ${esc(ago(r.at))}</b>${r.skipped === 'off' ? ' — the mailbox is off' : ''}${r.ok === false ? ` — <span class="bad-t">${esc(r.error)}</span>` : ''}</div>
  ${(r.imported ?? []).map((x) => `<div>✓ ${esc(x.subject || 'report')}: ${x.rows} rows, ${x.matched} matched${x.unmatched ? `, ${x.unmatched} not matched` : ''}</div>`).join('')}
  ${(r.skipped && r.skipped !== 'off' ? r.skipped : []).map((x) => `<div class="muted">Left: ${esc(x.subject || '(no subject)')} — ${esc(x.why)}</div>`).join('')}
  ${r.ok !== false && !(r.imported ?? []).length && r.skipped !== 'off' ? '<div class="muted">No new report emails.</div>' : ''}`;

// The team's POV WIP template: its look, layouts and closing slide are used for every POV's WIP deck.
async function wipTemplate(body) {
  const box = document.createElement('section');
  box.className = 'panel';
  box.style.cssText = 'max-width:720px;margin-top:16px';
  body.append(box);
  const draw = async () => {
    const { template: t } = await api('/wip-template');
    box.innerHTML = `<div class="head"><h3>POV WIP deck template</h3></div><div class="body stack">
      <p class="small muted" style="margin:0">Upload the team’s POV WIP PowerPoint. Kendra keeps its masters, layouts, backgrounds and closing slide, drops its slides, and fills every POV’s WIP deck in that look. Kept encrypted on this server. Without one, the deck uses Kendra’s own dark design.</p>
      ${t ? `<p style="margin:0"><b>${esc(t.name)}</b> <span class="small muted">· ${t.slides} slides · ${t.closing ? 'closing slide found' : 'no closing slide found'} · uploaded ${esc(new Date(t.at).toLocaleDateString())}${t.by ? ` by ${esc(t.by)}` : ''}</span></p>` : '<p class="small" style="margin:0">No template yet.</p>'}
      <div class="row"><button class="btn" data-act="tpl-up">${t ? 'Replace the template' : 'Upload the template (.pptx)'}</button>${t ? '<button class="btn ghost danger" data-act="tpl-del">Remove</button>' : ''}</div>
      <input type="file" id="wipTpl" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden></div>`;
    const input = box.querySelector('#wipTpl');
    box.querySelector('[data-act="tpl-up"]').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const res = await fetch('/api/wip-template', { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return toast(j.error ?? 'That file could not be used', { bad: true });
      toast('Template saved');
      draw();
    });
    box.querySelector('[data-act="tpl-del"]')?.addEventListener('click', async () => {
      if (!(await ask('Remove the WIP template? Decks go back to Kendra’s own design.', { ok: 'Remove', danger: true }))) return;
      if (await attempt(() => api('/wip-template', { method: 'DELETE' }), 'Removed')) draw();
    });
  };
  draw().catch(() => box.remove());
}

// SharePoint: the Microsoft app registration Kendra publishes POV documents with.
async function sharePointPanel(body) {
  const box = document.createElement('section');
  box.className = 'panel';
  box.style.cssText = 'max-width:720px;margin-top:16px';
  body.append(box);
  let c;
  try {
    c = await api('/settings/sharepoint');
  } catch {
    box.remove();
    return;
  }
  box.innerHTML = `<div class="head"><h3>SharePoint</h3><span class="small muted">${c.hasSecret ? '<span class="ok-t">Connected</span>' : 'Not set up'}</span></div>
    <form class="body stack" id="spF">
      <p class="small muted" style="margin:0">SEs publish a POV’s WIP deck, results deck and results page to the POV’s SharePoint site in one click. Your Microsoft admin registers an app in Entra ID with the <b>Sites.Selected</b> (or Sites.ReadWrite.All) application permission and admin consent, and gives you its ids and a client secret. The secret is kept sealed.</p>
      <div class="row"><label class="field">Directory (tenant) ID<input name="tenantId" value="${esc(c.tenantId)}" placeholder="00000000-0000-0000-0000-000000000000"></label><label class="field">Application (client) ID<input name="clientId" value="${esc(c.clientId)}" placeholder="00000000-0000-0000-0000-000000000000"></label></div>
      <label class="field">Client secret<input name="clientSecret" type="password" autocomplete="new-password" placeholder="${c.hasSecret ? 'Saved — leave empty to keep it' : 'The secret’s value'}"></label>
      <label class="field">Folder in the site’s documents <span class="muted small">{customer} is the POV’s customer</span><input name="folder" value="${esc(c.folder)}"></label>
      <label class="field">Test with a site link <span class="muted small">(optional)</span><input name="siteUrl" placeholder="https://contoso.sharepoint.com/sites/Acme"></label>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-act="sp-test">Test</button>${c.hasSecret ? '<button type="button" class="btn ghost danger" data-act="sp-remove">Remove</button>' : ''}</div>
    </form>`;
  const f = box.querySelector('#spF');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await attempt(() => api('/settings/sharepoint', { method: 'PUT', body: { tenantId: f.tenantId.value, clientId: f.clientId.value, clientSecret: f.clientSecret.value, folder: f.folder.value } }), 'SharePoint saved')) {
      box.remove();
      sharePointPanel(body);
    }
  });
  box.querySelector('[data-act="sp-test"]').addEventListener('click', async () => {
    const r = await attempt(() => api('/settings/sharepoint/test', { method: 'POST', body: { siteUrl: f.siteUrl.value } }));
    if (r) toast(r.site ? `Signed in, and found the site “${r.site}”` : 'Signed in to Microsoft');
  });
  box.querySelector('[data-act="sp-remove"]')?.addEventListener('click', async () => {
    if (!(await ask('Remove the SharePoint connection?', { ok: 'Remove', danger: true }))) return;
    if (await attempt(() => api('/settings/sharepoint', { method: 'PUT', body: { remove: true } }), 'Removed')) {
      box.remove();
      sharePointPanel(body);
    }
  });
}
