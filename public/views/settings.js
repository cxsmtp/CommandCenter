// Settings: your profile and look, and (by permission) the organisation, the email server and the roles.
import { $, $$, esc, api, state, can, attempt, toast, formData, when, ago, ask } from '../core.js';

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
  ['salesforce', 'Salesforce', () => can('settings.manage')],
  ['system', 'System & backups', () => can('settings.manage')],
];

export async function renderSettings(main, tab, { crumbs, applyLook }) {
  crumbs('<h2 style="font-size:16px">Settings</h2>');
  const tabs = TABS.filter(([, , ok]) => ok());
  const active = tabs.some(([k]) => k === tab) ? tab : 'profile';
  const data = await api('/settings');
  main.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === active}" data-tab="${k}">${l}</button>`).join('')}</div><div id="sBody"></div>`;
  for (const b of $$('[data-tab]', main)) b.addEventListener('click', () => (location.hash = `#/settings/${b.dataset.tab}`));
  const body = $('#sBody');
  ({ profile, organisation, email, roles, salesforce, system })[active](body, data, applyLook);
}

function profile(body, data, applyLook) {
  const u = state.session.user;
  const p = u.prefs ?? {};
  const theme = p.theme || data.settings.defaultTheme;
  const mode = p.mode || data.settings.defaultMode;
  body.innerHTML = `<div class="grid2">
    <section class="panel"><div class="head"><h3>Your look</h3></div><div class="body stack">
      <div class="looks">${Object.entries(LOOKS).slice(0, 4).map(([k, [label, sw]]) => `<button class="look" data-look="${k}" aria-pressed="${theme === k}"><div class="sw">${sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="nm">${label}</div></button>`).join('')}</div>
      <details ${Object.keys(LOOKS).indexOf(theme) >= 4 ? 'open' : ''}><summary class="small muted">More looks</summary><div class="looks" style="margin-top:10px">${Object.entries(LOOKS).slice(4).map(([k, [label, sw]]) => `<button class="look" data-look="${k}" aria-pressed="${theme === k}"><div class="sw">${sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="nm">${label}</div></button>`).join('')}</div></details>
      <div class="row center"><span class="small muted">Mode</span><div class="seg">${['auto', 'light', 'dark'].map((m) => `<button data-mode="${m}" aria-pressed="${mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <span class="small muted">Portfolio opens as</span><div class="seg">${[['', 'By role'], ['cards', 'Cards'], ['table', 'Line items']].map(([v, l]) => `<button data-pview="${v}" aria-pressed="${(p.view ?? '') === v}">${l}</button>`).join('')}</div></div>
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
    </form></section></div>
    <section class="panel" id="sfMe" style="margin-top:16px"></section>`;
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
    <p class="muted" style="margin:0">Meridian sends the SE's emails through this account, with the SE as Reply-To. Without it, SEs download .eml files or copy the text into their own mail.</p>
    <div class="row"><label class="field">SMTP host<input name="host" value="${esc(s.host)}" placeholder="smtp.office365.com"></label><label class="field" style="max-width:120px">Port<input type="number" name="port" value="${esc(s.port)}"></label><label class="check"><input type="checkbox" name="secure" ${s.secure ? 'checked' : ''}> TLS from the start (port 465)</label></div>
    <div class="row"><label class="field">User<input name="user" value="${esc(s.user)}" autocomplete="off"></label><label class="field">Password${s.hasPassword ? ' (kept; type to replace)' : ''}<input type="password" name="pass" autocomplete="new-password"></label></div>
    <label class="field">From<input name="from" value="${esc(s.from)}" placeholder="Meridian &lt;pov@company.com&gt;"></label>
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

// ——— System & backups: is it healthy, what did it fix by itself, the backups, and updates ———
const LEVEL = { ok: ['ok', 'Good'], warn: ['warn', 'Look'], bad: ['bad', 'Act'] };
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function system(body) {
  const [h, u] = await Promise.all([api('/system/health'), api('/updates')]);
  const worst = h.checks[0]?.level ?? 'ok';
  body.innerHTML = `<div class="stack">
    <section class="panel sys-head ${worst}"><div class="body row center" style="gap:14px">
      <span class="sys-dot ${worst}"></span>
      <div><h3 style="margin:0">${worst === 'ok' ? 'Everything is healthy' : worst === 'warn' ? 'Healthy, with things worth a look' : 'Something needs you'}</h3>
      <div class="small muted">Checked now · the server corrects what it can by itself every minute · key ${esc(h.key.fingerprint)}</div></div>
      <span class="spacer"></span><button class="btn" data-act="recheck">Check again</button></div></section>

    <section class="panel"><div class="head"><h3>Health</h3></div><div class="checks">
      ${h.checks.map((c) => `<div class="check-row ${c.level}"><span class="badge ${LEVEL[c.level][0]}">${LEVEL[c.level][1]}</span><div><b>${esc(c.label)}</b><div>${esc(c.text)}</div>${c.fix ? `<div class="small muted">${esc(c.fix)}</div>` : ''}</div></div>`).join('')}
    </div></section>

    <section class="panel"><div class="head"><h3>Backups</h3><div class="row center"><a class="btn" href="/api/system/backup/download">Download the data (encrypted)</a><button class="btn primary" data-act="backup">Back up now</button></div></div>
      <div class="body small muted" style="padding-bottom:0">Taken by itself every few hours, before every update and every restore. Each one is opened and checked when it is taken. Records stay encrypted and the key is never in a backup — keep the key safe somewhere else.${h.offsite ? ` Each is also copied to <span class="mono">${esc(h.offsite)}</span>.` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Taken</th><th>Why</th><th>Version</th><th class="n">Files</th><th class="n">Size</th><th>Check</th>${h.offsite ? '<th>Off the server</th>' : ''}<th></th></tr></thead><tbody>
      ${h.backups.map((b) => `<tr><td>${esc(b.at ? when(b.at) : b.name)}<div class="small muted">${b.at ? esc(ago(b.at)) : ''}</div></td><td>${esc(b.label === 'auto' ? 'Automatic' : b.label === 'manual' ? 'By hand' : b.label === 'before-restore' ? 'Before a restore' : b.label.startsWith('before-') ? `Before update ${b.label.slice(7)}` : b.label)}</td><td class="mono">${esc(b.version)}</td><td class="n">${b.files}</td><td class="n">${size(b.bytes)}</td>
        <td>${b.verified === true ? (b.sameKey ? '<span class="badge ok">Readable</span>' : '<span class="badge warn">Another key</span>') : b.verified === false ? `<span class="badge bad" title="${esc(b.problems.join('\n'))}">Failed</span>` : '<span class="badge">Not checked</span>'}</td>
        ${h.offsite ? `<td>${b.offsite ? '<span class="badge ok">Copied</span>' : '<span class="badge warn">Missing</span>'}</td>` : ''}
        <td class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm ghost" data-verify="${esc(b.name)}">Check</button>${h.launched ? `<button class="btn sm" data-restore="${esc(b.name)}" data-at="${esc(b.at ? when(b.at) : b.name)}">Restore</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No backup yet — the first is taken a minute after the server starts.</td></tr>'}
      </tbody></table></div></section>

    <div class="grid2">
      <section class="panel"><div class="head"><h3>Corrected by itself</h3></div><div class="body stack" style="gap:8px">
        ${[...h.corrections.map((c) => ({ at: c.at, text: `${c.what} — ${c.action}` })), ...h.repairs.map((r) => ({ at: r.at, text: r.from ? `${r.name} was damaged — repaired from ${r.from}` : `${r.name} was damaged — no good copy, set aside` }))].sort((a, b) => b.at.localeCompare(a.at)).map((c) => `<div><div class="small muted">${esc(when(c.at))}</div>${esc(c.text)}</div>`).join('') || '<span class="muted">Nothing needed correcting since the server started.</span>'}
      </div></section>
      <section class="panel"><div class="head"><h3>Updates</h3><button class="btn sm" data-act="check-updates">Check now</button></div><div class="body stack" style="gap:10px">
        <div>Running <b class="mono">${esc(u.current)}</b>${u.updateAvailable ? ` · <span class="badge accent">${esc(u.available[0].version)} available</span>` : u.checkError ? ' · <span class="warn-t">could not check</span>' : ' · up to date'}${u.lastCheck ? `<div class="small muted">Last checked ${esc(ago(u.lastCheck))}${u.checkError ? ` · ${esc(u.checkError)}` : ''}</div>` : ''}</div>
        ${u.lastFailure ? `<div class="small bad-t">${esc(u.lastFailure.version)} failed to start and was rolled back by itself.</div>` : ''}
        <label class="check"><input type="checkbox" id="autoOn" ${u.auto.enabled ? 'checked' : ''}> Keep up to date by itself — check every <select id="autoEvery">${[5, 10, 15, 30, 60, 240, 1440].map((m) => `<option value="${m}" ${u.auto.everyMinutes === m ? 'selected' : ''}>${m < 60 ? `${m} minutes` : m === 60 ? 'hour' : m === 1440 ? 'day' : `${m / 60} hours`}</option>`).join('')}</select></label>
        <div class="small muted">Every change pushed to main is published as a release; this server installs it as soon as it sees it. A checked backup is taken first, people see a few seconds’ pause, and a version that does not start is rolled back by itself and never tried again.${u.heldBack ? ` Held back: ${esc(u.heldBack)} and older (you went back from it).` : ''}</div>
        ${u.launched ? '' : '<div class="small warn-t">This server was not started by the launcher (npm start or the container image), so it cannot update itself.</div>'}
        ${u.token ? '' : '<div class="small muted">For a private repository, set CC_UPDATE_TOKEN (a read-only GitHub token) on the server.</div>'}
        <div class="row">${u.updateAvailable && u.launched ? `<button class="btn primary" data-act="install">Install ${esc(u.available[0].version)}</button>` : ''}${u.previous && u.launched ? `<button class="btn ghost" data-act="rollback">Go back to ${esc(u.previous)}</button>` : ''}</div>
      </div></section>
    </div></div>`;
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
  $('[data-act="check-updates"]', body).addEventListener('click', async () => (await attempt(() => api('/updates/check', { method: 'POST', body: {} }))) && again());
  const saveAuto = () => attempt(() => api('/updates/auto', { method: 'PUT', body: { enabled: $('#autoOn').checked, everyMinutes: Number($('#autoEvery').value) } }), 'Saved');
  $('#autoOn').addEventListener('change', saveAuto);
  $('#autoEvery').addEventListener('change', saveAuto);
  $('[data-act="install"]', body)?.addEventListener('click', async () => {
    if ((await ask(`Install ${u.available[0].version}? People see a short pause while the server restarts.`, { ok: 'Install' })) && (await attempt(() => api('/updates/install', { method: 'POST', body: { version: u.available[0].version } }), 'Installing — restarting'))) setTimeout(() => location.reload(), 8000);
  });
  $('[data-act="rollback"]', body)?.addEventListener('click', async () => {
    if ((await ask(`Go back to ${u.previous}?`, { ok: 'Go back' })) && (await attempt(() => api('/updates/rollback', { method: 'POST', body: {} }), 'Going back — restarting'))) setTimeout(() => location.reload(), 8000);
  });
}

// ——— Your Email to Salesforce address ———
async function sfMe(el) {
  const me = await api('/me/salesforce');
  el.innerHTML = `<div class="head"><h3>Email to Salesforce</h3>${me.set ? '<span class="badge ok">Connected</span>' : ''}</div><form id="sfMeForm" class="body stack" style="gap:10px;max-width:760px">
    <p class="muted small" style="margin:0">Your private address from Salesforce (<b>Settings → Email → My Email to Salesforce</b>). Meridian sends it your tasks, notes, stage changes and POV results, and copies it on the POV emails you send, so they are saved in Salesforce as activities. It is stored encrypted and shown to no one.</p>
    <label class="field">Your Email to Salesforce address<input name="address" type="email" autocomplete="off" placeholder="${me.set ? esc(`${me.hint} (kept — type to replace)`) : 'emailtosalesforce@….salesforce.com'}"></label>
    <label class="check"><input type="checkbox" name="copy" ${me.copy ? 'checked' : ''}> Copy it on the POV emails I send from Meridian</label>
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
      ${s.publicUrl ? '' : '<p class="small muted" style="margin:0">Tip: set CC_PUBLIC_URL to Meridian’s address so each Salesforce activity links back to the POV.</p>'}
      <div><button class="btn primary">Save</button></div></div></form>

    <form id="sfBoxForm" class="panel"><div class="head"><h3>Report mailbox</h3>${mb.enabled ? '<span class="badge ok">On</span>' : '<span class="badge">Off</span>'}</div><div class="body stack" style="gap:10px">
      <p class="muted small" style="margin:0">Salesforce keeps every POV’s stage, amount and close date current with no API: subscribe a mailbox to the opportunities report, and Meridian reads it.<br>
      <b>1.</b> In Salesforce, open the Opportunities report (columns: Opportunity ID, Opportunity Name, Account Name, Stage, Amount, Close Date, Probability, Next Step) → <b>Subscribe</b> → daily, recipient: this mailbox. Attach the file (.xlsx) if your org allows it; if not, the table in the email is read.<br>
      <b>2.</b> Give Meridian the mailbox below (IMAP; for Microsoft 365, a shared mailbox with IMAP on). Only mail from the allowed senders is read; it is marked read and moved to “Meridian imported”.</p>
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
