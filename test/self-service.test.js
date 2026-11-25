// What people do for themselves: one-time links (forgot password, joining), Get help, Branding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../src/db.js';
import { Users } from '../src/users.js';
import { Links, imageFrom, maskEmail } from '../src/self-service.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-ss-'));

test('one-time links: kept as a hash, for one kind, once, replaced by a newer one, three an hour', () => {
  const db = new Db(tmp());
  const links = new Links(db);
  const a = links.issue('reset', 'sam@northwind.example', { userId: 'u1' });
  assert.ok(!JSON.stringify(db.read('links', [])).includes(a.token), 'only the hash is kept');
  assert.equal(links.check('reset', a.token).userId, 'u1');
  assert.equal(links.check('join', a.token), null, 'another kind');
  const b = links.issue('reset', 'sam@northwind.example', { userId: 'u1' });
  assert.equal(links.check('reset', a.token), null, 'a newer link replaces the older');
  links.consume(b.token);
  assert.equal(links.check('reset', b.token), null, 'used once');
  links.issue('reset', 'sam@northwind.example');
  assert.equal(links.maySend('reset', 'sam@northwind.example'), false, 'three an hour');
  assert.equal(maskEmail('sam@northwind.example'), 's***@northwind.example');
});

test('a new password from a link, and joining as an Associate to be reviewed', () => {
  const users = new Users(new Db(tmp()));
  users.ensureAdmin();
  const admin = users.list()[0];
  const lead = users.add({ ...admin, role: 'admin' }, { email: 'lead@northwind.example', name: 'Lead', role: 'leader', managerId: admin.id, password: 'first-password-1' });
  assert.throws(() => users.setPasswordByLink(lead.id, 'short'), /10 characters/);
  users.setPasswordByLink(lead.id, 'a-new-password-1');
  assert.equal(users.signIn('lead@northwind.example', 'a-new-password-1').user.mustChangePassword, false);
  const joined = users.addJoined({ email: 'new.se@northwind.example', name: 'New SE', managerId: lead.id, password: 'joining-password-1' });
  assert.equal(joined.role, 'associate');
  assert.equal(joined.managerId, lead.id);
  assert.ok(joined.joined && !joined.joined.reviewedAt);
  assert.throws(() => users.addJoined({ email: 'new.se@northwind.example', name: 'x', password: 'joining-password-1' }), /joined already/);
  assert.ok(users.approveJoined(joined.id, 'Admin').joined.reviewedAt);
  users.stop?.();
});

test('images for the logo and icon: small, of an image type, no script', () => {
  const png = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
  assert.equal(imageFrom(png).type, 'image/png');
  assert.throws(() => imageFrom('data:text/html;base64,PGh0bWw+'), /PNG, JPEG, SVG or WebP/);
  assert.throws(() => imageFrom(`data:image/svg+xml;base64,${Buffer.from('<svg onload="x()"/>').toString('base64')}`), /script/);
  assert.throws(() => imageFrom(`data:image/png;base64,${Buffer.alloc(210 * 1024).toString('base64')}`), /200 KB/);
});

test('the routes: options before signing in, a dead link refused, Get help kept, the logo served', async () => {
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const { createApp } = await import('../src/server.js');
  const app = createApp({ dataDir: tmp(), startBackground: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const H = { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' };
  try {
    assert.deepEqual(await (await fetch(`${base}/api/auth/options`)).json(), { reset: false, join: null, sso: null }, 'no email server, no SSO: nothing offered');
    const forgot = await fetch(`${base}/api/auth/forgot`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'nobody@northwind.example' }) });
    assert.match((await forgot.json()).message, /Check your inbox/, 'the same answer for everyone');
    assert.equal((await fetch(`${base}/api/auth/reset/check`, { method: 'POST', headers: H, body: JSON.stringify({ token: 'x'.repeat(43) }) })).status, 400);
    assert.equal((await fetch(`${base}/api/auth/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'only from Kendra’s page');

    const c = (await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) })).headers.get('set-cookie').split(';')[0];
    const A = { ...H, Cookie: c };
    const r = await (await fetch(`${base}/api/help`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'case', subject: 'The deck', details: 'It has no toolchain slide' }) })).json();
    assert.equal(r.mailed, false);
    assert.match(r.error, /kept here/);
    assert.equal((await (await fetch(`${base}/api/help`, { headers: A })).json()).requests[0].subject, 'The deck');

    const png = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
    const br = await (await fetch(`${base}/api/settings/brand`, { method: 'PUT', headers: A, body: JSON.stringify({ tagline: 'POVs that win', logo: png }) })).json();
    assert.equal(br.settings.brand.tagline, 'POVs that win');
    const logo = await fetch(`${base}/api/brand/logo`);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await logo.arrayBuffer()).toString(), 'fake-png');
    assert.equal((await (await fetch(`${base}/api/session`)).json()).settings.brand.tagline, 'POVs that win', 'shown on the sign-in page too');

    const sr = await (await fetch(`${base}/api/settings/signin`, { method: 'PUT', headers: A, body: JSON.stringify({ joinEnabled: true, domains: '@Checkmarx.com, northwind.example', reset: 'not-admins' }) })).json();
    assert.deepEqual([sr.join.enabled, sr.join.domains, sr.reset], [true, ['checkmarx.com', 'northwind.example'], 'not-admins']);
  } finally {
    app.server.close();
  }
});

test('HTTPS: an uploaded certificate is checked, kept and preferred to the self-signed one', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { makeCertificate, saveUploaded, removeUploaded, tlsOptions, certificateInfo } = await import('../src/tls.js');
  const dir = tmp();
  const env = {};
  assert.equal(tlsOptions(dir, env).selfSigned, true);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const cert = makeCertificate({ subject: { cn: 'kendra.northwind.example' }, names: ['kendra.northwind.example'], publicKey, signerKey: privateKey });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => saveUploaded(dir, { cert, key: other }), /does not belong/);
  assert.throws(() => saveUploaded(dir, { cert: 'nonsense', key }), /PEM/);
  assert.match(saveUploaded(dir, { cert, key }).subject, /kendra\.northwind\.example/);
  const now = tlsOptions(dir, env);
  assert.equal(now.selfSigned, false);
  assert.match(certificateInfo(now.load().cert).subject, /kendra\.northwind\.example/);
  removeUploaded(dir);
  assert.equal(tlsOptions(dir, env).selfSigned, true);
});
