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
const H = { 'X-Requested-With': 'Meridian', 'Content-Type': 'application/json' };
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
  assert.equal(met.body.row.progress.met, 1);
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
  assert.match(d.body, /1 of 4 success criteria completed successfully/);
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
  const up = await fetch(`${base}/api/opportunities/${ids.alpha}/criteria/${c.id}/demo-video?name=demo.mp4`, { method: 'PUT', headers: { Cookie: jar.get('se1'), 'X-Requested-With': 'Meridian', 'Content-Type': 'video/mp4' }, body: video });
  assert.equal(up.status, 200);
  const bad = await fetch(`${base}/api/opportunities/${ids.alpha}/criteria/${c.id}/demo-video?name=x.exe`, { method: 'PUT', headers: { Cookie: jar.get('se1'), 'X-Requested-With': 'Meridian', 'Content-Type': 'application/octet-stream' }, body: 'MZ' });
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
    const r = await fetch(`${base}/api/salesforce/import`, { method: 'POST', headers: { Cookie: jar.get(who), 'X-Requested-With': 'Meridian', 'X-File-Name': 'report.csv', 'Content-Type': 'text/csv' }, body });
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
