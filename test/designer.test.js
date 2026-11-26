// The presentation designer: per-slide designs, own titles, and the slide keys previews are matched by.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanVariants, cleanTitles, DEFAULT_VARIANTS } from '../src/deck-templates.js';

test('designs and titles are cleaned: unknown slides and values fall back to the defaults', () => {
  assert.deepEqual(cleanVariants({ plan: 'template', tests: 'nonsense', bogus: 'kendra' }), { ...DEFAULT_VARIANTS, plan: 'template' });
  assert.deepEqual(cleanTitles({ plan: '  Our plan  ', nope: 'x', env: '' }), { plan: 'Our plan' });
});

test('a template keeps its designs and titles; the demo deck says which slide each one is', async () => {
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const { createApp } = await import('../src/server.js');
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-designer-')), startBackground: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const H = { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' };
  try {
    const c = (await fetch(`${base}/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) })).headers.get('set-cookie').split(';')[0];
    const A = { ...H, Cookie: c };
    const made = await (await fetch(`${base}/deck-templates`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'Ours', scope: 'team' }) })).json();
    const id = made.template.id;
    const put = await (await fetch(`${base}/deck-templates/${id}`, { method: 'PUT', headers: A, body: JSON.stringify({ name: 'Ours, renamed', variants: { plan: 'template' }, texts: { titles: { plan: 'How we will run it' } } }) })).json();
    assert.equal(put.template.name, 'Ours, renamed');
    assert.equal(put.template.variants.plan, 'template');
    assert.equal(put.template.texts.titles.plan, 'How we will run it');
    const d = await (await fetch(`${base}/deck-templates/${id}/designer`, { headers: A })).json();
    assert.equal(d.found, null, 'no PowerPoint yet');
    assert.ok(d.variants.plan && d.slides.cover);
    const demo = await fetch(`${base}/deck-templates/${id}/demo`, { method: 'POST', headers: A, body: JSON.stringify({ deck: 'wip' }) });
    assert.equal(demo.status, 200);
    const JSZip = (await import('jszip')).default;
    const z = await JSZip.loadAsync(Buffer.from(await demo.arrayBuffer()));
    const texts = (await Promise.all(Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => z.file(n).async('string')))).join(' ');
    assert.match(texts, /Northwind Media/, 'the demo POV');
    assert.match(texts, /How we will run it/, 'the slide’s own title');
    assert.equal((await (await fetch(`${base}/overview`, { headers: A })).json()).rows.length, 0, 'the demo POV is never kept');
  } finally {
    app.server.close();
  }
});

test('the built-in templates are Kendra standard and Classic; a template is drawn in its own PowerPoint or none', async () => {
  const { DeckTemplates, BUILT_IN } = await import('../src/deck-templates.js');
  assert.deepEqual(BUILT_IN.map((t) => t.name), ['Kendra standard', 'Classic']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-builtins-'));
  const store = {};
  const db = { read: (k, d) => store[k] ?? d, write: (k, v) => (store[k] = v) };
  const t = new DeckTemplates(db, { users: { get: () => null, chain: () => [], isBelow: () => false }, dataDir: dir });
  assert.equal(t.get('builtin-chakra'), null);
  assert.equal(t.designOf(t.get('builtin-meridian')), null);
  // A POV whose team chose a template that is gone takes the organisation's default.
  store.deckDefaults = { org: 'builtin-classic', teams: { se: 'builtin-kendra' } };
  assert.equal(t.resolve({ ownerId: 'se' }).id, 'builtin-classic');
});
