import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, seedTenant, apiKeyFor } from '../scripts/mock-cx.mjs';
import { createApp } from '../src/server.js';
import { collect, summarize, eventsOf, severityOf, scanTypeOf } from '../src/collector.js';
import { deriveConnection } from '../src/cxone/endpoints.js';
import { evaluate, tenantFacts, DEFAULT_CATALOG } from '../src/catalog.js';
import { draft } from '../src/mail.js';

let mock, app, base, dataDir;
const jar = new Map();
const H = { 'X-Requested-With': 'CommandCenter', 'Content-Type': 'application/json' };
async function call(who, p, { method = 'GET', body, raw = false } = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { ...H, Cookie: jar.get(who) ?? '' }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  if (set) jar.set(who, set.split(';')[0]);
  return { status: r.status, body: raw ? await r.text() : await r.json() };
}
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};
const ids = {};

before(async () => {
  const tenants = { alpha: seedTenant('alpha', { projects: 6, scans: 15, seed: 5 }), beta: seedTenant('beta', { projects: 3, scans: 4, seed: 9 }), revoked: seedTenant('revoked') };
  tenants.alpha.active.push({ id: 'alpha-run', projectId: 'alpha-p1', projectName: 'alpha/web-portal', status: 'Running', branch: 'main', createdAt: new Date().toISOString(), engines: ['sast'] });
  tenants.alpha.scans[0] = { ...tenants.alpha.scans[0], status: 'Completed', sourceOrigin: 'Jenkins', engines: ['sast', 'sca', 'ai'], metadata: { configs: [{ type: 'ai', value: { fusionEnabled: 'true' } }] } };
  mock = await startMock({ tenants, rejectTenants: ['revoked'] });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  app = createApp({ dataDir });
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
});

test('sign-in, and nothing without it', async () => {
  assert.equal((await call('anon', '/api/overview')).status, 401);
  assert.equal((await call('admin', '/api/login', { method: 'POST', body: { email: 'admin@commandcenter.local', password: 'wrong-password' } })).status, 401);
  const ok = await call('admin', '/api/login', { method: 'POST', body: { email: 'admin@commandcenter.local', password: 'admin-password-123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.password, undefined);
});

test('a reporting tree: VP → leader → team lead → associates', async () => {
  const add = async (who, body) => (await call(who, '/api/users', { method: 'POST', body: { password: 'long-password-1', ...body } })).body.user;
  ids.vp = (await add('admin', { email: 'vp@x.com', name: 'Vera VP', role: 'vp' })).id;
  ids.leader = (await add('admin', { email: 'lee@x.com', name: 'Lee Leader', role: 'leader', managerId: ids.vp })).id;
  ids.lead = (await add('admin', { email: 'tl@x.com', name: 'Tia Lead', role: 'team_lead', managerId: ids.leader })).id;
  ids.se1 = (await add('admin', { email: 'se1@x.com', name: 'Sam SE', role: 'associate', managerId: ids.lead })).id;
  ids.se2 = (await add('admin', { email: 'se2@x.com', name: 'Ana SE', role: 'associate', managerId: ids.lead })).id;
  // A team lead cannot place someone above themselves, nor outside their team.
  await call('tl', '/api/login', { method: 'POST', body: { email: 'tl@x.com', password: 'long-password-1' } });
  assert.equal((await call('tl', '/api/users', { method: 'POST', body: { email: 'x@x.com', role: 'leader', managerId: ids.lead, password: 'long-password-1' } })).status, 403);
  assert.equal((await call('tl', '/api/users', { method: 'POST', body: { email: 'x@x.com', role: 'associate', managerId: ids.vp, password: 'long-password-1' } })).status, 403);
  // An associate cannot report to an associate.
  assert.equal((await call('admin', '/api/users', { method: 'POST', body: { email: 'y@x.com', role: 'associate', managerId: ids.se1, password: 'long-password-1' } })).status, 400);
  for (const [who, email] of [['vp', 'vp@x.com'], ['se1', 'se1@x.com'], ['se2', 'se2@x.com']]) await call(who, '/api/login', { method: 'POST', body: { email, password: 'long-password-1' } });
  const tree = (await call('vp', '/api/users')).body.tree;
  assert.equal(tree[0].name, 'Vera VP');
  assert.equal(tree[0].reports[0].reports[0].reports.length, 2);
  assert.equal((await call('se1', '/api/users')).body.users.length, 1, 'an associate sees only themselves');
});

test('an associate adds an opportunity with success criteria and a tenant; keys never leave the server', async () => {
  const key = apiKeyFor(mock.origin, 'alpha');
  const r = await call('se1', '/api/opportunities', { method: 'POST', body: { customer: 'Alpha Bank', salesforceUrl: 'https://x.my.salesforce.com/006ABC', capabilities: ['sast', 'fusion', 'jenkins', 'jira'], apiKey: key, endDate: '2030-01-01' } });
  assert.equal(r.status, 201);
  ids.alpha = r.body.opportunity.id;
  assert.equal(r.body.opportunity.stage, 'pov');
  assert.equal(r.body.opportunity.criteria.length, 4);
  assert.ok(!JSON.stringify(r.body).includes(key));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'opportunities.json'), 'utf8').includes(key), 'sealed at rest');
  const b = await call('se2', '/api/opportunities', { method: 'POST', body: { customer: 'Beta Corp' } });
  ids.beta = b.body.opportunity.id;
  assert.equal(b.body.opportunity.stage, 'discovery');
  assert.equal((await call('se2', '/api/opportunities', { method: 'POST', body: { customer: 'Dup', apiKey: key } })).status, 409, 'one tenant, one live opportunity');
  assert.equal((await call('se2', '/api/opportunities', { method: 'POST', body: { customer: 'Bad', apiKey: apiKeyFor(mock.origin, 'revoked') } })).status, 400);
});

