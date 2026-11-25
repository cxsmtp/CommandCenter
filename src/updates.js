/**
 * Updates: Kendra replaces its own code with a published release, without anyone signing in to the server.
 *
 *   check     the repository's releases (GitHub, CC_UPDATE_REPO), newest first, every 15 minutes (an Admin can
 *             change it, 5 to 1440) and on request. A private repository needs CC_UPDATE_TOKEN (or
 *             CC_UPDATE_TOKEN_FILE): a read-only GitHub token, sent to api.github.com only, never to a download host
 *   install   download the release's app bundle, check it against the release's SHA256SUMS (and, when
 *             CC_UPDATE_PUBKEY is set, the Ed25519 signature of that file), back up the data folder, unpack it
 *             beside the others and ask the launcher (src/launcher.js) to restart into it
 *   verify    the launcher waits for the new version to answer /healthz; if it does not within a minute, it goes
 *             back to the version before by itself, and the failure is recorded here
 *   rollback  any time, to the version before (or the one built into the image)
 *   auto      on unless an Admin turns it off: the newest release is installed as soon as it is found (every push
 *             to main publishes one, see .github/workflows/release.yml). A version that failed to start here is never
 *             installed by itself again, and going back by hand holds that version (and older) back until a newer
 *             release comes
 *
 * Everything lives under <data>/app: versions/<version>/ (one folder per release), state.json (which one runs,
 * which ran before, what was tried) and <data>/backups/ (a copy of the data before each update; the last 5 kept).
 */
import { nodeSatisfies, writeManifest } from './stability.js';
import fs from 'node:fs';
import { Backups } from './backups.js';
import path from 'node:path';
import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './db.js';

const run = promisify(execFile);
export const RESTART_CODE = 75; // the launcher restarts the server on this exit code
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const AUTO_DEFAULT = { enabled: true, everyMinutes: 15 };
const KEEP_VERSIONS = 3;
const HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'codeload.github.com']);

/** Compare two versions: -1, 0, 1 (a pre-release sorts before its release). */
export function compareVersions(a, b) {
  const [ma, pa = ''] = String(a).split('-');
  const [mb, pb = ''] = String(b).split('-');
  const x = ma.split('.').map(Number);
  const y = mb.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa > pb ? 1 : -1;
}

