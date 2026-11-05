// Teams: the reporting tree (VP → leaders → team leads → associates) with each person's work, and the people a
// manager may add or change below them.
import { $, esc, api, state, can, attempt, avatar, openDialog, closeDialog, formData, peopleOptions, reloadPeople, local } from '../core.js';

export async function renderTeam(main, { crumbs }) {
  crumbs('<h2 style="font-size:16px">Teams</h2>');
  await reloadPeople();
  const o = await api('/overview');
  const stats = new Map(o.people.map((p) => [p.id, p]));
  const node = (n) => {
    const s = stats.get(n.id);
    const below = countBelow(n);
    return `<li><div class="node">${avatar(n.name)}<div style="min-width:160px"><b>${esc(n.name)}</b><div class="small muted">${esc(n.roleLabel)}${n.title ? ` · ${esc(n.title)}` : ''} · ${esc(n.email)}</div></div>
      <span class="badge">${s?.opportunities ?? 0} opportunities</span><span class="badge accent">${s?.povs ?? 0} POVs</span>${s?.attention ? `<span class="badge bad">${s.attention} need attention</span>` : ''}${below ? `<span class="badge">${below} in team</span>` : ''}${n.active === false ? '<span class="badge bad">inactive</span>' : ''}
      <span class="spacer"></span>
      <button class="btn sm" data-view-person="${esc(n.id)}">View work</button>
      ${can('users.manage') && n.id !== state.session.user.id ? `<button class="btn sm" data-edit-user="${esc(n.id)}">Edit</button>` : ''}
    </div>${n.reports?.length ? `<ul class="tree">${n.reports.map(node).join('')}</ul>` : ''}</li>`;
  };
  main.innerHTML = `<div class="toolbar"><span class="muted">Everyone sees their own work and everything below them. Click “View work” to open the command center for one person and their team.</span><span class="spacer"></span>${can('users.manage') ? '<button class="btn primary" data-act="add-user">＋ Add person</button>' : ''}</div>
    <section class="panel"><div class="body"><ul class="tree">${state.tree.map(node).join('')}</ul></div></section>`;
  main.querySelector('[data-act="add-user"]')?.addEventListener('click', () => editUser(null));
  for (const b of main.querySelectorAll('[data-edit-user]')) b.addEventListener('click', () => editUser(state.users.find((u) => u.id === b.dataset.editUser)));
  for (const b of main.querySelectorAll('[data-view-person]'))
    b.addEventListener('click', () => {
      const dash = local.get('cc.dash', {});
      local.set('cc.dash', { ...dash, owner: b.dataset.viewPerson });
      location.hash = '#/dashboard';
    });
}

const countBelow = (n) => (n.reports ?? []).reduce((k, r) => k + 1 + countBelow(r), 0);

function editUser(u) {
  const roles = Object.entries(state.meta.roles).filter(([k]) => k !== 'admin' || state.session.user.role === 'admin');
  return openDialog(
    `<form id="userForm"><h2>${u ? `Edit ${esc(u.name)}` : 'Add a person'}</h2>
      <div class="row"><label class="field">Name<input name="name" value="${esc(u?.name ?? '')}" required></label><label class="field">Email<input type="email" name="email" value="${esc(u?.email ?? '')}" required></label></div>
      <div class="row"><label class="field">Role<select name="role">${roles.map(([k, l]) => `<option value="${k}" ${(u?.role ?? 'associate') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field">Reports to<select name="managerId"><option value="">— nobody (top of a tree)</option>${peopleOptions(u ? u.managerId ?? "" : state.session.user.id)}</select></label></div>
      <label class="field">Title<input name="title" value="${esc(u?.title ?? '')}" placeholder="e.g. Senior Solution Engineer, EMEA"></label>
      <label class="field">${u ? 'Set a new password (they choose their own at next sign-in)' : 'First password (they choose their own at first sign-in)'}<input name="password" type="text" minlength="10" ${u ? '' : 'required'} autocomplete="off"></label>
      ${u ? `<label class="check"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Can sign in</label>` : ''}
      <p class="form-error" id="userErr" role="alert"></p>
      <div class="dialog-actions">${u ? '<button type="button" class="btn ghost danger" id="delUser">Remove</button><span class="spacer"></span>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`,
    {
      onOpen(d) {
        d.querySelector('[data-close]').addEventListener('click', () => closeDialog());
        d.querySelector('#delUser')?.addEventListener('click', async () => {
          if (!confirm(`Remove ${u.name}? Their opportunities go to their manager and their reports move up.`)) return;
          if (await attempt(() => api(`/users/${u.id}`, { method: 'DELETE' }), 'Removed')) {
            closeDialog();
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          }
        });
        d.querySelector('#userForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = formData(e.target);
          if (u && !b.password) delete b.password;
          try {
            await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PATCH' : 'POST', body: b });
            closeDialog('ok');
            document.dispatchEvent(new CustomEvent('cc:rerender'));
          } catch (error) {
            $('#userErr').textContent = error.message;
          }
        });
      },
    },
  );
}