test('who sees what: associates their own, managers their whole team', async () => {
  const d = await until(async () => {
    const x = (await call('se1', `/api/opportunities/${ids.alpha}`)).body;
    return x.tenant && !x.row.live.refreshing ? x : null;
  });
  assert.equal(d.tenant.projects.length, 6);
  assert.equal(d.row.live.summary.running, 1);
  assert.equal(d.row.live.summary.fusion7d, 1);
  // Evidence: Jenkins and Fusion detected from scans, SAST too; Jira not.
  const byCap = Object.fromEntries(d.opportunity.criteria.map((c) => [c.capabilityId, d.evidence[c.id].level]));
  assert.deepEqual(byCap, { sast: 'detected', fusion: 'detected', jenkins: 'detected', jira: 'none' });
  assert.equal((await call('se2', `/api/opportunities/${ids.alpha}`)).status, 404, 'a peer cannot see it');
  const lead = (await call('tl', '/api/overview')).body;
  assert.equal(lead.rows.length, 2);
  assert.equal(lead.totals.povs, 1);
  assert.equal(lead.people.length, 3);
  const filtered = (await call('vp', `/api/overview?owner=${ids.se2}`)).body;
  assert.deepEqual(filtered.rows.map((r) => r.customer), ['Beta Corp']);
  assert.ok(lead.events.length > 0);
});

test('managers edit their team’s work; associates only their own', async () => {
  assert.equal((await call('tl', `/api/opportunities/${ids.beta}`, { method: 'PATCH', body: { stage: 'technical' } })).status, 200);
  assert.equal((await call('se1', `/api/opportunities/${ids.beta}`, { method: 'PATCH', body: { stage: 'technical' } })).status, 404);
  const n = await call('se1', `/api/opportunities/${ids.alpha}/notes`, { method: 'POST', body: { text: 'Customer wants Jira tickets from findings.' } });
  assert.equal(n.status, 200);
  const jira = n.body.opportunity.criteria.find((c) => c.capabilityId === 'jira');
  assert.equal(n.body.evidence[jira.id].level, 'mentioned', 'keywords in notes are a hint');
  const met = await call('se1', `/api/opportunities/${ids.alpha}/criteria/${jira.id}`, { method: 'POST', body: { ...jira, status: 'met' } });
  assert.equal(met.body.row.progress.met, 1);
  assert.ok(met.body.opportunity.history.some((h) => /Not started → Met/.test(h.what)));
});

