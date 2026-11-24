// Encryption at rest, self-repair, checked backups and restore, encrypted video seeking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Db } from '../src/db.js';
import { Vault } from '../src/vault.js';
import { Backups } from '../src/backups.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrdn-'));

test('every record is encrypted on disk, and a record written before encryption still reads', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify({ old: 'plain' }));
  const db = new Db(dir);
  assert.deepEqual(db.read('legacy', null), { old: 'plain' });
  db.write('people', [{ name: 'Priya Rao', email: 'priya@acme.example' }]);
  const raw = fs.readFileSync(path.join(dir, 'people.json'));
  assert.ok(Vault.isEncrypted(raw));
  assert.ok(!raw.includes('Priya'), 'no plain text on disk');
  assert.deepEqual(new Db(dir).read('people', []), [{ name: 'Priya Rao', email: 'priya@acme.example' }]);
});

test('a damaged record repairs itself from its previous copy, then from a backup', () => {
  const dir = tmp();
  const db = new Db(dir);
  db.write('notes', ['one']);
  db.write('notes', ['one', 'two']);
  fs.writeFileSync(path.join(dir, 'notes.json'), 'garbage');
  const again = new Db(dir);
  assert.deepEqual(again.read('notes', []), ['one'], 'from notes.json.prev');
  assert.equal(again.repairs[0].from, 'its previous copy');

  const backups = new Backups({ dataDir: dir, vault: again.vault });
  again.write('notes', ['from backup']);
  backups.take('auto');
  fs.writeFileSync(path.join(dir, 'notes.json'), 'garbage');
  fs.writeFileSync(path.join(dir, 'notes.json.prev'), 'garbage');
  const third = new Db(dir);
  assert.deepEqual(third.read('notes', []), ['from backup']);
  assert.match(third.repairs[0].from, /^backup .*-auto$/);
});

test('backups: checked when taken, never hold the key, copied off the server, and restore with an undo', () => {
  const dir = tmp();
  const off = tmp();
  const db = new Db(dir);
  db.write('opportunities', [{ id: 'a' }]);
  fs.mkdirSync(path.join(dir, 'snapshots'));
  fs.writeFileSync(path.join(dir, 'snapshots', 'x.json'), '{}');
  const b = new Backups({ dataDir: dir, vault: db.vault, offsiteDir: off });
  const name = b.take('manual');
  const [listed] = b.list();
  assert.equal(listed.name, name);
  assert.equal(listed.verified, true);
  assert.equal(listed.offsite, true);
  assert.ok(!fs.existsSync(path.join(b.root, name, 'secret.key')), 'the key is never in a backup');
  assert.ok(!fs.existsSync(path.join(b.root, name, 'snapshots')), 'snapshots are read again, not backed up');

  db.write('opportunities', [{ id: 'a' }, { id: 'b' }]);
  const r = b.restore(name);
  assert.deepEqual(new Db(dir).read('opportunities', []), [{ id: 'a' }]);
  assert.ok(b.list().some((x) => x.name === r.undo), 'the data before the restore is kept');

  // A backup changed after it was taken is refused.
  fs.appendFileSync(path.join(b.root, name, 'opportunities.json'), 'x');
  assert.equal(b.verify(name).ok, false);
  assert.throws(() => b.restore(name), /cannot be restored/);
});

test('encrypted videos can be read from any byte, for seeking', async () => {
  const dir = tmp();
  const v = new Vault(dir);
  const plain = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const file = path.join(dir, 'v.mp4');
  await new Promise((res, rej) => Readable.from([plain.subarray(0, 1234), plain.subarray(1234)]).pipe(v.encryptingStream()).pipe(fs.createWriteStream(file)).on('finish', res).on('error', rej));
  assert.ok(!fs.readFileSync(file).includes(plain.subarray(100, 140)));
  assert.equal(v.plainSize(file), 5000);
  const read = async (s, e) => Buffer.concat(await v.readStream(file, s, e).toArray());
  assert.deepEqual(await read(0, 4999), plain);
  assert.deepEqual(await read(17, 300), plain.subarray(17, 301));
  assert.deepEqual(await read(4095, 4999), plain.subarray(4095));
  assert.deepEqual(v.decrypt(fs.readFileSync(file)), plain);
});

