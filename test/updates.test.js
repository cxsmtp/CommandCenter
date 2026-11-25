import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Updater, compareVersions, readState, writeState } from '../src/updates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp, server, base;
const files = new Map();
const seen = [];
let requireToken = '';

/** A release bundle of this checkout, saying it is `version`, its server optionally broken. */
function makeBundle(version, { broken = false } = {}) {
  const stage = fs.mkdtempSync(path.join(tmp, 'stage-'));
  const top = path.join(stage, 'meridian');
  fs.mkdirSync(top);
  for (const item of ['package.json', 'src', 'public', 'node_modules']) fs.cpSync(path.join(ROOT, item), path.join(top, item), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(top, 'package.json'), 'utf8'));
  pkg.version = version;
  fs.writeFileSync(path.join(top, 'package.json'), JSON.stringify(pkg));
  if (broken) fs.writeFileSync(path.join(top, 'src', 'server.js'), 'process.exit(3);\n');
  const name = `meridian-${version}.tar.gz`;
  const file = path.join(tmp, name);
  execFileSync('tar', ['-czf', file, '-C', stage, 'meridian']);
  const buf = fs.readFileSync(file);
  return { name, buf, sums: `${createHash('sha256').update(buf).digest('hex')}  ${name}\n` };
}

function publish(releases) {
  files.clear();
  const list = releases.map(({ version, bundle, sums, sig, prerelease = false }) => {
    files.set(`/dl/${bundle.name}`, bundle.buf);
    files.set(`/dl/${version}/SHA256SUMS`, Buffer.from(sums ?? bundle.sums));
    if (sig) files.set(`/dl/${version}/SHA256SUMS.sig`, Buffer.from(sig));
    return { tag_name: `v${version}`, name: `v${version}`, body: `Release ${version}`, published_at: new Date().toISOString(), html_url: `${base}/r/${version}`, draft: false, prerelease, assets: [{ name: bundle.name, browser_download_url: `${base}/dl/${bundle.name}` }, { name: 'SHA256SUMS', browser_download_url: `${base}/dl/${version}/SHA256SUMS` }, ...(sig ? [{ name: 'SHA256SUMS.sig', browser_download_url: `${base}/dl/${version}/SHA256SUMS.sig` }] : [])] };
  });
  files.set('/repos/acme/cc/releases', Buffer.from(JSON.stringify(list)));
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upd-'));
  server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, auth: req.headers.authorization ?? '' });
    if (requireToken && req.url.startsWith('/repos/') && req.headers.authorization !== `Bearer ${requireToken}`) return res.writeHead(404).end();
    // The API's asset address answers with a redirect to the download host, as GitHub does.
    const asset = /^\/repos\/acme\/cc\/releases\/assets\/(.+)$/.exec(req.url);
    if (asset) return res.writeHead(302, { Location: `http://localhost:${server.address().port}/dl/${decodeURIComponent(asset[1])}` }).end();
    const body = files.get(req.url.split('?')[0]);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('versions compare as releases do', () => {
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('check, verify, unpack, back up, restart into the new version', async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  fs.writeFileSync(path.join(dataDir, 'users.json'), '[]');
  publish([{ version: '1.0.1', bundle: makeBundle('1.0.1') }]);
  let restarts = 0;
  const u = new Updater({ dataDir, currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, restart: () => (restarts += 1) });
  const s = await u.check();
  assert.equal(s.updateAvailable, true);
  assert.equal(s.available[0].version, '1.0.1');
  await u.install('1.0.1', { by: 'test' });
  assert.equal(restarts, 1);
  const st = readState(dataDir);
  assert.equal(st.active, '1.0.1');
  assert.equal(st.pending.version, '1.0.1');
  assert.ok(fs.existsSync(path.join(dataDir, 'app', 'versions', '1.0.1', 'src', 'server.js')));
  assert.ok(fs.existsSync(path.join(dataDir, 'backups', st.pending.backup, 'users.json')), 'the data was backed up first');
});

test('a download that does not match its checksum is refused', async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const good = makeBundle('1.0.2');
  publish([{ version: '1.0.2', bundle: good, sums: `${'0'.repeat(64)}  ${good.name}\n` }]);
  const u = new Updater({ dataDir, currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, restart: () => assert.fail('must not restart') });
  await u.check();
  await assert.rejects(u.install('1.0.2'), /does not match its published checksum/);
  assert.equal(readState(dataDir).active, undefined);
  assert.match(readState(dataDir).lastFailure.message, /checksum/);
});

test('with a public key set, only signed releases install', async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const bundle = makeBundle('1.0.3');
  publish([{ version: '1.0.3', bundle }]);
  const u = new Updater({ dataDir, currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, pubkey: pub, restart: () => {} });
  await u.check();
  await assert.rejects(u.install('1.0.3'), /not signed/);
  publish([{ version: '1.0.3', bundle, sig: sign(null, Buffer.from(bundle.sums), privateKey).toString('base64') }]);
  await u.check();
  const r = await u.install('1.0.3');
  assert.equal(r.version, '1.0.3');
});

test('downloads only come from the release service', async () => {
  const u = new Updater({ dataDir: fs.mkdtempSync(path.join(tmp, 'data-')), currentVersion: '1.0.0', repo: 'acme/cc', api: 'https://evil.example', launched: true });
  await assert.rejects(u.check(), /not the release service/);
});