test('mute silences a POV’s alerts; projects can be muted on their own', async () => {
  const r = await call('se1', `/api/opportunities/${ids.alpha}/mute`, { method: 'PUT', body: { until: 'forever' } });
  assert.equal(r.body.row.muted, true);
  await call('se1', `/api/opportunities/${ids.alpha}/mute`, { method: 'PUT', body: { until: null, projects: ['alpha-p1'] } });
  const o = (await call('se1', '/api/overview')).body;
  assert.ok(!o.events.some((e) => e.projectId === 'alpha-p1'));
});

test('email drafts, .eml and the report', async () => {
  await call('se1', `/api/opportunities/${ids.alpha}/stakeholders`, { method: 'POST', body: { name: 'Priya Rao', email: 'priya@alpha.com', side: 'customer' } });
  const d = (await call('se1', `/api/opportunities/${ids.alpha}/email/draft`, { method: 'POST', body: { template: 'weekly' } })).body;
  assert.deepEqual(d.to, ['priya@alpha.com']);
  assert.match(d.body, /Hi Priya/);
  assert.match(d.body, /1 of 4 success criteria met/);
  const eml = await call('se1', `/api/opportunities/${ids.alpha}/email/eml`, { method: 'POST', body: d, raw: true });
  assert.match(eml.body, /Subject: =\?UTF-8\?Q\?Alpha_Bank_POV/);
  assert.match(eml.body, /X-Unsent: 1/);
  assert.equal((await call('se1', `/api/opportunities/${ids.alpha}/email/send`, { method: 'POST', body: d })).status, 400, 'no SMTP set up');
  const report = await call('tl', `/api/opportunities/${ids.alpha}/report`, { raw: true });
  assert.match(report.body, /Alpha Bank/);
  assert.match(report.body, /25%/);
});

test('roles can be changed by an Admin only', async () => {
  assert.equal((await call('vp', '/api/settings/roles', { method: 'PUT', body: { matrix: {} } })).status, 403);
  const r = await call('admin', '/api/settings/roles', { method: 'PUT', body: { matrix: { associate: ['opps.create'] } } });
  assert.deepEqual(r.body.matrix.associate, ['opps.create']);
  assert.equal((await call('se1', `/api/opportunities/${ids.alpha}/troubleshoot`, { raw: true })).status, 403);
});

test('state-changing calls need the page header', async () => {
  const r = await fetch(`${base}/api/refresh`, { method: 'POST', headers: { Cookie: jar.get('se1') } });
  assert.equal(r.status, 403);
});

test('summaries, scan types, severities and the feed', () => {
  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600e3).toISOString();
  const snapshot = {
    at: iso(0),
    projects: { total: 2, list: [{ id: 'p1', name: 'one', createdAt: iso(2) }, { id: 'p2', name: 'two', createdAt: iso(24 * 30) }] },
    scans: [
      { id: 's1', projectId: 'p1', projectName: 'one', status: 'Failed', createdAt: iso(3), updatedAt: iso(2.9), initiator: 'a', engines: [] },
      { id: 's2', projectId: 'p1', projectName: 'one', status: 'Completed', createdAt: iso(30), updatedAt: iso(29), initiator: 'a', engines: ['ai'], scanType: 'last' },
    ],
    active: [{ id: 's3', projectId: 'p2', status: 'Queued', createdAt: iso(0.1) }],
    findings: { critical: 2, high: 3, medium: 0, low: 0, info: 0, total: 5, byProject: {} },
  };
  const s = summarize(snapshot, { findings: { critical: 1, high: 3, total: 4 } }, now);
  assert.equal(s.scans24h, 1);
  assert.equal(s.failed24h, 1);
  assert.equal(s.last7d, 1);
  assert.deepEqual(s.delta, { critical: 1, high: 0, total: 1 });
  assert.deepEqual(eventsOf(snapshot).map((e) => e.kind), ['queued', 'project', 'failed', 'completed']);
  assert.equal(scanTypeOf({ engines: ['sast', 'ai'], metadata: { configs: [{ type: 'ai', value: { fusionEnabled: false } }] } }), 'last');
  assert.equal(scanTypeOf({ engines: ['sast', 'AI'] }), 'fusion');
  assert.equal(scanTypeOf({ engines: ['sast'] }), 'none');
  assert.deepEqual(severityOf({ sastCounters: { severityCounters: [{ severity: 'HIGH', counter: 2 }] }, scaPackagesCounters: { severityCounters: [{ severity: 'HIGH', counter: 99 }] } }).high, 2);
});

