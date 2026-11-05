/**
 * The POVs (one Checkmarx One tenant each) and their API keys, kept in one JSON file.
 *
 * API keys are encrypted at rest (AES-256-GCM). The encryption key comes from CC_SECRET when set, otherwise from a
 * random key file made beside the data the first time (mode 0600). The key never leaves the server: what the page
 * gets back is publicPov(), without it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { deriveConnection } from './cxone/endpoints.js';
import { tenantColours } from '../public/tenant-colour.js';

export const STAGES = ['active', 'paused', 'won', 'lost', 'closed'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const dateOnly = (v) => {
  const s = text(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) ? s : '';
};

function secretKey(dataDir) {
  if (process.env.CC_SECRET) return createHash('sha256').update(process.env.CC_SECRET).digest();
  const file = path.join(dataDir, 'secret.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length === 32) return key;
  } catch {}
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

export function encrypt(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(key, sealed) {
  const [iv, tag, data] = String(sealed).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export class PovStore {
  #file;
  #key;
  #povs = [];

  constructor({ dataDir }) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.#file = path.join(dataDir, 'povs.json');
    this.#key = secretKey(dataDir);
    try {
      const raw = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
      this.#povs = Array.isArray(raw.povs) ? raw.povs : [];
    } catch {}
  }

  #save() {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ povs: this.#povs }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.#file);
  }

  list() {
    const colours = tenantColours(this.#povs.map((p) => p.id));
    return this.#povs.map((p) => ({ ...p, colour: colours[p.id] }));
  }

  get(id) {
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** The connection (with the API key) for a POV: server side only. */
  connection(id) {
    const pov = this.#povs.find((p) => p.id === id);
    if (!pov) throw fail(404, 'No such POV.');
    return deriveConnection(decrypt(this.#key, pov.apiKey), pov.overrides ?? {});
  }

  /** Add a POV from an API key. The tenant, region and hosts come from the key itself. */
  add({ apiKey, name, customer, owner, startDate, endDate, notes, overrides } = {}) {
    const connection = deriveConnection(apiKey, cleanOverrides(overrides));
    if (this.#povs.some((p) => p.tenant === connection.tenant && p.iamUrl === connection.iamUrl)) {
      throw fail(409, `Tenant "${connection.tenant}" (${connection.regionLabel}) is already in the command center.`);
    }
    const pov = {
      id: randomUUID(),
      name: text(name, 80) || text(customer, 80) || connection.tenant,
      customer: text(customer, 120),
      owner: text(owner, 120),
      stage: 'active',
      startDate: dateOnly(startDate) || new Date().toISOString().slice(0, 10),
      endDate: dateOnly(endDate),
      notes: text(notes, 2000),
      tenant: connection.tenant,
      region: connection.region,
      regionLabel: connection.regionLabel,
      iamUrl: connection.iamUrl,
      baseUrl: connection.baseUrl,
      keyExpiresAt: connection.expiresAt,
      overrides: cleanOverrides(overrides),
      apiKey: encrypt(this.#key, connection.apiKey),
      createdAt: new Date().toISOString(),
    };
    this.#povs.push(pov);
    this.#save();
    return publicPov(this.get(pov.id));
  }

  update(id, changes = {}) {
    const pov = this.#povs.find((p) => p.id === id);
    if (!pov) throw fail(404, 'No such POV.');
    if ('name' in changes) pov.name = text(changes.name, 80) || pov.tenant;
    for (const field of ['customer', 'owner']) if (field in changes) pov[field] = text(changes[field], 120);
    if ('notes' in changes) pov.notes = text(changes.notes, 2000);
    if ('startDate' in changes) pov.startDate = dateOnly(changes.startDate);
    if ('endDate' in changes) pov.endDate = dateOnly(changes.endDate);
    if ('stage' in changes) {
      if (!STAGES.includes(changes.stage)) throw fail(400, `Stage must be one of ${STAGES.join(', ')}.`);
      pov.stage = changes.stage;
    }
    if (changes.apiKey) {
      // A new key for the same tenant (the old one expired or was revoked).
      const connection = deriveConnection(changes.apiKey, pov.overrides ?? {});
      if (connection.tenant !== pov.tenant) throw fail(400, `That key is for tenant "${connection.tenant}", not "${pov.tenant}".`);
      pov.apiKey = encrypt(this.#key, connection.apiKey);
      pov.keyExpiresAt = connection.expiresAt;
    }
    this.#save();
    return publicPov(this.get(id));
  }

  remove(id) {
    const index = this.#povs.findIndex((p) => p.id === id);
    if (index === -1) throw fail(404, 'No such POV.');
    const [pov] = this.#povs.splice(index, 1);
    this.#save();
    return publicPov(pov);
  }
}

function cleanOverrides(o) {
  const out = {};
  for (const k of ['baseUrl', 'iamUrl', 'tenant']) if (o?.[k]) out[k] = text(o[k], 300);
  return out;
}

/** A POV as the page sees it: never the API key. */
export function publicPov(pov) {
  if (!pov) return null;
  const { apiKey, overrides, ...safe } = pov;
  return safe;
}
