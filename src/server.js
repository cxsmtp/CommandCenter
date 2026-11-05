/**
 * CommandCenter: every POV a Solution Engineer runs, in one place.
 *
 * No dependencies beyond Node 20+. Listens on 127.0.0.1 by default (a personal tool); set HOST to share it, and
 * CC_PASSCODE to require a passcode then.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { PovStore } from './store.js';
import { Monitor } from './monitor.js';
import { CxClient } from './cxone/client.js';
import { deriveConnection, publicConnection } from './cxone/endpoints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MAX_BODY = 64 * 1024;

export function createApp({ dataDir = process.env.CC_DATA_DIR || path.join(ROOT, 'data'), intervalMinutes = process.env.REFRESH_MINUTES || 10, passcode = process.env.CC_PASSCODE || '', collectFn, verifyKey = defaultVerify } = {}) {
  const store = new PovStore({ dataDir });
  const monitor = new Monitor({ store, dataDir, intervalMinutes, ...(collectFn ? { collectFn } : {}) });
  const clients = new Set();
  // A key Checkmarx One refuses is a mistake in the form (400), never "sign in to CommandCenter" (401).
  const checkKey = async (connection) => {
    try {
      return await verifyKey(connection);
    } catch (error) {
      throw Object.assign(new Error(`Checkmarx One did not accept that key: ${error.message}`), { status: 400 });
    }
  };
  const sessionToken = randomBytes(24).toString('hex');
  monitor.on('update', (event) => {
    const line = `event: update\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(line);
  });

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const parts = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) reject(Object.assign(new Error('Request too large.'), { status: 413 }));
        else parts.push(c);
      });
      req.on('end', () => {
        try {
          resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {});
        } catch {
          reject(Object.assign(new Error('Body is not JSON.'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });

  const cookieOf = (req) => Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
  const same = (a, b) => {
    const x = createHash('sha256').update(String(a)).digest();
    const y = createHash('sha256').update(String(b)).digest();
    return timingSafeEqual(x, y);
  };
  const authed = (req) => !passcode || same(cookieOf(req).cc_session ?? '', sessionToken);

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const method = req.method;

    if (parts[0] === 'login' && method === 'POST') {
      const { passcode: given } = await readBody(req);
      if (!passcode || same(given ?? '', passcode)) {
        res.setHeader('Set-Cookie', `cc_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res, 200, { ok: true });
      }
      return json(res, 401, { error: 'Wrong passcode.' });
    }
    if (parts[0] === 'session') return json(res, 200, { authed: authed(req), passcode: Boolean(passcode) });
    if (!authed(req)) return json(res, 401, { error: 'Sign in first.' });
    // State-changing calls only from this page (no cross-site form posts).
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'CommandCenter') return json(res, 403, { error: 'Missing request header.' });

    const since = Date.parse(url.searchParams.get('since') ?? '') || 0;

    if (parts[0] === 'stream' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (parts[0] === 'overview' && method === 'GET') return json(res, 200, monitor.overview({ since }));
    if (parts[0] === 'refresh' && method === 'POST') {
      monitor.refreshAll().catch(() => {});
      return json(res, 202, { ok: true });
    }
    if (parts[0] === 'keys' && parts[1] === 'inspect' && method === 'POST') {
      // What a pasted key says (tenant, region, expiry) before it is saved; checked against Checkmarx One.
      const { apiKey, overrides } = await readBody(req);
      const connection = deriveConnection(apiKey, overrides ?? {});
      const identity = await checkKey(connection);
      return json(res, 200, { connection: publicConnection(connection), identity });
    }
    if (parts[0] === 'povs') {
      const id = parts[1];
      if (!id && method === 'GET') return json(res, 200, { povs: store.list().map((p) => monitor.card(p)) });
      if (!id && method === 'POST') {
        const body = await readBody(req);
        await checkKey(deriveConnection(body.apiKey, body.overrides ?? {}));
        const pov = store.add(body);
        monitor.refresh(pov.id, { force: true }).catch(() => {});
        return json(res, 201, { pov });
      }
      if (id && !parts[2] && method === 'GET') {
        const detail = monitor.detail(id, { since });
        return detail ? json(res, 200, detail) : json(res, 404, { error: 'No such POV.' });
      }
      if (id && !parts[2] && method === 'PATCH') {
        const body = await readBody(req);
        if (body.apiKey) await checkKey(deriveConnection(body.apiKey, {}));
        const pov = store.update(id, body);
        if (body.apiKey || body.stage === 'active') monitor.refresh(id, { force: true }).catch(() => {});
        else monitor.emit('update', { povId: id });
        return json(res, 200, { pov });
      }
      if (id && !parts[2] && method === 'DELETE') {
        const pov = store.remove(id);
        monitor.forget(id);
        return json(res, 200, { pov });
      }
      if (id && parts[2] === 'refresh' && method === 'POST') {
        if (!store.get(id)) return json(res, 404, { error: 'No such POV.' });
        monitor.refresh(id, { force: true }).catch(() => {});
        return json(res, 202, { ok: true });
      }
    }
    return json(res, 404, { error: 'Not found.' });
  }

  function serveStatic(req, res, url) {
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return json(res, 404, { error: 'Not found.' });
    if (url.pathname === '/' || !path.extname(file)) file = path.join(PUBLIC, 'index.html');
    fs.readFile(file, (error, data) => {
      if (error) return json(res, 404, { error: 'Not found.' });
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') serveStatic(req, res, url);
      else json(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      if (!res.headersSent) json(res, error.status && error.status < 600 ? error.status : 500, { error: String(error.message ?? error) });
    }
  });
  server.on('close', () => monitor.stop());
  return { server, store, monitor };
}

/** A key is only saved once Checkmarx One accepts it: one sign-in and one cheap read. */
async function defaultVerify(connection) {
  const client = new CxClient(connection);
  await client.request('/api/projects', { query: { limit: 1, offset: 0 }, retries: 1 });
  return client.identity();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 4310;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.CC_PASSCODE) {
    console.warn('Warning: listening beyond this machine without CC_PASSCODE. Anyone who can reach it sees your POVs.');
  }
  const { server, monitor } = createApp();
  server.listen(port, host, () => {
    console.log(`CommandCenter on http://${host}:${port} — refreshing every ${monitor.intervalMs / 60_000} min`);
    monitor.start();
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
