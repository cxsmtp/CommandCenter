/**
 * The launcher: what the container (and `npm start`) runs. It starts the server from the version chosen under
 * Settings → Update & recovery, and keeps it running:
 *
 *   - exit code 75 is a restart request (an update, a rollback, Restart server, a proxy or certificate change):
 *     the state is read again and the server started again
 *   - a version just installed must answer /healthz within 60 s; if it does not, or it stops, the launcher goes
 *     back to the version before by itself and records why
 *   - a crash is restarted after a pause (longer each time, up to a minute)
 *   - the company proxy and trusted certificates saved in Settings are applied to the server it starts
 *   - stop signals pass to the server, which saves before it ends
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState, RESTART_CODE } from './updates.js';
import { Db } from './db.js';

const BUILTIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.CC_DATA_DIR || path.join(BUILTIN, 'data');
const PORT = Number(process.env.PORT) || 4310;
const HEALTH_MS = 60_000;

let child = null;
let stopping = false;
let crashes = 0;
const log = (...a) => console.log(`[launcher ${new Date().toISOString()}]`, ...a);

/** Which code to run: the active version's folder, or the one built into the image. */
export function chooseDir(state, dataDir = DATA, builtin = BUILTIN) {
  const dir = state.active ? path.join(dataDir, 'app', 'versions', state.active) : builtin;
  return fs.existsSync(path.join(dir, 'src', 'server.js')) ? dir : builtin;
}

/** The environment for the server: the saved proxy and trusted certificates. */
export function serverEnv(base = process.env, dataDir = DATA) {
  const env = { ...base, CC_LAUNCHED: '1', CC_DATA_DIR: dataDir };
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    const n = settings.network ?? {};
    if (n.proxy) {
      let proxy = n.proxy;
      if (n.proxyUser) {
        const url = new URL(n.proxy);
        url.username = encodeURIComponent(n.proxyUser);
        if (n.proxyPass) url.password = encodeURIComponent(new Db(dataDir).open(n.proxyPass));
        proxy = url.href;
      }
      Object.assign(env, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NODE_USE_ENV_PROXY: '1', NO_PROXY: [n.noProxy, 'localhost', '127.0.0.1'].filter(Boolean).join(',') });
    }
  } catch {}
  const certs = path.join(dataDir, 'certs', 'trusted.pem');
  if (fs.existsSync(certs) && fs.statSync(certs).size > 0) env.NODE_EXTRA_CA_CERTS = certs;
  return env;
}

async function healthy(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function rollback(state, why) {
  log(`Version ${state.active} did not start (${why}); going back to ${state.previous ?? 'the built-in version'}.`);
  const failed = state.active;
  writeState(DATA, {
    ...state,
    active: state.previous ?? null,
    previous: null,
    pending: null,
    lastFailure: { at: new Date().toISOString(), version: failed, message: `Did not start (${why}); rolled back by itself.` },
    history: [...(state.history ?? []), { at: new Date().toISOString(), event: 'auto-rollback', version: state.previous ?? 'built-in', from: failed, message: why }].slice(-50),
  });
}

function start() {
  const state = readState(DATA);
  const dir = chooseDir(state);
  const pending = state.pending && state.pending.version === state.active ? state.pending : null;
  log(`Starting ${dir === BUILTIN ? 'the built-in version' : `version ${state.active}`} from ${dir}`);
  child = spawn(process.execPath, [path.join(dir, 'src', 'server.js')], { cwd: dir, env: serverEnv(), stdio: 'inherit' });
  const started = Date.now();
  let settled = !pending;
  if (pending) {
    healthy(started + HEALTH_MS).then((ok) => {
      if (settled) return;
      settled = true;
      const s = readState(DATA);
      if (ok) {
        writeState(DATA, { ...s, pending: null, history: [...(s.history ?? []), { at: new Date().toISOString(), event: 'started', version: s.active }].slice(-50) });
        log(`Version ${s.active} is up.`);
      } else {
        rollback(s, 'no answer on /healthz within 60 s');
        child.kill('SIGTERM');
      }
    });
  }
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    if (code === RESTART_CODE) {
      log('Restart requested.');
      crashes = 0;
      return start();
    }
    if (!settled) {
      settled = true;
      rollback(readState(DATA), `stopped with ${signal ?? `code ${code}`}`);
      return start();
    }
    crashes = Date.now() - started > 5 * 60_000 ? 1 : crashes + 1;
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(crashes, 6));
    log(`The server stopped (${signal ?? `code ${code}`}); starting again in ${Math.round(wait / 1000)} s.`);
    setTimeout(start, wait);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      stopping = true;
      if (child) child.kill(sig);
      else process.exit(0);
      setTimeout(() => process.exit(0), 15_000).unref();
    });
  }
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  start();
}
