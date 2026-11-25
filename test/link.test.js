// Linked apps: one sign-in for Kendra and the FTR Credits Command Center.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePass, readPass, newLinkKey, safePath, cleanPartnerUrl } from '../src/link.js';

test('a pass: genuine, for one app, once, for a minute', () => {
  const key = newLinkKey();
  const used = new Map();
  const pass = makePass({ key, from: 'ftr', to: 'kendra', email: 'Sam@Northwind.example', name: 'Sam' });
  assert.deepEqual(readPass(pass, { key, me: 'kendra', from: 'ftr', used }), { email: 'sam@northwind.example', name: 'Sam' });
  assert.throws(() => readPass(pass, { key, me: 'kendra', from: 'ftr', used }), /used already/);
  assert.throws(() => readPass(makePass({ key, from: 'ftr', to: 'kendra', email: 'a@b.c' }), { key: newLinkKey(), me: 'kendra', from: 'ftr', used }), /shared key/);
  assert.throws(() => readPass(makePass({ key, from: 'kendra', to: 'ftr', email: 'a@b.c' }), { key, me: 'kendra', from: 'ftr', used }), /another app/);
  assert.throws(() => readPass(makePass({ key, from: 'ftr', to: 'kendra', email: 'a@b.c', now: Date.now() - 120_000 }), { key, me: 'kendra', from: 'ftr', used }), /expired/);
  const [v, body, sig] = makePass({ key, from: 'ftr', to: 'kendra', email: 'a@b.c' }).split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), email: 'admin@x.y' })).toString('base64url');
  assert.throws(() => readPass(`${v}.${forged}.${sig}`, { key, me: 'kendra', from: 'ftr', used }), /shared key/);
  assert.throws(() => readPass('nonsense', { key, me: 'kendra', from: 'ftr', used }), /not valid/);
});

test('where a pass may land, and the other app’s address', () => {
  assert.equal(safePath('/#/insights'), '/#/insights');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'x']) assert.equal(safePath(bad), '/');
  assert.equal(cleanPartnerUrl('https://ftr.example.com/'), 'https://ftr.example.com');
  assert.equal(cleanPartnerUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.throws(() => cleanPartnerUrl('http://ftr.example.com'), /https/);
  assert.throws(() => cleanPartnerUrl('https://u:p@ftr.example.com'), /only/);
});

