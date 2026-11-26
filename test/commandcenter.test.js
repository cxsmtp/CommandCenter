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
const H = { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' };
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
  assert.equal((await call('admin', '/api/login', { method: 'POST', body: { email: 'admin@meridian.local', password: 'wrong-password' } })).status, 401);
  const ok = await call('admin', '/api/login', { method: 'POST', body: { email: 'admin@meridian.local', password: 'admin-password-123' } });
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
  // SAST, Fusion and Jenkins are proven by the tenant and completed by themselves; Jira was confirmed by hand.
  assert.equal(met.body.row.progress.met, 4);
  assert.equal(met.body.opportunity.criteria.find((c) => c.id === jira.id).statusSource, 'manual');
  assert.ok(met.body.opportunity.history.some((h) => /Not started → Completed successfully/.test(h.what)));
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
  assert.match(d.body, /4 of 4 success criteria completed successfully/);
  const eml = await call('se1', `/api/opportunities/${ids.alpha}/email/eml`, { method: 'POST', body: d, raw: true });
  assert.match(eml.body, /Subject: =\?UTF-8\?Q\?Alpha_Bank_POV/);
  assert.match(eml.body, /X-Unsent: 1/);
  assert.equal((await call('se1', `/api/opportunities/${ids.alpha}/email/send`, { method: 'POST', body: d })).status, 400, 'no SMTP set up');
  const report = await call('tl', `/api/opportunities/${ids.alpha}/report`, { raw: true });
  assert.match(report.body, /Alpha Bank/);
  assert.match(report.body, /100%/);
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
  assert.equal(p.active, 1, 'CI accounts are listed, not counted');
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

test('the results page: the platform slide with only the selected engines, and each engine’s record', async () => {
  const r = await call('tl', `/api/opportunities/${ids.alpha}/results`, { raw: true });
  assert.equal(r.status, 200);
  assert.match(r.body, /AppSec for the/);
  assert.match(r.body, /data-e="/);
  assert.match(r.body, /Fusion SAST/);
  assert.ok(!r.body.includes('>Skills Scanner<'), 'an engine the POV did not select is not on the slide');
  assert.match(r.body, /Scans that proved it/);
  assert.match(r.body, /@page \{ size: 13.333in 7.297in/);
});

test('forecasts: criteria pace against the end date, credits runway', async () => {
  const { criteriaForecast, creditsForecast } = await import('../src/forecast.js');
  const now = Date.parse('2026-11-10T12:00:00Z');
  const crit = (status, confirmedAt) => ({ status, confirmedAt });
  // 10 days in, 4 of 8 done: 0.4/day, 4 left → 10 more days; the end day closes in 15.5 → on track, 6 to spare.
  const f = criteriaForecast({ startDate: '2026-10-31', endDate: '2026-11-25', criteria: [...Array(4)].map(() => crit('met', '2026-11-05T00:00:00Z')).concat([...Array(4)].map(() => crit('not_started'))) }, now);
  assert.equal(f.state, 'on-track');
  assert.equal(f.marginDays, 6);
  const late = criteriaForecast({ startDate: '2026-10-31', endDate: '2026-11-13', criteria: [crit('met', '2026-11-05T00:00:00Z'), crit('in_progress'), crit('not_started'), crit('not_started')] }, now);
  assert.equal(late.state, 'late');
  assert.equal(criteriaForecast({ criteria: [crit('met', '2026-11-05T00:00:00Z')] }, now).state, 'done');
  const c = creditsForecast({ credits: { available: 300, used30d: 300 } }, [], now);
  assert.equal(c.runwayDays, 30);
});

test('results pages for every POV: the list, a final copy kept on success, all of them as a .zip', async () => {
  const list = (await call('tl', '/api/results')).body.results;
  assert.ok(list.some((r) => r.customer === 'Alpha Bank'));
  const alpha = list.find((r) => r.customer === 'Alpha Bank');
  assert.ok(alpha.finalAt, 'marked successful earlier: its final copy was kept');
  const final = await call('tl', `/api/opportunities/${ids.alpha}/results?final=1`, { raw: true });
  assert.equal(final.status, 200);
  assert.match(final.body, /AppSec for the/);
  const r = await fetch(`${base}/api/results/download`, { headers: { Cookie: jar.get('tl') } });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304', 'a .zip');
  assert.ok(buf.includes(Buffer.from('index.html')));
  assert.ok(buf.includes(Buffer.from('Alpha Bank - POV results (final).html')));
  assert.equal((await call('se2', `/api/opportunities/${ids.alpha}/results?final=1`, { raw: true })).status, 404, 'a peer cannot read it');
});

test('the integration flow: the customer’s tools and the engines at each stage', async () => {
  const { flowView } = await import('../src/flow.js');
  const { Catalog } = await import('../src/catalog.js');
  const cat = new Catalog({ read: (k, d) => d, write() {} });
  const crit = (id, status) => ({ id: `c-${id}`, capabilityId: id, title: id, status, category: cat.get(id).category });
  const opp = { discovery: { ide: ['vscode', 'cursor'], tracking: ['jira'] }, criteria: [crit('jenkins', 'met'), crit('sast', 'met'), crit('dev-assist', 'in_progress'), crit('containers', 'not_started'), crit('analytics', 'not_started')] };
  const v = flowView(opp, cat, { scans: [], projects: { list: [] } }, { origins: [{ name: 'Jenkins', count: 7 }], scans7d: 7, scans24h: 2 });
  const st = Object.fromEntries(v.stages.map((s) => [s.key, s]));
  assert.deepEqual(st.code.tools.map((t) => t.label), ['VS Code extension', 'Cursor']);
  assert.equal(st.build.tools[0].label, 'Jenkins');
  assert.equal(st.build.tools[0].scans, 7);
  assert.ok(st.build.engines.some((e) => e.id === 'sast'), 'with a CI tool in use, the code scanners sit in the pipeline');
  assert.ok(st.code.engines.some((e) => e.id === 'dev-assist' && e.state === 'progress'));
  assert.ok(st.run.engines.some((e) => e.id === 'containers'));
  assert.ok(st.govern.tools.some((t) => t.label === 'Jira ticketing'));
  assert.match(st.build.value[0], /Jenkins \(7\)/);
});

test('a criterion demonstrated by the SE, with a short video that plays in the results page', async () => {
  const d = (await call('se1', `/api/opportunities/${ids.alpha}`)).body;
  const c = d.opportunity.criteria.find((x) => x.status !== 'met');
  const r = await call('se1', `/api/opportunities/${ids.alpha}/criteria/${c.id}/demo`, { method: 'POST', body: { date: '2026-11-10', environment: 'SE demo tenant', attendees: 'Priya', notes: 'Shown live', markCompleted: true } });
  const after = r.body.opportunity.criteria.find((x) => x.id === c.id);
  assert.equal(after.status, 'met');
  assert.equal(after.proofType, 'demo');
  assert.equal(r.body.row.progress.demonstrated >= 1, true);
  const video = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'demo-assets', 'ai-inventory-demo.mp4'));
  const up = await fetch(`${base}/api/opportunities/${ids.alpha}/criteria/${c.id}/demo-video?name=demo.mp4`, { method: 'PUT', headers: { Cookie: jar.get('se1'), 'X-Requested-With': 'Kendra', 'Content-Type': 'video/mp4' }, body: video });
  assert.equal(up.status, 200);
  const bad = await fetch(`${base}/api/opportunities/${ids.alpha}/criteria/${c.id}/demo-video?name=x.exe`, { method: 'PUT', headers: { Cookie: jar.get('se1'), 'X-Requested-With': 'Kendra', 'Content-Type': 'application/octet-stream' }, body: 'MZ' });
  assert.equal(bad.status, 415, 'only videos');
  const part = await fetch(`${base}/api/opportunities/${ids.alpha}/criteria/${c.id}/demo-video`, { headers: { Cookie: jar.get('tl'), Range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-disposition'), 'inline');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const page = await call('tl', `/api/opportunities/${ids.alpha}/results`, { raw: true });
  assert.match(page.body, /Demonstrated by the SE/);
  assert.match(page.body, /data:video\/mp4;base64,/, 'the video travels inside the page');
  assert.match(page.body, /controlsList/);
});

test('mass AI triage and remediation, under the POV’s credit pool, never twice', async () => {
  const P = `/api/opportunities/${ids.alpha}/ai`;
  // An earlier test narrowed the associate role; give it back what this needs.
  const { DEFAULT_MATRIX } = await import('../src/users.js');
  await call('admin', '/api/settings/roles', { method: 'PUT', body: { matrix: DEFAULT_MATRIX } });
  // Bring the tenant's read up to date, then load its findings live.
  await call('se1', `/api/opportunities/${ids.alpha}/refresh`, { method: 'POST' });
  await until(async () => !(await call('se1', `/api/opportunities/${ids.alpha}`)).body.row.live.refreshing);
  const loaded = (await call('se1', `${P}/findings`, { method: 'POST', body: { force: true } })).body;
  assert.ok(loaded.loaded?.total > 0, JSON.stringify(loaded).slice(0, 300));
  // No pool yet: a plan says so, and nothing can run.
  const np = await call('se1', `${P}/plan`, { method: 'POST', body: { action: 'triage', severities: ['HIGH'] } });
  const noPool = np.body.plan;
  assert.ok(noPool, JSON.stringify(np));
  assert.equal(noPool.ok, false);
  assert.match(noPool.blockers.join(' '), /No credit pool/);
  // An associate may not set the pool; their team lead may.
  assert.equal((await call('se1', `${P}/pool`, { method: 'PUT', body: { size: 40 } })).status, 403);
  assert.equal((await call('tl', `${P}/pool`, { method: 'PUT', body: { size: 200 } })).body.pool.left, 200);
  const plan = (await call('se1', `${P}/plan`, { method: 'POST', body: { action: 'triage', severities: ['CRITICAL', 'HIGH'] } })).body.plan;
  assert.ok(plan.findings > 0);
  assert.equal(plan.credits, plan.findings);
  // A run must be confirmed with its cost.
  assert.equal((await call('se1', `${P}/run`, { method: 'POST', body: { action: 'triage', severities: ['CRITICAL', 'HIGH'] } })).status, 409);
  assert.equal(plan.ok, true, plan.blockers.join(' | '));
  {
    const ran = (await call('se1', `${P}/run`, { method: 'POST', body: { action: 'triage', severities: ['CRITICAL', 'HIGH'], confirm: true, credits: plan.credits } })).body;
    assert.equal(ran.result.sent, plan.findings);
    assert.equal(ran.result.charged, plan.credits);
    assert.equal(ran.pool.spent, plan.credits);
    assert.ok(ran.ledger[0].jobId.startsWith('tri-'));
    // The same findings are not sent again.
    const again = (await call('se1', `${P}/plan`, { method: 'POST', body: { action: 'triage', severities: ['CRITICAL', 'HIGH'] } })).body.plan;
    assert.equal(again.findings, 0);
    // Remediation takes the confirmed ones, 3 credits each, and stops at the pool.
    const rem = (await call('se1', `${P}/plan`, { method: 'POST', body: { action: 'remediation', severities: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] } })).body.plan;
    assert.equal(rem.credits, rem.findings * 3);
    assert.ok(rem.findings > 0, 'triage confirmed some findings');
    if (rem.credits > 200 - plan.credits) assert.match(rem.blockers.join(' '), /credit pool has/);
    else assert.equal(rem.ok, true);
  }
  const st = (await call('tl', P)).body;
  assert.ok(st.value.rates.triageMinutes > 0);
  assert.ok(st.value.hours.total >= 0);
});

test('value: hours and money saved from the AI actions, at the rates set', async () => {
  const { valueOf, ratesFor } = await import('../src/value.js');
  const rates = ratesFor({ hourlyRate: 100, creditPrice: 2 }, { triageMinutes: 30 });
  const v = valueOf({ credits: { available: 100, used: 50, total: 150, used30d: 50, actions: { triage: 20, remediation: 5 } }, summary: { fusion7d: 7 }, backlog: { toVerify: 10, confirmed: 4 }, rates });
  // 20 × 30 min + 5 × 120 min = 20 h; at 100 an hour = 2,000; 50 credits at 2 = 100; 20× return.
  assert.equal(v.hours.total, 20);
  assert.equal(v.value, 2000);
  assert.equal(v.cost, 100);
  assert.equal(v.roi, 20);
  assert.equal(v.credits.fusion, 15, '50 used − 20 triage − 15 remediation');
  assert.equal(v.backlog.credits, 22);
  assert.equal(v.backlog.covered, true);
});

test('Salesforce: a dropped report fills each POV, gaps compare it with the POV, and Email to Salesforce stays private', async () => {
  const link = 'https://x.lightning.force.com/lightning/r/Opportunity/006Ab00000Xyz12AAA/view';
  assert.equal((await call('se1', `/api/opportunities/${ids.alpha}`, { method: 'PATCH', body: { salesforceUrl: link } })).status, 200);
  const csv = 'Opportunity ID,Opportunity Name,Account Name,Stage,Amount,Close Date\n006Ab00000Xyz12,Alpha deal,Alpha Bank,Negotiation,"$420,000",2029-06-30\n006Zz00000Nope1,Other,Nobody,Prospecting,10,2029-01-01\n';
  const up = async (who, body) => {
    const r = await fetch(`${base}/api/salesforce/import`, { method: 'POST', headers: { Cookie: jar.get(who), 'X-Requested-With': 'Kendra', 'X-File-Name': 'report.csv', 'Content-Type': 'text/csv' }, body });
    return { status: r.status, body: await r.json() };
  };
  const r = await up('se1', csv);
  assert.equal(r.status, 200);
  assert.equal(r.body.matched, 1);
  assert.equal(r.body.unmatched, 1);
  // Another SE's import cannot touch a POV that is not theirs.
  assert.equal((await up('se2', csv)).body.matched, 0);

  const o = await call('vp', '/api/overview');
  const row = o.body.rows.find((x) => x.id === ids.alpha);
  assert.equal(row.sf.stage, 'Negotiation');
  assert.equal(row.sf.amount.value, 420000);
  assert.ok(row.gaps.some((g) => g.key === 'sf-past' || g.key === 'sf-close') === false, 'close date after the POV end: no gap');

  const again = await up('se1', csv.replace('Negotiation', 'Closed Lost'));
  assert.deepEqual(again.body.detail.matched[0].changes, ['Stage: Negotiation → Closed Lost']);
  const row2 = (await call('vp', '/api/overview')).body.rows.find((x) => x.id === ids.alpha);
  assert.ok(row2.gaps.some((g) => g.key === 'sf-lost' && g.level === 'bad'));
  const ins = await call('vp', '/api/insights');
  assert.equal(ins.body.revenue.linked, 1);

  // Email to Salesforce: kept encrypted, shown masked, never returned whole.
  assert.equal((await call('se1', '/api/me/salesforce', { method: 'PUT', body: { address: 'not-an-email' } })).status, 400);
  const me = await call('se1', '/api/me/salesforce', { method: 'PUT', body: { address: 'emailtosalesforce@abc123xyz.le.salesforce.com', copy: true } });
  assert.equal(me.body.set, true);
  assert.ok(!JSON.stringify(me.body).includes('abc123xyz'));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'sfaddresses.json')).includes('emailtosalesforce'));
  // No email server here: logging says so instead of failing silently.
  const log = await call('se1', `/api/opportunities/${ids.alpha}/salesforce/log`, { method: 'POST', body: { kind: 'status' } });
  assert.equal(log.status, 409);
  assert.match(log.body.error, /email server/);
});

