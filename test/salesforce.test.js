// Salesforce without its API: reading reports (csv, xlsx, the email table), matching them to POVs, the messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readTable, recordsOf, matchRecords, opportunityIdOf, changesOf, logMessage } from '../src/salesforce.js';

test('the Opportunity ID is read from Lightning and Classic links, 15 or 18 characters', () => {
  assert.equal(opportunityIdOf('https://acme.lightning.force.com/lightning/r/Opportunity/006Ab00000Xyz12AAA/view'), '006Ab00000Xyz12AAA');
  assert.equal(opportunityIdOf('https://acme.my.salesforce.com/006Ab00000Xyz12'), '006Ab00000Xyz12');
  assert.equal(opportunityIdOf('https://acme.my.salesforce.com/001Ab00000Xyz12'), '', 'an account, not an opportunity');
  assert.equal(opportunityIdOf(''), '');
});

const CSV = [
  'Opportunity Owner,Account Name,Opportunity Name,Stage,Amount,Close Date,Probability (%),Next Step,Opportunity ID',
  'Jordan AE,Acme Bank,AppSec platform FY27,Negotiation,"USD 420,000.00",12/15/2026,70,Security review,006Ab00000Xyz12',
  'Jordan AE,Globex,Globex AppSec,Proof of Value,"$180,000",31/12/2026,40,,006Ab00000Glb01',
  'Jordan AE,Nobody Inc,Other deal,Prospecting,1000,1/2/2027,10,,006Ab00000Zzz99',
  'Total,,,,"601,000",,,,',
].join('\r\n');

test('a CSV export: header found, amounts, dates and totals handled', async () => {
  const { records, columns } = recordsOf(await readTable(Buffer.from(CSV), { name: 'report.csv' }));
  assert.equal(records.length, 3, 'the Total row is not a record');
  assert.ok(columns.includes('id') && columns.includes('closeDate'));
  assert.deepEqual(records[0].amount, { value: 420000, currency: 'USD' });
  assert.equal(records[0].closeDate, '2026-12-15');
  assert.equal(records[1].closeDate, '2026-12-31', 'day first when it can only be day first');
  assert.equal(records[0].probability, 70);
});

test('an .xlsx export (shared strings, date serials) reads the same', async () => {
  const zip = new JSZip();
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Opportunity ID</t></si><si><t>Account Name</t></si><si><t>Stage</t></si><si><t>Close Date</t></si><si><t>006Ab00000Xyz12</t></si><si><t>Acme &amp; Co</t></si><si><t>Closed Won</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2"><v>46371</v></c></row></sheetData></worksheet>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const { records } = recordsOf(await readTable(buf, { name: 'r.xlsx' }));
  assert.equal(records[0].account, 'Acme & Co');
  assert.equal(records[0].stage, 'Closed Won');
  assert.equal(records[0].closeDate, '2026-12-15');
});

test('a subscription email without an attachment: the report table in its body', async () => {
  const html = `<html><body><table><tr><td>Logo</td></tr></table><table border=1><tr><th>Opportunity Name</th><th>Account Name</th><th>Stage</th><th>Amount</th></tr><tr><td>AppSec platform FY27</td><td>Acme Bank</td><td>Value Proposition</td><td>$420,000.00</td></tr></table></body></html>`;
  const { records } = recordsOf(await readTable(Buffer.from(html), { name: 'email.html' }));
  assert.equal(records.length, 1);
  assert.equal(records[0].stage, 'Value Proposition');
});

test('matching: by ID (15 = 18), else by name and account when the POV has no link', () => {
  const opps = [
    { id: 'a', customer: 'Acme Bank', name: 'AppSec platform FY27', salesforceUrl: 'https://x.lightning.force.com/lightning/r/Opportunity/006Ab00000Xyz12AAA/view' },
    { id: 'b', customer: 'Globex Inc', name: 'Globex AppSec', salesforceUrl: '' },
  ];
  const { matched, unmatched } = matchRecords([{ id: '006Ab00000Xyz12', name: 'x' }, { id: '006Ab00000Glb01', name: 'Globex AppSec', account: 'Globex' }, { id: '006Ab00000Zzz99', name: 'Other' }], opps);
  assert.deepEqual(matched.map((m) => [m.opp.id, m.how]), [['a', 'id'], ['b', 'name']]);
  assert.equal(unmatched.length, 1);
});

test('what changed, and the message Salesforce saves', () => {
  assert.deepEqual(changesOf({ stage: 'Proposal', amount: { value: 1000, currency: 'USD' } }, { stage: 'Negotiation', amount: { value: 1000, currency: 'USD' } }), ['Stage: Proposal → Negotiation']);
  const m = logMessage({ customer: 'Acme', name: 'Deal', salesforceUrl: 'https://x/006' }, { kind: 'Task', title: 'Show Jira', due: '2026-11-20', by: 'Sam' });
  assert.equal(m.subject, 'Acme — Task: Show Jira');
  assert.match(m.body, /Due: 2026-11-20/);
  assert.match(m.body, /Salesforce: https:\/\/x\/006/);
});

test('a narrower report keeps the fields an earlier one brought in', async () => {
  const { Opportunities } = await import('../src/opportunities.js');
  const { Db } = await import('../src/db.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const db = new Db(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-')));
  db.write('opportunities', [{ id: 'a', customer: 'Acme', history: [] }]);
  const opps = new Opportunities(db, { users: { visibleIds: () => new Set() }, catalog: null });
  opps.setSalesforce([{ id: 'a', rec: { id: 'x', stage: 'Proposal', probability: 40, nextStep: 'Readout' } }], { source: 'file', columns: ['id', 'stage', 'probability', 'nextStep'] }, 't');
  const ch = opps.setSalesforce([{ id: 'a', rec: { id: 'x', stage: 'Negotiation' } }], { source: 'file', columns: ['id', 'stage'] }, 't');
  assert.deepEqual(ch.get('a'), ['Stage: Proposal → Negotiation']);
  assert.equal(opps.get('a').salesforce.probability, 40);
  assert.equal(opps.get('a').salesforce.nextStep, 'Readout');
});
