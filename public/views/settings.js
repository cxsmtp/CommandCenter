// Settings: your profile and look; and (by permission) the organisation, connections, the server's security, health,
// backups, updates and recovery; and About.
import { $, $$, esc, api, state, can, attempt, toast, formData, when, ago, ask, day } from '../core.js';
import { renderPeople, renderTeams } from './people.js';
import { renderAudit } from './audit.js';
import { renderCatalog } from './catalog.js';
import { renderPresentations } from './presentations.js';

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
// Settings, as in the FTR command center: one side menu by subject (You, People, POVs, Records, System), each page
// with its title and what it is for, panels that say what they do, and settings that save as they are changed.
const MANAGE = () => can('settings.manage');
const ALL = () => true;
const TABS = [
  ['You', [['profile', 'Your profile & look', ALL]]],
  ['People', [['people', 'People', ALL], ['teams', 'Teams', ALL], ['roles', 'Roles & permissions', () => can('roles.manage')], ['signin', 'Sign-in', MANAGE]]],
  ['POVs', [['capabilities', 'Capabilities & criteria', ALL], ['presentations', 'Presentation templates', () => can('templates.manage')], ['salesforce', 'Salesforce', MANAGE]]],
  ['Records', [['audit', 'Audit log', () => can('audit.view')]]],
  ['System', [['general', 'General', MANAGE], ['branding', 'Branding', MANAGE], ['email', 'Email (SMTP)', MANAGE], ['sso', 'Single sign-on', MANAGE], ['linked', 'Linked apps', MANAGE], ['https', 'HTTPS & network', MANAGE], ['updates', 'Updates', MANAGE], ['backups', 'Backups & health', MANAGE], ['help', 'Get help', ALL], ['about', 'About', ALL]]],
];
// Old addresses of pages that were renamed.
const ALIAS = { organisation: 'general', network: 'https', system: 'backups', security: 'signin' };
const ADMINS = 'for the whole of Kendra · Admins only';
// Each page's title line: [what it is for, shown beside the title (inline) or under it].
const META = {
  profile: ['yours alone: how Kendra looks and opens for you', true],
  people: ['Everyone who can sign in, and what they may do. You manage the people below you.'],
  teams: ['The team structure: each leader and everyone below them. A leader sees their team’s POVs, and every team below it.'],
  roles: ['What each role may do. Admins may do everything; what people see always follows the reporting tree.'],
  signin: [ADMINS, true],
  presentations: ['The decks shared with customers: each template’s slides as they will look, their order, the design of each slide and its words. A new PowerPoint is read by itself.'],
  capabilities: ['What a POV can prove (and how Kendra reads it from Checkmarx One), the business goals, the success criteria templates and the customer presentations.'],
  salesforce: [ADMINS, true],
  audit: [null],
  general: [ADMINS, true],
  email: [ADMINS, true],
  linked: [ADMINS, true],
  https: [ADMINS, true],
  updates: [ADMINS, true],
  backups: [ADMINS, true],
  about: ['the version, what changed, and the licence', true],
  branding: [ADMINS, true],
  sso: [ADMINS, true],
  help: ['a support case or an idea, to the team that runs Kendra', true],
};
/** A settings form that saves as it is changed (after a pause while typing), as in the FTR command center. */
export function autosave(form, save, status, { delay = 700 } = {}) {
  let timer = null;
  const say = (t, bad = false) => {
    if (!status) return;
    status.textContent = t;
    status.classList.toggle('bad', bad);
  };
  const run = async () => {
    clearTimeout(timer);
    say('Saving…');
    try {
      await save(form);
      say(`All changes are saved ✓ ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      say(`${error.message} Nothing was changed.`, true);
    }
  };
  form.addEventListener('submit', (e) => (e.preventDefault(), run()));
  form.addEventListener('input', (e) => {
    if (['checkbox', 'radio', 'select-one', 'file'].includes(e.target.type)) return;
    clearTimeout(timer);
    timer = setTimeout(run, e.target.tagName === 'TEXTAREA' ? 1200 : delay);
  });
  form.addEventListener('change', (e) => e.target.type !== 'file' && run());
  return { run };
}
export const SAVES = '<div class="st-banner">✓ Changes save as you type.</div>';

export async function renderSettings(main, tab, { crumbs, applyLook }) {
  crumbs('<h2 style="font-size:16px">Settings</h2>');
  const groups = TABS.map(([g, items]) => [g, items.filter(([, , ok]) => ok())]).filter(([, items]) => items.length);
  const all = groups.flatMap(([, items]) => items);
  const want = ALIAS[tab] ?? tab;
  const active = all.some(([k]) => k === want) ? want : all.some(([k]) => k === 'people') && !tab ? 'people' : 'profile';
  if (tab !== active && location.hash.startsWith('#/settings')) history.replaceState(null, '', `#/settings/${active}`);
  const data = await api('/settings');
  const [sub, inline] = META[active] ?? [''];
  const title = all.find(([k]) => k === active)[1];
  main.innerHTML = `<div class="set-layout"><nav class="set-nav" aria-label="Settings">${groups.map(([g, items]) => `<div class="set-group">${esc(g)}</div>${items.map(([k, l]) => `<a href="#/settings/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}`).join('')}</nav>
    <div class="set-main">${sub === null ? '' : `<div class="st-head${inline ? ' inline' : ''}"><h1>${esc(title)}</h1>${sub ? `<span class="st-sub">${esc(sub)}</span>` : ''}</div>`}<div id="sBody"></div></div></div>`;
  const body = $('#sBody');
  const linked = state.session.linked ?? null;
  const pages = {
    profile, general: organisation, branding, email, roles, salesforce, backups: system, signin: security, https: network, updates, about, linked: linkedPage, help: helpPage, sso: ssoPage,
    people: () => renderPeople(body, { linked }),
    teams: () => renderTeams(body, { linked }),
    audit: () => renderAudit(body, { crumbs: () => {} }),
    capabilities: () => renderCatalog(body, { crumbs: () => {} }),
    presentations: () => renderPresentations(body),
  };
  await pages[active](body, data, applyLook);
}

// ——— General: how Kendra works for everyone ———
function organisation(body, data) {
  const s = data.settings;
  body.innerHTML = `${SAVES}<div class="grid2 org-cols"><div class="stack" id="orgLeft"><section class="panel st-panel"><div class="st-ph"><h2>Kendra</h2><span class="st-aside">The name, logo and look are under Branding</span></div>
    <form id="orgForm" class="st-form">
      <label class="field">Read each running POV tenant every <span class="small muted">minutes, 1 to 1,440</span><input type="number" name="refreshMinutes" min="1" max="1440" value="${esc(s.refreshMinutes)}"></label>
      <label class="field">Results presentation<select name="reportStyle"><option value="classic" ${s.reportStyle !== 'team' ? 'selected' : ''}>Classic (Kendra’s own design)</option><option value="team" ${s.reportStyle === 'team' ? 'selected' : ''}>Team template (the WIP design, in the uploaded template)</option></select></label>
      <label class="opt"><input type="checkbox" name="weeklyDrafts" ${s.weeklyDrafts ? 'checked' : ''}><span><b>Weekly status drafts</b><small>Every Monday, a draft for each running POV waits in its Email tab. It is never sent by itself.</small></span></label>
    </form><div class="st-foot" id="orgSaved">Saved as you change it.</div></section></div><div class="stack" id="orgRight"></div></div>`;
  wipTemplate($('#orgLeft', body));
  sharePointPanel($('#orgRight', body));
  autosave($('#orgForm', body), async (f) => {
    const b = formData(f);
    const r = await api('/settings', { method: 'PUT', body: { refreshMinutes: Number(b.refreshMinutes), reportStyle: b.reportStyle, weeklyDrafts: b.weeklyDrafts } });
    state.session.settings = r.settings;
  }, $('#orgSaved', body));
}

// ——— Branding: the name line, logo, browser icon and the look ———
async function branding(body, data, applyLook) {
  const s = data.settings;
  const br = s.brand ?? {};
  const img = (k, at) => (at ? `<img src="/api/brand/${k}?v=${encodeURIComponent(at)}" alt="">` : `<img src="${k === 'logo' ? '/logo.png' : '/favicon-64.png'}" alt="">`);
  body.innerHTML = `${SAVES}<section class="panel st-panel"><div class="st-ph"><h2>Branding</h2></div><form id="brForm" class="st-form">
    <div class="st-cols3"><label class="field">App name<input name="orgName" maxlength="80" value="${esc(s.orgName)}"></label>
      <label class="field">Under the name<input name="tagline" maxlength="60" value="${esc(br.tagline ?? '')}" placeholder="One line of sight"></label><span></span></div>
    <div class="st-cols2">
      <div class="field">Logo <span class="small muted">PNG, JPEG, SVG or WebP, up to 200 KB; square works best</span><div class="img-pick"><span class="img-prev">${img('logo', br.logoAt)}</span><label class="btn sm">Upload<input type="file" data-img="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></label>${br.logoAt ? '<button type="button" class="btn sm ghost" data-rm="logo">Use Kendra’s</button>' : ''}</div></div>
      <div class="field">Browser icon<div class="img-pick"><span class="img-prev">${img('icon', br.iconAt)}</span><label class="btn sm">Upload<input type="file" data-img="icon" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></label>${br.iconAt ? '<button type="button" class="btn sm ghost" data-rm="icon">Use Kendra’s</button>' : ''}</div></div></div>
    <div class="field">Look of the app <span class="small muted">everyone’s, unless they choose their own under Your profile &amp; look</span>
      <div class="seg st-seg">${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'As the device']].map(([m, l]) => `<label><input type="radio" name="defaultMode" value="${m}" ${s.defaultMode === m ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <div class="looks">${Object.entries(LOOKS).map(([k, [label, sw]]) => `<label class="look"><input type="radio" name="defaultTheme" value="${k}" ${s.defaultTheme === k ? 'checked' : ''} hidden><div class="sw">${sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="nm">${esc(label)}</div></label>`).join('')}</div>
    <label class="opt"><input type="checkbox" name="lookFree" ${s.lookForAll ? '' : 'checked'}><span><b>Let people choose their own look</b><small>Off: everyone sees the look chosen here.</small></span></label>
  </form><div class="st-foot" id="brSaved">All changes are saved.</div></section>`;
  const f = $('#brForm', body);
  const put = async (extra) => {
    const r = await api('/settings/brand', { method: 'PUT', body: extra });
    state.session.settings = { ...state.session.settings, ...r.settings };
    applyLook(state.session.user.prefs);
    return r;
  };
  autosave(f, async () => {
    const b = formData(f);
    const theme = f.querySelector('input[name="defaultTheme"]:checked')?.value;
    const mode = f.querySelector('input[name="defaultMode"]:checked')?.value;
    await put({ orgName: b.orgName, tagline: b.tagline, defaultTheme: theme, defaultMode: mode, lookForAll: !b.lookFree });
    for (const l of body.querySelectorAll('.look')) l.classList.toggle('on', l.querySelector('input').checked);
  }, $('#brSaved', body));
  for (const l of body.querySelectorAll('.look')) l.classList.toggle('on', l.querySelector('input').checked);
  for (const inp of body.querySelectorAll('[data-img]'))
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      if (file.size > 200 * 1024) return toast('The image is larger than 200 KB.', { bad: true });
      const url = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = () => no(new Error('The file could not be read.'));
        r.readAsDataURL(file);
      });
      if (await attempt(() => put({ [inp.dataset.img]: url }), 'Saved')) location.reload();
    });
  for (const b of body.querySelectorAll('[data-rm]')) b.addEventListener('click', async () => (await attempt(() => put({ [b.dataset.rm]: null }), 'Saved')) && location.reload());
}