test('a password can be reset from the server console when nobody can sign in', async () => {
  const { execFileSync } = await import('node:child_process');
  const { createApp } = await import('../src/server.js');
  const dir = tmp();
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const app = createApp({ dataDir: dir, startBackground: false });
  app.server.close();
  const out = execFileSync(process.execPath, ['src/reset-password.js', 'Admin@Meridian.local'], { env: { ...process.env, CC_DATA_DIR: dir }, encoding: 'utf8' });
  const pw = /password for admin@meridian\.local:\s+(\S+)/.exec(out)?.[1];
  assert.ok(pw, out);
  // A server started afterwards (the restart) takes it; the person must choose their own.
  const again = createApp({ dataDir: dir, startBackground: false });
  await new Promise((r) => again.server.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${again.server.address().port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@meridian.local', password: pw }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user.mustChangePassword, true);
    assert.ok(again.audit.list({ limit: 5 }).some((e) => /reset from the server console/.test(e.what)));
  } finally {
    again.server.close();
  }
  assert.throws(() => execFileSync(process.execPath, ['src/reset-password.js', 'nobody@x.com'], { env: { ...process.env, CC_DATA_DIR: dir }, stdio: 'pipe' }));
});

test('the audit trail: chained, encrypted, sealed by day, carried on after a restart, and any change shows', async () => {
  const { Trail } = await import('../src/trail.js');
  const dir = tmp();
  const vault = new Vault(dir);
  const t = new Trail({ dataDir: dir, vault });
  t.change({ by: 'u1', byName: 'Vera', type: 'people', what: 'Added Sam' });
  t.access({ by: 'u1', byName: 'Vera', method: 'GET', path: '/api/overview', status: 200 });
  t.stop();
  const day = new Date().toISOString().slice(0, 10);
  const raw = fs.readFileSync(path.join(dir, 'audit', 'changes', `${day}.log`), 'utf8');
  assert.ok(!raw.includes('Added Sam'), 'encrypted on disk');

  // A restart carries the chain on.
  const t2 = new Trail({ dataDir: dir, vault });
  t2.change({ by: 'u1', byName: 'Vera', type: 'people', what: 'Added Ana' });
  assert.deepEqual(t2.verify('changes'), { ok: true, records: 2, from: t2.verify('changes').from });
  assert.deepEqual(t2.query('changes').records.map((r) => r.what), ['Added Ana', 'Added Sam']);
  assert.equal(t2.query('access').records[0].path, '/api/overview');

  // Sealing a day keeps every record and the chain.
  t2.maintain(Date.now() + 86_400_000);
  assert.ok(fs.existsSync(path.join(dir, 'audit', 'changes', `${day}.arc`)));
  assert.equal(t2.verify('changes').ok, true);
  t2.stop();

  // A record removed from the middle breaks the chain.
  const t3dir = tmp();
  const v3 = new Vault(t3dir);
  const t3 = new Trail({ dataDir: t3dir, vault: v3 });
  for (const w of ['a', 'b', 'c']) t3.change({ what: w });
  t3.stop();
  const f = path.join(t3dir, 'audit', 'changes', `${day}.log`);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  fs.writeFileSync(f, `${lines[0]}\n${lines[2]}\n`);
  const t4 = new Trail({ dataDir: t3dir, vault: v3 });
  const v = t4.verify('changes');
  assert.equal(v.ok, false);
  assert.match(v.reason, /missing/);
  t4.stop();
});

test('the audit trail starts the next day: yesterday’s records carry the chain on (the server once failed to start here)', async (t) => {
  const { Trail } = await import('../src/trail.js');
  const dir = tmp();
  const vault = new Vault(dir);
  const day1 = new Trail({ dataDir: dir, vault });
  day1.change({ by: 'u1', byName: 'Vera', type: 'people', what: 'Added Sam' });
  day1.stop();
  // The next morning the server starts again.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 86_400_000 });
  const day2 = new Trail({ dataDir: dir, vault });
  day2.change({ by: 'u1', byName: 'Vera', type: 'people', what: 'Added Kim' });
  day2.stop();
  t.mock.timers.reset();
  const v = day2.verify('changes');
  assert.equal(v.ok, true);
  assert.equal(v.records, 2);
});

test('a sign-in survives a restart; sign-out and a password change end sessions everywhere else', async () => {
  const { Users } = await import('../src/users.js');
  const dir = tmp();
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const db1 = new Db(dir);
  const u1 = new Users(db1);
  u1.ensureAdmin?.();
  const admin = db1.read('users', [])[0];
  const a = u1.signIn(admin.email, 'admin-password-123');
  const b = u1.signIn(admin.email, 'admin-password-123');
  u1.stop();
  // The server restarts (an update, a crash): the same browser is still signed in.
  const u2 = new Users(new Db(dir));
  assert.equal(u2.fromToken(a.token)?.id, admin.id);
  assert.ok(u2.expiresAt(a.token));
  // A password change keeps this session and ends the other.
  u2.changePassword(admin.id, 'admin-password-123', 'a-brand-new-password', a.token);
  assert.ok(u2.fromToken(a.token));
  assert.equal(u2.fromToken(b.token), null);
  u2.signOut(a.token);
  u2.stop();
  const u3 = new Users(new Db(dir));
  assert.equal(u3.fromToken(a.token), null, 'signed out stays signed out after a restart');
  u3.stop();
});

test('a changed encryption key never wipes the accounts: Meridian refuses to start and says why', async () => {
  const dir = tmp();
  const saved = process.env.CC_SECRET;
  try {
    process.env.CC_SECRET = 'the-original-secret';
    const db = new Db(dir);
    db.write('users', [{ id: 'u1', email: 'a@x.com' }]);
    db.write('opportunities', [{ id: 'o1' }]);
    assert.ok(fs.existsSync(path.join(dir, 'key.fingerprint')));
    // Started again without its secret (or with another one).
    process.env.CC_SECRET = 'a-different-secret';
    assert.throws(() => new Db(dir), (e) => e.code === 'STATE' && e.exitCode === 78 && /original key/.test(e.message));
    // Old data without the fingerprint file: the key must still open the accounts.
    fs.rmSync(path.join(dir, 'key.fingerprint'));
    assert.throws(() => new Db(dir), (e) => e.code === 'STATE');
    // The right key: everything is there.
    process.env.CC_SECRET = 'the-original-secret';
    assert.equal(new Db(dir).read('users', []).length, 1);
    // A damaged accounts file with no good copy stops the start instead of becoming an empty list.
    fs.writeFileSync(path.join(dir, 'opportunities.json'), 'garbage');
    fs.rmSync(path.join(dir, 'opportunities.json.prev'), { force: true });
    assert.throws(() => new Db(dir).read('opportunities', []), (e) => e.code === 'STATE' && /opportunities\.json/.test(e.message));
  } finally {
    if (saved === undefined) delete process.env.CC_SECRET;
    else process.env.CC_SECRET = saved;
  }
});

test('one server per data folder, crash leftovers cleared, Node.js checked, Admins emailed about trouble and recovery', async () => {
  const { lockDataDir, preflight, nodeSatisfies, AdminAlerts } = await import('../src/stability.js');
  const dir = tmp();
  // Another live server holds the folder: refused. A dead one's lock is taken over.
  fs.writeFileSync(path.join(dir, 'instance.lock'), JSON.stringify({ pid: process.ppid, host: (await import('node:os')).hostname(), at: Date.now() }));
  assert.throws(() => lockDataDir(dir), (e) => e.code === 'STATE' && /Another Meridian/.test(e.message));
  fs.writeFileSync(path.join(dir, 'instance.lock'), JSON.stringify({ pid: 999999, host: (await import('node:os')).hostname(), at: Date.now() }));
  const release = lockDataDir(dir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'instance.lock'), 'utf8')).pid, process.pid);
  release();
  assert.ok(!fs.existsSync(path.join(dir, 'instance.lock')));
  // Half-saved files from a crash (older than 10 minutes) go; fresh ones stay.
  const old = path.join(dir, 'users.json.123.abc123.tmp');
  fs.writeFileSync(old, 'x');
  fs.utimesSync(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  fs.writeFileSync(path.join(dir, 'fresh.json.1.aa.tmp'), 'x');
  const notes = preflight(dir);
  assert.ok(!fs.existsSync(old) && fs.existsSync(path.join(dir, 'fresh.json.1.aa.tmp')));
  assert.ok(notes.some((n) => /half-saved/.test(n)));
  assert.equal(nodeSatisfies('>=20', '22.1.0'), true);
  assert.equal(nodeSatisfies('>=24', '22.1.0'), false);
  // The Admins: told once a check is bad twice in a row, told again when it works, and of self-fixes.
  const db = new Db(tmp());
  const sent = [];
  let level = 'bad';
  const corrections = [];
  const alerts = new AdminAlerts({ db, org: 'Meridian', mailer: { configured: true, send: async (m) => sent.push(m) }, admins: () => ['ops@x.com'], checks: () => [{ key: 'backup', label: 'Backups', level, text: 'The last backup failed.', fix: 'Check the disk.' }], corrections: () => corrections });
  await alerts.tick();
  assert.equal(sent.length, 0, 'not on the first bad check');
  await alerts.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Needs attention — Backups[\s\S]*Check the disk/);
  await alerts.tick();
  assert.equal(sent.length, 1, 'told once');
  level = 'ok';
  await alerts.tick();
  assert.match(sent[1].body, /Working again — Backups/);
  corrections.unshift({ at: new Date().toISOString(), what: 'Memory high', action: 'restarted cleanly' });
  await alerts.tick();
  assert.match(sent[2].body, /Fixed by itself — Memory high/);
});

