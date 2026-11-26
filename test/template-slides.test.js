// The team template's own slides, filled with a POV's data: only the words change, every shape and style stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapesOf, fillCoverSlide, fillOverviewSlide, fillPlanSlide, fillTestSlide, fillNotesSlide, fillShotSlide } from '../src/template-slides.js';

const sp = (name, x, y, w, h, paras, extra = '') => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="${name}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${extra}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const p = (runs, pPr = '') => `<a:p>${pPr}${runs.map(([t, rPr = '<a:rPr lang="en-US" sz="1600"><a:latin typeface="Aptos"/></a:rPr>']) => `<a:r>${rPr}<a:t>${t}</a:t></a:r>`).join('')}</a:p>`;
const slide = (...shapes) => `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;
const pic = (x, y, w, h) => `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture 9"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr></p:pic>`;
const texts = (xml) => shapesOf(xml).map((s) => s.text);

test('the cover: people, date, Results, and the customer in place of the example logo, in the template’s font', () => {
  const xml = slide(pic(100, 1000, 6000000, 4000000), sp('Title 2', 100, 5200000, 7000000, 600000, p([['CxOne'], [' Platform: Proof of Value Guide']])), sp('People', 100, 6000000, 7000000, 600000, p([['Jo Example | Strategic Account Manager']])), sp('Date', 100, 6800000, 3000000, 300000, p([['2nd September '], ['2026']])));
  const out = fillCoverSlide(xml, { customer: 'Northwind Media', results: true, people: [{ name: 'Dana Lee', title: 'Strategic Account Manager' }, { name: 'Sam Roe', title: 'Solution Engineer' }], date: '25th November 2026' });
  const t = texts(out);
  assert.ok(t.includes('NORTHWIND MEDIA'));
  assert.ok(!/<p:pic>/.test(out), 'the example customer’s logo is gone');
  assert.ok(t.some((x) => /Proof of Value Results/.test(x)));
  assert.ok(t.includes('Dana Lee | Strategic Account ManagerSam Roe | Solution Engineer'));
  assert.ok(t.includes('25th November 2026'));
  assert.match(out, /typeface="Aptos"/);
});