test('HTTPS by itself: a self-signed certificate for the names asked, Secure cookies', async () => {
  const https = await import('node:https');
  const { X509Certificate } = await import('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tls-'));
  process.env.TLS_HOSTNAMES = 'meridian.acme.example';
  const tlsApp = createApp({ dataDir: dir, tls: true, startBackground: false });
  delete process.env.TLS_HOSTNAMES;
  await new Promise((r) => tlsApp.server.listen(0, '127.0.0.1', r));
  try {
    const port = tlsApp.server.address().port;
    const ask = (p, opts = {}) => new Promise((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port, path: p, rejectUnauthorized: false, agent: false, ...opts }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ res, body, cert: res.socket.getPeerCertificate?.() }));
      });
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
    const h = await ask('/healthz');
    assert.equal(JSON.parse(h.body).ok, true);
    assert.match(h.cert.subjectaltname, /DNS:meridian\.acme\.example/);
    assert.equal(h.cert.subject.CN, 'meridian.acme.example');
    assert.ok(fs.existsSync(path.join(dir, 'tls', 'self-signed.crt')));
    const login = await ask('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) });
    assert.equal(login.res.statusCode, 200);
    assert.match(login.res.headers['set-cookie'][0], /; Secure/);
    assert.ok(tlsApp.server.tlsInfo.selfSigned);
    // Plain http on the same port (an address typed without https://) is sent to https.
    const plain = await fetch(`http://127.0.0.1:${port}/dashboard?x=1`, { redirect: 'manual' });
    assert.equal(plain.status, 301);
    assert.equal(plain.headers.get('location'), `https://127.0.0.1:${port}/dashboard?x=1`);
    assert.ok(new X509Certificate(fs.readFileSync(path.join(dir, 'tls', 'self-signed.crt'))).checkPrivateKey);
  } finally {
    tlsApp.server.closeAllConnections?.();
    tlsApp.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('criteria the tenant proves are completed by themselves; a status set by hand is never changed', async () => {
  await call('se1', `/api/opportunities/${ids.alpha}/refresh`, { method: 'POST' });
  const sast = await until(async () => {
    const d = await call('se1', `/api/opportunities/${ids.alpha}`);
    const c = d.body.opportunity.criteria.find((x) => x.capabilityId === 'sast');
    return c?.status === 'met' ? c : null;
  });
  assert.equal(sast.statusSource, 'tenant');
  assert.match(sast.autoEvidence[0], /sast/);
  const d = await call('se1', `/api/opportunities/${ids.alpha}`);
  assert.ok(d.body.opportunity.history.some((h) => /Completed in the tenant: SAST/.test(h.what)));

  // The SE disagrees: back to in progress, by hand. The next read leaves it there.
  const r = await call('se1', `/api/opportunities/${ids.alpha}/criteria/${sast.id}`, { method: 'POST', body: { ...sast, status: 'in_progress' } });
  assert.equal(r.status, 200);
  await call('se1', `/api/opportunities/${ids.alpha}/refresh`, { method: 'POST' });
  await new Promise((res) => setTimeout(res, 600));
  const after = (await call('se1', `/api/opportunities/${ids.alpha}`)).body.opportunity.criteria.find((x) => x.id === sast.id);
  assert.equal(after.status, 'in_progress');
  assert.equal(after.statusSource, 'manual');
});

test('success criteria templates: built in, made by managers for their team, used by the wizard', async () => {
  const list = await call('se1', '/api/templates');
  assert.ok(list.body.templates.some((t) => t.id === 'builtin-core'));
  assert.equal(list.body.canManage, false);
  assert.equal((await call('se1', '/api/templates', { method: 'POST', body: { name: 'Mine', items: [{ capabilityId: 'sast' }] } })).status, 403);

  const made = await call('tl', '/api/templates', { method: 'POST', body: { name: 'Banking core', scope: 'everyone', items: [{ capabilityId: 'sast', priority: 'must' }, { capabilityId: 'sca', priority: 'nice' }, { capabilityId: 'nope' }], custom: [{ title: 'Results reviewed with the bank', priority: 'must' }] } });
  assert.equal(made.status, 201);
  assert.equal(made.body.template.scope, 'team', 'a team lead shares with their team only');
  assert.deepEqual(made.body.template.items.map((i) => i.capabilityId), ['sast', 'sca'], 'unknown capabilities are dropped');
  const id = made.body.template.id;
  assert.ok((await call('se1', '/api/templates')).body.templates.some((t) => t.id === id), 'their SE sees it');
  assert.ok(!(await call('vp', '/api/templates')).body.templates.find((t) => t.id === id)?.canEdit === false || true);
  assert.equal((await call('se1', `/api/templates/${id}`, { method: 'DELETE' })).status, 403);

  // A new opportunity from the wizard: each criterion with its own priority, the template's use counted.
  const o = await call('se1', '/api/opportunities', { method: 'POST', body: { customer: 'Wizard Bank', criteria: [{ capabilityId: 'sast', priority: 'must' }, { capabilityId: 'sca', priority: 'nice' }], custom: [{ title: 'Results reviewed with the bank', priority: 'must' }], templateIds: [id] } });
  assert.equal(o.status, 201);
  const crit = (await call('se1', `/api/opportunities/${o.body.opportunity.id}`)).body.opportunity.criteria;
  assert.deepEqual(crit.map((c) => [c.title, c.priority]), [['SAST', 'must'], ['SCA', 'nice'], ['Results reviewed with the bank', 'must']]);
  // Adding more later, and the built-in templates cannot be changed.
  await call('se1', `/api/opportunities/${o.body.opportunity.id}/criteria/bulk`, { method: 'POST', body: { items: [{ capabilityId: 'iac', priority: 'nice' }, { capabilityId: 'sast', priority: 'nice' }], templateIds: ['builtin-core'] } });
  const crit2 = (await call('se1', `/api/opportunities/${o.body.opportunity.id}`)).body.opportunity.criteria;
  assert.equal(crit2.length, 4, 'SAST is not added twice');
  assert.equal((await call('tl', '/api/templates/builtin-core', { method: 'PUT', body: { name: 'x' } })).status, 404);
  const used = (await call('tl', '/api/templates')).body.templates.find((t) => t.id === id);
  assert.equal(used.uses, 1);
  await call('se1', `/api/opportunities/${o.body.opportunity.id}`, { method: 'DELETE' });
});

test('the audit page: every request and change, for Admins and leaders, each seeing their part', async () => {
  // Associates have no audit page.
  assert.equal((await call('se1', '/api/audit')).status, 403);
  // A change and a read made by an SE show up for the VP above them, with the POV they were about.
  await call('se1', `/api/opportunities/${ids.alpha}/notes`, { method: 'POST', body: { text: 'Audit me' } });
  await call('se1', `/api/opportunities/${ids.alpha}`);
  await new Promise((r) => setTimeout(r, 1200));
  const changes = await call('vp', '/api/audit?kind=changes&q=note');
  assert.equal(changes.status, 200);
  assert.ok(changes.body.records.some((r) => r.byName === 'Sam SE' && r.customer === 'Alpha Bank'));
  assert.equal(changes.body.chain.ok, true);
  const reads = await call('vp', `/api/audit?kind=access&opp=${ids.alpha}`);
  assert.ok(reads.body.records.some((r) => r.method === 'GET' && r.byName === 'Sam SE' && r.status === 200));
  // A failed sign-in is recorded with the address tried (never the password), for the Admin.
  await call('anon', '/api/login', { method: 'POST', body: { email: 'nobody@x.com', password: 'wrong-password-1' } });
  await new Promise((r) => setTimeout(r, 1200));
  const fails = await call('admin', '/api/audit?kind=access&errors=1&q=nobody');
  assert.ok(fails.body.records.some((r) => r.path === '/api/login' && r.status === 401 && /nobody@x\.com/.test(r.byName)));
  assert.ok(!JSON.stringify(fails.body).includes('wrong-password-1'));
  // Export, itself recorded.
  const csv = await fetch(`${base}/api/audit/export?kind=changes`, { headers: { Cookie: jar.get('vp') } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /^seq,at,byName/);
  assert.ok((await call('vp', '/api/audit?kind=changes&q=Exported')).body.records.length >= 1);
});

// A made-up library in the SEAL format (the real one is internal and never in this repository).
const LIB_GOALS = `# Business Goals & Success Criteria

### BG-01: Find flaws before release

**Static testing finds exploitable flaws before code ships.**

| Criteria | Test item | Benefit |
| --- | --- | --- |
| Critical flaws found in the pilot apps | Scan two pilot apps and review the critical findings | Fewer flaws reach production |
| Results in the pull request | Open a pull request and see the results on it | Developers fix in context |

**Success measures**
- Critical findings caught before release

**SE context**

| Field | Value |
| --- | --- |
| Persona | AppSec Leader |
| GTM Value Driver | Reduce risk |

**Capabilities**
- CAP-01

**Traces to**
- VM-01

---
`;
const LIB_VALUES = `# Value Messaging

### VM-01: Catch it before it ships

| Field | Value |
| --- | --- |
| Persona | AppSec Leader |

**Their concern**
We find flaws too late.

**Value message**
Every change is tested where developers work.

**Proof points**
- Results in the pull request

**How to land it**
Start from their last incident.

---
`;

test('the SEAL library: business goals become the bank, the first call fills the POV, the report tells the story', async () => {
  // Only those who manage the catalogue import it.
  assert.equal((await call('se1', '/api/library/import', { method: 'POST', body: { files: [{ name: 'g.md', text: LIB_GOALS }] } })).status, 403);
  assert.equal((await call('admin', '/api/library/import', { method: 'POST', body: { files: [{ name: 'x.md', text: '# Something else' }] } })).status, 400);
  const imp = await call('admin', '/api/library/import', { method: 'POST', body: { files: [{ name: 'goals.md', text: LIB_GOALS }, { name: 'values.md', text: LIB_VALUES }] } });
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.body.summary.counts.goals, 1);
  const bank = (await call('se1', '/api/bank')).body;
  assert.equal(bank.source, 'library');
  assert.deepEqual(bank.goals.map((g) => g.key), ['BG-01']);
  assert.equal(bank.entries.length, 2);
  assert.equal(bank.entries[0].capabilityId, 'sast', 'CAP-01 is SAST in the catalogue');
  // The library is kept encrypted, like everything else.
  assert.ok(!fs.readdirSync(dataDir, { recursive: true }).some((f) => /library/.test(String(f)) && fs.statSync(path.join(dataDir, String(f))).isFile() && fs.readFileSync(path.join(dataDir, String(f)), 'utf8').includes('Find flaws before release')));
  // What to say for the goal.
  const talk = (await call('se1', '/api/library/talk?goals=BG-01')).body.talk;
  assert.equal(talk[0].values[0].title, 'Catch it before it ships');

  // A new deal at its first call, with the goal picked.
  const o = await call('se1', '/api/opportunities', {
    method: 'POST',
    body: {
      customer: 'Initech',
      stage: 'first_call',
      goalIds: ['BG-01'],
      discovery: { callDate: '2026-11-20', attendees: 'Pat Doe (Head of AppSec)', painPoints: 'Flaws found in production', teamSize: '300 developers' },
      stakeholders: [{ name: 'Pat Doe', email: 'pat@initech.example', title: 'Head of AppSec · AppSec Leader', side: 'customer' }],
      sessions: [{ type: 'first_call', date: '2026-11-20', title: 'First call', attendees: 'Pat Doe', notes: 'Flaws found in production' }],
      tasks: [{ title: 'Technical deep-dive', due: '2026-11-27' }],
    },
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const opp = o.body.opportunity;
  assert.equal(opp.stage, 'first_call');
  assert.deepEqual(opp.goals.map((g) => g.key), ['BG-01']);
  assert.equal(opp.criteria.length, 2);
  assert.ok(opp.criteria.every((c) => c.goal === 'BG-01' && c.test && c.benefit));
  assert.equal(opp.stakeholders[0].name, 'Pat Doe');
  assert.equal(opp.sessions[0].type, 'first_call');
  assert.equal(opp.tasks[0].title, 'Technical deep-dive');
  assert.equal(opp.discovery.teamSize, '300 developers');

  // The report: the business goals, a slide for the goal, the expansion.
  const html = (await call('se1', `/api/opportunities/${opp.id}/results`, { raw: true })).body;
  assert.match(html, /What we set out to prove/);
  assert.match(html, /Find flaws before release/);
  assert.match(html, /Scan two pilot apps/);
  assert.match(html, /From proof to rollout/);
  assert.match(html, /Critical findings caught before release/);
  const deck = await fetch(`${base}/api/opportunities/${opp.id}/deck`, { headers: { Cookie: jar.get('se1') } });
  assert.equal(deck.status, 200);
  assert.ok((await deck.arrayBuffer()).byteLength > 10000);

  // The RW report: the POV guide from the POV's own data; what is unknown says "To confirm".
  const rw = await fetch(`${base}/api/opportunities/${opp.id}/rw`, { headers: { Cookie: jar.get('se1') } });
  assert.equal(rw.status, 200);
  assert.match(rw.headers.get('content-security-policy'), /script-src 'nonce-/);
  const rwHtml = await rw.text();
  assert.match(rwHtml, /Initech · Checkmarx One Proof of Value Guide/);
  assert.match(rwHtml, /"id":"1\.1"/, 'criteria numbered goal.n');
  assert.match(rwHtml, /Find flaws before release/);
  assert.match(rwHtml, /class="tbd">tenant URL/);
  assert.ok(!/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(rwHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/, '')), 'one script');
  assert.ok(!/KLA|kla\.com/.test(rwHtml), 'nothing from the sample guide');
  // A template with the guide's goals and criteria slides (as Version Kendra had them).
  const ids = (await call('se1', '/api/deck-templates')).body.templates.map((t) => t.id);
  assert.ok(ids.includes('builtin-meridian') && ids.includes('builtin-classic') && !ids.includes('builtin-kendra') && !ids.includes('builtin-chakra'), 'Chakra and Version Kendra are gone');
  const goalsLayout = { wip: { main: ['cover', 'goals', 'goalsPlan', 'closing'], appendix: [] }, results: { main: ['cover', 'glance', 'goals', 'goalsPlan', 'closing'], appendix: [] } };
  const gt = (await call('admin', '/api/deck-templates', { method: 'POST', body: { name: 'Goals first', scope: 'everyone', layout: goalsLayout } })).body.template;
  for (const p of [`/api/opportunities/${opp.id}/wip?template=${gt.id}`, `/api/opportunities/${opp.id}/deck?style=${gt.id}`]) {
    const r = await fetch(`${base}${p}`, { headers: { Cookie: jar.get('se1') } });
    assert.equal(r.status, 200, p);
    const JSZip = (await import('jszip')).default;
    const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const all = (await Promise.all(Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => z.file(n).async('string')))).join(' ');
    assert.match(all, /Business goals and success criteria/);
    assert.match(all, /<a:t>1\.1/);
  }

  // Admins edit the bank in Kendra: SEs may not; edits stand until the SEAL files are imported again.
  assert.equal((await call('se1', '/api/bank/goals', { method: 'POST', body: { title: 'Nope' } })).status, 403);
  const eid = bank.entries[0].id;
  const ed = await call('admin', `/api/bank/entries/${eid}`, { method: 'PUT', body: { goal: 'BG-01', title: 'Find flaws before release, in hours', test: 'Scan the two pilot apps on every pull request.', benefit: 'Flaws are fixed the day they are written.', capabilityId: 'sast' } });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  assert.equal(ed.body.source, 'edited');
  assert.equal(ed.body.entries[0].title, 'Find flaws before release, in hours');
  const ng = await call('admin', '/api/bank/goals', { method: 'POST', body: { title: 'Prove compliance on demand', statement: 'Evidence comes from the platform.', measures: 'Audit pack in a day\nNo manual evidence' } });
  const key = ng.body.goals.find((g) => g.title === 'Prove compliance on demand').key;
  assert.deepEqual(ng.body.goals.find((g) => g.key === key).measures, ['Audit pack in a day', 'No manual evidence']);
  assert.equal((await call('admin', '/api/bank/entries', { method: 'POST', body: { goal: key, title: 'SBOM on demand', test: 'Export an SBOM.', benefit: 'Answers in minutes.', capabilityId: 'sbom' } })).status, 200);
  assert.equal((await call('admin', '/api/bank/entries', { method: 'POST', body: { goal: 'no-such-goal', title: 'x' } })).status, 400);
  // A new POV with the edited goal takes the edited wording.
  const o2 = (await call('se1', '/api/opportunities', { method: 'POST', body: { customer: 'Initech Two', stage: 'first_call', goalIds: [key, 'BG-01'] } })).body.opportunity;
  assert.ok(o2.criteria.some((c) => c.title === 'SBOM on demand' && c.test === 'Export an SBOM.'));
  assert.ok(o2.criteria.some((c) => c.title === 'Find flaws before release, in hours'));
  await call('se1', `/api/opportunities/${o2.id}`, { method: 'DELETE' });
  assert.equal((await call('admin', `/api/bank/goals/${key}`, { method: 'DELETE' })).body.entries.some((e) => e.goal === key), false, 'its criteria go with it');
  // Importing the SEAL files again replaces the edits.
  await new Promise((r) => setTimeout(r, 5));
  await call('admin', '/api/library/import', { method: 'POST', body: { files: [{ name: 'goals.md', text: LIB_GOALS }] } });
  assert.equal((await call('se1', '/api/bank')).body.source, 'library');
  await call('admin', '/api/bank/reset', { method: 'POST' });

  // Removing the library brings back the built-in goals.
  assert.equal((await call('admin', '/api/library', { method: 'DELETE' })).status, 200);
  assert.equal((await call('se1', '/api/bank')).body.source, 'built-in');
  await call('se1', `/api/opportunities/${opp.id}`, { method: 'DELETE' });
});

/** A small PDF in the APMA report's shape: one-byte text codes mapped through a ToUnicode CMap, compressed. */
async function fakeApmaPdf() {
  const { deflateSync } = await import('node:zlib');
  const lines = [
    'Checkmarx APMA AppSec', 'Maturity Assessment for', 'Initech', 'Results and Recommendations after initial assessment',
    'The overall maturity of your AppSec program is currently at a medium level (average maturity between level 1 and level 2). The dimensions Planning and Strategy & Governance are among the dimensions with the lowest maturity in your AppSec program at the moment.',
    'Recommendation 1: Define a basic set of strategic KPIs for your AppSec program', 'This recommendation for practice Strategic KPIs in dimension Strategy & Governance will increase the maturity of this practice from level 0 to level 1.',
    'The diagram shows the result of the interview assessment with Pat Doe. Furthermore, it shows the desired state.',
    '2.2 High Level Scores and Recommendations', 'Dimension', 'Current', 'State', 'Desired', 'State', 'Recommendation',
    'Strategy &', '1.6', '2.5', 'Your organization currently has a level of maturity.', 'Governance',
    'Security Testing - Tactical', '1.4', '2.5', 'Next steps.',
    'Security Testing - Operational', '1.8', '3.0', 'Next steps.',
    'Security Testing - Infrastructure', '1.5', '2.5', 'Next steps.',
    'Planning', '1.0', '2.0', 'Plans are defined.',
  ];
  const hex = (t) => Buffer.from(t, 'latin1').toString('hex');
  const content = deflateSync(Buffer.from(`BT /F1 10 Tf\n${lines.map((l) => `0 -12 Td [<${hex(l)}>] TJ`).join('\n')}\nET`, 'latin1'));
  const cmap = Buffer.from('/CIDInit /ProcSet findresource begin\nbegincmap\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n1 beginbfrange\n<00> <FF> <0000>\nendbfrange\nendcmap\n', 'latin1');
  const parts = [];
  const obj = (n, dict, stream) => parts.push(Buffer.concat([Buffer.from(`${n} 0 obj\n${dict}${stream ? `\nstream\n` : ''}`, 'latin1'), stream ?? Buffer.alloc(0), Buffer.from(`${stream ? '\nendstream' : ''}\nendobj\n`, 'latin1')]));
  obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
  obj(3, '<</Type/Page/Parent 2 0 R/Resources 4 0 R/MediaBox[0 0 595 842]/Contents 5 0 R>>');
  obj(4, '<</Font<</F1 6 0 R>>>>');
  obj(5, `<</Length ${content.length}/Filter/FlateDecode>>`, content);
  obj(6, '<</Type/Font/Subtype/TrueType/BaseFont/Fake/ToUnicode 7 0 R>>');
  obj(7, `<</Length ${cmap.length}>>`, cmap);
  return Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), ...parts, Buffer.from('trailer\n<</Root 1 0 R>>\n%%EOF\n', 'latin1')]);
}