test('backups link what never changes, and a restore is put in place at the next start', async () => {
  const dir = tmp();
  const db = new Db(dir);
  db.write('opportunities', [{ id: 'o1', customer: 'Before' }]);
  fs.mkdirSync(path.join(dir, 'demos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demos', 'video.bin'), Buffer.alloc(200_000, 7));
  const b = new Backups({ dataDir: dir, vault: db.vault });
  const first = b.take('manual');
  const second = b.take('manual');
  const v1 = fs.statSync(path.join(dir, 'backups', first, 'demos', 'video.bin'));
  const v2 = fs.statSync(path.join(dir, 'backups', second, 'demos', 'video.bin'));
  assert.equal(v1.ino, v2.ino, 'the video is linked, not copied again');
  assert.equal(b.manifest(second).files['demos/video.bin'].sha256, b.manifest(first).files['demos/video.bin'].sha256);
  // A staged restore changes nothing now; the next start puts it in place before anything is read.
  db.write('opportunities', [{ id: 'o1', customer: 'After' }]);
  const r = b.restore(first, { staged: true });
  assert.equal(r.staged, true);
  assert.equal(new Db(dir).read('opportunities', [])[0].customer, 'After');
  assert.equal(new Backups({ dataDir: dir, vault: db.vault }).applyPending(), first);
  assert.equal(new Db(dir).read('opportunities', [])[0].customer, 'Before');
  assert.equal(new Backups({ dataDir: dir, vault: db.vault }).applyPending(), null, 'applied once');
});

