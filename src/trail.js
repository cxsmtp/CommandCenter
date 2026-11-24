/**
 * The audit trail: everything that happens in Meridian, kept and provable.
 *
 * Two streams, each in <data>/audit/<stream>/:
 *   changes  every change (settings, people, roles, opportunities, criteria, emails sent, updates…), in words.
 *            Kept for good.
 *   access   every request to the API — reads included — with who, when, from where, what, the POV it was about and
 *            how it ended; sign-ins (and failed ones). Kept CC_ACCESS_DAYS days (730 by default).
 *
 * Every record carries the SHA-256 of the record before it in its stream, so a removed, changed or reordered record
 * breaks the chain and shows. Records are encrypted with the data key (vault.js): the day being written is one
 * encrypted line per record (<day>.log); a finished day is sealed into one compressed, encrypted file (<day>.arc)
 * that never changes again — backups link to it instead of copying it each time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const STREAMS = ['changes', 'access'];
const DAY = 86_400_000;
const dayOf = (iso) => iso.slice(0, 10);

export class Trail {
  #dir;
  #vault;
  #state = {}; // per stream: { seq, hash, day }
  #queue = { changes: [], access: [] };
  #timer = null;
  #cache = new Map(); // `${stream}/${day}` -> records (sealed days only)
  #size = {}; // per stream: the size its day file had after our last write
  accessDays;

  constructor({ dataDir, vault, accessDays = Number(process.env.CC_ACCESS_DAYS) || 730 }) {
    this.#dir = path.join(dataDir, 'audit');
    this.#vault = vault;
    this.accessDays = accessDays;
    for (const s of STREAMS) {
      fs.mkdirSync(path.join(this.#dir, s), { recursive: true, mode: 0o700 });
      this.#state[s] = this.#lastOf(s);
    }
    this.#timer = setInterval(() => this.flush(), 1000);
    this.#timer.unref();
  }

  // ——— Writing ———

  /** A change, in words: { by, byName, role, type, what, opp, customer, detail }. Written at once. */
  change(entry) {
    this.#catchUp('changes');
    const r = this.#append('changes', entry);
    this.flush('changes');
    return r;
  }

  /** A request: { by, byName, role, ip, ua, method, route, path, status, ms, opp, customer }. Written within a second. */
  access(entry) {
    return this.#append('access', entry);
  }

  #append(stream, entry) {
    const st = this.#state[stream];
    const at = new Date().toISOString();
    const rec = { seq: st.seq + 1, at, ...entry, prev: st.hash };
    rec.hash = createHash('sha256').update(st.hash + JSON.stringify({ ...rec, hash: undefined })).digest('hex');
    st.seq = rec.seq;
    st.hash = rec.hash;
    this.#queue[stream].push(rec);
    if (this.#queue[stream].length >= 500) this.flush(stream);
    return rec;
  }

  /** Write what is waiting, sealing the day before when the date has moved on. */
  flush(only = null) {
    for (const s of only ? [only] : STREAMS) {
      const q = this.#queue[s];
      if (!q.length) continue;
      this.#queue[s] = [];
      const byDay = new Map();
      for (const r of q) {
        const d = dayOf(r.at);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(r);
      }
      for (const [d, list] of byDay) {
        if (this.#state[s].day && this.#state[s].day < d) this.#seal(s, this.#state[s].day);
        this.#state[s].day = d;
        const lines = list.map((r) => this.#vault.encrypt(JSON.stringify(r)).toString('base64')).join('\n') + '\n';
        const file = path.join(this.#dir, s, `${d}.log`);
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          fs.appendFileSync(file, lines, { mode: 0o600 });
          this.#size[s] = { day: d, bytes: fs.statSync(file).size };
        } catch (error) {
          // Never take the server down for the trail; say so loudly (the health check shows the disk).
          console.error(`Audit trail: could not write ${list.length} ${s} record(s): ${error.message}`);
        }
      }
    }
  }

  /** Another process (the console reset) wrote to the stream: carry the chain on from its record, not ours. */
  #catchUp(stream) {
    const known = this.#size[stream];
    if (!known || this.#queue[stream].length) return;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(this.#dir, stream, `${known.day}.log`)).size;
    } catch {}
    if (bytes !== known.bytes) {
      this.#state[stream] = this.#lastOf(stream);
      this.#size[stream] = { day: known.day, bytes };
    }
  }

  /** A finished day becomes one compressed, encrypted file. */
  #seal(stream, day) {
    const log = path.join(this.#dir, stream, `${day}.log`);
    if (!fs.existsSync(log)) return;
    const records = this.#readLog(log);
    const arc = path.join(this.#dir, stream, `${day}.arc`);
    this.#vault.writeFile(arc, gzipSync(JSON.stringify(records)), { keepPrevious: false });
    fs.rmSync(log, { force: true });
  }

  /** Seal finished days and drop access days past their keeping time (once a day is enough). */
  maintain(now = Date.now()) {
    this.flush();
    const today = dayOf(new Date(now).toISOString());
    for (const s of STREAMS) {
      for (const f of fs.readdirSync(path.join(this.#dir, s))) {
        const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
        if (m && m[1] < today) this.#seal(s, m[1]);
      }
    }
    const cutoff = dayOf(new Date(now - this.accessDays * DAY).toISOString());
    for (const f of fs.readdirSync(path.join(this.#dir, 'access'))) {
      const m = /^(\d{4}-\d{2}-\d{2})\.(arc|log)$/.exec(f);
      if (m && m[1] < cutoff) fs.rmSync(path.join(this.#dir, 'access', f), { force: true });
    }
  }

  stop() {
    clearInterval(this.#timer);
    this.flush();
  }

  // ——— Reading ———

  #days(stream) {
    const out = new Set();
    for (const f of fs.readdirSync(path.join(this.#dir, stream))) {
      const m = /^(\d{4}-\d{2}-\d{2})\.(arc|log)$/.exec(f);
      if (m) out.add(m[1]);
    }
    return [...out].sort();
  }

  #readLog(file) {
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(this.#vault.decrypt(Buffer.from(line, 'base64')).toString('utf8')));
      } catch {
        out.push({ damaged: true });
      }
    }
    return out;
  }

  #readDay(stream, day) {
    const log = path.join(this.#dir, stream, `${day}.log`);
    const arc = path.join(this.#dir, stream, `${day}.arc`);
    let records = [];
    const key = `${stream}/${day}`;
    if (fs.existsSync(arc)) {
      if (!this.#cache.has(key)) {
        this.#cache.set(key, JSON.parse(gunzipSync(this.#vault.readFile(arc)).toString('utf8')));
        while (this.#cache.size > 20) this.#cache.delete(this.#cache.keys().next().value);
      }
      records = this.#cache.get(key);
    }
    if (fs.existsSync(log)) records = [...records, ...this.#readLog(log)];
    if (dayOf(new Date().toISOString()) === day || this.#state[stream]?.day === day) records = [...records, ...this.#queue[stream].filter((r) => dayOf(r.at) === day)];
    return records;
  }

  /**
   * Newest first. `match(record)` decides what is shown; `before` (a seq) pages back; `from`/`to` are dates.
   * Reads day by day from the newest, and stops once `limit` records are found.
   */
  query(stream, { match = () => true, before = Infinity, from = '', to = '', limit = 100 } = {}) {
    this.flush(stream);
    const days = this.#days(stream).filter((d) => (!from || d >= from) && (!to || d <= to)).reverse();
    const out = [];
    let scanned = 0;
    for (const d of days) {
      const recs = this.#readDay(stream, d);
      for (let i = recs.length - 1; i >= 0; i -= 1) {
        const r = recs[i];
        if (r.damaged || r.seq >= before) continue;
        scanned += 1;
        if (match(r)) {
          out.push(r);
          if (out.length >= limit) return { records: out, next: r.seq, scanned };
        }
      }
    }
    return { records: out, next: null, scanned };
  }

  /** Walk a stream's chain from its oldest kept record: { ok, records, from, brokenAt }. */
  verify(stream = 'changes') {
    this.flush(stream);
    let prev = null;
    let count = 0;
    let first = null;
    for (const d of this.#days(stream)) {
      for (const r of this.#readDay(stream, d)) {
        if (r.damaged) return { ok: false, records: count, from: first, brokenAt: d, reason: 'a record cannot be read' };
        const { hash, ...rest } = r;
        const want = createHash('sha256').update(r.prev + JSON.stringify({ ...rest, hash: undefined })).digest('hex');
        if (want !== hash || (prev !== null && r.prev !== prev)) return { ok: false, records: count, from: first, brokenAt: r.at, reason: want !== hash ? 'a record was changed' : 'a record is missing' };
        prev = hash;
        first ??= r.at;
        count += 1;
      }
    }
    return { ok: true, records: count, from: first };
  }

  /** The newest record's position in a stream, to carry the chain on after a restart. */
  #lastOf(stream) {
    const days = this.#days(stream);
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const recs = this.#readDay(stream, days[i]).filter((r) => !r.damaged);
      if (recs.length) {
        const last = recs.at(-1);
        return { seq: last.seq, hash: last.hash, day: days[i] };
      }
    }
    return { seq: 0, hash: '', day: null };
  }

  /** Bring entries from the old audit.json in (once), keeping their order and time. */
  importOld(entries) {
    const st = this.#state.changes;
    if (st.seq > 0 || !entries.length) return 0;
    for (const e of entries) {
      const rec = { seq: st.seq + 1, at: e.at, by: e.by, byName: e.byName, type: e.type, what: e.what, detail: e.detail, imported: true, prev: st.hash };
      rec.hash = createHash('sha256').update(st.hash + JSON.stringify({ ...rec, hash: undefined })).digest('hex');
      st.seq = rec.seq;
      st.hash = rec.hash;
      this.#queue.changes.push(rec);
    }
    this.flush('changes');
    return entries.length;
  }
}