// ——— Email (SMTP) ———
function email(body, data) {
  const s = data.smtp;
  body.innerHTML = `${SAVES}<section class="panel st-panel"><div class="st-ph"><h2>Email server (SMTP)</h2><span class="st-aside"><span class="status ${s.host ? 'on' : 'off'}"><i></i>${s.host ? 'Set up' : 'Not set up'}</span></span></div>
    <p class="st-note">Kendra sends the SEs’ emails through this account, with the SE as Reply-To, and the “Forgot your password?”, joining and Get help emails. Saved as you type and tested with the mail server at once; settings that fail give way to the last ones that worked. The password is kept encrypted and never shown again.</p>
    <form id="smtpForm" class="st-form">
      <div class="st-cols2"><label class="field">Mail server<input name="host" value="${esc(s.host)}" placeholder="smtp.office365.com"></label><label class="field">Port<input type="number" name="port" value="${esc(s.port)}"></label></div>
      <label class="opt"><input type="checkbox" name="secure" ${s.secure ? 'checked' : ''}><span><b>Implicit TLS</b><small>On for port 465. Off for 587 and 25, where STARTTLS is used.</small></span></label>
      <div class="st-cols2"><label class="field">User name<input name="user" value="${esc(s.user)}" autocomplete="off"></label><label class="field">Password<input type="password" name="pass" autocomplete="new-password" placeholder="${s.hasPassword ? 'kept: type to replace' : ''}"></label></div>
      <label class="field">From<input name="from" value="${esc(s.from)}" placeholder="Kendra &lt;pov@company.com&gt;"></label>
    </form>
    <div class="st-form row center" style="padding-top:0"><button type="button" class="btn primary" id="smtpTest">Send me a test email</button></div>
    <div class="st-foot" id="smtpSaved">All changes are saved.</div></section>`;
  autosave($('#smtpForm', body), async (f) => {
    const b = formData(f);
    if (!b.pass) delete b.pass;
    const r = await api('/settings/smtp', { method: 'PUT', body: b });
    if (r.restored) throw new Error(`These settings did not work (${r.error}); the last working ones were put back.`);
    if (r.verified === false && r.error) throw new Error(`Saved, but the email server did not accept them: ${r.error}.`);
    f.pass.value = '';
  }, $('#smtpSaved', body), { delay: 1200 });
  $('#smtpTest', body).addEventListener('click', async () => {
    const r = await attempt(() => api('/settings/smtp/test', { method: 'POST', body: {} }));
    if (r) toast(`Test email sent to ${r.to}`);
  });
}