test('the troubleshooting report: everything to see what went wrong, and no secrets', async () => {
  const dir = tmp();
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const { createApp } = await import('../src/server.js');
  const app = createApp({ dataDir: dir, startBackground: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'X-Requested-With': 'Meridian', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const r = await fetch(`${base}/api/system/report`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const text = await r.text();
    const rep = JSON.parse(text);
    assert.ok(rep.version && rep.checks.length && 'signedIn' in rep && Array.isArray(rep.recentErrors));
    assert.ok(!text.includes('admin-password-123') && !text.includes(cookie.split('=')[1]), 'no passwords or session tokens');
    const h = await (await fetch(`${base}/healthz`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.signedIn, 1);
  } finally {
    app.server.close();
  }
});

test('the template’s own slides: items found through groups, boxed by exact name (never by prefix)', async () => {
  const { textShapes, markShapes } = await import('../src/wip.js');
  const sp = (name, x, y) => `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="500000" cy="180000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${name}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const xml = `<p:spTree>${sp('GitHub', 100, 100)}<p:grpSp><p:grpSpPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="2000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></p:grpSpPr>${sp('GitHub Copilot', 10, 20)}${sp('BitBucket Pipeline', 30, 40)}</p:grpSp></p:spTree>`;
  const shapes = textShapes(xml);
  const copilot = shapes.find((s) => s.text === 'GitHub Copilot');
  assert.deepEqual([copilot.x, copilot.y, copilot.w], [1000020, 2000040, 1000000], 'the group’s offset and scale applied');
  const boxes = markShapes(shapes, ['GitHub Copilot', 'Bitbucket Pipelines']);
  assert.equal((boxes.match(/<p:sp>/g) ?? []).length, 2, 'Copilot and the pipeline (plural or not), not GitHub');
});