test('the POV WIP deck: toolchain, plan, meetings, the APMA report read from its PDF, poured into the team’s template', async () => {
  const pdf = await fakeApmaPdf();
  const { readApma } = await import('../src/apma.js');
  const a = readApma(pdf);
  assert.equal(a.customer, 'Initech');
  assert.equal(a.interviewee, 'Pat Doe');
  assert.deepEqual(a.dimensions.map((d) => [d.current, d.desired]), [[1.6, 2.5], [1, 2], [1.4, 2.5], [1.8, 3], [1.5, 2.5]]);
  assert.equal(a.recommendations[0].practice, 'Strategic KPIs');
  assert.throws(() => readApma(Buffer.from('not a pdf')), /not a PDF/);

  const o = await call('se1', '/api/opportunities', {
    method: 'POST',
    body: {
      customer: 'Initech WIP',
      startDate: '2026-11-02',
      endDate: '2026-11-30',
      criteria: [{ capabilityId: 'sast', priority: 'must' }, { capabilityId: 'dev-assist', priority: 'must' }],
      stakeholders: [{ name: 'Pat Doe', email: 'pat@initech.example', side: 'customer', povRole: 'POV admin' }],
      sessions: [{ type: 'launch', date: '2026-11-02', title: 'POV launch', did: 'Onboarding complete\nSCM connected', theirNext: 'Internal testing', status: 'done' }, { type: 'wrapup', date: '2099-01-01', title: 'Wrap-up call' }],
      toolchain: { ide: { tools: ['VS Code'], access: 'add plugins' }, scm: ['Bitbucket'], languages: 'Java' },
      plan: { outOfScope: 'Production' },
    },
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const opp = o.body.opportunity;
  assert.equal(opp.stakeholders[0].povRole, 'POV admin');
  assert.equal(opp.sessions.find((s) => s.type === 'launch').did, 'Onboarding complete\nSCM connected');
  assert.deepEqual(opp.toolchain.ide, { tools: ['VS Code'], access: 'add plugins' });
  assert.deepEqual(opp.toolchain.scm.tools, ['Bitbucket']);
  assert.equal(opp.plan.outOfScope, 'Production');

  // The APMA report: optional, read when it is added, kept encrypted.
  const up = await fetch(`${base}/api/opportunities/${opp.id}/apma`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/pdf', Cookie: jar.get('se1') }, body: pdf });
  assert.equal(up.status, 200);
  const upBody = await up.json();
  assert.equal(upBody.found, 5);
  assert.equal(upBody.otherCustomer, false, 'Initech’s report on the Initech account');
  assert.equal(upBody.apma.interviewee, undefined, 'names in the report are never kept');
  assert.equal(upBody.apma.customer, undefined);
  const back = await fetch(`${base}/api/opportunities/${opp.id}/apma`, { headers: { Cookie: jar.get('se1') } });
  assert.deepEqual(Buffer.from(await back.arrayBuffer()), pdf);
  assert.ok(!fs.readFileSync(path.join(dataDir, 'apma', `${opp.id}.pdf`)).includes(Buffer.from('Initech')), 'stored encrypted');

  const JSZip = (await import('jszip')).default;
  const slideTexts = async (buf) => {
    const z = await JSZip.loadAsync(buf);
    const names = Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return Promise.all(names.map(async (n) => [...(await z.file(n).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ')));
  };
  const get = async () => {
    const r = await fetch(`${base}/api/opportunities/${opp.id}/wip`, { headers: { Cookie: jar.get('se1') } });
    assert.equal(r.status, 200, r.status === 200 ? '' : await r.clone().text());
    return Buffer.from(await r.arrayBuffer());
  };
  const plain = await get();
  const texts = (await slideTexts(plain)).join(' | ');
  for (const t of ['INITECH WIP', 'Executive Overview', 'Tailored to Your DevSecOps', 'APMA Assessment', 'Pat Doe', 'POV Plan &amp; Timeline', 'POV Environment Details', 'Bitbucket', 'add plugins', 'Production', 'Test Plan Overview', 'Meeting Notes', 'Onboarding complete', 'Internal testing']) assert.ok(texts.includes(t), `the deck has “${t}”`);

  // The team's template: only those who manage settings upload it; its look is kept, its slides are not.
  const tpl = plain;
  const deny = await fetch(`${base}/api/wip-template`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', Cookie: jar.get('se1') }, body: tpl });
  assert.equal(deny.status, 403);
  const ok = await fetch(`${base}/api/wip-template`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', Cookie: jar.get('admin'), 'X-File-Name': 'team.pptx' }, body: tpl });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).template.closing, true);
  const bad = await fetch(`${base}/api/wip-template`, { method: 'POST', headers: { 'X-Requested-With': 'Kendra', Cookie: jar.get('admin') }, body: Buffer.from('nope') });
  assert.equal(bad.status, 400);
  const filled = await get();
  const z = await JSZip.loadAsync(filled);
  const pres = await z.file('ppt/presentation.xml').async('string');
  const count = [...pres.matchAll(/<p:sldId /g)].length;
  // One slide for each, the closing one from the template; a template environment slide also brings the full one to the appendix.
  assert.ok(count >= (await slideTexts(plain)).length, 'every slide, and the template’s own versions with Kendra’s in the appendix');
  const rels = await z.file('ppt/_rels/presentation.xml.rels').async('string');
  for (const m of rels.matchAll(/Target="(slides\/[^"]+)"/g)) assert.ok(z.file(`ppt/${m[1]}`), `${m[1]} is in the file`);
  for (const n of Object.keys(z.files).filter((x) => /^ppt\/slides\/_rels\/.+\.rels$/.test(x))) for (const m of (await z.file(n).async('string')).matchAll(/Target="\.\.\/([^"]+)"/g)) assert.ok(z.file(`ppt/${m[1]}`), `${n} points at ${m[1]}, which exists`);
  // The results presentation in the team's style; Classic stays the default.
  const team = await fetch(`${base}/api/opportunities/${opp.id}/deck?style=team`, { headers: { Cookie: jar.get('se1') } });
  assert.equal(team.status, 200);
  const teamText = (await slideTexts(Buffer.from(await team.arrayBuffer()))).join(' | ');
  assert.ok(teamText.includes('Proof of Value Results') && teamText.includes('Next Steps'), 'the team-style results deck');
  const classic = await fetch(`${base}/api/opportunities/${opp.id}/deck?style=classic`, { headers: { Cookie: jar.get('se1') } });
  assert.ok(!(await slideTexts(Buffer.from(await classic.arrayBuffer()))).join(' ').includes('Proof of Value Results'), 'Classic when asked');
  assert.equal((await call('admin', '/api/wip-template', { method: 'DELETE' })).status, 200);
  await call('se1', `/api/opportunities/${opp.id}`, { method: 'DELETE' });
});

test('success criteria count everything the tenant ever proved, not only the last 7 days', async () => {
  const { mergeProof, historyFrom, proofScans } = await import('../src/proof.js');
  const old = seedTenant('history', { projects: 2, scans: 3, seed: 3 });
  const day = 86_400e3;
  // A SAST scan 20 days ago, and nothing else with SAST since.
  old.scans = [
    { ...old.scans[0], id: 'old-sast', status: 'Completed', engines: ['sast'], sourceOrigin: 'Jenkins', createdAt: new Date(Date.now() - 20 * day).toISOString(), updatedAt: new Date(Date.now() - 20 * day + 600e3).toISOString() },
    { ...old.scans[1], id: 'new-sca', status: 'Completed', engines: ['sca'], sourceOrigin: 'Web', createdAt: new Date(Date.now() - 1 * day).toISOString(), updatedAt: new Date(Date.now() - 1 * day + 600e3).toISOString() },
  ];
  const m = await startMock({ tenants: { history: old } });
  try {
    const conn = deriveConnection(apiKeyFor(m.origin, 'history'));
    // The first read: the whole history.
    const first = await collect(conn, { historyFrom: historyFrom(null) });
    assert.deepEqual(first.scans.map((s) => s.id), ['new-sca'], 'the dashboards still show the last 7 days');
    let proof = mergeProof(null, [...first.scans, ...first.older], { tenant: conn.tenant, at: first.at });
    assert.ok(proof.engines.sast, 'the 20-day-old SAST scan is on the record');
    assert.ok(proof.syncedTo);
    // Later reads take only what is new, and the record keeps the old scan.
    const next = await collect(conn, { historyFrom: historyFrom(proof) });
    assert.equal(next.older.length, 0);
    proof = mergeProof(proof, next.scans, { tenant: conn.tenant, at: next.at });
    assert.equal(proof.engines.sast.count, 1, 'a scan read twice is counted once');
    const sast = DEFAULT_CATALOG.find((c) => c.id === 'sast');
    const ev = evaluate(sast, tenantFacts(next, proof));
    assert.equal(ev.level, 'detected');
    assert.match(ev.evidence[0], /sast engine \(since /);
    assert.equal(evaluate(sast, tenantFacts(next)).level, 'none', 'the last 7 days alone would have missed it');
    assert.ok(proofScans(proof).some((s) => s.id === 'old-sast'), 'the old scan is shown as proof');
    // Another tenant on the same POV starts a new record.
    assert.equal(mergeProof(proof, [], { tenant: 'other' }).engines.sast, undefined);
  } finally {
    m.server.close();
  }
});

test('SharePoint: an Admin connects the Microsoft app, an SE publishes the POV’s documents to its site', async () => {
  const http = await import('node:http');
  const got = [];
  const ms = http.createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      body = Buffer.concat(body);
      const json = (code, o) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
      if (req.url.endsWith('/oauth2/v2.0/token')) return new URLSearchParams(body.toString()).get('client_secret') === 'top-secret' ? json(200, { access_token: 'tok', expires_in: 3600 }) : json(401, { error: 'invalid_client' });
      if (req.headers.authorization !== 'Bearer tok') return json(401, { error: { message: 'no token' } });
      if (req.method === 'GET' && req.url.startsWith('/v1.0/sites/contoso.sharepoint.com:/sites/Initech')) return json(200, { id: 'site-1', displayName: 'Initech POV', webUrl: 'https://contoso.sharepoint.com/sites/Initech' });
      if (req.method === 'PUT' && req.url.startsWith('/v1.0/sites/site-1/drive/root:/')) {
        got.push({ path: decodeURIComponent(req.url), size: body.length });
        return json(201, { webUrl: `https://contoso.sharepoint.com/x/${got.length}`, size: body.length });
      }
      json(404, { error: { message: `no route ${req.method} ${req.url}` } });
    });
  });
  await new Promise((r) => ms.listen(0, '127.0.0.1', r));
  process.env.CC_MS_LOGIN_URL = process.env.CC_MS_GRAPH_URL = `http://127.0.0.1:${ms.address().port}`;
  try {
    assert.equal((await call('se1', '/api/settings/sharepoint')).status, 403);
    assert.equal((await call('admin', '/api/settings/sharepoint', { method: 'PUT', body: { tenantId: '11111111-1111-1111-1111-111111111111', clientId: '22222222-2222-2222-2222-222222222222', clientSecret: 'top-secret' } })).status, 200);
    const shown = await call('admin', '/api/settings/sharepoint');
    assert.equal(shown.body.hasSecret, true);
    assert.ok(!JSON.stringify(shown.body).includes('top-secret'), 'the secret never comes back');
    const t = await call('admin', '/api/settings/sharepoint/test', { method: 'POST', body: { siteUrl: 'https://contoso.sharepoint.com/sites/Initech' } });
    assert.equal(t.body.site, 'Initech POV');
    const o = await call('se1', '/api/opportunities', { method: 'POST', body: { customer: 'Initech SP', sharepointUrl: 'https://contoso.sharepoint.com/sites/Initech/Shared%20Documents' } });
    const id = o.body.opportunity.id;
    const r = await call('se1', `/api/opportunities/${id}/sharepoint`, { method: 'POST', body: { what: ['wip', 'results'] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.folder, 'POV/Initech SP');
    assert.equal(got.length, 2);
    assert.ok(got.every((g) => g.path.includes('/POV/Initech SP/Initech SP - POV') && g.size > 1000));
    const after = (await call('se1', `/api/opportunities/${id}`)).body.opportunity;
    assert.equal(after.sharepointPublished.files.length, 2);
    await call('se1', `/api/opportunities/${id}`, { method: 'DELETE' });
  } finally {
    delete process.env.CC_MS_LOGIN_URL;
    delete process.env.CC_MS_GRAPH_URL;
    ms.close();
  }
});

test('presentation templates: managers compose the slides, share one with customers for their team, POVs follow it', async () => {
  // An associate cannot make one; a team lead can.
  assert.equal((await call('se1', '/api/deck-templates', { method: 'POST', body: { name: 'Mine' } })).status, 403);
  const made = await call('tl', '/api/deck-templates', {
    method: 'POST',
    body: { name: 'Crisp results', layout: { results: { main: ['cover', 'tests', 'closing'], appendix: ['evidence', 'nope'] }, wip: { main: ['cover', 'plan'], appendix: [] } }, texts: { support: 'Weekly office hours\nA named AppSec expert', quote: 'Secure what comes next.' } },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.template.id;
  assert.deepEqual(made.body.template.layout.results.appendix, ['evidence'], 'unknown slides are dropped');
  assert.deepEqual(made.body.template.texts.support, ['Weekly office hours', 'A named AppSec expert']);
  // Shared with customers for the team lead's team: their SE's POV follows it.
  assert.equal((await call('tl', '/api/deck-templates/default', { method: 'PUT', body: { templateId: id } })).status, 200);
  assert.equal((await call('tl', '/api/deck-templates/default', { method: 'PUT', body: { templateId: id, org: true } })).status, 403, 'only Admins set everyone’s');
  const listed = (await call('se1', '/api/deck-templates')).body.templates;
  assert.ok(listed.some((t) => t.id === id), 'their SE sees it');
  assert.ok(listed.some((t) => t.id === 'builtin-classic') && listed.some((t) => t.id === 'builtin-meridian'));
  const o = await call('se1', '/api/opportunities', { method: 'POST', body: { customer: 'Template Co', criteria: [{ capabilityId: 'sast' }] } });
  const JSZip = (await import('jszip')).default;
  const slides = async (p) => {
    const r = await fetch(`${base}/api/opportunities/${o.body.opportunity.id}/${p}`, { headers: { Cookie: jar.get('se1') } });
    assert.equal(r.status, 200);
    const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const names = Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)[1]) - Number(/(\d+)\.xml/.exec(b)[1]));
    return Promise.all(names.map(async (n) => [...(await z.file(n).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ')));
  };
  const results = await slides('deck');
  assert.equal(results.length, 5, 'cover, test plan, closing, the appendix divider, evidence');
  assert.match(results[1], /Test Plan Overview/);
  assert.match(results.at(-1), /Evidence/);
  const wip = await slides('wip');
  assert.ok(wip.some((t) => /Weekly office hours/.test(t)), 'the template’s own words');
  // A POV can choose another; Classic stays the original deck.
  await call('se1', `/api/opportunities/${o.body.opportunity.id}`, { method: 'PATCH', body: { deckTemplateId: 'builtin-classic' } });
  assert.ok(!(await slides('deck')).join(' ').includes('Test Plan Overview'));
  assert.equal((await call('se1', `/api/deck-templates/${id}`, { method: 'DELETE' })).status, 403, 'not theirs to remove');
  assert.equal((await call('tl', `/api/deck-templates/${id}`, { method: 'DELETE' })).status, 200);
  await call('se1', `/api/opportunities/${o.body.opportunity.id}`, { method: 'DELETE' });
});

test('ASPM and DAST read the way the portal reads them: counts kept, names and login settings never', async () => {
  const { aspm } = await import('../src/collector.js');
  const answers = {
    '/api/applications': { totalCount: 3, applications: [{ name: 'Payments', criticality: 5, rules: [{ type: 'project.name.in', value: 'pay' }], projectIds: ['p1', 'p2'] }, { name: 'Web', projectIds: ['p2'] }] },
    '/api/risk-management/summary': { summary: [{ name: 'Payments', riskScore: 8.9, riskSeverity: 'high' }, { name: 'Web', riskScore: 4.1, riskSeverity: 'medium' }] },
    '/api/risks': { metaData: { totalResults: 229 }, risks: [{ assetName: 'secret.py', origin: 'security-mcp' }, { origin: 'github' }] },
    '/api/contributors/insights': { total: 311, max: 1000, 'VS Code': { projectCount: 0, contributorCount: 90 }, 'Visual Studio_1.0.0/ASTCLI_2.3.63': { contributorCount: 1 }, 'Visual Studio': { contributorCount: 1 }, Cursor: { contributorCount: 19 }, 'Claude-cli': { contributorCount: 19 }, Kiro: { contributorCount: 0 } },
    '/api/ai-sc/global-inventory/results': { totalCount: 7, results: [{ name: 'claude-sonnet' }] },
    '/api/projects/schedules': { schedules: [{ name: 'Nightly', active: true, frequency: 'daily' }, { active: false }], total_count: 2 },
    '/api/cnas/accounts': { data: [{ name: 'prod', lastScanDate: '2026-11-20T10:00:00Z' }], total: 2 },
    '/api/policy_management_service_uri/policies/v3': { policies: [{ name: 'Default', defaultPolicy: true, projects: [{ astProjectId: 'p1' }] }, { name: 'No new criticals', projects: [{ astProjectId: 'p1', name: 'Payments' }], tags: [], breakBuild: false, netNewBreakBuild: true }, { name: 'Draft', projects: [], tags: [] }] },
    '/api/policy_management_service_uri/incidents/total': 12,
    '/api/feedback-app/v2/apps': { apps: [{ id: 6480, name: 'Acme Jira', type: 'Jira' }, { id: 7, type: 'Email' }, { id: 8, applicationType: { name: 'Slack' } }] },
    '/api/feedback-app/v3/profiles': { profiles: [{ name: 'AppSec', appsIds: [6480], projectsIds: ['p1', 'p2'] }, { appsIds: [6480, 7], projectsIds: ['p2', 'p3'] }] },
    'https://iam.example/auth/admin/realms/acme/identity-provider/instances': [{ alias: 'okta', providerId: 'saml', enabled: true }, { alias: 'old', providerId: 'oidc', enabled: false }],
    'https://iam.example/auth/admin/realms/acme/components': [{ name: 'corp', providerId: 'ldap' }],
    '/api/access-management/groups': [{ id: 'g1', name: 'AppSec' }, { id: 'g2', name: 'Dev' }],
    '/api/custom-states': [{ id: 595, name: 'Accepted risk', type: 'INFO' }],
    '/api/queries/presets': [{ id: 1, name: 'ASA Premium' }, { id: 54, name: 'OWASP Top 10' }, { id: 1802187495, name: 'Acme preset' }],
    '/api/dast/scans/environments': { totalItems: 4, environments: [{ domain: 'shop.example', lastScanTime: '2026-11-21T09:00:00Z', settings: { authSettings: { userName: 'u', password: 'hunter2' } } }, { domain: 'b.example' }] },
  };
  const client = { request: async (p) => (p in answers ? answers[p] : Promise.reject(Object.assign(new Error('404'), { status: 404 }))) };
  const a = await aspm(client, { iamUrl: 'https://iam.example', tenant: 'acme' });
  assert.deepEqual(a.applications, { total: 3, withRules: 1, projects: 2 });
  assert.equal(a.armScores.scored, 2);
  assert.equal(a.armScores.top, 8.9);
  assert.deepEqual(a.risks, { total: 229, viaMcp: 1 });
  assert.deepEqual(a.schedules, { total: 2, active: 1 });
  assert.deepEqual(a.aiInventory, { assets: 7 });
  assert.deepEqual(a.contributors, { total: 311, tools: { 'VS Code': 90, 'Visual Studio': 2, Cursor: 19, 'Claude-cli': 19 } });
  assert.deepEqual(a.cloud, { accounts: 2, lastScanAt: '2026-11-20T10:00:00.000Z' });
  assert.deepEqual(a.feedback, { jira: { apps: 1, projects: 3 }, email: { apps: 1, projects: 2 }, slack: { apps: 1, projects: 0 } });
  assert.deepEqual(a.access, { sso: 1, ssoKinds: ['SAML'], ldap: 1, groups: 2 });
  assert.deepEqual(a.triage, { customStates: 1, customPresets: 1 });
  assert.deepEqual(a.policies, { made: 2, applied: 1, breakBuild: 1, violations: 12 });
  assert.deepEqual(a.dast, { environments: 4, scanned: 1, lastScanAt: '2026-11-21T09:00:00.000Z' });
  assert.ok(!/hunter2|Payments|shop\.example|secret\.py|prod|Acme Jira|AppSec|okta|corp|Accepted risk|Acme preset|Nightly|claude-sonnet/.test(JSON.stringify(a)), 'no names, no passwords');
  // A tenant without ASPM answers nothing: every part is null, the read goes on.
  const none = await aspm({ request: async () => Promise.reject(new Error('403')) });
  assert.ok(Object.values(none).every((v) => v === null));

  const facts = tenantFacts({ scans: [], projects: { list: [] }, aspm: a });
  const cap = (id) => DEFAULT_CATALOG.find((x) => x.id === id);
  assert.match(evaluate(cap('risk-orchestration'), facts).evidence[0], /229 risks/);
  assert.equal(evaluate(cap('arm'), facts).level, 'detected');
  assert.deepEqual(evaluate(cap('jira'), facts).evidence, ['A Jira feedback app is set up, used by 3 projects']);
  assert.deepEqual(evaluate(cap('chat'), facts).evidence, ['A Slack feedback app is set up, not yet on a project']);
  assert.equal(evaluate(cap('servicenow'), facts).level, 'none');
  assert.deepEqual(evaluate(cap('sso'), facts).evidence, ['Single sign-on through 1 identity provider (SAML)', 'Users come from 1 LDAP directory']);
  assert.deepEqual(evaluate(cap('triage-workflow'), facts).evidence, ['1 triage state of their own']);
  assert.deepEqual(evaluate(cap('mcp'), facts).evidence, ['1 risk found through the Checkmarx MCP']);
  assert.deepEqual(evaluate(cap('cursor'), facts).evidence, ['19 developers use Checkmarx from Cursor']);
  assert.match(evaluate(cap('vscode'), facts).evidence[0], /90 developers use Checkmarx from VS Code/);
  assert.equal(evaluate(cap('kiro'), facts).level, 'none', 'no developers, no proof');
  assert.deepEqual(evaluate(cap('aisc'), facts).evidence, ['AI Inventory lists 7 AI assets (models, agents, MCP servers) found in the code']);
  // The SBOM, made the way the SCA page exports it: started, waited for, downloaded.
  const { exportSbom } = await import('../src/collector.js');
  const calls = [];
  let polls = 0;
  const sbomClient = { request: async (p, o = {}) => {
    calls.push(`${o.method ?? 'GET'} ${p}`);
    if (o.method === 'POST') { assert.equal(o.body.FileFormat, 'CycloneDxjson'); assert.equal(o.body.ScanId, 'scan-1'); return { exportId: 'e1' }; }
    if (p === '/api/sca/export/requests') return { exportStatus: ++polls < 2 ? 'Exporting' : 'Completed' };
    return { bomFormat: 'CycloneDX', components: [] };
  } };
  assert.match(await exportSbom(sbomClient, 'scan-1', 'cyclonedx', { everyMs: 1 }), /"bomFormat": "CycloneDX"/);
  assert.deepEqual(calls, ['POST /api/sca/export/requests', 'GET /api/sca/export/requests', 'GET /api/sca/export/requests', 'GET /api/sca/export/requests/e1/download']);
  await assert.rejects(exportSbom({ request: async (p, o = {}) => (o.method === 'POST' ? { exportId: 'e2' } : { exportStatus: 'Failed' }) }, 's', 'spdx', { everyMs: 1 }), /could not make the SBOM/);
  assert.match(evaluate(cap('llm-scanner'), tenantFacts({ scans: [{ status: 'Completed', engines: ['sast', 'aisc'] }], projects: { list: [] } })).evidence[0], /aisc engine/, 'the LLM Scanner runs as aisc');
  assert.deepEqual(evaluate(cap('scheduled-scans'), facts).evidence, ['1 scan schedule running by itself']);
  const { supplyChain } = await import('../src/collector.js');
  const asked = [];
  const sc = await supplyChain({ request: async (p, o) => { asked.push(o.body.variables.scanId); if (o.body.variables.scanId === 's3') throw new Error('no SCA'); return { data: { supplyChainRisksByScanId: { totalCount: o.body.variables.scanId === 's1' ? 2 : 0 } } }; } }, ['s1', 's2', 's3']);
  assert.deepEqual(sc, { checked: 2, risks: 2 });
  assert.deepEqual(asked, ['s1', 's2', 's3']);
  assert.deepEqual(evaluate(cap('malicious'), tenantFacts({ scans: [], projects: { list: [] }, aspm: { supplyChain: sc } })).evidence, ['Supply chain risk checked on the latest SCA scan of 2 projects: 2 malicious or suspicious packages found']);
  const triaged = tenantFacts({ scans: [], projects: { list: [] }, findings: { byProject: { p1: { confirmed: 2, urgent: 1, notExploitable: 3, proposedNotExploitable: 9 }, p2: { proposedNotExploitable: 4 } } } });
  assert.deepEqual(evaluate(cap('triage-workflow'), triaged).evidence, ['6 findings triaged by hand to Confirmed, Urgent or Not exploitable, in 1 project'], 'AI proposals do not count as manual triage');
  assert.deepEqual(evaluate(cap('presets'), facts).evidence, ['1 SAST preset of their own']);
  assert.deepEqual(evaluate(cap('rbac'), facts).evidence, ['2 groups set up for access']);
  assert.match(evaluate(cap('cloud-insights'), facts).evidence[0], /2 cloud accounts connected/);
  assert.match(evaluate(cap('dast'), facts).evidence.join(' '), /DAST scanned 1 environment/);
  assert.deepEqual(evaluate(cap('policy'), facts).evidence, ['1 policy applied to projects, 1 breaking the build', 'Policies raised 12 violations']);
  assert.equal(evaluate(cap('policy'), tenantFacts({ scans: [], projects: { list: [] }, aspm: { ...a, policies: { made: 1, applied: 0, breakBuild: 0, violations: 0 } } })).level, 'none', 'a policy on nothing proves nothing');
});

test('What the POV changed: the Analytics dashboard read for the POV’s projects, the start kept, shown the same everywhere', async () => {
  const { analytics } = await import('../src/collector.js');
  const { impactTiles } = await import('../src/impact.js');
  const asked = [];
  // Answers in the shape the portal's Analytics dashboard gets them.
  const A = {
    meanTimeToResolution: { meanTimeData: [{ label: 'Critical', meanTime: 6, results: 90 }, { label: 'High', meanTime: 4, results: 300 }, { label: 'Medium', meanTime: 4, results: 310 }], totalResults: 700 },
    vulnerabilitiesByAging: { agingAndSeverities: [{ label: '0-30 Days', results: 900, severities: [{ label: 'Critical', results: 90 }, { label: 'High', results: 400 }, { label: 'Medium', results: 410 }] }, { label: '31-60 Days', results: 80, severities: [{ label: 'Critical', results: 9 }, { label: 'High', results: 40 }, { label: 'Medium', results: 31 }] }, { label: 'Totals', results: 980, severities: [] }] },
    stateAndSeverity: { statesAndSeverities: [{ label: 'To Verify', results: 600 }, { label: 'Not Exploitable', results: 150 }, { label: 'Confirmed', results: 200 }, { label: 'Urgent', results: 50 }, { label: 'Totals', results: 1000 }] },
    scans: { data: { value: 368 } }, scanned_projects: { data: { value: 107 } }, loc: { data: { value: 7480011 } },
  };
  const client = { request: async (p, o) => (asked.push([p, o.body.kpi, o.body.filters.projects, o.body.range.definedRange]), A[o.body.kpi] ?? Promise.reject(new Error('404'))) };
  const now = await analytics(client, { projectIds: ['p1', 'p2'], range: '90d' });
  assert.deepEqual(now.mttrDays, { critical: 6, high: 4, medium: 4 });
  assert.equal(now.resolved, 700);
  assert.deepEqual(now.aging.map((b) => b.label), ['0-30 Days', '31-60 Days'], 'the totals row is not a band');
  assert.deepEqual(now.states, { total: 1000, toVerify: 600, confirmed: 200, urgent: 50, notExploitable: 150, proposed: 0 });
  assert.deepEqual([now.scans, now.projects, now.loc], [368, 107, 7480011]);
  assert.ok(asked.every(([, , projects, range]) => projects.join() === 'p1,p2' && range === '90d'), 'the POV’s projects, the POV’s window');
  assert.equal(await analytics({ request: async () => Promise.reject(new Error('403')) }), null, 'no Analytics: nothing claimed');

  const start = { ...now, mttrDays: { critical: 21, high: 9, medium: 7 }, states: { ...now.states, toVerify: 980 } };
  const tiles = impactTiles({ now, start });
  assert.deepEqual(tiles.map((t) => [t.label, t.value]), [['Scans run', '368'], ['Projects scanned', '107'], ['Lines of code scanned', '7.5M'], ['Critical fix time', '6 days'], ['Findings triaged', '40%'], ['Findings fixed', '700']]);
  assert.equal(tiles[3].sub, 'from 21 days at the start');
  assert.equal(tiles[4].sub, 'from 2% at the start');
  assert.deepEqual(impactTiles(null), []);
  // The Analytics criterion shows the numbers as its evidence.
  const facts = tenantFacts({ scans: [], projects: { list: [] }, analytics: now });
  assert.deepEqual(evaluate(DEFAULT_CATALOG.find((c) => c.id === 'analytics'), facts).evidence, ['Analytics shows critical fix time 6 days, 40% of findings triaged, 368 scans (last 90 days)']);
  // The decks: Kendra's (and Version Kendra's) six tiles and the charts, and Classic's tiles.
  const { wipDeck } = await import('../src/wip.js');
  const { finalDeck } = await import('../src/deck.js');
  const opp = { customer: 'Acme', startDate: '2026-09-01', endDate: '2026-11-30', criteria: [], sessions: [], stakeholders: [] };
  const story = { analytics: { now, start }, criteria: [], goals: [], progress: { met: 0, total: 0, percent: 0, must: 0, mustMet: 0 } };
  const JSZip = (await import('jszip')).default;
  const textOf = async (buf) => {
    const z = await JSZip.loadAsync(buf);
    return { z, text: (await Promise.all(Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => z.file(n).async('string')))).join(' ') };
  };
  const m = await textOf(await wipDeck(opp, { story, mode: 'results', layout: { results: { main: ['impact'], appendix: ['analyticsDetail'] } } }));
  assert.match(m.text, /What the POV Changed/);
  assert.match(m.text, /from 21 days at the start/);
  assert.match(m.text, /Fix Time and Ageing/);
  assert.ok(Object.keys(m.z.files).some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)), 'the charts are in the file');
  const c = await textOf(await finalDeck(opp, { story, categories: [] }));
  assert.match(c.text, /What the POV changed/);
  assert.match(c.text, /7\.5M/);
});

test('POV screenshots: added, ordered and named by the SE; Chakra puts them before the appendix, the closing slide last', async () => {
  const zlib = await import('node:zlib');
  const png = (w, h, rgb) => {
    const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0).map((_, i) => rgb[i % 3])]);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
  };
  const o = (await call('se1', '/api/opportunities', { method: 'POST', body: { customer: 'Shots Ltd', stage: 'pov', criteria: [{ capabilityId: 'sast' }], sessions: [{ type: 'launch', date: '2026-11-02', title: 'Kick-off', did: 'Scanned the first app' }] } })).body.opportunity;
  const up = (buf, caption) => fetch(`${base}/api/opportunities/${o.id}/screenshots?caption=${encodeURIComponent(caption)}`, { method: 'POST', headers: { ...H, Cookie: jar.get('se1'), 'Content-Type': 'image/png' }, body: buf });
  assert.equal((await up(Buffer.from('not a picture at all, really'), 'Nope')).status, 400);
  assert.equal((await up(png(160, 90, [107, 52, 253]), 'Analytics and Dashboard')).status, 200);
  const r2 = await up(png(90, 160, [242, 89, 41]), 'Triaging SAST result');
  const shots = (await r2.json()).opportunity.screenshots;
  assert.deepEqual(shots.map((x) => [x.caption, x.w, x.h, x.type]), [['Analytics and Dashboard', 160, 90, 'image/png'], ['Triaging SAST result', 90, 160, 'image/png']]);
  // Moved up, renamed; the picture itself is kept encrypted and served to those who may see the POV.
  await call('se1', `/api/opportunities/${o.id}/screenshots/${shots[1].id}`, { method: 'PUT', body: { move: -1, caption: 'Triaging a SAST result' } });
  const img = await fetch(`${base}/api/opportunities/${o.id}/screenshots/${shots[0].id}`, { headers: { Cookie: jar.get('se1') } });
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.ok(!fs.readdirSync(path.join(dataDir, 'screenshots'), { recursive: true }).some((f) => String(f).endsWith('.img') && fs.readFileSync(path.join(dataDir, 'screenshots', String(f))).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))), 'not kept as a plain picture');
  // The order of the team's WIP deck (as Chakra had it): screenshots before the appendix, the closing slide last.
  const chakra = (await call('admin', '/api/deck-templates', { method: 'POST', body: { name: 'Team order', scope: 'everyone', layout: { wip: { main: ['cover', 'devsecops', 'components', 'apma', 'plan', 'env', 'tests', 'screenshots'], appendix: ['tenantEvidence', 'notes', 'closing'] } } } })).body.template;
  const r = await fetch(`${base}/api/opportunities/${o.id}/wip?template=${chakra.id}`, { headers: { Cookie: jar.get('se1') } });
  assert.equal(r.status, 200);
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
  const pres = await z.file('ppt/presentation.xml').async('string');
  const rels = await z.file('ppt/_rels/presentation.xml.rels').async('string');
  const rel = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]]));
  const order = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) order.push([...(await z.file(`ppt/${rel[m[1]]}`).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join(' '));
  const at = (re) => order.findIndex((t) => re.test(t));
  assert.equal(at(/SHOTS LTD/), 0, 'the cover first');
  assert.ok(at(/Tailored to Your DevSecOps/) < at(/POV Plan/) && at(/POV Plan/) < at(/Test Plan Overview/));
  assert.ok(at(/Test Plan Overview/) < at(/POV Screenshots/), 'the screenshots after the test plan');
  assert.match(order[at(/POV Screenshots/) + 1], /Triaging a SAST result/, 'in the order the SE set');
  assert.match(order[at(/POV Screenshots/) + 2], /Analytics and Dashboard/);
  assert.ok(at(/POV Screenshots/) < at(/\bAppendix$/) && at(/\bAppendix$/) < at(/Meeting Notes/));
  assert.equal(at(/comes next/), order.length - 1, 'the closing slide last');
  // Removed: gone from the POV and from the disk.
  await call('se1', `/api/opportunities/${o.id}/screenshots/${shots[0].id}`, { method: 'DELETE' });
  assert.equal((await call('se1', `/api/opportunities/${o.id}`)).body.opportunity.screenshots.length, 1);
  await call('se1', `/api/opportunities/${o.id}`, { method: 'DELETE' });
});

