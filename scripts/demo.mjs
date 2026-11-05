/**
 * `npm run demo`: CommandCenter with three made-up POV tenants on a local mock of Checkmarx One, so the dashboard can
 * be seen without a real API key. Data goes to a throwaway folder; refreshes every minute; one scan keeps running.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, seedTenant, apiKeyFor } from './mock-cx.mjs';
import { createApp } from '../src/server.js';

const tenants = { 'acme-bank': seedTenant('acme', { projects: 9, scans: 34, seed: 7 }), globex: seedTenant('globex', { projects: 5, scans: 12, seed: 3 }), initech: seedTenant('initech', { projects: 14, scans: 40, seed: 11 }) };
tenants['acme-bank'].active.push({ id: 'acme-live', projectId: 'acme-p1', projectName: 'acme/web-portal', status: 'Running', branch: 'main', createdAt: new Date().toISOString(), initiator: 'jenkins-ci', sourceOrigin: 'Jenkins', engines: ['sast', 'sca'] });
const mock = await startMock({ tenants });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-demo-'));
const { server, store, monitor } = createApp({ dataDir, intervalMinutes: 1 });
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
store.add({ apiKey: apiKeyFor(mock.origin, 'acme-bank'), customer: 'Acme Bank', endDate: day(4), notes: 'Champion: Priya (AppSec lead). Success criteria: SAST on 5 core apps, Jenkins + GitHub Actions.' });
store.add({ apiKey: apiKeyFor(mock.origin, 'globex'), customer: 'Globex', endDate: day(18) });
store.add({ apiKey: apiKeyFor(mock.origin, 'initech'), customer: 'Initech', endDate: day(-1) });
const port = Number(process.env.PORT) || 4310;
server.listen(port, '127.0.0.1', () => {
  console.log(`CommandCenter demo on http://127.0.0.1:${port}  (mock Checkmarx One at ${mock.origin})`);
  monitor.start();
});