test('catalogue rules: word boundaries, and notes only ever hint', () => {
  const ado = DEFAULT_CATALOG.find((c) => c.id === 'azure-pipelines');
  const facts = tenantFacts({ scans: [{ status: 'Completed', origin: 'shadow-runner', engines: [] }], projects: { list: [] } });
  assert.equal(evaluate(ado, facts, '').level, 'none', '"ado" is not in "shadow"');
  assert.equal(evaluate(ado, facts, 'They run Azure DevOps').level, 'mentioned');
});

test('a draft never invents a recipient', () => {
  const d = draft('discovery', { customer: 'C', stakeholders: [{ side: 'customer', notify: true, email: '' , name: 'X'}], discovery: {} }, { owner: { name: 'S' }, catalog: { get: () => null } });
  assert.deepEqual(d.to, []);
});

test('a tenant that cannot be reached fails the read with its reason', async () => {
  await assert.rejects(collect(deriveConnection(apiKeyFor(mock.origin, 'revoked'))), /rejected the API key/);
});

test('people in the tenant: IAM users and sign-ins joined with who scanned', async () => {
  const { peopleActivity } = await import('../src/collector.js');
  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600e3).toISOString();
  const p = peopleActivity({
    people: { users: [{ id: '1', username: 'ana@c.com', email: 'ana@c.com', name: 'Ana', logins7d: 3, lastLoginAt: iso(5) }, { id: '2', username: 'bo@c.com', email: 'bo@c.com', name: 'Bo', logins7d: 0, lastLoginAt: null }, { id: '3', username: 'cy@c.com', email: 'cy@c.com', name: 'Cy', logins7d: 1, lastLoginAt: iso(100) }], eventsKnown: true },
    scans: [{ initiator: 'ana@c.com', createdAt: iso(1) }, { initiator: 'jenkins-ci', createdAt: iso(2) }],
    active: [],
  }, now);
  assert.equal(p.total, 3);
  assert.deepEqual(p.users.map((u) => [u.username, u.status]), [['ana@c.com', 'active'], ['jenkins-ci', 'active'], ['cy@c.com', 'quiet'], ['bo@c.com', 'never']]);
  assert.equal(p.users.find((u) => u.username === 'jenkins-ci').inIam, false);
  const denied = peopleActivity({ people: { users: [], denied: true }, scans: [{ initiator: 'x@c.com', createdAt: iso(1) }] }, now);
  assert.equal(denied.iamRead, false);
  assert.equal(denied.users.length, 1);
});

test('the tenant’s people are read from IAM; a POV marked successful gets its deck', async () => {
  const d = (await call('se1', `/api/opportunities/${ids.alpha}`)).body;
  assert.equal(d.tenant.people.iamRead, true);
  assert.ok(d.tenant.people.users.some((u) => u.inIam && u.logins7d > 0));
  const r = await call('se1', `/api/opportunities/${ids.alpha}`, { method: 'PATCH', body: { stage: 'completed', povResult: 'successful' } });
  assert.equal(r.body.opportunity.povResult, 'successful');
  const deck = await fetch(`${base}/api/opportunities/${ids.alpha}/deck`, { headers: { Cookie: jar.get('tl') } });
  assert.equal(deck.status, 200);
  const buf = Buffer.from(await deck.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'a .pptx (zip)');
  const draftBody = (await call('se1', `/api/opportunities/${ids.alpha}/email/draft`, { method: 'POST', body: { template: 'completion' } })).body;
  const eml = await call('se1', `/api/opportunities/${ids.alpha}/email/eml`, { method: 'POST', body: { ...draftBody, attachDeck: true }, raw: true });
  assert.match(eml.body, /POV results\.pptx/);
});

test('a custom criterion can name its own engine', async () => {
  const r = await call('se1', `/api/opportunities/${ids.alpha}/criteria`, { method: 'POST', body: { title: 'AI Red Teaming', engines: 'sca', keywords: 'red team' } });
  const c = r.body.opportunity.criteria.find((x) => x.title === 'AI Red Teaming');
  assert.deepEqual(c.engines, ['sca']);
  assert.equal(r.body.evidence[c.id].level, 'detected');
});
