// People and Teams, as in the FTR command center: who can sign in (a table to sort and filter, each person's role,
// manager, region, status and last sign-in) and the teams (the reporting tree, leader by leader).
import { esc, api, state, can, avatar, ago, local, reloadPeople, table } from '../core.js';
import { editUser } from './team.js';

const ui = local.get('cc.people', {});
const save = () => local.set('cc.people', ui);
const rerender = () => document.dispatchEvent(new CustomEvent('cc:rerender'));
const viewWork = (id) => {
  local.set('cc.dash', { ...local.get('cc.dash', {}), owner: id });
  location.hash = '#/dashboard';
};

async function load() {
  await reloadPeople();
  const o = await api('/overview').catch(() => ({ people: [] }));
  return new Map((o.people ?? []).map((p) => [p.id, p]));
}

// ——— People ———
export async function renderPeople(body, { linked = null } = {}) {
  const stats = await load();
  const me = state.session.user;
  const byId = new Map(state.users.map((u) => [u.id, u]));
  const regions = [...new Set(state.users.map((u) => u.region).filter(Boolean))].sort();
  const roles = state.meta.roles ?? {};
  const q = (ui.q ?? '').toLowerCase();
  const rows = state.users.filter((u) =>
    (!q || [u.name, u.email, u.title, u.region].some((x) => String(x ?? '').toLowerCase().includes(q))) &&
    (!ui.role || u.role === ui.role) &&
    (!ui.region || u.region === ui.region) &&
    (!ui.manager || u.managerId === ui.manager) &&
    (!ui.status || (ui.status === 'off' ? u.active === false : u.active !== false)));
  const edit = (u) => can('users.manage') && u.id !== me.id;
  const cols = [
    { label: 'Person', key: (u) => u.name, html: (u) => `<div class="person">${avatar(u.name)}<div><div class="pn"><b>${esc(u.name)}</b>${u.id === me.id ? '<span class="pill">You</span>' : ''}</div><div class="small muted">${esc(u.email)}</div></div></div>` },
    { label: 'Role', key: (u) => u.roleLabel, html: (u) => `<span class="pill">${esc(u.roleLabel)}</span>${u.title ? `<div class="small muted">${esc(u.title)}</div>` : ''}` },
    { label: 'Reports to', key: (u) => byId.get(u.managerId)?.name ?? '', html: (u) => esc(byId.get(u.managerId)?.name ?? '—') },
    { label: 'Region', key: (u) => u.region ?? '', html: (u) => esc(u.region || '—') },
    { label: 'POVs', n: true, key: (u) => stats.get(u.id)?.povs ?? 0, html: (u) => String(stats.get(u.id)?.povs ?? 0) },
    { label: 'Status', key: (u) => (u.active === false ? 1 : 0), html: (u) => (u.active === false ? '<span class="status off"><i></i>Off</span>' : '<span class="status on"><i></i>Active</span>') },
    { label: 'Last sign-in', key: (u) => u.lastSignInAt ?? '', html: (u) => (u.lastSignInAt ? `<span title="${esc(u.lastSignInMethod === 'linked' ? 'through the FTR command center' : 'with a password')}">${esc(ago(u.lastSignInAt))}</span>` : '<span class="muted">—</span>') },
    { label: '', html: (u) => `<span class="row-actions"><button class="btn sm link" data-work="${esc(u.id)}">Portfolio</button>${edit(u) ? `<button class="btn sm" data-manage="${esc(u.id)}">Manage</button>` : ''}</span>` },
  ];
  body.innerHTML = `<section class="panel st-panel">
    <div class="st-ph"><h2>People</h2><span class="st-aside">${linked ? 'kept in step with the FTR command center every hour' : 'everyone who can sign in, and what they may do'}</span>
      ${can('users.manage') ? '<button class="btn primary" data-act="add">Add person</button>' : ''}</div>
    <div class="st-filters">
      <input type="search" id="pQ" placeholder="Search people, emails, titles" value="${esc(ui.q ?? '')}" aria-label="Search people">
      <select id="pRole" aria-label="Role"><option value="">All roles</option>${Object.entries(roles).map(([k, l]) => `<option value="${k}" ${ui.role === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select id="pRegion" aria-label="Region"><option value="">All regions</option>${regions.map((r) => `<option ${ui.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <select id="pManager" aria-label="Reports to"><option value="">Reports to: anyone</option>${state.users.filter((u) => state.users.some((x) => x.managerId === u.id)).map((u) => `<option value="${esc(u.id)}" ${ui.manager === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <select id="pStatus" aria-label="Status"><option value="">Any status</option><option value="on" ${ui.status === 'on' ? 'selected' : ''}>Active</option><option value="off" ${ui.status === 'off' ? 'selected' : ''}>Off</option></select>
      <span class="st-count">${rows.length} of ${state.users.length}</span></div>
    ${table('people2', cols, rows, { empty: 'Nobody matches.' })}</section>`;
  body.querySelector('[data-act="add"]')?.addEventListener('click', () => editUser(null));
  for (const b of body.querySelectorAll('[data-manage]')) b.addEventListener('click', () => editUser(state.users.find((u) => u.id === b.dataset.manage)));
  for (const b of body.querySelectorAll('[data-work]')) b.addEventListener('click', () => viewWork(b.dataset.work));
  let t;
  body.querySelector('#pQ').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => ((ui.q = e.target.value), save(), rerender()), 250);
  });
  for (const [id, k] of [['pRole', 'role'], ['pRegion', 'region'], ['pManager', 'manager'], ['pStatus', 'status']]) body.querySelector(`#${id}`).addEventListener('change', (e) => ((ui[k] = e.target.value), save(), rerender()));
}

// ——— Teams: each leader and the people below them, as a tree ———
export async function renderTeams(body, { linked = null } = {}) {
  const stats = await load();
  const below = (n) => (n.reports ?? []).reduce((k, r) => k + 1 + below(r), 0);
  const leads = (n) => (n.reports ?? []).length > 0;
  const row = (n, depth) => {
    const povs = [n, ...flat(n)].reduce((k, x) => k + (stats.get(x.id)?.povs ?? 0), 0);
    const attention = [n, ...flat(n)].reduce((k, x) => k + (stats.get(x.id)?.attention ?? 0), 0);
    const sub = (n.reports ?? []).filter(leads);
    const direct = (n.reports ?? []).filter((r) => !leads(r));
    return `<div class="team-row" style="--d:${depth}">${depth ? '<span class="team-elbow" aria-hidden="true"></span>' : ''}
        <div class="team-name"><b>${esc(n.name)}’s team</b>${n.region ? ` <span class="small muted">${esc(n.region)}</span>` : ''}<div class="small muted">Led by ${esc(n.name)} · ${esc(n.roleLabel)}${direct.length ? ` · ${direct.map((r) => esc(r.name)).slice(0, 4).join(', ')}${direct.length > 4 ? ` and ${direct.length - 4} more` : ''}` : ''}</div></div>
        <span class="small muted">${below(n)} people · ${povs} POV${povs === 1 ? '' : 's'}${attention ? ` · <span class="bad-t">${attention} need attention</span>` : ''}</span>
        <button class="btn sm link" data-work="${esc(n.id)}">Portfolio</button>
        ${can('users.manage') && n.id !== state.session.user.id ? `<button class="btn sm" data-manage="${esc(n.id)}">Edit</button>` : ''}
      </div>${sub.map((r) => row(r, depth + 1)).join('')}`;
  };
  const flat = (n) => (n.reports ?? []).flatMap((r) => [r, ...flat(r)]);
  const tops = (state.tree ?? []).filter(leads);
  const alone = (state.tree ?? []).filter((n) => !leads(n));
  body.innerHTML = `<section class="panel st-panel teams">${tops.map((n) => row(n, 0)).join('') || '<p class="muted pad">Nobody leads a team yet: set who reports to whom on People.</p>'}
    ${alone.length ? `<div class="team-row loose"><div class="team-name"><b>Not in a team</b><div class="small muted">${alone.map((n) => esc(n.name)).join(', ')}</div></div><span class="small muted">${alone.length} people</span></div>` : ''}</section>
    <p class="small muted" style="margin-top:10px">${linked ? 'Teams come from the FTR command center (Settings → Linked apps) every hour: its leaders and who is in each team.' : 'A team is a leader and everyone below them: set who reports to whom on People.'} Everyone sees their own work and everything below them.</p>`;
  for (const b of body.querySelectorAll('[data-manage]')) b.addEventListener('click', () => editUser(state.users.find((u) => u.id === b.dataset.manage)));
  for (const b of body.querySelectorAll('[data-work]')) b.addEventListener('click', () => viewWork(b.dataset.work));
}
