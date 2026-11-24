#!/usr/bin/env node
/**
 * Reset a person's password from the server itself, for when nobody can sign in (the Admin too).
 *
 *   podman exec -it meridian node src/reset-password.js admin@meridian.local
 *   podman restart meridian
 *
 * Prints a new one-time password; the person chooses their own at the next sign-in. The account is switched back on
 * if it was off. The restart makes the server read it, and signs that person out everywhere. Recorded in the audit log.
 * With no address, lists the people there are.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Db } from './db.js';
import { hashPassword } from './users.js';
import { Audit } from './audit.js';
import { Trail } from './trail.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CC_DATA_DIR || path.join(ROOT, 'data');
const email = String(process.argv[2] ?? '').trim().toLowerCase();

const db = new Db(dataDir);
const users = db.read('users', []);
const list = () => users.map((u) => `  ${u.email}  (${u.role}${u.active === false ? ', off' : ''})`).join('\n');

if (!users.length) {
  console.error(`No people found in ${dataDir}. Is CC_DATA_DIR (and CC_SECRET / CC_SECRET_FILE) the one the server uses?`);
  process.exit(1);
}
if (!email) {
  console.log(`Usage: node src/reset-password.js <email>\n\nPeople:\n${list()}`);
  process.exit(1);
}
const user = users.find((u) => u.email === email);
if (!user) {
  console.error(`Nobody signs in as ${email}. People:\n${list()}`);
  process.exit(1);
}

const password = randomBytes(9).toString('base64url');
user.password = hashPassword(password);
user.mustChangePassword = true;
user.active = true;
db.write('users', users);
const trail = new Trail({ dataDir, vault: db.vault });
new Audit(db, trail).record(null, 'people', `Password reset from the server console for ${user.email}`, { id: user.id });
trail.stop();

console.log(`\n  New one-time password for ${user.email}:  ${password}\n  They choose their own at the next sign-in.\n\n  Now restart the server so it takes it:  podman restart meridian\n`);