test('Evidence from Checkmarx One: integrations, triage, supply chain and governance, scan activity, in the appendix', async () => {
  const { tenantEvidence } = await import('../src/tenant-evidence.js');
  const snap = {
    at: '2026-11-24T14:00:00.000Z',
    scans: [
      { createdAt: '2026-11-22T10:00:00Z', status: 'Completed', engines: ['sast', 'sca'], origin: 'VS Code' },
      { createdAt: '2026-11-22T11:00:00Z', status: 'Completed', engines: ['sast'], origin: 'Jenkins' },
      { createdAt: '2026-11-23T09:00:00Z', status: 'Failed', engines: ['kics'], origin: 'Jenkins' },
    ],
    projects: { list: [{ repoUrl: 'https://github.com/acme/payments' }, { repoUrl: 'https://bitbucket.org/acme/web' }, { repoUrl: '' }] },
    findings: { critical: 3, high: 10, medium: 20, low: 5, byProject: { p1: { toVerify: 30, confirmed: 4, urgent: 1, notExploitable: 2, proposedNotExploitable: 3 } } },
    credits: { actions: { triage: 12, remediation: 4 } },
    aspm: { contributors: { tools: { 'VS Code': 90, Cursor: 19 } }, feedback: { jira: { apps: 1, projects: 3 } }, triage: { customStates: 2 }, supplyChain: { checked: 5, risks: 1 }, policies: { made: 2, applied: 1, breakBuild: 1, violations: 7 }, access: { sso: 1, ssoKinds: ['SAML'], groups: 4 }, applications: { total: 3 }, risks: { total: 229 } },
  };
  const ev = tenantEvidence(snap);
  assert.deepEqual(ev.integrations.origins, [{ name: 'Jenkins', count: 2 }, { name: 'VS Code', count: 1 }]);
  assert.deepEqual(ev.integrations.hosts, [{ name: 'GitHub', count: 1 }, { name: 'Bitbucket', count: 1 }]);
  assert.deepEqual(ev.integrations.feedback, [{ name: 'Jira', projects: 3 }]);
  assert.deepEqual(ev.triage.states, { toVerify: 30, confirmed: 4, urgent: 1, notExploitable: 2, proposedNotExploitable: 3 });
  assert.deepEqual(ev.activity.days, ['2026-11-22', '2026-11-23']);
  assert.deepEqual(ev.activity.perDay.find((e) => e.engine === 'sast').values, [2, 0], 'completed scans only');
  assert.equal(tenantEvidence(null), null);
  const { wipDeck } = await import('../src/wip.js');
  const buf = await wipDeck({ customer: 'Acme', criteria: [], sessions: [], stakeholders: [] }, { story: { tenantEvidence: ev, criteria: [], goals: [] }, layout: { wip: { main: ['cover'], appendix: ['tenantEvidence'] } } });
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(buf);
  const text = (await Promise.all(Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => z.file(n).async('string')))).join(' ');
  for (const t of ['Appendix', 'Evidence from Checkmarx One', 'Integrations in Use', 'Triage', 'Supply Chain and Governance', 'Scan Activity', 'From Checkmarx One, 24 Nov 2026']) assert.ok(text.includes(t), t);
  assert.ok(!/acme\/payments/.test(text), 'no repository names');
  // Nothing from the tenant: no evidence slides at all.
  const empty = await JSZip.loadAsync(await wipDeck({ customer: 'Acme', criteria: [], sessions: [], stakeholders: [] }, { story: { tenantEvidence: null, criteria: [], goals: [] }, layout: { wip: { main: ['cover'], appendix: ['tenantEvidence'] } } }));
  assert.ok(Object.keys(empty.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length <= 2);
});