test('the launcher runs the new version, and goes back by itself from one that does not start', { timeout: 90_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const port = 4800 + Math.floor(Math.random() * 500);
  const env = { ...process.env, CC_DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', CC_ADMIN_PASSWORD: 'admin-password-123' };
  // A broken version, just installed: the launcher must roll back to the built-in one.
  const broken = makeBundle('9.9.9', { broken: true });
  const dir = path.join(dataDir, 'app', 'versions', '9.9.9');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'b.tgz'), broken.buf);
  execFileSync('tar', ['-xzf', path.join(tmp, 'b.tgz'), '-C', dir, '--strip-components=1']);
  writeState(dataDir, { active: '9.9.9', previous: null, pending: { version: '9.9.9', startedAt: new Date().toISOString() } });
  const launcher = spawn(process.execPath, [path.join(ROOT, 'src', 'launcher.js')], { env, stdio: 'ignore' });
  try {
    const deadline = Date.now() + 60_000;
    let version = null;
    while (Date.now() < deadline) {
      try {
        version = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).version;
        if (version) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    assert.equal(version, own, 'the built-in version answers after the rollback');
    const st = readState(dataDir);
    assert.equal(st.active, null);
    assert.match(st.lastFailure.message, /rolled back by itself/);
    assert.ok(st.history.some((h) => h.event === 'auto-rollback'));
  } finally {
    launcher.kill('SIGTERM');
  }
});

test('auto-update: on by default, installs a new release as soon as it is found, never one that failed here', async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  publish([{ version: '1.0.5', bundle: makeBundle('1.0.5') }]);
  let restarts = 0;
  const u = new Updater({ dataDir, currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, token: '', restart: () => (restarts += 1) });
  assert.deepEqual(u.status().auto, { enabled: true, everyMinutes: 15, stage: '' });
  const r = await u.tick();
  assert.equal(r.version, '1.0.5');
  assert.equal(restarts, 1);

  // The launcher rolled 1.0.5 back: it is never installed by itself again.
  writeState(dataDir, { ...readState(dataDir), active: null, pending: null, lastFailure: { version: '1.0.5', message: 'Did not start' }, lastCheck: null });
  assert.equal(await u.tick(), null);
  assert.deepEqual(readState(dataDir).failed, ['1.0.5']);

  // Turned off: nothing installs.
  writeState(dataDir, { ...readState(dataDir), failed: [], lastFailure: null, lastCheck: null });
  u.setAuto({ enabled: false });
  assert.equal(await u.tick(), null);
  // An older choice made by the hour becomes on, every 15 minutes.
  writeState(dataDir, { ...readState(dataDir), auto: { enabled: false, hour: 3 } });
  assert.deepEqual(u.status().auto, { enabled: true, everyMinutes: 15, stage: '' });
});

test('a private repository: the token goes to the API only, never to the download host', async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const bundle = makeBundle('1.0.6');
  publish([{ version: '1.0.6', bundle }]);
  // GitHub lists private assets with an API address; the download is a redirect away.
  const list = JSON.parse(files.get('/repos/acme/cc/releases').toString());
  for (const a of list[0].assets) a.url = `${base}/repos/acme/cc/releases/assets/${encodeURIComponent(a.browser_download_url.split('/dl/')[1])}`;
  files.set('/repos/acme/cc/releases', Buffer.from(JSON.stringify(list)));
  requireToken = 'ghp_readonly';
  try {
    const anon = new Updater({ dataDir, currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, token: '' });
    await assert.rejects(anon.check(), /private.*CC_UPDATE_TOKEN/);
    seen.length = 0;
    const u = new Updater({ dataDir, currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, token: 'ghp_readonly', restart: () => {} });
    await u.check();
    const r = await u.install('1.0.6');
    assert.equal(r.version, '1.0.6');
    const downloads = seen.filter((x) => x.url.startsWith('/dl/'));
    assert.ok(downloads.length >= 2);
    assert.ok(downloads.every((x) => !x.auth), 'no token sent to the download host');
    assert.ok(seen.filter((x) => x.url.startsWith('/repos/')).every((x) => x.auth === 'Bearer ghp_readonly'));
  } finally {
    requireToken = '';
  }
});

test('staging and production: a candidate goes to Staging only, until it is promoted', async () => {
  const b = makeBundle('1.0.1');
  publish([{ version: '1.0.2', bundle: makeBundle('1.0.2'), prerelease: true }, { version: '1.0.1', bundle: b }]);
  const mk = () => new Updater({ dataDir: fs.mkdtempSync(path.join(tmp, 'data-')), currentVersion: '1.0.0', repo: 'acme/cc', api: base, launched: true, restart: () => {} });
  const prod = mk();
  prod.setAuto({ stage: 'production' });
  const p = await prod.check();
  assert.deepEqual([p.available.map((r) => r.version), p.candidates, p.stage], [['1.0.1'], ['1.0.2'], 'production']);
  const unmarked = await mk().check();
  assert.equal(unmarked.available[0].version, '1.0.1', 'not marked: as before, released versions only');
  const staging = mk();
  staging.setAuto({ stage: 'staging' });
  const s = await staging.check();
  assert.equal(s.available[0].version, '1.0.2');
  assert.equal(s.updateAvailable, true);
  assert.throws(() => staging.setAuto({ stage: 'beta' }), /Staging or Production/);
});
