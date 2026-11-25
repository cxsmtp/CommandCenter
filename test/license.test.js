// The tenant's licence dates, from the access token's ast-license claim, on the Portfolio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseOf } from '../src/cxone/client.js';
import { summarize } from '../src/collector.js';

test('the tenant licence: start and end from the ast-license claim, in any of its shapes', () => {
  const ms = Date.UTC(2026, 9, 1);
  const end = Date.UTC(2026, 11, 31);
  assert.deepEqual(licenseOf({ 'ast-license': { IsActive: true, LicenseData: { activationDate: ms, expirationDate: end, allowedEngines: ['SAST', 'SCA'] } } }), { start: '2026-10-01', end: '2026-12-31', active: true, engines: ['SAST', 'SCA'] });
  // A JSON string, epoch seconds, text dates.
  assert.equal(licenseOf({ 'ast-license': JSON.stringify({ LicenseData: { activationDate: ms / 1000, expirationDate: '2026-12-31T00:00:00Z' } }) }).start, '2026-10-01');
  assert.equal(licenseOf({ 'ast-license': JSON.stringify({ LicenseData: { expirationDate: '2026-12-31T00:00:00Z' } }) }).end, '2026-12-31');
  // None, broken or dateless: nothing.
  for (const c of [{}, { 'ast-license': 'not json' }, { 'ast-license': { LicenseData: { features: [] } } }]) assert.equal(licenseOf(c), null);
});

test('the POV summary carries the tenant licence dates', () => {
  const s = summarize({ at: new Date().toISOString(), identity: { user: 'x', license: { start: '2026-10-01', end: '2026-12-31', active: true, engines: [] } }, projects: { total: 0, list: [] }, scans: [], active: [] });
  assert.deepEqual([s.license.start, s.license.end], ['2026-10-01', '2026-12-31']);
  assert.equal(summarize({ at: new Date().toISOString(), identity: { user: 'x' }, projects: { total: 0, list: [] }, scans: [], active: [] }).license, null);
});

test('the Salesforce close date: from the report, else typed; Insights lists deals closing in 30 days', async () => {
  const { gaps } = await import('../src/insights.js');
  const now = Date.parse('2026-11-25T12:00:00Z');
  const base = { stage: 'pov', endDate: '2026-12-20', stakeholders: [], tasks: [], criteria: [], salesforceUrl: 'https://x.lightning.force.com/r/Opportunity/006/view', sharepointUrl: 'https://s' };
  assert.ok(JSON.stringify(gaps({ ...base, closeDate: '2026-12-10' }, { daysLeft: 25, live: null }, { now })).includes('before the POV ends'), 'typed close date before the POV end');
  assert.ok(JSON.stringify(gaps({ ...base, closeDate: '2026-11-01' }, { daysLeft: 25, live: null }, { now })).includes('has passed'));
  assert.ok(!JSON.stringify(gaps({ ...base, closeDate: '2027-01-15' }, { daysLeft: 25, live: null }, { now })).includes('close date'));
  assert.ok(JSON.stringify(gaps({ ...base, closeDate: '2027-01-15', salesforce: { closeDate: '2026-12-01', stage: 'Proposal' } }, { daysLeft: 25, live: null }, { now })).includes('2026-12-01'), 'the report wins over the typed date');
});