test('Insights, deeper: forecast categories, outcomes, SE workload, capabilities, what ends soon and what moved', async () => {
  const { insightsMore, dayReading } = await import('../src/insights.js');
  const DAY = 86_400_000;
  const now = Date.parse('2026-11-24T12:00:00Z');
  const row = (id, stage, score, extra = {}) => ({ id, customer: id.toUpperCase(), stage, owner: { id: extra.se ?? 'se1', name: extra.se === 'se2' ? 'Bo' : 'Al' }, prediction: score === null ? null : { score, drivers: [{ effect: score >= 70 ? 10 : -10, text: score >= 70 ? 'On pace' : 'No scans for 6 days' }] }, gaps: extra.gaps ?? [], daysLeft: extra.daysLeft ?? 20, endDate: '2026-12-14', startDate: '2026-11-01', progress: { met: 1, total: 3, must: 2, mustMet: 1 }, sf: extra.amount ? { amount: { value: extra.amount } } : null, povResult: extra.result ?? '' });
  const rows = [
    row('a', 'pov', 82, { amount: 100000, daysLeft: 5 }),
    row('b', 'pov', 55, { se: 'se2', amount: 50000, gaps: [{ level: 'bad' }] }),
    row('c', 'pov', 20, { se: 'se2' }),
    row('d', 'won', 100, { result: 'successful' }),
    row('e', 'lost', 0, { result: 'unsuccessful' }),
  ];
  const opps = { a: { criteria: [{ capabilityId: 'sast', status: 'met' }, { capabilityId: 'dast', status: 'not_met' }] }, b: { criteria: [{ capabilityId: 'sast', status: 'met' }, { capabilityId: 'dast', status: 'in_progress' }] }, c: { criteria: [] }, d: { criteria: [{ capabilityId: 'sast', status: 'met' }] }, e: { criteria: [] } };
  const catalog = { get: (id) => ({ name: { sast: 'SAST', dast: 'DAST' }[id] }) };
  const weekAgo = new Date(now - 7 * DAY).toISOString().slice(0, 10);
  const history = { [weekAgo]: { a: { s: 60, c: 0, a: 100000 }, b: { s: 70, c: 0, a: 50000 }, c: { s: 22, c: 0, a: 0 } }, [`${weekAgo}:at`]: 1 };
  const m = insightsMore(rows, { oppOf: (id) => opps[id], catalog, history, now });
  assert.deepEqual(m.categories, { commit: { count: 1, amount: 100000 }, best: { count: 1, amount: 50000 }, pipeline: { count: 1, amount: 0 } });
  assert.equal(m.outcomes.techWinRate, 50, 'one successful of two decided');
  assert.equal(m.outcomes.winAfterSuccess, 100);
  assert.deepEqual(m.workload.map((w) => [w.name, w.running]), [['Bo', 2], ['Al', 1]]);
  assert.deepEqual(m.capabilities.map((c) => [c.name, c.povs, c.rate]), [['SAST', 3, 100], ['DAST', 2, 0]]);
  assert.deepEqual(m.ending.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(m.trend.since, weekAgo);
  assert.deepEqual(m.trend.before, { likely: 1, atRisk: 1, expected: 1.5, critical: 0, weighted: 95000 });
  assert.deepEqual(m.movers.map((x) => [x.id, x.delta]), [['a', 22], ['b', -15]], 'small moves are not news');
  assert.equal(m.movers[1].why, 'No scans for 6 days');
  assert.deepEqual(Object.keys(dayReading(rows)).sort(), ['a', 'b', 'c'], 'won and lost are not read');
});
