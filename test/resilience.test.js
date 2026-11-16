// Encryption at rest, self-repair, checked backups and restore, encrypted video seeking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Db } from '../src/db.js';
import { Vault } from '../src/vault.js';
import { Backups } from '../src/backups.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrdn-'));

test('every record is encrypted on disk, and a record written before encryption still reads', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify({ old: 'plain' }));
  const db = new Db(dir);
  assert.deepEqual(db.read('legacy', null), { old: 'plain' });
  db.write('people', [{ name: 'Priya Rao', email: 'priya@acme.example' }]);
  const raw = fs.readFileSync(path.join(dir, 'people.json'));
  assert.ok(Vault.isEncrypted(raw));
  assert.ok(!raw.includes('Priya'), 'no plain text on disk');
  assert.deepEqual(new Db(dir).read('people', []), [{ name: 'Priya Rao', email: 'priya@acme.example' }]);
});

test('a damaged record repairs itself from its previous copy, then from a backup', () => {
  const dir = tmp();
  const db = new Db(dir);
  db.write('notes', ['one']);
  db.write('notes', ['one', 'two']);
  fs.writeFileSync(path.join(dir, 'notes.json'), 'garbage');
  const again = new Db(dir);
  assert.deepEqual(again.read('notes', []), ['one'], 'from notes.json.prev');
  assert.equal(again.repairs[0].from, 'its previous copy');

  const backups = new Backups({ dataDir: dir, vault: again.vault });
  again.write('notes', ['from backup']);
  backups.take('auto');
  fs.writeFileSync(path.join(dir, 'notes.json'), 'garbage');
  fs.writeFileSync(path.join(dir, 'notes.json.prev'), 'garbage');
  const third = new Db(dir);
  assert.deepEqual(third.read('notes', []), ['from backup']);
  assert.match(third.repairs[0].from, /^backup .*-auto$/);
});

test('backups: checked when taken, never hold the key, copied off the server, and restore with an undo', () => {
  const dir = tmp();
  const off = tmp();
  const db = new Db(dir);
  db.write('opportunities', [{ id: 'a' }]);
  fs.mkdirSync(path.join(dir, 'snapshots'));
  fs.writeFileSync(path.join(dir, 'snapshots', 'x.json'), '{}');
  const b = new Backups({ dataDir: dir, vault: db.vault, offsiteDir: off });
  const name = b.take('manual');
  const [listed] = b.list();
  assert.equal(listed.name, name);
  assert.equal(listed.verified, true);
  assert.equal(listed.offsite, true);
  assert.ok(!fs.existsSync(path.join(b.root, name, 'secret.key')), 'the key is never in a backup');
  assert.ok(!fs.existsSync(path.join(b.root, name, 'snapshots')), 'snapshots are read again, not backed up');

  db.write('opportunities', [{ id: 'a' }, { id: 'b' }]);
  const r = b.restore(name);
  assert.deepEqual(new Db(dir).read('opportunities', []), [{ id: 'a' }]);
  assert.ok(b.list().some((x) => x.name === r.undo), 'the data before the restore is kept');

  // A backup changed after it was taken is refused.
  fs.appendFileSync(path.join(b.root, name, 'opportunities.json'), 'x');
  assert.equal(b.verify(name).ok, false);
  assert.throws(() => b.restore(name), /cannot be restored/);
});

test('encrypted videos can be read from any byte, for seeking', async () => {
  const dir = tmp();
  const v = new Vault(dir);
  const plain = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const file = path.join(dir, 'v.mp4');
  await new Promise((res, rej) => Readable.from([plain.subarray(0, 1234), plain.subarray(1234)]).pipe(v.encryptingStream()).pipe(fs.createWriteStream(file)).on('finish', res).on('error', rej));
  assert.ok(!fs.readFileSync(file).includes(plain.subarray(100, 140)));
  assert.equal(v.plainSize(file), 5000);
  const read = async (s, e) => Buffer.concat(await v.readStream(file, s, e).toArray());
  assert.deepEqual(await read(0, 4999), plain);
  assert.deepEqual(await read(17, 300), plain.subarray(17, 301));
  assert.deepEqual(await read(4095, 4999), plain.subarray(4095));
  assert.deepEqual(v.decrypt(fs.readFileSync(file)), plain);
});
