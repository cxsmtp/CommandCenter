/**
 * Load test at the target scale: N POV tenants (300 by default) on the mock Checkmarx One, 40 SEs in a team tree,
 * every tenant read once (as after a start, or one full interval), then P people (40) loading the portfolio at
 * the same time, for R rounds. Prints how long the reads took, the server's memory, and the overview's response
 * times (median and 95th percentile).
 *
 *   node scripts/loadtest.mjs [tenants=300] [people=40] [rounds=5]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, seedTenant, apiKeyFor } from './mock-cx.mjs';
import { createApp } from '../src/server.js';

const N = Number(process.argv[2]) || 300;
const PEOPLE = Number(process.argv[3]) || 40;
const ROUNDS = Number(process.argv[4]) || 5;

const tenants = {};
for (let i = 0; i < N; i += 1) tenants[`t${i}`] = seedTenant(`t${i}`, { projects: 5 + (i % 25), scans: 10 + (i % 60), seed: i + 1 });
const mock = await startMock({ tenants });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-load-'));
process.env.CC_ADMIN_PASSWORD = 'load-password-123';
const app = createApp({ dataDir });
const { users, opps } = app;
const admin = { ...users.list().find((u) => u.role === 'admin'), role: 'admin' };
const pw = 'load-password-123';
const vp = users.add(admin, { email: 'vp@load.local', name: 'VP', role: 'vp', password: pw });
const leaders = [0, 1, 2, 3].map((i) => users.add(admin, { email: `l${i}@load.local`, name: `Leader ${i}`, role: 'leader', managerId: vp.id, password: pw }));
const leads = leaders.flatMap((l, i) => [0, 1].map((j) => users.add(admin, { email: `tl${i}${j}@load.local`, name: `Lead ${i}${j}`, role: 'team_lead', managerId: l.id, password: pw })));
const ses = Array.from({ length: 40 }, (_, i) => users.add(admin, { email: `se${i}@load.local`, name: `SE ${i}`, role: 'associate', managerId: leads[i % leads.length].id, password: pw }));
const list = app.db.read('users', []);
list.forEach((u) => (u.mustChangePassword = false));
app.db.write('users', list);
for (let i = 0; i < N; i += 1) {
  const se = ses[i % ses.length];
  const o = opps.create({ ...users.get(se.id) }, { customer: `Customer ${i}`, capabilities: ['sast', 'sca', 'fusion', 'jenkins', 'jira'], endDate: new Date(Date.now() + ((i % 40) - 5) * 86400e3).toISOString().slice(0, 10) }, {});
  opps.setTenant({ ...users.get(se.id) }, o.id, { apiKey: apiKeyFor(mock.origin, `t${i}`) }, {});
}
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;

// Every tenant read once, as the clock would, at the configured concurrency.
const t0 = Date.now();
await Promise.all(opps.raw().map((o) => app.monitor.refresh(o.id)));
const readS = (Date.now() - t0) / 1000;
const rss = Math.round(process.memoryUsage().rss / 1048576);

const login = async (email) => (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).headers.get('set-cookie').split(';')[0];
const who = ['vp@load.local', ...leaders.map((_, i) => `l${i}@load.local`), ...ses.map((_, i) => `se${i}@load.local`)].slice(0, PEOPLE);
const cookies = await Promise.all(who.map(login));
const times = [];
let errors = 0;
for (let r = 0; r < ROUNDS; r += 1) {
  await Promise.all(
    cookies.map(async (c) => {
      const s = Date.now();
      const res = await fetch(`${base}/api/overview`, { headers: { Cookie: c } });
      if (!res.ok) errors += 1;
      await res.arrayBuffer();
      times.push(Date.now() - s);
    }),
  );
}
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
const vpRes = await fetch(`${base}/api/overview`, { headers: { Cookie: cookies[0] } });
const vpBody = await vpRes.json();
console.log(JSON.stringify({ tenants: N, readAllSeconds: readS, perTenantMs: Math.round((readS * 1000) / N), memoryMb: rss, memoryAfterMb: Math.round(process.memoryUsage().rss / 1048576), people: cookies.length, requests: times.length, errors, overviewMs: { p50: pct(50), p95: pct(95), max: times[times.length - 1] }, vpSees: vpBody.rows.length, overviewKb: Math.round(JSON.stringify(vpBody).length / 1024), reading: app.monitor.load() }, null, 1));
app.server.close();
mock.server.close();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
