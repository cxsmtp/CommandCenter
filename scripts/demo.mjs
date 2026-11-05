/**
 * `npm run demo`: CommandCenter with a made-up team (VP → leader → team leads → SEs), opportunities at every stage
 * and four POV tenants on a local mock of Checkmarx One, so everything can be seen without a real API key.
 * Data goes to a throwaway folder. Every demo account's password: demo-password
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, seedTenant, apiKeyFor } from './mock-cx.mjs';
import { createApp } from '../src/server.js';

const tenants = {
  'acme-bank': seedTenant('acme', { projects: 9, scans: 34, seed: 7 }),
  globex: seedTenant('globex', { projects: 5, scans: 12, seed: 3 }),
  initech: seedTenant('initech', { projects: 14, scans: 40, seed: 11 }),
  umbrella: seedTenant('umbrella', { projects: 6, scans: 18, seed: 23 }),
};
const now = Date.now();
tenants['acme-bank'].active.push({ id: 'acme-live', projectId: 'acme-p1', projectName: 'acme/web-portal', status: 'Running', branch: 'main', createdAt: new Date(now - 4 * 60e3).toISOString(), initiator: 'jenkins-ci', sourceOrigin: 'Jenkins', engines: ['sast', 'sca', 'ai'] });
// Some Fusion and LAST scans, and the integrations they came from.
for (const [name, t] of Object.entries(tenants)) {
  t.scans.forEach((s, i) => {
    if (i % 3 === 0) Object.assign(s, { engines: [...s.engines, 'ai'], metadata: { configs: [{ type: 'ai', value: { fusionEnabled: name === 'initech' ? 'false' : 'true' } }] } });
  });
  t.projects.forEach((p, i) => (p.repoUrl = i % 2 ? `https://github.com/${name}/${p.name.split('/')[1]}` : `https://gitlab.com/${name}/${p.name.split('/')[1]}`));
}
const mock = await startMock({ tenants });
const dataDir = process.env.CC_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cc-demo-'));
process.env.CC_ADMIN_PASSWORD ||= 'demo-password';
process.env.CC_ADMIN_EMAIL ||= 'admin@demo.local';
const app = createApp({ dataDir });
const { users, opps } = app;
const admin = users.list().find((u) => u.role === 'admin');
const sudo = { ...admin, role: 'admin' };
const pw = 'demo-password';
const add = (email, name, role, managerId, title) => users.add(sudo, { email, name, role, managerId, title, password: pw });
const vp = add('vp@demo.local', 'Vera Patel', 'vp', null, 'VP Solution Engineering');
const lead = add('leader@demo.local', 'Leon Duarte', 'leader', vp.id, 'Director, SE EMEA');
const tl1 = add('tl1@demo.local', 'Tara Lim', 'team_lead', lead.id, 'SE Manager, North');
const tl2 = add('tl2@demo.local', 'Omar Haddad', 'team_lead', lead.id, 'SE Manager, South');
const ses = [add('se1@demo.local', 'Sam Okafor', 'associate', tl1.id, 'Senior SE'), add('se2@demo.local', 'Ana Ruiz', 'associate', tl1.id, 'SE'), add('se3@demo.local', 'Kenji Mori', 'associate', tl2.id, 'SE'), add('se4@demo.local', 'Priya Nair', 'associate', tl2.id, 'Principal SE')];
// No forced password change in the demo.
const list = app.db.read('users', []);
list.forEach((u) => (u.mustChangePassword = false));
app.db.write('users', list);

const day = (n) => new Date(now + n * 86400e3).toISOString().slice(0, 10);
const asUser = (u) => ({ ...users.get(u.id) });
function make(owner, body, { tenant, criteria = [], notes = [], sessions = [], stakeholders = [], tasks = [], met = [] } = {}) {
  const who = asUser(owner);
  let o = opps.create(who, { ...body, capabilities: criteria }, {});
  if (tenant) o = opps.setTenant(who, o.id, { apiKey: apiKeyFor(mock.origin, tenant) }, {});
  if (body.stage) o = opps.update(who, o.id, { stage: body.stage }, {});
  for (const text of notes) opps.upsertItem(who, o.id, 'notes', { text }, {});
  for (const s of sessions) opps.upsertItem(who, o.id, 'sessions', s, {});
  for (const s of stakeholders) opps.upsertItem(who, o.id, 'stakeholders', s, {});
  for (const t of tasks) opps.upsertItem(who, o.id, 'tasks', t, {});
  for (const c of opps.get(o.id).criteria.filter((c) => met.includes(c.capabilityId))) opps.upsertItem(who, o.id, 'criteria', { ...c, status: 'met' }, {});
  return o;
}
make(ses[0], { customer: 'Acme Bank', name: 'AppSec platform FY27', salesforceUrl: 'https://example.lightning.force.com/lightning/r/Opportunity/006XX0000001/view', sharepointUrl: 'https://example.sharepoint.com/sites/AcmeBankPOV', startDate: day(-12), endDate: day(4), amount: '$420k ARR', discovery: { goals: 'Replace the current SAST tool; one platform for SAST, SCA and IaC.', painPoints: 'Too many false positives; developers ignore results.', languages: 'Java, TypeScript, Python', scm: ['github', 'gitlab'], ci: ['jenkins', 'github-actions'], tracking: ['jira'], requested: ['sast', 'sca', 'fusion', 'jenkins', 'jira'] } }, {
  tenant: 'acme-bank', criteria: ['sast', 'sca', 'iac', 'fusion', 'ai-triage', 'jenkins', 'github-actions', 'github', 'jira', 'sso'], met: ['sast', 'sca'],
  notes: ['Champion: Priya (AppSec lead). Wants Jira tickets created from critical findings.', 'Jenkins pipeline scans running on 5 core apps.'],
  sessions: [{ date: day(-20), type: 'discovery', title: 'Discovery with AppSec team', attendees: 'Priya Rao, Tom Lee', notes: 'Current tool: legacy SAST. Pain: false positives, slow scans.' }, { date: day(-10), type: 'technical', title: 'Jenkins and GitHub integration', notes: 'Plugin installed, first pipeline green.' }],
  stakeholders: [{ name: 'Priya Rao', email: 'priya.rao@acme-bank.example', title: 'AppSec Lead', side: 'customer' }, { name: 'Tom Lee', email: 'tom.lee@acme-bank.example', title: 'DevOps Manager', side: 'customer' }, { name: 'Jordan AE', email: 'jordan.ae@company.example', title: 'Account Executive', side: 'internal' }],
  tasks: [{ title: 'Show Jira feedback app', due: day(1) }, { title: 'Fusion results readout', due: day(3) }],
});
make(ses[1], { customer: 'Globex', startDate: day(-5), endDate: day(18), salesforceUrl: 'https://example.lightning.force.com/lightning/r/Opportunity/006XX0000002/view' }, { tenant: 'globex', criteria: ['sast', 'sca', 'containers', 'azure-pipelines', 'vscode'], tasks: [{ title: 'Kick-off email', due: day(-1) }] });
make(ses[2], { customer: 'Initech', stage: 'completed', povResult: 'successful', summary: 'Checkmarx One scanned the 14 Initech projects from GitLab CI and the CLI. LAST found issues the legacy tool missed, and the security team signed off on the results.', startDate: day(-30), endDate: day(-1) }, { tenant: 'initech', criteria: ['sast', 'last', 'cli', 'gitlab-ci', 'secrets'], met: ['sast', 'cli', 'last'] });
make(ses[3], { customer: 'Umbrella Health', startDate: day(-3), endDate: day(25) }, { tenant: 'umbrella', criteria: ['sast', 'sca', 'aisc', 'fusion', 'api', 'servicenow'] });
make(ses[3], { customer: 'Hooli', stage: 'technical', discovery: { goals: 'Shift-left for 400 developers.', ci: ['github-actions'] } }, { criteria: ['sast', 'sca', 'github-actions', 'dev-assist'], sessions: [{ date: day(-2), type: 'technical', title: 'Architecture deep dive' }] });
make(ses[0], { customer: 'Stark Logistics', stage: 'discovery' }, { tasks: [{ title: 'Discovery call', due: day(2) }] });
make(ses[2], { customer: 'Wayne Retail', stage: 'won', povResult: 'successful' }, { criteria: ['sast', 'sca'], met: ['sast', 'sca'] });
make(ses[1], { customer: 'Cyberdyne', stage: 'lost' }, {});

const port = Number(process.env.PORT) || 4310;
app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`CommandCenter demo on http://127.0.0.1:${port}  (mock Checkmarx One at ${mock.origin})`);
  console.log(`Sign in as vp@demo.local, leader@demo.local, tl1@demo.local, se1@demo.local … or admin@demo.local — password: ${pw}`);
  app.monitor.start();
  for (const o of opps.raw().filter((x) => x.tenant)) app.monitor.refresh(o.id, { force: true });
});