export function readState(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'app', 'state.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(dataDir, state) {
  const dir = path.join(dataDir, 'app');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'state.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class Updater {
  #dataDir;
  #current;
  #repo;
  #api;
  #pubkey;
  #fetch;
  #restart;
  #timer = null;
  #busy = null;
  #token;
  launched;

  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {string} o.currentVersion  the version running now
   * @param {() => void} [o.restart]   ask the launcher for a restart (exit with RESTART_CODE)
   */
  constructor({ dataDir, currentVersion, repo = process.env.CC_UPDATE_REPO || 'cxsmtp/CommandCenter', api = process.env.CC_UPDATE_API || 'https://api.github.com', pubkey = process.env.CC_UPDATE_PUBKEY || '', fetchFn = fetch, token = null, restart = () => setTimeout(() => process.exit(RESTART_CODE), 300), launched = process.env.CC_LAUNCHED === '1' }) {
    this.#dataDir = dataDir;
    this.#current = currentVersion;
    this.#repo = repo;
    this.#api = api.replace(/\/+$/, '');
    this.#pubkey = pubkey;
    this.#fetch = fetchFn;
    this.#restart = restart;
    this.launched = launched;
    this.#token = tokenFrom(token);
  }

  get state() {
    return readState(this.#dataDir);
  }

  /** The notice of a version that did not start, put away (it stays in the history, and is never installed by itself). */
  dismissFailure() {
    const v = this.state.lastFailure?.version ?? null;
    this.#save({ lastFailure: null });
    return v;
  }

  #save(patch) {
    const next = { ...this.state, ...patch };
    writeState(this.#dataDir, next);
    return next;
  }

  #log(entry) {
    const s = this.state;
    const history = [...(s.history ?? []), { at: new Date().toISOString(), ...entry }].slice(-50);
    this.#save({ history });
  }

  /** What Settings → Updates shows. */
  status() {
    const s = this.state;
    const newest = (s.available ?? [])[0] ?? null;
    return {
      current: this.#current,
      launched: this.launched,
      repo: this.#repo,
      signed: Boolean(this.#pubkey),
      clockSkewMs: this.clockSkewMs ?? null,
      active: s.active ?? null,
      previous: s.previous ?? null,
      lastCheck: s.lastCheck ?? null,
      checkError: s.checkError ?? null,
      available: (s.available ?? []).map((r) => ({ ...r, newer: compareVersions(r.version, this.#current) > 0 })),
      updateAvailable: Boolean(newest && compareVersions(newest.version, this.#current) > 0),
      auto: autoOf(s),
      failed: s.failed ?? [],
      heldBack: s.heldBack ?? null,
      token: Boolean(this.#token),
      pending: s.pending ?? null,
      // A version that failed is no news once a newer one runs, or once an Admin dismissed it.
      lastFailure: s.lastFailure && compareVersions(s.lastFailure.version, this.#current) > 0 ? s.lastFailure : null,
      busy: Boolean(this.#busy),
      history: [...(s.history ?? [])].reverse().slice(0, 20),
      installed: this.#installed(),
    };
  }

  #installed() {
    try {
      return fs.readdirSync(path.join(this.#dataDir, 'app', 'versions')).filter((v) => VERSION_RE.test(v)).sort(compareVersions).reverse();
    } catch {
      return [];
    }
  }

  setAuto({ enabled, everyMinutes }) {
    const before = autoOf(this.state);
    const m = Math.trunc(Number(everyMinutes));
    return this.#save({ auto: { enabled: enabled === undefined ? before.enabled : Boolean(enabled), everyMinutes: m >= 5 && m <= 1440 ? m : before.everyMinutes } }).auto;
  }

  /** Only the release service's own hosts (or this machine, outside production, for tests). */
  #checkUrl(raw) {
    const url = new URL(raw);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && process.env.NODE_ENV !== 'production';
    if (!(url.protocol === 'https:' && HOSTS.has(url.hostname)) && !(local && url.protocol === 'http:')) throw fail(400, `Refused to download from ${url.host}: not the release service.`);
    return url;
  }

  async #get(url, { json = false, accept } = {}) {
    // Redirects are followed by hand: each hop must be the release service, and the token goes to the API host only.
    const apiHost = new URL(this.#api).host;
    let at = this.#checkUrl(url);
    let r;
    for (let hop = 0; hop < 5; hop += 1) {
      const headers = { 'User-Agent': 'Kendra-updater', Accept: accept ?? (json ? 'application/vnd.github+json' : 'application/octet-stream') };
      if (this.#token && at.host === apiHost) headers.Authorization = `Bearer ${this.#token}`;
      // A dropped connection (a reused one the far side had just closed) is tried once more before it counts.
      const once = () => this.#fetch(at, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      r = await once().catch((e) => (e?.name === 'TimeoutError' ? Promise.reject(e) : new Promise((ok) => setTimeout(ok, 500)).then(once)));
      // The server's clock against GitHub's: sign-ins, certificates and the audit trail rely on it.
      const theirs = Date.parse(r.headers?.get?.('date') ?? '');
      if (Number.isFinite(theirs)) this.clockSkewMs = Date.now() - theirs;
      if (![301, 302, 303, 307, 308].includes(r.status)) break;
      at = this.#checkUrl(new URL(r.headers.get('location'), at));
    }
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') throw fail(503, `GitHub’s hourly limit for servers that do not sign in is used up${this.#token ? '' : '; set CC_UPDATE_TOKEN (a read-only GitHub token) to lift it'}.`);
    if ((r.status === 404 || r.status === 401 || r.status === 403) && !this.#token && at.host === apiHost) throw fail(502, `GitHub answered ${r.status}: the repository is private. Set CC_UPDATE_TOKEN to a read-only GitHub token (Contents: read) so this server can see its releases.`);
    if (!r.ok) throw fail(502, `The release service answered ${r.status} for ${at.pathname}.`);
    return json ? r.json() : Buffer.from(await r.arrayBuffer());
  }

  /** The published releases, newest first: { version, name, notes, publishedAt, url, bundle, sums, sig }. */
  async check() {
    try {
      const list = await this.#get(`${this.#api}/repos/${this.#repo}/releases?per_page=20`, { json: true });
      const available = (Array.isArray(list) ? list : [])
        .filter((r) => !r.draft && !r.prerelease)
        .map((r) => {
          const version = String(r.tag_name ?? '').replace(/^v/, '');
          // With a token, assets come through the API (the only way for a private repository); without, the public link.
          const found = (re) => (r.assets ?? []).find((a) => re.test(a.name));
          const asset = (re) => {
            const a = found(re);
            return a ? (this.#token && a.url ? a.url : a.browser_download_url) : null;
          };
          return { version, name: String(r.name ?? r.tag_name ?? '').slice(0, 120), notes: String(r.body ?? '').slice(0, 4000), publishedAt: r.published_at ?? null, url: r.html_url ?? null, bundle: asset(/^(meridian|commandcenter)-.*\.tar\.gz$/), bundleName: found(/^(meridian|commandcenter)-.*\.tar\.gz$/)?.name ?? '', sums: asset(/^SHA256SUMS$/), sig: asset(/^SHA256SUMS\.sig$/) };
        })
        .filter((r) => VERSION_RE.test(r.version) && r.bundle && r.sums)
        .sort((a, b) => compareVersions(b.version, a.version));
      this.#save({ available, lastCheck: new Date().toISOString(), checkError: null });
      return this.status();
    } catch (error) {
      this.#save({ lastCheck: new Date().toISOString(), checkError: String(error.message).slice(0, 300) });
      throw error;
    }
  }

  /** Install a version (the newest when none is named) and restart into it. */
  install(version, { by = '' } = {}) {
    if (!this.launched) throw fail(409, 'Updates need the launcher: start Kendra with "npm start" or the container image.');
    if (this.#busy) throw fail(409, 'An update is already running.');
    this.#busy = this.#install(version, by).finally(() => {
      this.#busy = null;
    });
    return this.#busy;
  }

  async #install(version, by) {
    const s = this.state;
    const release = version ? (s.available ?? []).find((r) => r.version === version) : (s.available ?? [])[0];
    if (!release) throw fail(404, 'That version is not among the published releases. Check for updates first.');
    if (release.version === this.#current) throw fail(409, `${release.version} is already running.`);
    const dir = path.join(this.#dataDir, 'app', 'versions', release.version);
    try {
      if (!fs.existsSync(path.join(dir, 'src', 'server.js'))) {
        const [bundle, sums, sig] = await Promise.all([this.#get(release.bundle), this.#get(release.sums), release.sig ? this.#get(release.sig) : null]);
        // The signature (when a key is set) vouches for SHA256SUMS; SHA256SUMS vouches for the bundle.
        if (this.#pubkey) {
          if (!sig) throw fail(400, 'This release is not signed, and this server only installs signed releases.');
          const ok = verifySig(null, sums, createPublicKey(this.#pubkey), Buffer.from(sig.toString('utf8').trim(), 'base64'));
          if (!ok) throw fail(400, 'The release signature does not match: not installed.');
        }
        const name = release.bundleName || new URL(release.bundle).pathname.split('/').pop();
        const line = sums.toString('utf8').split('\n').find((l) => l.trim().endsWith(name));
        const want = line?.trim().split(/\s+/)[0]?.toLowerCase();
        const got = createHash('sha256').update(bundle).digest('hex');
        if (!want || want !== got) throw fail(400, `The download does not match its published checksum: not installed.`);
        await this.#unpack(bundle, dir);
      }
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.version !== release.version) throw fail(400, `The bundle says it is ${pkg.version}, not ${release.version}: not installed.`);
      if (!nodeSatisfies(pkg.engines?.node)) throw fail(409, `Version ${release.version} needs Node.js ${pkg.engines.node}; this server runs ${process.versions.node}. Update the container image (podman pull), then it installs.`);
      // Every file fingerprinted: the launcher checks them before each start and refuses a version that was changed.
      writeManifest(dir);
      const backup = this.backup(`before-${release.version}`);
      this.#save({ previous: this.state.active ?? null, active: release.version, pending: { version: release.version, from: this.#current, startedAt: new Date().toISOString(), by, backup } });
      this.#log({ event: 'install', version: release.version, from: this.#current, by, backup });
      this.#prune();
      this.#restart();
      return { version: release.version, restarting: true };
    } catch (error) {
      this.#log({ event: 'failed', version: release.version, by, message: String(error.message).slice(0, 300) });
      this.#save({ lastFailure: { at: new Date().toISOString(), version: release.version, message: String(error.message).slice(0, 300) }, failed: [...new Set([...(this.state.failed ?? []), release.version])].slice(-20) });
      throw error;
    }
  }

  /** Unpack the bundle into `dir`, refusing any entry that would land outside it. */
  async #unpack(bundle, dir) {
    const staging = `${dir}.staging-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true, mode: 0o755 });
    const file = path.join(staging, '..', `${path.basename(dir)}.tar.gz`);
    fs.writeFileSync(file, bundle, { mode: 0o600 });
    try {
      const { stdout } = await run('tar', ['-tzf', file], { maxBuffer: 64 * 1024 * 1024 });
      for (const entry of stdout.split('\n').filter(Boolean)) {
        const rest = entry.split('/').slice(1).join('/');
        if (entry.startsWith('/') || entry.split('/').includes('..') || (rest && path.isAbsolute(rest))) throw fail(400, `The bundle holds an unsafe path (${entry}): not installed.`);
      }
      await run('tar', ['-xzf', file, '-C', staging, '--strip-components=1', '--no-same-owner'], { maxBuffer: 16 * 1024 * 1024 });
      if (!fs.existsSync(path.join(staging, 'src', 'server.js'))) throw fail(400, 'The bundle has no src/server.js: not installed.');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(staging, dir);
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Go back to the version before (or to the one built into the image). */
  rollback({ by = '' } = {}) {
    if (!this.launched) throw fail(409, 'Rollback needs the launcher: start Kendra with "npm start" or the container image.');
    const s = this.state;
    if (!s.active) throw fail(409, 'This is the version built into the image: there is nothing to go back to.');
    const target = s.previous && fs.existsSync(path.join(this.#dataDir, 'app', 'versions', s.previous, 'src', 'server.js')) ? s.previous : null;
    // Going back by hand holds this version (and older ones) back from auto-update until a newer release comes.
    this.#save({ active: target, previous: s.active, pending: null, heldBack: s.active });
    this.#log({ event: 'rollback', version: target ?? 'built-in', from: this.#current, by });
    this.#restart();
    return { version: target ?? 'built-in', restarting: true };
  }

  /** A checked backup of the data (see backups.js). */
  backup(label = 'manual') {
    return new Backups({ dataDir: this.#dataDir }).take(label, { version: this.#current });
  }

  #prune() {
    const keep = new Set([this.state.active, this.state.previous].filter(Boolean));
    const versions = this.#installed();
    for (const v of versions.slice(KEEP_VERSIONS)) if (!keep.has(v)) fs.rmSync(path.join(this.#dataDir, 'app', 'versions', v), { recursive: true, force: true });
  }

  /** Check every few minutes (15 by default); with auto-update on, install the newest release as soon as it is found. */
  start() {
    this.#timer = setInterval(() => this.tick(), 60_000);
    this.#timer.unref();
    setTimeout(() => this.tick(), 30_000).unref();
  }

  /** One round: check when due, and install the newest release auto-update may take. */
  async tick() {
    try {
      const s = this.state;
      // A version the launcher rolled back is remembered for good: auto-update never tries it again.
      if (s.lastFailure?.version && !(s.failed ?? []).includes(s.lastFailure.version)) this.#save({ failed: [...(s.failed ?? []), s.lastFailure.version].slice(-20) });
      const auto = autoOf(this.state);
      if (!s.lastCheck || Date.now() - Date.parse(s.lastCheck) >= auto.everyMinutes * 60_000 - 5_000) await this.check().catch(() => {});
      const st = this.status();
      if (!this.launched || !auto.enabled || st.pending || this.#busy) return null;
      const failed = new Set(st.failed);
      const newest = st.available.find((r) => compareVersions(r.version, this.#current) > 0 && !failed.has(r.version) && (!st.heldBack || compareVersions(r.version, st.heldBack) > 0));
      if (newest) return await this.install(newest.version, { by: 'auto-update' }).catch(() => null);
    } catch {}
    return null;
  }

  stop() {
    clearInterval(this.#timer);
  }
}

/** The auto-update choice: on, every 15 minutes, unless an Admin changed it (older choices, made by the hour, become this). */
function autoOf(state) {
  const a = state.auto ?? {};
  if (!a.everyMinutes) return { ...AUTO_DEFAULT };
  return { enabled: a.enabled !== false, everyMinutes: a.everyMinutes };
}

/** The GitHub token: given, or CC_UPDATE_TOKEN / UPDATE_GITHUB_TOKEN, or a file (CC_UPDATE_TOKEN_FILE). */
function tokenFrom(given) {
  if (given !== null && given !== undefined) return String(given).trim();
  if (process.env.CC_UPDATE_TOKEN || process.env.UPDATE_GITHUB_TOKEN) return String(process.env.CC_UPDATE_TOKEN || process.env.UPDATE_GITHUB_TOKEN).trim();
  if (process.env.CC_UPDATE_TOKEN_FILE) {
    try {
      return fs.readFileSync(process.env.CC_UPDATE_TOKEN_FILE, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}
