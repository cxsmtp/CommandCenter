// Builds the sample decks for a made-up POV, to check them in PowerPoint:
//   the WIP deck, the results presentation in the team template, and the Classic results presentation.
//
//   node scripts/sample-decks.mjs [path\to\team-template.pptx] [output folder]
//
// Without a template the team-style decks use Meridian's own dark design. Nothing real is in them: the customer,
// people and APMA scores are made up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

const [templatePath = '', outDir = path.resolve('sample-decks')] = process.argv.slice(2);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-samples-'));
process.env.CC_ADMIN_PASSWORD = 'sample-password-123';
const app = createApp({ dataDir, startBackground: false });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}/api`;
let cookie = '';
const call = async (p, { method = 'GET', body, raw = false, type } = {}) => {
  const binary = Buffer.isBuffer(body);
  const r = await fetch(base + p, { method, headers: { 'X-Requested-With': 'Meridian', Cookie: cookie, ...(body ? { 'Content-Type': binary ? type ?? 'application/octet-stream' : 'application/json' } : {}) }, body: body ? (binary ? body : JSON.stringify(body)) : undefined });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
};

try {
  await call('/login', { method: 'POST', body: { email: 'admin@meridian.local', password: 'sample-password-123' } });
  if (templatePath) await call('/wip-template', { method: 'POST', body: fs.readFileSync(templatePath), type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const { opportunity } = await call('/opportunities', {
    method: 'POST',
    body: {
      customer: 'Northwind Media',
      stage: 'pov',
      startDate: day(-22),
      endDate: day(6),
      goalIds: ['consolidate', 'ai', 'runtime'],
      criteria: [{ capabilityId: 'sast', priority: 'must' }, { capabilityId: 'sca', priority: 'must' }, { capabilityId: 'dev-assist', priority: 'must' }, { capabilityId: 'bitbucket', priority: 'must' }, { capabilityId: 'ai-triage', priority: 'nice' }, { capabilityId: 'dast', priority: 'must' }],
      discovery: { painPoints: 'Too many tools and late findings', languages: 'Java, TypeScript, Python' },
      stakeholders: [
        { name: 'Priya Rao', title: 'Deputy General Manager', email: 'priya@northwind.example', side: 'customer', povRole: 'POV admin' },
        { name: 'Ken Ito', title: 'Developer', email: 'ken@northwind.example', side: 'customer', povRole: 'Evaluator' },
        { name: 'Dana Lee', title: 'Strategic Account Manager', email: 'dana@vendor.example', side: 'internal', povRole: 'Checkmarx sponsor' },
      ],
      sessions: [
        { type: 'pre_pov', date: day(-29), title: 'Pre-POV call' },
        { type: 'launch', date: day(-22), title: 'POV launch & quick setup', did: 'Onboarding complete: users provisioned\nBitbucket SCM integration completed\nDeveloper Assist in VS Code', theirNext: 'Internal testing of the features shown', ourNext: 'Share the WIP deck\nSchedule the DAST session' },
        { type: 'checkpoint', date: day(-12), title: 'Check-in call', did: 'Ran DAST on the staging web app' },
        { type: 'checkpoint', date: day(2), title: 'Check-in call' },
        { type: 'wrapup', date: day(6), title: 'Wrap-up call' },
      ],
      toolchain: { ide: ['VS Code'], scm: ['Bitbucket'], cicd: ['Bitbucket Pipelines', 'Jenkins'], feedback: ['Jira'], ai: ['GitHub Copilot'], registry: ['JFrog'], languages: 'Java, TypeScript, Python' },
      plan: { outOfScope: 'Production deployments', accountName: 'NWM-APPSEC' },
      apma: {
        overall: 'medium level (average maturity between level 1 and level 2)',
        lowest: 'Strategy & Governance and Security Testing - Tactical',
        dimensions: [
          { name: 'Strategy & Governance', current: 1.6, desired: 2.5 },
          { name: 'Planning', current: 1.0, desired: 2.0 },
          { name: 'Security Testing - Tactical', current: 1.4, desired: 2.5 },
          { name: 'Security Testing - Operational', current: 1.8, desired: 3.0 },
          { name: 'Security Testing - Infrastructure', current: 1.5, desired: 2.5 },
        ],
        recommendations: [
          { title: 'Define a basic set of strategic KPIs for your AppSec program', practice: 'Strategic KPIs', dimension: 'Strategy & Governance', from: 0, to: 1 },
          { title: 'Begin exploring AI use cases in AppSec and define a strategy for tool selection', practice: 'AI Use in AppSec', dimension: 'Security Testing - Tactical', from: 0, to: 1 },
        ],
      },
    },
  });
  fs.mkdirSync(outDir, { recursive: true });
  const id = opportunity.id;
  const out = [
    ['Northwind Media - POV WIP.pptx', `/opportunities/${id}/wip`],
    ['Northwind Media - POV results (team template).pptx', `/opportunities/${id}/deck?style=team`],
    ['Northwind Media - POV results (classic).pptx', `/opportunities/${id}/deck?style=classic`],
  ];
  for (const [name, p] of out) {
    fs.writeFileSync(path.join(outDir, name), await call(p, { raw: true }));
    console.log(path.join(outDir, name));
  }
} finally {
  app.server.close();
  app.server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 300);
}