// ——— Sign-in: sessions, forgotten passwords, joining by themselves ———
async function security(body) {
  const d = await api('/settings/signin');
  const sec = d.security ?? { sessionHours: 12, maxAttempts: 10 };
  const missing = d.missing.length ? `<div class="st-warn">Not available yet: ${d.missing.map(esc).join(' ')}</div>` : '';
  body.innerHTML = `<div class="stack">
    <section class="panel st-panel"><div class="st-ph"><h2>Joining by themselves</h2><span class="st-aside">from the sign-in page${d.joined ? ` · <a href="#/settings/people">${d.joined} to review on People</a>` : ''}</span></div>
      <p class="st-note">Someone with a work address of these domains asks from the sign-in page. Already with an account: they get a link to choose a new password. New: a link (it proves the address is theirs) to give their name, who they report to and a password. They join as an Associate and are listed on People for review. Arriving from the FTR command center needs no link (Linked apps).</p>
      <form id="joinForm" class="st-form">
        <label class="opt"><input type="checkbox" name="joinEnabled" ${d.join.enabled ? 'checked' : ''}><span><b>People may join by themselves</b></span></label>
        <label class="field">Email domains <span class="small muted">one or more, such as checkmarx.com</span><input name="domains" value="${esc(d.join.domains.join(', '))}"></label>
        ${missing}</form><div class="st-foot" id="joinSaved">Changes save as you choose.</div></section>
    <div class="grid2">
      <section class="panel st-panel"><div class="st-ph"><h2>Forgotten passwords</h2></div>
        <p class="st-note">“Forgot your password?” sends a one-time link to the account’s own email. It works once, for 30 minutes, and signs the account out everywhere when used. The answer never says whether an address has an account.</p>
        <form id="resetForm" class="st-form"><label class="field">Who may reset a forgotten password by email<select name="reset">${[['everyone', 'Everyone with a password'], ['not-admins', 'Everyone but Admins'], ['nobody', 'Nobody (an Admin sets a new one)']].map(([v, l]) => `<option value="${v}" ${d.reset === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${missing}</form>
        <div class="st-foot" id="resetSaved">Changes save as you choose.</div></section>
      <section class="panel st-panel"><div class="st-ph"><h2>Sessions</h2></div><form id="secForm" class="st-form">
        <div class="st-cols2"><label class="field">A sign-in lasts, while in use <span class="small muted">hours, 1 to 168</span><input type="number" name="sessionHours" min="1" max="168" value="${esc(sec.sessionHours)}"></label>
          <label class="field">Attempts before a pause <span class="small muted">per 15 minutes</span><input type="number" name="maxAttempts" min="3" max="100" value="${esc(sec.maxAttempts)}"></label></div>
        <p class="small muted" style="margin:0">Each use extends the sign-in; after 30 days it ends in any case. Passwords of 10 characters or more, kept as salted scrypt hashes; changing one ends every other sign-in. Locked out on the server: <span class="mono">node src/reset-password.js you@company.com</span>.</p>
      </form><div class="st-foot" id="secSaved">Saved as you change it.</div></section></div></div>`;
  autosave($('#joinForm', body), async (f) => {
    const b = formData(f);
    await api('/settings/signin', { method: 'PUT', body: { joinEnabled: b.joinEnabled, domains: b.domains } });
  }, $('#joinSaved', body));
  autosave($('#resetForm', body), async (f) => api('/settings/signin', { method: 'PUT', body: { reset: f.reset.value } }), $('#resetSaved', body));
  autosave($('#secForm', body), async (f) => {
    const b = formData(f);
    await api('/settings/security', { method: 'PUT', body: { sessionHours: Number(b.sessionHours), maxAttempts: Number(b.maxAttempts) } });
  }, $('#secSaved', body));
}

// ——— Get help: a support case or an enhancement request (everyone); where they go (Admins) ———
async function helpPage(body) {
  const d = await api('/help');
  const admin = can('settings.manage');
  body.innerHTML = `<div class="grid2 help-cols"><div class="stack">
    <section class="panel st-panel"><div class="st-ph"><h2>Ask for help</h2><span class="st-aside">${d.ready ? 'emailed to the team that runs Kendra' : 'kept here for the Admins'}</span></div>
      <form id="helpForm" class="st-form">
        <div class="seg st-seg"><label><input type="radio" name="kind" value="case" checked><span>Something is wrong</span></label><label><input type="radio" name="kind" value="idea"><span>An idea or enhancement</span></label></div>
        <label class="field">In a line<input name="subject" maxlength="160" required placeholder="e.g. The WIP deck has no toolchain slide"></label>
        <label class="field">Details<textarea name="details" rows="6" required placeholder="What you did, what you expected, what happened (and which POV)"></textarea></label>
        <div><button class="btn primary">Send</button></div></form></section>
    ${admin ? `<section class="panel st-panel"><div class="st-ph"><h2>Where requests go</h2><span class="st-aside">Admins only</span></div><form id="helpTo" class="st-form">
      <label class="field">Send requests to<input type="email" name="email" value="${esc(d.email ?? '')}" placeholder="support@company.com"></label>
      <p class="small muted" style="margin:0">Each request is emailed here through the email server (Settings → Email); replying answers the person who asked. Until the email server is set up, requests are kept here.</p></form><div class="st-foot" id="helpSaved">All changes are saved.</div></section>` : ''}</div>
    <section class="panel st-panel"><div class="st-ph"><h2>${admin ? 'Requests' : 'Your requests'}</h2><span class="st-aside">${d.requests.length}</span></div>
      <ul class="feed">${d.requests.map((r) => `<li><span class="icon">${r.kind === 'idea' ? '✦' : '!'}</span><div><div class="t">${esc(r.subject)}</div><div class="m">${admin ? `${esc(r.byName)} · ` : ''}${r.kind === 'idea' ? 'Enhancement' : 'Support case'} · ${r.mailed ? 'emailed' : r.error ? `<span class="warn-t">${esc(r.error)}</span>` : 'kept here'}</div></div><span class="when">${ago(r.at)}</span></li>`).join('') || '<li class="empty" style="display:block">Nothing yet.</li>'}</ul></section></div>`;
  $('#helpForm', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    const kind = e.target.querySelector('input[name="kind"]:checked').value;
    const r = await attempt(() => api('/help', { method: 'POST', body: { kind, subject: b.subject, details: b.details } }));
    if (!r) return;
    toast(r.mailed ? 'Sent: you will get the answer by email' : r.error, { bad: !r.mailed });
    helpPage(body);
  });
  if (admin) autosave($('#helpTo', body), async (f) => api('/settings/help', { method: 'PUT', body: { email: f.email.value } }), $('#helpSaved', body));
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



function roles(body, data) {
  const { matrix, permissions, labels } = data.roles;
  const roleKeys = Object.keys(matrix);
  const count = (r) => (state.users ?? []).filter((u) => u.role === r).length;
  const people = (r) => `${count(r)} ${count(r) === 1 ? 'person' : 'people'}`;
  const start = Object.fromEntries(roleKeys.map((r) => [r, Object.keys(permissions).filter((p) => matrix[r]?.includes(p))]));
  body.innerHTML = `<form id="roleForm" class="panel st-panel roles-grid">
    <div class="st-ph"><h2>Roles &amp; permissions</h2><span class="st-aside">changes apply to everyone with the role · <span class="pill">Admin</span> may do everything</span></div>
    <div class="st-filters"><input type="search" id="rQ" placeholder="Find a permission" aria-label="Find a permission"><label class="check"><input type="checkbox" id="rDiff"> Show only the differences</label>
      <span class="st-count"><button class="btn primary" id="rSave" disabled>Save role changes</button> <button type="button" class="btn ghost" id="rDiscard" disabled>Discard</button></span></div>
    <div class="table-wrap"><table><thead><tr><th>Permission</th><th class="rh">Admin<small>${people('admin')}</small></th>${roleKeys.map((r) => `<th class="rh">${esc(labels[r])}<small>${people(r)}</small></th>`).join('')}</tr></thead><tbody>
    ${Object.entries(permissions).map(([p, label]) => `<tr data-perm="${esc(p)}" data-text="${esc(`${label} ${p}`.toLowerCase())}"><td class="p"><b>${esc(label)}</b><span class="small muted mono">${esc(p)}</span></td><td class="c"><input type="checkbox" checked disabled aria-label="Admin: ${esc(label)}"></td>${roleKeys.map((r) => `<td class="c"><input type="checkbox" data-role="${r}" value="${p}" ${matrix[r]?.includes(p) ? 'checked' : ''} aria-label="${esc(labels[r])}: ${esc(label)}"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div><div class="st-foot">What people see always follows the reporting tree: themselves and everyone below them.</div></form>`;
  const now = () => Object.fromEntries(roleKeys.map((r) => [r, [...body.querySelectorAll(`input[data-role="${r}"]:checked`)].map((x) => x.value)]));
  const filter = () => {
    const q = body.querySelector('#rQ').value.toLowerCase();
    const diff = body.querySelector('#rDiff').checked;
    for (const tr of body.querySelectorAll('tr[data-perm]')) {
      const vals = [...tr.querySelectorAll('input[data-role]')].map((x) => x.checked);
      tr.hidden = Boolean((q && !tr.dataset.text.includes(q)) || (diff && vals.every((v) => v === vals[0])));
    }
  };
  const dirty = () => {
    const changed = JSON.stringify(now()) !== JSON.stringify(start);
    body.querySelector('#rSave').disabled = !changed;
    body.querySelector('#rDiscard').disabled = !changed;
  };
  body.querySelector('#rQ').addEventListener('input', filter);
  body.querySelector('#rDiff').addEventListener('change', filter);
  body.querySelector('#roleForm').addEventListener('change', (e) => e.target.matches('input[data-role]') && dirty());
  body.querySelector('#rDiscard').addEventListener('click', () => roles(body, data));
  body.querySelector('#roleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = now();
    if (await attempt(() => api('/settings/roles', { method: 'PUT', body: { matrix: m } }), 'Roles saved')) roles(body, { ...data, roles: { ...data.roles, matrix: m } });
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
const syncLine = (x) => (!x ? 'Not synced yet.' : x.ok ? `${ago(x.at)}: ${x.people} people in ${x.teams} teams · ${x.added} added, ${x.updated} changed${x.off ? `, ${x.off} turned off` : ''}` : `${ago(x.at)}: ${x.error}`);
async function linkedPage(body) {
  const l = await api('/settings/link');
  const here = l.here || location.origin;
  body.innerHTML = `<div class="grid2">
    <section class="panel"><div class="head"><h3>FTR Credits Command Center</h3>${l.ready ? '<span class="badge ok">Linked</span>' : '<span class="badge">Not linked</span>'}</div>
      <form id="linkForm" class="body stack" style="gap:12px">
        <p class="small muted" style="margin:0">Someone signed in to one opens the other already signed in, as the same person (their email): from the menu, or by opening it directly. They need an account in both, or an email of the domains under Teams and people (then they are added).</p>
        <label class="field">Its address<input name="ftrUrl" value="${esc(l.ftrUrl)}" placeholder="https://ftr.company.com" required></label>
        <label class="field">Shared key <span class="small muted">${l.hasKey ? 'set (paste a new one to replace it)' : 'paste the key the FTR command center made, or make one here'}</span><input name="key" autocomplete="off" spellcheck="false" placeholder="${l.hasKey ? '••••••••••••••••' : '43 letters and digits'}"></label>
        <div id="newKey"></div>
        <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-act="new-key">Make a new key</button>${l.ready ? '<a class="btn ghost" href="/link/ftr?to=%2F" target="_blank" rel="noopener">Try it ↗</a><button type="button" class="btn ghost danger" data-act="unlink">Unlink</button>' : ''}</div>
        ${l.at ? `<p class="small muted" style="margin:0">Set ${esc(ago(l.at))}${l.by ? ` by ${esc(l.by)}` : ''}.</p>` : ''}
      </form></section>
    <div class="stack"><section class="panel"><div class="head"><h3>Teams and people</h3>${l.lastSync ? `<span class="badge ${l.lastSync.ok ? 'ok' : 'bad'}">${l.lastSync.ok ? 'In step' : 'Failed'}</span>` : ''}</div><form id="teamForm" class="body stack" style="gap:12px">
        <label class="check"><input type="checkbox" name="teams" ${l.teams ? 'checked' : ''} ${l.ready ? '' : 'disabled'}> Take the team structure from the FTR command center <span class="small muted">every hour: who reports to whom, roles and regions</span></label>
        <label class="field">Anyone with these email domains is signed in automatically <span class="small muted">added as an Associate on their first visit from the FTR command center</span><input name="domains" value="${esc((l.domains ?? []).join(', '))}" placeholder="checkmarx.com"></label>
        <div class="row center"><button class="btn primary">Save</button><button type="button" class="btn" data-act="sync" ${l.ready ? '' : 'disabled'}>Sync now</button><span class="small muted" id="syncState">${syncLine(l.lastSync)}</span></div>
      </form></section>
    <section class="panel"><div class="head"><h3>On the FTR command center</h3></div><div class="body"><ol class="facts-list">
      <li>Settings → Linked apps: give it Kendra’s address, <span class="mono">${esc(here)}</span>.</li>
      <li>Paste the same shared key on both sides (make it on one, copy it to the other).</li>
      <li>Try it: the menu of each shows the other; opening one while signed in to the other signs you in.</li></ol>
      <p class="small muted">Each sign-in travels as a pass signed with the key, for one app, good for a minute and used once; both audit trails record it. Unlink here or there to stop it.</p></div></section></div></div>`;
  const tf = $('#teamForm', body);
  tf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(tf);
    if (await attempt(() => api('/settings/link', { method: 'PUT', body: { teams: Boolean(b.teams), domains: b.domains ?? '' } }), 'Saved')) linkedPage(body);
  });
  $('[data-act="sync"]', body).addEventListener('click', async (e) => {
    e.target.disabled = true;
    $('#syncState', body).textContent = 'Reading the FTR command center…';
    const r = await attempt(() => api('/settings/link/sync', { method: 'POST' }));
    if (r) {
      toast(r.lastSync.ok ? 'Teams in step' : r.lastSync.error);
      linkedPage(body);
    } else e.target.disabled = false;
  });
  const form = $('#linkForm', body);
  const save = async (extra = {}) => {
    const b = formData(form);
    const r = await attempt(() => api('/settings/link', { method: 'PUT', body: { ftrUrl: b.ftrUrl, ...(b.key ? { key: b.key } : {}), ...extra } }), 'Saved');
    if (r?.key) {
      $('#newKey', body).innerHTML = `<div class="notice-box"><b>The new shared key</b> (shown once): copy it into the FTR command center.<div class="row center" style="margin-top:6px"><input readonly class="mono" value="${esc(r.key)}" style="flex:1"><button type="button" class="btn sm" data-copy>Copy</button></div></div>`;
      $('[data-copy]', body).addEventListener('click', () => navigator.clipboard?.writeText(r.key).then(() => toast('Copied')));
    } else if (r) linkedPage(body);
    return r;
  };
  form.addEventListener('submit', (e) => (e.preventDefault(), save()));
  $('[data-act="new-key"]', body).addEventListener('click', async () => {
    if (l.hasKey && !(await ask('Make a new shared key? The old one stops working, so paste the new one in the FTR command center too.', { ok: 'Make a new key' }))) return;
    save({ newKey: true });
  });
  $('[data-act="unlink"]', body)?.addEventListener('click', async () => {
    if (!(await ask('Unlink the FTR command center? Signing in to one no longer signs you in to the other.', { ok: 'Unlink', danger: true }))) return;
    if (await attempt(() => api('/settings/link', { method: 'PUT', body: { remove: true } }), 'Unlinked')) linkedPage(body);
  });
}

// ——— Security & sign-in ———

// ——— Network & certificates ———
// ——— Single sign-on (SAML 2.0), as in the FTR command center ———
async function ssoPage(body) {
  const x = await api('/settings/sso');
  const chip = x.ready ? '<span class="status on"><i></i>On</span>' : x.enabled ? '<span class="status warn"><i></i>On, but CC_PUBLIC_URL is missing</span>' : '<span class="status off"><i></i>Off</span>';
  body.innerHTML = `${SAVES}<div class="grid2">
    <section class="panel st-panel"><div class="st-ph"><h2>Identity provider (SAML 2.0)</h2><span class="st-aside">${chip}</span></div>
      <form id="ssoForm" class="st-form">
        <label class="field">Sign-in URL of the identity provider (SSO URL)<input name="entryPoint" value="${esc(x.entryPoint)}" placeholder="https://login.microsoftonline.com/<tenant>/saml2"></label>
        <label class="field">Identity provider issuer (entity ID) <span class="small muted">optional, checked when given</span><input name="idpIssuer" value="${esc(x.idpIssuer)}" placeholder="https://sts.windows.net/<tenant>/"></label>
        <label class="field">Signing certificate of the identity provider <span class="small muted">PEM or base64; two for a rollover</span><textarea name="idpCert" rows="4" placeholder="${x.certificates.length ? 'Kept: paste to replace' : '-----BEGIN CERTIFICATE-----'}" spellcheck="false"></textarea></label>
        ${x.certificates.map((c) => `<div class="small muted">${esc(c.subject)} · valid until ${esc(day(c.validTo))} · <span class="mono">${esc(c.fingerprint.slice(0, 23))}…</span></div>`).join('')}
        <div class="st-cols2"><label class="field">Email attribute<input name="emailAttribute" value="${esc(x.emailAttribute)}"></label><label class="field">Name attribute<input name="nameAttribute" value="${esc(x.nameAttribute)}"></label></div>
        <label class="opt"><input type="checkbox" name="wantResponseSigned" ${x.wantResponseSigned ? 'checked' : ''}><span><b>Require the whole response signed too</b><small>Assertions must always be signed. Turn this on if your identity provider signs both.</small></span></label>
        <label class="field">Button on the sign-in page<input name="label" maxlength="60" value="${esc(x.label)}"></label>
        <label class="opt"><input type="checkbox" name="jit" ${x.jit ? 'checked' : ''}><span><b>Add people on their first sign-in</b><small>Otherwise only people with an account can sign in. They join as Associates, under the leader chosen here; never as anything more.</small></span></label>
        <label class="field">They report to<select name="jitManagerId"><option value="">Nobody yet (set on People)</option>${x.leaders.map((l) => `<option value="${esc(l.id)}" ${l.id === x.jitManagerId ? 'selected' : ''}>${esc(l.name)} · ${esc(l.role)}</option>`).join('')}</select></label>
        <label class="field">Who may still sign in with a password<select name="passwordSignIn"><option value="everyone" ${x.passwordSignIn === 'everyone' ? 'selected' : ''}>Everyone</option><option value="admins" ${x.passwordSignIn === 'admins' ? 'selected' : ''}>Admins only (a way in if the identity provider is down)</option></select></label>
        <label class="opt"><input type="checkbox" name="enabled" ${x.enabled ? 'checked' : ''}><span><b>Single sign-on is on</b></span></label>
      </form><div class="st-foot" id="ssoSaved">All changes are saved.</div></section>
    <section class="panel st-panel"><div class="st-ph"><h2>This service, for the identity provider</h2></div>
      ${x.sp ? `<dl class="st-kv"><dt>Entity ID (audience)</dt><dd class="mono">${esc(x.sp.entityId)}</dd><dt>Reply URL (ACS)</dt><dd class="mono">${esc(x.sp.acs)}</dd><dt>Sign-on URL</dt><dd class="mono">${esc(x.sp.login)}</dd><dt>Metadata</dt><dd><a href="/saml/metadata" target="_blank" rel="noopener">${esc(x.sp.metadata)}</a></dd><dt>Name ID</dt><dd class="mono">emailAddress</dd></dl>
        <p class="st-note">In your identity provider, add an enterprise application (SAML) with the Entity ID and Reply URL above, send the work email as the NameID or the email attribute, and assign the solution engineers and leaders. Then paste its SSO URL and signing certificate here.</p>` : '<div class="st-warn st-box-m">Set <b>CC_PUBLIC_URL</b> to the https address people use, and restart: the identity provider needs it.</div>'}
    </section></div>`;
  autosave($('#ssoForm', body), async (f) => {
    const fd = new FormData(f);
    const b = { entryPoint: fd.get('entryPoint'), idpIssuer: fd.get('idpIssuer'), emailAttribute: fd.get('emailAttribute'), nameAttribute: fd.get('nameAttribute'), wantResponseSigned: fd.get('wantResponseSigned') === 'on', label: fd.get('label'), jit: fd.get('jit') === 'on', jitManagerId: fd.get('jitManagerId'), passwordSignIn: fd.get('passwordSignIn'), enabled: fd.get('enabled') === 'on' };
    if (String(fd.get('idpCert') ?? '').trim()) b.idpCert = fd.get('idpCert');
    await api('/settings/sso', { method: 'PUT', body: b });
    f.idpCert.value = '';
  }, $('#ssoSaved', body), { delay: 1000 });
}

// ——— HTTPS: how the server is reached and the certificate it presents (as in the FTR command center) ———
async function httpsPanels(el) {
  const h = await api('/settings/https');
  const c = h.cert;
  const days = c?.validTo ? Math.ceil((Date.parse(c.validTo) - Date.now()) / 86400000) : null;
  el.innerHTML = `<div class="grid2" style="margin-bottom:16px">
    <section class="panel st-panel"><div class="st-ph"><h2>How the server is reached</h2><span class="st-aside"><span class="status ${h.mode === 'https' ? 'on' : 'off'}"><i></i>${h.mode === 'https' ? 'HTTPS, by Kendra' : 'HTTP only'}</span></span></div>
      <p class="st-note">${h.mode === 'https' ? `Kendra answers HTTPS itself on port ${h.port} (HTTPS=on, the container image’s default). Plain http to the same port is sent to https.` : `Kendra answers plain http on port ${h.port}: right behind a reverse proxy or load balancer that does HTTPS. Without one, start it with HTTPS=on (the container image does) so passwords never cross the network in clear.`} You are viewing this page over <b>${esc(h.viewedOver)}</b>.${h.publicUrl ? ` People use <span class="mono">${esc(h.publicUrl)}</span>.` : ' <span class="warn-t">CC_PUBLIC_URL is not set</span>: links in emails need it.'}</p></section>
    <section class="panel st-panel"><div class="st-ph"><h2>Certificate in use</h2>${c ? `<span class="st-aside"><span class="status ${c.selfSigned ? 'warn' : 'on'}"><i></i>${c.selfSigned ? 'Self-signed' : 'Trusted chain'}</span></span>` : ''}</div>
      ${c ? `<dl class="st-kv"><dt>For</dt><dd>${esc(c.subject)}</dd>${c.issuer ? `<dt>Issued by</dt><dd>${esc(c.issuer)}</dd>` : ''}${c.validTo ? `<dt>Valid until</dt><dd class="${days < 30 ? 'warn-t' : ''}">${esc(day(c.validTo))} · ${days} days</dd>` : ''}${c.names ? `<dt>Names</dt><dd class="small">${esc(c.names)}</dd>` : ''}</dl>` : `<p class="st-note">${h.mode === 'https' ? 'The certificate could not be read.' : 'No certificate in use (HTTP only).'}</p>`}
      ${h.envCert ? '<p class="st-note">From TLS_CERT_FILE / TLS_PFX_FILE: renewed by replacing those files (taken within a minute, no restart).</p>' : `<form id="certForm" class="st-form"><b>Upload your certificate</b>
        <label class="field">Certificate <span class="small muted">PEM, with its chain after it</span><textarea name="cert" rows="3" placeholder="-----BEGIN CERTIFICATE-----" spellcheck="false"></textarea></label>
        <label class="field">Private key <span class="small muted">PEM</span><textarea name="key" rows="3" placeholder="-----BEGIN PRIVATE KEY-----" spellcheck="false"></textarea></label>
        <label class="field">Key passphrase <span class="small muted">if any</span><input type="password" name="passphrase" autocomplete="off"></label>
        <div class="row"><button class="btn primary">Check and put to use</button>${h.uploaded ? '<button type="button" class="btn ghost" data-act="cert-rm">Use the self-signed one again</button>' : ''}</div></form>`}
      <div style="height:8px"></div></section></div>`;
  el.querySelector('#certForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    const r = await attempt(() => api('/settings/https/certificate', { method: 'POST', body: b }));
    if (r) {
      toast(r.live ? 'In use now' : 'Kept: in use from the next start with HTTPS on');
      httpsPanels(el);
    }
  });
  el.querySelector('[data-act="cert-rm"]')?.addEventListener('click', async () => {
    if (await attempt(() => api('/settings/https/certificate', { method: 'DELETE' }), 'Back to the self-signed certificate')) httpsPanels(el);
  });
}

async function network(body) {
  const n = await api('/settings/network');
  const net = n.network;
  const sheet = n.allowlist.map((a) => `${a.direction === 'in' ? 'IN ' : 'OUT'}  ${a.host}:${a.port}  ${a.why}`).join('\n');
  body.innerHTML = `<div id="httpsBox"></div><div class="stack">
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
  httpsPanels($('#httpsBox', body));
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
    ${SAVES}
    <section class="panel st-panel"><div class="st-ph"><h2>Update &amp; recovery</h2></div>
      <div class="st-stats">
        <div class="st-stat"><span>Running</span><b class="mono">${esc(u.current)}</b><small>${installed.has(u.current) ? 'Installed by the launcher' : 'Built into this server'}${u.signed ? ' · releases must be signed' : ''}</small></div>
        <div class="st-stat"><span>Latest published</span><b class="mono">${esc(u.available?.[0]?.version ?? '—')}</b><small>${u.updateAvailable ? `<span class="accent-t">Newer than this one</span>` : u.checkError ? `<span class="warn-t">Could not check: ${esc(u.checkError)}</span>` : 'Up to date'} · ${u.lastCheck ? `checked ${esc(ago(u.lastCheck))}` : 'not checked yet'}</small></div>
        <div class="st-stat"><span>Auto-update</span><b class="${u.auto.enabled ? 'ok-t' : 'muted'}" style="font-size:17px">${u.auto.enabled ? 'Always on the newest' : 'Off: install by hand'}</b>
          <label class="small"><input type="checkbox" id="autoOn" ${u.auto.enabled ? 'checked' : ''}> On, checking every <select id="autoEvery" style="width:auto;padding:2px 6px">${[5, 10, 15, 30, 60, 240, 1440].map((m) => `<option value="${m}" ${u.auto.everyMinutes === m ? 'selected' : ''}>${m < 60 ? `${m} min` : m === 60 ? 'hour' : m === 1440 ? 'day' : `${m / 60} h`}</option>`).join('')}</select></label>
          <small>A checked backup first; a version that fails to start is rolled back and never installed again by itself.</small></div>
      </div>
      <div class="st-box"><div class="row center" style="gap:14px;flex-wrap:wrap"><b>This installation is</b>
        <div class="seg st-seg" id="stageSeg">${[['', 'Not marked'], ['staging', 'Staging'], ['production', 'Production']].map(([v, l]) => `<label><input type="radio" name="stage" value="${v}" ${(u.stage ?? '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <p class="small muted" style="margin:8px 0 0">Not marked: it takes every published release, as it always has. Mark it <b>Staging</b> to try candidate releases first; mark the one people work on <b>Production</b>: it takes a version only once it is promoted.${u.candidates?.length ? ` Waiting for promotion: ${u.candidates.map(esc).join(', ')}.` : ''}${u.heldBack ? ` Held back: ${esc(u.heldBack)} and older (you went back from it).` : ''}</p></div>
      <div class="st-box"><div class="row center" style="gap:10px"><b>Software integrity</b><span class="status ${i?.checked && !i.ok ? 'off bad-t' : 'on'}"><i></i>${i?.checked ? (i.ok ? 'Genuine' : 'Files changed') : 'Image version'}</span><span class="spacer"></span><button class="btn sm" data-act="integrity">Check now</button></div>
        <p class="small" style="margin:8px 0 0">${i?.checked ? (i.ok ? `Every file of ${esc(u.current)} matches what was installed.` : `${i.changed.length} file${i.changed.length === 1 ? '' : 's'} changed since it was installed: <span class="mono small">${esc(i.changed.slice(0, 6).join(', '))}</span>`) : `${esc(u.current)} is the container image’s own version; its files were checked when the image was built.`} <span class="muted">Checked before it starts, every 6 hours and when you ask${i?.at ? `; last ${esc(ago(i.at))}` : ''}.</span></p></div>
      ${u.lastFailure ? `<div class="st-warn st-box-m" style="display:flex;align-items:center;gap:12px"><div><b>${esc(u.lastFailure.version)} did not start</b> and the server went back by itself; it is never installed by itself again.<div class="small muted">${esc(u.lastFailure.message ?? '')}</div></div><button class="btn sm ghost" data-act="dismiss-failure" style="margin-left:auto">Dismiss</button></div>` : ''}
      ${u.launched ? '' : '<div class="st-warn st-box-m">Not started by the launcher (npm start / the container’s command), so versions can be installed but not switched to from here.</div>'}
      <div class="row st-box-m" style="gap:8px;flex-wrap:wrap;padding-bottom:16px"><button class="btn primary" data-act="check">Check for updates</button>${u.updateAvailable && u.launched ? `<button class="btn primary" data-install="${esc(u.available[0].version)}">Install ${esc(u.available[0].version)}</button>` : ''}${u.previous && u.launched ? `<button class="btn" data-act="rollback">Go back to ${esc(u.previous)}</button>` : ''}${u.launched ? '<button class="btn" data-act="restart">Restart the server</button>' : ''}<a class="btn" href="/api/system/report" download>Download troubleshooting report</a></div>
    </section>
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
  $('[data-act="dismiss-failure"]', body)?.addEventListener('click', async () => (await attempt(() => api('/updates/dismiss-failure', { method: 'POST', body: {} }))) && again());
  $('[data-act="check"]', body).addEventListener('click', async () => (await attempt(() => api('/updates/check', { method: 'POST', body: {} }))) && again());
  $('[data-act="integrity"]', body).addEventListener('click', async () => {
    const r = await attempt(() => api('/system/integrity?now=1'));
    if (r) toast(r.integrity.checked ? (r.integrity.ok ? 'Genuine: every file matches' : 'Files changed since install') : 'The image’s own version: nothing to compare');
    again();
  });
  $('[data-act="more"]', body)?.addEventListener('click', () => ((body.dataset.more = String(shown + 10)), again()));
  const stageNow = () => body.querySelector('input[name="stage"]:checked')?.value ?? '';
  const saveAuto = () => attempt(() => api('/updates/auto', { method: 'PUT', body: { enabled: $('#autoOn').checked, everyMinutes: Number($('#autoEvery').value), stage: stageNow() } }), 'Saved');
  $('#autoOn', body).addEventListener('change', saveAuto);
  $('#autoEvery', body).addEventListener('change', saveAuto);
  for (const r of body.querySelectorAll('input[name="stage"]')) r.addEventListener('change', async () => (await saveAuto()) && again());
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
