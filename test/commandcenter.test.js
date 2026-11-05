import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, seedTenant, apiKeyFor } from '../scripts/mock-cx.mjs';
import { createApp } from '../src/server.js';
import { collect, summarize, eventsOf, severityOf } from '../src/collector.js';
import { deriveConnection } from '../src/cxone/endpoints.js';
import { PovStore } from '../src/store.js';

let mock;
let app;
let base;
let dataDir;
const H = { 'X-Requested-With': 'CommandCenter', 'Content-Type': 'application/json' };
const call = async (p, opts = {}) => {
  const r = await fetch(`${base}${p}`, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  return { status: r.status, body: await r.json() };
};
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

before(async () => {
  const tenants = { alpha: seedTenant('alpha', { projects: 6, scans: 15, seed: 5 }), beta: seedTenant('beta', { projects: 3, scans: 4, seed: 9 }), revoked: seedTenant('revoked') };
  tenants.alpha.active.push({ id: 'alpha-run', projectId: 'alpha-p1', projectName: 'alpha/web-portal', status: 'Running', branch: 'main', createdAt: new Date().toISOString(), engines: ['sast'] });
  mock = await startMock({ tenants, rejectTenants: ['revoked'] });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  app = createApp({ dataDir, intervalMinutes: 10 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => {
  app.server.close();
  mock.server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the tenant, region and hosts come from the API key alone', () => {
  const c = deriveConnection(apiKeyFor('https://eu.iam.checkmarx.net', 'acme'));
  assert.equal(c.tenant, 'acme');
  assert.equal(c.baseUrl, 'https://eu.ast.checkmarx.net');
  assert.equal(c.regionLabel, 'EU');
  assert.match(c.tokenUrl, /\/auth\/realms\/acme\/protocol\/openid-connect\/token$/);
});

test('API keys are stored encrypted and never returned', async () => {
  const key = apiKeyFor(mock.origin, 'beta');
  const { status, body } = await call('/api/povs', { method: 'POST', body: JSON.stringify({ apiKey: key, customer: 'Beta Corp', endDate: '2030-01-31' }) });
  assert.equal(status, 201);
  assert.equal(body.pov.tenant, 'beta');
  assert.equal(body.pov.name, 'Beta Corp');
  assert.equal(body.pov.apiKey, undefined);
  const onDisk = fs.readFileSync(path.join(dataDir, 'povs.json'), 'utf8');
  assert.ok(!onDisk.includes(key), 'the key is not on disk in clear');
  const list = await call('/api/povs');
  assert.ok(!JSON.stringify(list.body).includes(key));
  // Reopened, the store still decrypts it.
  assert.equal(new PovStore({ dataDir }).connection(body.pov.id).apiKey, key);
});

test('a key Checkmarx One refuses is not added', async () => {
  const { status, body } = await call('/api/povs', { method: 'POST', body: JSON.stringify({ apiKey: apiKeyFor(mock.origin, 'revoked') }) });
  assert.equal(status, 400);
  assert.match(body.error, /did not accept/);
});

test('the same tenant cannot be added twice', async () => {
  const { status } = await call('/api/povs', { method: 'POST', body: JSON.stringify({ apiKey: apiKeyFor(mock.origin, 'beta') }) });
  assert.equal(status, 409);
});

test('state-changing calls need the page header', async () => {
  const r = await fetch(`${base}/api/refresh`, { method: 'POST' });
  assert.equal(r.status, 403);
});

test('the consolidated view adds up every POV and merges their activity', async () => {
  await call('/api/povs', { method: 'POST', body: JSON.stringify({ apiKey: apiKeyFor(mock.origin, 'alpha'), customer: 'Alpha' }) });
  const o = await until(async () => {
    const { body } = await call('/api/overview');
    return body.povs.length === 2 && body.povs.every((p) => p.summary && !p.refreshing) ? body : null;
  });
  const alpha = o.povs.find((p) => p.tenant === 'alpha');
  const beta = o.povs.find((p) => p.tenant === 'beta');
  assert.equal(alpha.summary.projects, 6);
  assert.equal(alpha.summary.running, 1);
  assert.equal(o.totals.projects, 9);
  assert.equal(o.totals.running, 1);
  assert.equal(o.totals.critical, alpha.summary.findings.critical + beta.summary.findings.critical);
  assert.ok(o.events.some((e) => e.povId === alpha.id) && o.events.some((e) => e.povId === beta.id));
  assert.ok(o.events.some((e) => e.kind === 'running'));
  const times = o.events.map((e) => Date.parse(e.at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  const d = await call(`/api/povs/${alpha.id}`);
  assert.equal(d.body.projects.length, 6);
  assert.equal(d.body.active.length, 1);
});

test('editing a POV and replacing its key with one for another tenant', async () => {
  const { body } = await call('/api/povs');
  const beta = body.povs.find((p) => p.tenant === 'beta');
  const ok = await call(`/api/povs/${beta.id}`, { method: 'PATCH', body: JSON.stringify({ stage: 'won', notes: 'Signed!' }) });
  assert.equal(ok.body.pov.stage, 'won');
  const bad = await call(`/api/povs/${beta.id}`, { method: 'PATCH', body: JSON.stringify({ apiKey: apiKeyFor(mock.origin, 'alpha') }) });
  assert.equal(bad.status, 400);
  const del = await call(`/api/povs/${beta.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await call('/api/povs')).body.povs.length, 1);
});

test('summaries, severities and the feed', () => {
  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600e3).toISOString();
  const snapshot = {
    at: iso(0),
    projects: { total: 2, list: [{ id: 'p1', name: 'one', createdAt: iso(2) }, { id: 'p2', name: 'two', createdAt: iso(24 * 30) }] },
    scans: [
      { id: 's1', projectId: 'p1', projectName: 'one', status: 'Failed', createdAt: iso(3), updatedAt: iso(2.9), initiator: 'a' },
      { id: 's2', projectId: 'p1', projectName: 'one', status: 'Completed', createdAt: iso(30), updatedAt: iso(29), initiator: 'a' },
    ],
    active: [{ id: 's3', projectId: 'p2', status: 'Queued', createdAt: iso(0.1) }],
    findings: { critical: 2, high: 3, medium: 0, low: 0, info: 0, total: 5, byProject: {} },
  };
  const s = summarize(snapshot, { findings: { critical: 1, high: 3, total: 4 } }, now);
  assert.equal(s.scans24h, 1);
  assert.equal(s.failed24h, 1);
  assert.equal(s.queued, 1);
  assert.equal(s.newProjects7d, 1);
  assert.deepEqual(s.delta, { critical: 1, high: 0, total: 1 });
  const events = eventsOf(snapshot, { since: now - 3600e3 });
  assert.deepEqual(events.map((e) => e.kind), ['queued', 'project', 'failed', 'completed']);
  assert.deepEqual(events.map((e) => e.fresh), [true, false, false, false]);
  assert.deepEqual(severityOf({ sastCounters: { severityCounters: [{ severity: 'HIGH', counter: 2 }] }, scaCounters: { severityCounters: [{ severity: 'HIGH', counter: 1 }, { severity: 'CRITICAL', counter: 4 }] }, scaPackagesCounters: { severityCounters: [{ severity: 'HIGH', counter: 99 }] } }), { critical: 4, high: 3, medium: 0, low: 0, info: 0 });
});

test('a tenant that cannot be reached fails the read with its reason', async () => {
  const c = deriveConnection(apiKeyFor(mock.origin, 'revoked'));
  await assert.rejects(collect(c), /rejected the API key/);
});
