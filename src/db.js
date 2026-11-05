/**
 * Storage: one JSON file per collection in the data folder, written atomically (temp file + rename), mode 0600.
 * Sized for a team's worth of opportunities (hundreds), where a database would only add moving parts; a backup is a
 * copy of the folder.
 *
 * Secrets (Checkmarx One API keys, the SMTP password) are sealed with AES-256-GCM. The key comes from CC_SECRET when
 * set, otherwise from a random key file made beside the data the first time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const fail = (status, message) => Object.assign(new Error(message), { status });
export const text = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
export const dateOnly = (v) => {
  const s = text(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) ? s : '';
};
export const isoOrNull = (v) => (v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
export const httpUrl = (v) => {
  const s = text(v, 2000);
  if (!s) return '';
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
};
export const email = (v) => {
  const s = text(v, 254).toLowerCase();
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s) ? s : '';
};

export class Db {
  #dir;
  #cache = new Map();
  #key;

  constructor(dir) {
    this.#dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#key = secretKey(dir);
  }

  get dir() {
    return this.#dir;
  }

  read(name, fallback) {
    if (this.#cache.has(name)) return this.#cache.get(name);
    let value = fallback;
    try {
      value = JSON.parse(fs.readFileSync(path.join(this.#dir, `${name}.json`), 'utf8'));
    } catch {}
    this.#cache.set(name, value);
    return value;
  }

  write(name, value) {
    this.#cache.set(name, value);
    const file = path.join(this.#dir, `${name}.json`);
    const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  seal(plain) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }

  open(sealed) {
    const [iv, tag, data] = String(sealed).split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

function secretKey(dir) {
  if (process.env.CC_SECRET) return createHash('sha256').update(process.env.CC_SECRET).digest();
  const file = path.join(dir, 'secret.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length === 32) return key;
  } catch {}
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}
