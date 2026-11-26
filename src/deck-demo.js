/**
 * The demo POV the presentation designer previews templates with: a made-up customer (Northwind Media), its people,
 * meetings, toolchain, APMA scores and success criteria. Built as a real opportunity is, never kept anywhere.
 */
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { CLEANERS } from './opportunities.js';

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function demoOpportunity({ opps, actor, settings }) {
  const opp = opps.draft(actor, {
    customer: 'Northwind Media',
    stage: 'pov',
    startDate: day(-22),
    endDate: day(6),
    criteria: ['sast', 'sca', 'dev-assist', 'bitbucket', 'ai-triage', 'dast', 'secrets', 'iac', 'containers', 'ai-remediation'].map((capabilityId, i) => ({ capabilityId, priority: i < 6 ? 'must' : 'nice' })),
    discovery: { painPoints: 'Too many tools and late findings', languages: 'Java, TypeScript, Python' },
  }, settings);
  // Some criteria proven, some under way, so the slides show every state.
  opp.criteria.forEach((c, i) => Object.assign(c, { status: i < 3 ? 'met' : i < 5 ? 'in_progress' : 'not_started' }));
  const person = (p) => ({ id: randomUUID(), ...CLEANERS.stakeholders(p) });
  opp.stakeholders = [
    person({ name: 'Priya Rao', title: 'Deputy General Manager', email: 'priya@northwind.example', side: 'customer', povRole: 'POV admin' }),
    person({ name: 'Ken Ito', title: 'Developer', email: 'ken@northwind.example', side: 'customer', povRole: 'Evaluator' }),
    person({ name: 'Dana Lee', title: 'Strategic Account Manager', email: 'dana@vendor.example', side: 'internal', povRole: 'Checkmarx sponsor' }),
  ];
  const meeting = (m) => ({ id: randomUUID(), ...CLEANERS.sessions(m) });
  opp.sessions = [
    meeting({ type: 'pre_pov', date: day(-29), title: 'Pre-POV call' }),
    meeting({ type: 'launch', date: day(-22), title: 'POV launch & quick setup', did: 'Onboarding complete: users provisioned\nBitbucket SCM integration completed\nDeveloper Assist in VS Code', theirNext: 'Internal testing of the features shown', ourNext: 'Share the WIP deck\nSchedule the DAST session' }),
    meeting({ type: 'checkpoint', date: day(-12), title: 'Check-in call', did: 'Ran DAST on the staging web app\nAI Triage on the SAST backlog' }),
    meeting({ type: 'checkpoint', date: day(2), title: 'Check-in call' }),
    meeting({ type: 'wrapup', date: day(6), title: 'Wrap-up call' }),
  ];
  opp.toolchain = { ide: { tools: ['VS Code'] }, scm: { tools: ['Bitbucket'] }, cicd: { tools: ['Bitbucket Pipelines', 'Jenkins'] }, feedback: { tools: ['Jira'] }, ai: { tools: ['GitHub Copilot'] }, registry: { tools: ['JFrog'] }, languages: 'Java, TypeScript, Python' };
  opp.plan = { outOfScope: 'Production deployments', accountName: 'NWM-APPSEC' };
  opp.apma = {
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
  };
  return opp;
}

/** A plain demo screenshot (a dark panel with bars), so the screenshot slides show in previews. */
export function demoScreenshot(caption, w = 1600, h = 900) {
  const row = Buffer.alloc(1 + w * 3);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const r = Buffer.from(row);
    for (let x = 0; x < w; x++) {
      const bar = y > 200 && (y - 200) % 140 < 60 && x > 120 && x < 120 + ((Math.floor((y - 200) / 140) * 331) % 900) + 400;
      const [R, G, B] = bar ? [107, 52, 253] : x > 80 && x < w - 80 && y > 80 && y < h - 80 ? [31, 18, 53] : [23, 11, 43];
      r[1 + x * 3] = R;
      r[2 + x * 3] = G;
      r[3 + x * 3] = B;
    }
    rows.push(r);
  }
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  return { caption, w, h, data: `image/png;base64,${png.toString('base64')}` };
}
