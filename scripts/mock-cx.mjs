/**
 * A tiny stand-in for Checkmarx One, for the tests and `npm run demo`: one HTTP server answering for any number of
 * tenants (realms), each with its own projects and scans. Plain http on 127.0.0.1, which CommandCenter accepts only
 * outside production.
 */
import http from 'node:http';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const fakeJwt = (claims) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.sig`;

/** A fake API key for `tenant` on the mock at `origin`. */
export const apiKeyFor = (origin, tenant, extra = {}) => fakeJwt({ iss: `${origin}/auth/realms/${tenant}`, exp: Math.floor(Date.now() / 1000) + 90 * 86400, typ: 'Offline', ...extra });

const ENGINES = [['sast', 'sca'], ['sast'], ['sast', 'sca', 'kics'], ['sca']];
const PEOPLE = ['priya@customer.com', 'jenkins-ci', 'dev.lead@customer.com', 'github-actions'];
const ORIGINS = ['Jenkins', 'GitHub Actions', 'CLI', 'Web Portal'];

/** Made-up but plausible tenant data. */
export function seedTenant(name, { projects = 8, scans = 20, seed = 1 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const now = Date.now();
  const list = Array.from({ length: projects }, (_, i) => ({ id: `${name}-p${i + 1}`, name: `${name}/${['web-portal', 'payments-api', 'mobile-app', 'auth-service', 'data-pipeline', 'admin-ui', 'gateway', 'billing', 'search', 'notifications'][i % 10]}${i >= 10 ? `-${i}` : ''}`, createdAt: new Date(now - (i < 2 ? rnd() * 5 : 10 + rnd() * 30) * 86400e3).toISOString() }));
  const scanList = Array.from({ length: scans }, (_, i) => {
    const p = list[Math.floor(rnd() * list.length)];
    const created = now - rnd() * 6.5 * 86400e3;
    const r = rnd();
    const status = r < 0.1 ? 'Failed' : r < 0.15 ? 'Partial' : 'Completed';
    return {
      id: `${name}-s${i + 1}`, projectId: p.id, projectName: p.name, status, branch: rnd() < 0.7 ? 'main' : 'feature/login',
      createdAt: new Date(created).toISOString(), updatedAt: new Date(created + (4 + rnd() * 30) * 60e3).toISOString(),
      initiator: PEOPLE[Math.floor(rnd() * PEOPLE.length)], sourceOrigin: ORIGINS[Math.floor(rnd() * ORIGINS.length)], engines: ENGINES[Math.floor(rnd() * ENGINES.length)],
      statusDetails: status === 'Failed' ? [{ name: 'sast', status: 'Failed', details: 'Scan failed: no supported source files found' }] : [],
    };
  });
  const sev = Object.fromEntries(list.map((p) => [p.id, { CRITICAL: Math.floor(rnd() * 4), HIGH: Math.floor(rnd() * 15), MEDIUM: Math.floor(rnd() * 40), LOW: Math.floor(rnd() * 30) }]));
  const items = list.slice(0, 4).map((p) => ({ projectId: p.id, name: p.name, creditsUsed: Math.round(rnd() * 400) / 10, actionsPerformed: { actions: [{ actionType: 'AI_TRIAGE', transactionCount: Math.floor(rnd() * 30) }, { actionType: 'AI_REMEDIATION', transactionCount: Math.floor(rnd() * 8) }] } }));
  const used = Math.round(items.reduce((n, i) => n + i.creditsUsed, 0));
  return { projects: list, scans: scanList, sev, active: [], credits: { info: { total: 1000, used, available: 1000 - used, enforcement: { state: 'enabled' } }, items } };
}

export function startMock({ tenants = {}, port = 0, rejectTenants = [] } = {}) {
  const data = new Map(Object.entries(tenants));
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(`${req.method} ${url.pathname}`);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const token = url.pathname.match(/^\/auth\/realms\/([^/]+)\/protocol\/openid-connect\/token$/);
    if (token) {
      const tenant = decodeURIComponent(token[1]);
      if (!data.has(tenant) || rejectTenants.includes(tenant)) return send(400, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
      return send(200, { access_token: fakeJwt({ tenant_name: tenant, preferred_username: `se@${tenant}`, exp: Math.floor(Date.now() / 1000) + 600 }), expires_in: 600 });
    }
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    let tenant;
    try {
      tenant = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString()).tenant_name;
    } catch {}
    const t = data.get(tenant);
    if (!t) return send(401, { message: 'unauthorized' });
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if (url.pathname === '/api/projects') return send(200, { totalCount: t.projects.length, filteredTotalCount: t.projects.length, projects: t.projects.slice(offset, offset + limit) });
    if (url.pathname === '/api/scans') {
      const statuses = url.searchParams.getAll('statuses');
      if (statuses.length) {
        const rows = t.active.filter((s) => statuses.includes(s.status));
        return send(200, { totalCount: rows.length, filteredTotalCount: rows.length, scans: rows });
      }
      const from = Date.parse(url.searchParams.get('from-date') ?? '') || 0;
      const rows = [...t.active, ...t.scans].filter((s) => Date.parse(s.createdAt) >= from).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return send(200, { totalCount: rows.length, filteredTotalCount: rows.length, scans: rows.slice(offset, offset + limit) });
    }
    if (url.pathname === '/api/projects/last-scan') {
      const out = {};
      for (const id of url.searchParams.getAll('project-ids')) {
        const last = t.scans.filter((s) => s.projectId === id && s.status === 'Completed').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
        out[id] = last ? { id: last.id, createdAt: last.createdAt, updatedAt: last.updatedAt } : { id: `${id}-old`, createdAt: new Date(Date.now() - 20 * 86400e3).toISOString() };
      }
      return send(200, out);
    }
    if (url.pathname === '/api/scan-summary') {
      const scansSummaries = url.searchParams.getAll('scan-ids').map((scanId) => {
        const pid = t.scans.find((s) => s.id === scanId)?.projectId ?? scanId.replace(/-old$/, '');
        const sev = t.sev[pid] ?? {};
        return { scanId, sastCounters: { severityCounters: Object.entries(sev).map(([severity, counter]) => ({ severity, counter })) } };
      });
      return send(200, { scansSummaries, totalCount: scansSummaries.length });
    }
    if (url.pathname === '/api/credits/info') return t.credits ? send(200, t.credits.info) : send(404, { message: 'not found' });
    if (url.pathname === '/api/credits/consumption') return t.credits ? send(200, { items: t.credits.items, totalPages: 1 }) : send(404, { message: 'not found' });
    if (url.pathname === '/api/configuration/tenant') return send(200, [{ key: 'scan.config.ai.fusionEnabled', value: String(t.fusion !== false) }, { key: 'scan.config.sast.extendedAnalysis', value: 'true' }, { key: 'scan.config.ai.llmModel', value: t.model ?? '' }]);
    const log = url.pathname.match(/^\/api\/logs\/([^/]+)\/([^/]+)$/);
    if (log) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(`[${new Date().toISOString()}] ${log[2]} engine log for scan ${log[1]}\nINFO  Source downloaded\nERROR No supported source files found\n`);
    }
    return send(404, { message: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, data, calls })));
}