test('the overview, plan, test plan and notes keep the template’s paragraphs and shapes', () => {
  const ov = fillOverviewSlide(slide(sp('Body', 0, 0, 9000000, 5000000, p([['Dear Example Team,']]) + p([['Old paragraph.']]) + p([['“Old quote.”']]))), { customer: 'Northwind Media', letter: ['One.', 'Two.'], quote: '“New quote.”' });
  assert.equal(texts(ov)[0], 'Dear Northwind Media Team,One.Two.“New quote.”');

  const col = (x, month, day, label, status) => [sp('M', x, 6800000, 900000, 180000, p([[month]])), sp('D', x, 6260000, 900000, 600000, p([[day]])), sp('L', x - 200000, 6050000, 1300000, 1700000, p([[label]])), sp('S', x, 7250000, 900000, 300000, p([[status, '<a:rPr lang="en-US" b="1"><a:solidFill><a:srgbClr val="92D050"/></a:solidFill></a:rPr>']]))];
  const plan = slide(sp('Focus', 900000, 2200000, 3400000, 330000, p([['Focus on Example goals']])), sp('Scope', 800000, 2700000, 3900000, 2400000, p([['a']]) + p([['b']])), sp('Support', 5000000, 2700000, 3900000, 2400000, p([['c']]) + p([['d']])), sp('Success', 9000000, 2700000, 3900000, 2400000, p([['e']]) + p([['f']])), ...col(1000000, 'July', '8', 'Pre-POC Call', 'Completed'), ...col(3000000, 'July', '30', 'Launch', 'Completed'), ...col(5000000, 'August', '3', 'Check-in call', 'Completed'));
  const filled = fillPlanSlide(plan, { customer: 'Northwind Media', scope: ['Goal one'], support: ['Help'], success: ['Win'], milestones: [{ month: 10, day: 27, label: 'Kick-off', state: 'done' }, { month: 11, day: 1, label: 'Wrap-up', state: 'planned' }] });
  const t = texts(filled);
  assert.ok(t.includes('Focus on Northwind Media goals') && t.includes('Goal one') && t.includes('Help') && t.includes('Win'));
  assert.ok(t.includes('November') && t.includes('27') && t.includes('Kick-off') && t.includes('December') && t.includes('Wrap-up'));
  assert.ok(t.includes('Planned') && !t.includes('August'), 'the third place goes: two meetings');
  assert.match(filled, /F5C518/, 'planned in yellow');

  const cell = (t2) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${p([[t2]])}</a:txBody></a:tc>`;
  const row = `<a:tr h="1400000">${cell('SC1:')}${cell('Old')}${cell('Old')}${cell('Completed')}</a:tr>`;
  const testXml = slide(sp('Title', 0, 0, 9000000, 600000, p([['Test Plan Overview']])), sp('Badge', 900000, 1700000, 1000000, 500000, p([['BG1']])), sp('Goal', 2000000, 1500000, 12000000, 900000, p([['Old goal - ', '<a:rPr b="1"/>'], ['old statement', '<a:rPr b="0"/>']])), `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Test Plan Items"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="4200000"/></p:xfrm><a:graphic><a:graphicData><a:tbl>${row}${row}${row}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
  const tp = fillTestSlide(testXml, { number: 2, title: 'Secure the supply chain', statement: 'Packages checked', rows: [{ code: 'SC1', name: 'SCA', description: 'Know what ships', measure: 'Scan a repo', state: 'done' }] });
  assert.ok(texts(tp).includes('BG2'));
  assert.ok(texts(tp).includes('Secure the supply chain - Packages checked'));
  assert.equal((tp.match(/<a:tr\b/g) ?? []).length, 1, 'one row per criterion');
  assert.match(tp, /cy="1400000"/, 'the table as tall as its rows');

  const notes = slide(sp('Title 2', 0, 0, 9000000, 900000, p([['Meeting Notes'], ['Date: 14th August 2026']])), sp('Body', 800000, 1600000, 12000000, 5800000, p([['What we did today']], '<a:pPr marL="0" indent="0"><a:buNone/></a:pPr>') + p([['AI Triage:', '<a:rPr b="1"/>'], [' tested', '<a:rPr b="0"/>']], '<a:pPr marL="285750" indent="-285750"/>') + p([['Shared the deck', '<a:rPr b="0"/>']], '<a:pPr marL="285750" indent="-285750"/>')));
  const n = fillNotesSlide(notes, { date: '13th November 2026', sections: [{ heading: 'What we did today', items: ['DAST: ran on staging', 'Reviewed results'] }, { heading: 'From the Checkmarx side', items: [] }] });
  assert.ok(texts(n)[0].startsWith('Meeting Notes') && texts(n)[0].includes('Date: 13th November 2026'), 'the title stays, the date changes');
  assert.ok(texts(n)[1].includes('DAST: ran on staging') && texts(n)[1].includes('Reviewed results') && !texts(n)[1].includes('From the Checkmarx side'), 'empty sections are left out');
});

test('a screenshot slide: its title, its picture fitted to the screenshot’s shape', () => {
  const xml = slide(sp('Title', 200000, 200000, 13000000, 700000, p([['Bitbucket Repo SCM']])), pic(756320, 1162050, 12126243, 6434309));
  const out = fillShotSlide(xml, { caption: 'Analytics and Dashboard', width: 1000, height: 1000 });
  assert.equal(texts(out)[0], 'Analytics and Dashboard');
  assert.match(out, /<a:ext cx="6434309" cy="6434309"\/>/, 'square, as tall as the box');
});

test('a cover with no example logo: the example customer above the title, or a new line there, says this customer', () => {
  const title = sp('Title', 100, 3000000, 7000000, 600000, p([['CxOne Platform: Proof of Value Guide']]));
  const named = fillCoverSlide(slide(sp('Example', 100, 2200000, 7000000, 700000, p([['INITECH']])), title), { customer: 'Northwind Media', people: [], date: '' });
  assert.ok(texts(named).includes('NORTHWIND MEDIA') && !texts(named).includes('INITECH'));
  const bare = fillCoverSlide(slide(title), { customer: 'Northwind Media', people: [], date: '' });
  assert.ok(texts(bare).includes('NORTHWIND MEDIA'));
});
