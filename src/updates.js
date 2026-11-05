/**
 * Updates: CommandCenter replaces its own code with a published release, without anyone signing in to the server.
 *
 *   check     the repository's releases (GitHub, CC_UPDATE_REPO), newest first, every 6 hours and on request
 *   install   download the release's app bundle, check it against the release's SHA256SUMS (and, when
 *             CC_UPDATE_PUBKEY is set, the Ed25519 signature of that file), back up the data folder, unpack it
 *             beside the others and ask the launcher (src/launcher.js) to restart into it
 *   verify    the launcher waits for the new version to answer /healthz; if it does not within a minute, it goes
 *             back to the version before by itself, and the failure is recorded here
 *   rollback  any time, to the version before (or the one built into the image)
 *   auto      install the newest release by itself in a quiet hour (off until an Admin turns it on)
 *
 * Everything lives under <data>/app: versions/<version>/ (one folder per release), state.json (which one runs,
 * which ran before, what was tried) and <data>/backups/ (a copy of the data before each update; the last 5 kept).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './db.js';

const run = promisify(execFile);
export const RESTART_CODE = 75; // the launcher restarts the server on this exit code
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHECK_EVERY_MS = 6 * 3600e3;
const KEEP_VERSIONS = 3;
const KEEP_BACKUPS = 5;
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
  launched;

  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {string} o.currentVersion  the version running now
   * @param {() => void} [o.restart]   ask the launcher for a restart (exit with RESTART_CODE)
   */
  constructor({ dataDir, currentVersion, repo = process.env.CC_UPDATE_REPO || 'cxsmtp/CommandCenter', api = process.env.CC_UPDATE_API || 'https://api.github.com', pubkey = process.env.CC_UPDATE_PUBKEY || '', fetchFn = fetch, restart = () => setTimeout(() => process.exit(RESTART_CODE), 300), launched = process.env.CC_LAUNCHED === '1' }) {
    this.#dataDir = dataDir;
    this.#current = currentVersion;
    this.#repo = repo;
    this.#api = api.replace(/\/+$/, '');
    this.#pubkey = pubkey;
    this.#fetch = fetchFn;
    this.#restart = restart;
    this.launched = launched;
  }

  get state() {
    return readState(this.#dataDir);
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
      active: s.active ?? null,
      previous: s.previous ?? null,
      lastCheck: s.lastCheck ?? null,
      checkError: s.checkError ?? null,
      available: (s.available ?? []).map((r) => ({ ...r, newer: compareVersions(r.version, this.#current) > 0 })),
      updateAvailable: Boolean(newest && compareVersions(newest.version, this.#current) > 0),
      auto: { enabled: false, hour: 3, ...(s.auto ?? {}) },
      pending: s.pending ?? null,
      lastFailure: s.lastFailure ?? null,
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

  setAuto({ enabled, hour }) {
    const h = Math.trunc(Number(hour));
    return this.#save({ auto: { enabled: Boolean(enabled), hour: h >= 0 && h < 24 ? h : 3 } }).auto;
  }

  /** Only the release service's own hosts (or this machine, outside production, for tests). */
  #checkUrl(raw) {
    const url = new URL(raw);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && process.env.NODE_ENV !== 'production';
    if (!(url.protocol === 'https:' && HOSTS.has(url.hostname)) && !(local && url.protocol === 'http:')) throw fail(400, `Refused to download from ${url.host}: not the release service.`);
    return url;
  }

  async #get(url, { json = false, accept } = {}) {
    const r = await this.#fetch(this.#checkUrl(url), { headers: { 'User-Agent': 'CommandCenter-updater', Accept: accept ?? (json ? 'application/vnd.github+json' : 'application/octet-stream') }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    // A redirect may only land on the release service too.
    if (r.url) this.#checkUrl(r.url);
    if (!r.ok) throw fail(502, `The release service answered ${r.status} for ${new URL(url).pathname}.`);
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
          const asset = (re) => (r.assets ?? []).find((a) => re.test(a.name))?.browser_download_url ?? null;
          return { version, name: String(r.name ?? r.tag_name ?? '').slice(0, 120), notes: String(r.body ?? '').slice(0, 4000), publishedAt: r.published_at ?? null, url: r.html_url ?? null, bundle: asset(/^commandcenter-.*\.tar\.gz$/), sums: asset(/^SHA256SUMS$/), sig: asset(/^SHA256SUMS\.sig$/) };
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
    if (!this.launched) throw fail(409, 'Updates need the launcher: start CommandCenter with "npm start" or the container image.');
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
        const name = new URL(release.bundle).pathname.split('/').pop();
        const line = sums.toString('utf8').split('\n').find((l) => l.trim().endsWith(name));
        const want = line?.trim().split(/\s+/)[0]?.toLowerCase();
        const got = createHash('sha256').update(bundle).digest('hex');
        if (!want || want !== got) throw fail(400, `The download does not match its published checksum: not installed.`);
        await this.#unpack(bundle, dir);
      }
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.version !== release.version) throw fail(400, `The bundle says it is ${pkg.version}, not ${release.version}: not installed.`);
      const backup = this.backup(`before-${release.version}`);
      this.#save({ previous: this.state.active ?? null, active: release.version, pending: { version: release.version, from: this.#current, startedAt: new Date().toISOString(), by, backup } });
      this.#log({ event: 'install', version: release.version, from: this.#current, by, backup });
      this.#prune();
      this.#restart();
      return { version: release.version, restarting: true };
    } catch (error) {
      this.#log({ event: 'failed', version: release.version, by, message: String(error.message).slice(0, 300) });
      this.#save({ lastFailure: { at: new Date().toISOString(), version: release.version, message: String(error.message).slice(0, 300) } });
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
    if (!this.launched) throw fail(409, 'Rollback needs the launcher: start CommandCenter with "npm start" or the container image.');
    const s = this.state;
    if (!s.active) throw fail(409, 'This is the version built into the image: there is nothing to go back to.');
    const target = s.previous && fs.existsSync(path.join(this.#dataDir, 'app', 'versions', s.previous, 'src', 'server.js')) ? s.previous : null;
    this.#save({ active: target, previous: s.active, pending: null });
    this.#log({ event: 'rollback', version: target ?? 'built-in', from: this.#current, by });
    this.#restart();
    return { version: target ?? 'built-in', restarting: true };
  }

  /** A copy of the data folder's own files (not the app versions, not other backups). */
  backup(label = 'manual') {
    const root = path.join(this.#dataDir, 'backups');
    const dest = path.join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label.replace(/[^\w.-]+/g, '_')}`);
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    const copy = (from, to) => {
      for (const name of fs.readdirSync(from)) {
        if (from === this.#dataDir && ['app', 'backups'].includes(name)) continue;
        const src = path.join(from, name);
        const dst = path.join(to, name);
        if (fs.statSync(src).isDirectory()) {
          fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
          copy(src, dst);
        } else fs.copyFileSync(src, dst);
      }
    };
    copy(this.#dataDir, dest);
    const all = fs.readdirSync(root).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    return path.basename(dest);
  }

  #prune() {
    const keep = new Set([this.state.active, this.state.previous].filter(Boolean));
    const versions = this.#installed();
    for (const v of versions.slice(KEEP_VERSIONS)) if (!keep.has(v)) fs.rmSync(path.join(this.#dataDir, 'app', 'versions', v), { recursive: true, force: true });
  }

  /** Check every 6 hours; with auto-update on, install the newest in the chosen hour. */
  start({ now = () => new Date() } = {}) {
    const tick = async () => {
      try {
        const s = this.state;
        if (!s.lastCheck || Date.now() - Date.parse(s.lastCheck) > CHECK_EVERY_MS) await this.check().catch(() => {});
        const st = this.status();
        if (this.launched && st.auto.enabled && st.updateAvailable && now().getHours() === st.auto.hour && !st.pending) {
          const newest = st.available[0];
          // Never retry by itself a version that already failed here.
          if (st.lastFailure?.version !== newest.version) await this.install(newest.version, { by: 'auto-update' }).catch(() => {});
        }
      } catch {}
    };
    this.#timer = setInterval(tick, 10 * 60_000);
    this.#timer.unref();
    setTimeout(tick, 30_000).unref();
  }

  stop() {
    clearInterval(this.#timer);
  }
}
