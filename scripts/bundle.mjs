/**
 * Build the release bundle the updater installs: commandcenter-<version>.tar.gz (the app with its production
 * dependencies, under one top folder) and SHA256SUMS. With RELEASE_SIGNING_KEY (an Ed25519 private key, PEM) set,
 * also SHA256SUMS.sig, which servers started with CC_UPDATE_PUBKEY require.
 *
 *   npm ci --omit=dev && node scripts/bundle.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist'));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `commandcenter-${version}.tar.gz`;
fs.mkdirSync(out, { recursive: true });
const stage = fs.mkdtempSync(path.join(out, 'stage-'));
const top = path.join(stage, 'commandcenter');
fs.mkdirSync(top);
for (const item of ['package.json', 'package-lock.json', 'src', 'public', 'scripts/bundle.mjs', 'node_modules', 'LICENSE', 'README.md']) {
  const from = path.join(root, item);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(top, item), { recursive: true });
}
execFileSync('tar', ['-czf', path.join(out, name), '-C', stage, 'commandcenter']);
fs.rmSync(stage, { recursive: true, force: true });
const sum = createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex');
const sums = `${sum}  ${name}\n`;
fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums);
if (process.env.RELEASE_SIGNING_KEY) {
  const sig = sign(null, Buffer.from(sums), createPrivateKey(process.env.RELEASE_SIGNING_KEY)).toString('base64');
  fs.writeFileSync(path.join(out, 'SHA256SUMS.sig'), `${sig}\n`);
}
console.log(`${name}  ${sum}`);
