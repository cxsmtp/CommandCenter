/**
 * Everything kept on disk is encrypted: the collections, the tenant snapshots, the frozen results pages and the demo
 * videos. One key (AES-256) for the data folder:
 *   - CC_SECRET (a passphrase) or CC_SECRET_FILE (a file holding one, e.g. a Docker/Kubernetes secret), best kept off
 *     the data volume, so a copy of the data or of a backup cannot be read without it;
 *   - otherwise a random key made beside the data the first time (data/secret.key), never put in a backup.
 *
 * Records (JSON, HTML) use AES-256-GCM, which also proves they were not damaged or changed: a file that fails is
 * treated as damaged and repaired from its last good copy (<file>.prev) or the newest backup holding it.
 * Videos use AES-256-CTR so a player can seek (any byte range can be decrypted on its own).
 *
 * Files written before encryption was turned on are read as they are and encrypted the next time they are written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const RECORD = Buffer.from('MRDN1G'); // + iv(12) + tag(16) + data
const STREAM = Buffer.from('MRDN1C'); // + iv(16) + data

export function loadKey(dataDir) {
  if (process.env.CC_SECRET) return { key: createHash('sha256').update(process.env.CC_SECRET).digest(), source: 'CC_SECRET' };
  if (process.env.CC_SECRET_FILE) {
    const s = fs.readFileSync(process.env.CC_SECRET_FILE, 'utf8').trim();
    if (!s) throw new Error('CC_SECRET_FILE is empty.');
    return { key: createHash('sha256').update(s).digest(), source: 'CC_SECRET_FILE' };
  }
  const file = path.join(dataDir, 'secret.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length === 32) return { key, source: 'key file in the data folder' };
  } catch {}
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return { key, source: 'key file in the data folder' };
}

export class Vault {
  #key;
  /** A short fingerprint of the key, to tell which key a backup needs (never the key). */
  fingerprint;
  source;

  constructor(dataDir) {
    const { key, source } = loadKey(dataDir);
    this.#key = key;
    this.source = source;
    this.fingerprint = createHash('sha256').update(key).update('meridian-fingerprint').digest('hex').slice(0, 12);
  }

  static isEncrypted(buf) {
    return Buffer.isBuffer(buf) && (buf.subarray(0, RECORD.length).equals(RECORD) || buf.subarray(0, STREAM.length).equals(STREAM));
  }

  encrypt(data) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#key, iv);
    const body = Buffer.concat([c.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')), c.final()]);
    return Buffer.concat([RECORD, iv, c.getAuthTag(), body]);
  }

  /** The plain bytes; throws when the file is damaged or was encrypted with another key. */
  decrypt(buf) {
    if (!buf.subarray(0, RECORD.length).equals(RECORD)) {
      if (buf.subarray(0, STREAM.length).equals(STREAM)) return this.decryptStream(buf);
      return buf; // written before encryption
    }
    const iv = buf.subarray(RECORD.length, RECORD.length + 12);
    const tag = buf.subarray(RECORD.length + 12, RECORD.length + 28);
    const d = createDecipheriv('aes-256-gcm', this.#key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(buf.subarray(RECORD.length + 28)), d.final()]);
  }

  /** Atomic: a temp file, flushed to disk, then renamed over; the file it replaces is kept as <file>.prev. */
  writeFile(file, data, { keepPrevious = true } = {}) {
    const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, this.encrypt(data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (keepPrevious && fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, `${file}.prev`);
      } catch {}
    }
    fs.renameSync(tmp, file);
  }

  readFile(file) {
    return this.decrypt(fs.readFileSync(file));
  }

  readJson(file) {
    return JSON.parse(this.readFile(file).toString('utf8'));
  }

  // ——— Streams (videos): CTR, so any range can be read on its own ———

  /** A transform that encrypts what passes through; the header goes first. */
  encryptingStream() {
    const iv = randomBytes(16);
    const c = createCipheriv('aes-256-ctr', this.#key, iv);
    let first = true;
    return new Transform({
      transform(chunk, _enc, done) {
        const out = c.update(chunk);
        if (first) {
          first = false;
          return done(null, Buffer.concat([STREAM, iv, out]));
        }
        done(null, out);
      },
      flush(done) {
        if (first) this.push(Buffer.concat([STREAM, iv]));
        done(null, c.final());
      },
    });
  }

  static streamHeader = STREAM.length + 16;

  /** The plain size of a stream file (or of a legacy plain file). */
  plainSize(file) {
    const size = fs.statSync(file).size;
    return this.#isStreamFile(file) ? size - Vault.streamHeader : size;
  }

  #isStreamFile(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(STREAM.length);
      fs.readSync(fd, head, 0, head.length, 0);
      return head.equals(STREAM);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** A readable stream of the plain bytes start..end (inclusive). */
  readStream(file, start = 0, end = Infinity) {
    if (!this.#isStreamFile(file)) return fs.createReadStream(file, { start, end });
    const fd = fs.openSync(file, 'r');
    const iv = Buffer.alloc(16);
    fs.readSync(fd, iv, 0, 16, STREAM.length);
    fs.closeSync(fd);
    const block = Math.floor(start / 16);
    const counter = addCounter(iv, block);
    const d = createDecipheriv('aes-256-ctr', this.#key, counter);
    let skip = start % 16;
    const src = fs.createReadStream(file, { start: Vault.streamHeader + block * 16, end: end === Infinity ? undefined : Vault.streamHeader + end });
    const t = new Transform({
      transform(chunk, _e, done) {
        let out = d.update(chunk);
        if (skip) {
          out = out.subarray(skip);
          skip = 0;
        }
        done(null, out);
      },
    });
    src.on('error', (e) => t.destroy(e));
    return src.pipe(t);
  }

  decryptStream(buf) {
    const iv = buf.subarray(STREAM.length, STREAM.length + 16);
    const d = createDecipheriv('aes-256-ctr', this.#key, iv);
    return Buffer.concat([d.update(buf.subarray(Vault.streamHeader)), d.final()]);
  }

  // ——— Short secrets inside records (API keys, passwords): a text form, as before ———

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

/** The CTR counter for a block: the IV read as a 128-bit big-endian number, plus the block number. */
function addCounter(iv, n) {
  const out = Buffer.from(iv);
  let carry = BigInt(n);
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(out[i]) + (carry & 0xffn);
    out[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return out;
}