test('Kendra and the FTR command center: signed in to one, signed in to the other', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-link-'));
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const { createApp } = await import('../src/server.js');
  const app = createApp({ dataDir: dir, startBackground: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const H = { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' };
  try {
    // Not linked yet: the session says so, and the routes explain.
    assert.equal((await (await fetch(`${base}/api/session`)).json()).linked, null);
    assert.match(await (await fetch(`${base}/link/ftr/authorize`)).text(), /Not linked/);

    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const put = await (await fetch(`${base}/api/settings/link`, { method: 'PUT', headers: { ...H, Cookie: cookie }, body: JSON.stringify({ ftrUrl: 'https://ftr.example.com/', newKey: true }) })).json();
    assert.equal(put.ready, true);
    const key = put.key;
    assert.ok(key && key.length >= 43, 'the new key, shown once');
    const got = await (await fetch(`${base}/api/settings/link`, { headers: { Cookie: cookie } })).text();
    assert.ok(!got.includes(key), 'the key never comes back');
    assert.deepEqual((await (await fetch(`${base}/api/session`)).json()).linked, { ftr: 'https://ftr.example.com' });

    // Kendra's menu → the FTR command center, with a pass for this person.
    const go = await fetch(`${base}/link/ftr?to=%2Fcredits`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(go.status, 302);
    const loc = new URL(go.headers.get('location'));
    assert.equal(`${loc.origin}${loc.pathname}`, 'https://ftr.example.com/link/kendra/in');
    assert.equal(loc.searchParams.get('to'), '/credits');
    assert.equal(readPass(loc.searchParams.get('pass'), { key, me: 'ftr', from: 'kendra' }).email, 'admin@meridian.local');

    // The FTR command center asks who is here: the hop page, then a pass (signed in) or "nobody" (not).
    assert.match(await (await fetch(`${base}/link/ftr/authorize?to=%2F`)).text(), /authorize2/);
    const who = await fetch(`${base}/link/ftr/authorize2?to=%2F`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.match(who.headers.get('location'), /^https:\/\/ftr\.example\.com\/link\/kendra\/in\?pass=/);
    const nobody = await fetch(`${base}/link/ftr/authorize2`, { redirect: 'manual' });
    assert.equal(nobody.headers.get('location'), 'https://ftr.example.com/link/kendra/none');

    // The FTR command center vouches for someone: a Kendra session, once.
    const pass = makePass({ key, from: 'ftr', to: 'kendra', email: 'admin@meridian.local' });
    const inn = await fetch(`${base}/link/ftr/in?pass=${encodeURIComponent(pass)}&to=%2F%23%2Finsights`, { redirect: 'manual' });
    const set = inn.headers.get('set-cookie');
    assert.match(set, /^cc_session=[^;]+; HttpOnly; SameSite=Strict/);
    assert.match(await inn.text(), /url=\/#\/insights/);
    const me = await (await fetch(`${base}/api/session`, { headers: { Cookie: set.split(';')[0] } })).json();
    assert.equal(me.user.email, 'admin@meridian.local');
    const again = await fetch(`${base}/link/ftr/in?pass=${encodeURIComponent(pass)}`, { redirect: 'manual' });
    assert.ok(!again.headers.get('set-cookie'), 'a pass works once');
    // Nobody is created: an email with no Kendra account is refused.
    const stranger = await fetch(`${base}/link/ftr/in?pass=${encodeURIComponent(makePass({ key, from: 'ftr', to: 'kendra', email: 'nobody@else.example' }))}`, { redirect: 'manual' });
    assert.ok(!stranger.headers.get('set-cookie'));
    assert.match(await stranger.text(), /no Kendra account/);

    // Unlinked: nothing more.
    await fetch(`${base}/api/settings/link`, { method: 'PUT', headers: { ...H, Cookie: cookie }, body: JSON.stringify({ remove: true }) });
    assert.equal((await (await fetch(`${base}/api/session`)).json()).linked, null);
  } finally {
    app.server.close();
  }
});

test('teams from the FTR command center: roles, managers and regions; Checkmarx people signed in on arrival', async () => {
  const { Db } = await import('../src/db.js');
  const { Users } = await import('../src/users.js');
  const users = new Users(new Db(fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-dir-'))));
  users.ensureAdmin();
  const T = (id, name, parentId, leaderIds, region = '') => ({ id, name, parentId, leaderIds, region });
  const P = (id, email, role, teamId) => ({ id, email, name: email.split('@')[0], role, teamId, title: '' });
  const dir = {
    teams: [T('g', 'Global', null, ['vp']), T('emea', 'EMEA', 'g', ['lead']), T('dach', 'DACH', 'emea', ['tl'], 'DACH'), T('apac', 'APAC', 'g', [])],
    people: [P('vp', 'vp@checkmarx.com', 'executive', 'g'), P('lead', 'lead@checkmarx.com', 'leader', 'emea'), P('tl', 'tl@checkmarx.com', 'leader', 'dach'), P('se', 'se@checkmarx.com', 'se', 'dach'), P('se2', 'se2@checkmarx.com', 'se', 'apac'), P('ae', 'ae@checkmarx.com', 'sales', 'emea')],
  };
  const c = users.syncDirectory(dir);
  assert.deepEqual([c.added, c.skipped], [5, 1], 'Sales are not added');
  const u = (e) => users.list().find((x) => x.email === e);
  assert.deepEqual(['vp', 'lead', 'tl', 'se'].map((x) => u(`${x}@checkmarx.com`).role), ['vp', 'leader', 'team_lead', 'associate']);
  assert.equal(u('se@checkmarx.com').managerId, u('tl@checkmarx.com').id);
  assert.equal(u('tl@checkmarx.com').managerId, u('lead@checkmarx.com').id);
  assert.equal(u('lead@checkmarx.com').managerId, u('vp@checkmarx.com').id);
  assert.equal(u('se2@checkmarx.com').managerId, u('vp@checkmarx.com').id, 'no APAC leader: the next one up');
  assert.deepEqual([u('se@checkmarx.com').region, u('lead@checkmarx.com').region], ['DACH', 'EMEA']);
  // Someone leaves the FTR command center: turned off; nobody added by hand is touched.
  const again = users.syncDirectory({ ...dir, people: dir.people.filter((p) => p.id !== 'se2') });
  assert.equal(again.off, 1);
  assert.equal(u('se2@checkmarx.com').active, false);
  assert.equal(u('admin@meridian.local').active, true);
  // A Checkmarx address new to Kendra is added on arrival; another domain is not.
  const { added } = users.signInLinked('new.se@checkmarx.com', { name: 'New SE', domains: ['checkmarx.com'] });
  assert.equal(added, true);
  assert.equal(u('new.se@checkmarx.com').role, 'associate');
  assert.throws(() => users.signInLinked('x@other.example', { domains: ['checkmarx.com'] }), /no Kendra account/);
  users.stop?.();
});
