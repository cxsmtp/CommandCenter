/**
 * Keeps every POV tenant fresh: reads each one every REFRESH_MINUTES (10 by default) and keeps the latest read, the
 * one before (for what changed) and a short history for trend lines. Snapshots are saved, so a restart shows the
 * last known state straight away. Only opportunities whose POV is running are read on the clock; any other is read
 * when someone asks.
 *
 * Built for hundreds of tenants at once:
 *   - at most CC_READ_CONCURRENCY tenants (10) are read at the same time; the rest queue, a person's
 *     "Refresh now" ahead of the clock
 *   - the first reads after a start are spread over the whole interval, never all at once
 *   - each tenant keeps its client, so its sign-in token is reused until it expires
 *   - the slow parts (credits, IAM people, AI settings) are read every hour, the rest every interval
 *   - a quiet tenant (no scan for 3 days, none running) is read three times less often
 *   - a failing tenant backs off (2×, 4×… up to an hour); a refused key waits an hour, until it is replaced
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { collect, summarize, healthOf } from './collector.js';
import { CxClient } from './cxone/client.js';
import { Vault } from './vault.js';
import { mergeProof, historyFrom, proofScans } from './proof.js';

const SLOW_EVERY_MS = 60 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** Two queues, one slot pool: a person's refresh goes ahead of the clock's. */
class Lanes {
  #high = [];
  #low = [];
  active = 0;
  constructor(limit) {
    this.limit = limit;
  }
  get waiting() {
    return this.#high.length + this.#low.length;
  }
  async run(task, { high = false } = {}) {
    if (this.active >= this.limit) await new Promise((resolve) => (high ? this.#high : this.#low).push(resolve));
    else this.active += 1;
    try {
      return await task();
    } finally {
      const next = this.#high.shift() ?? this.#low.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

const HISTORY = 288; // 48 hours at 10 minutes
const SAFE_ID = /^[0-9a-f-]{36}$/;

export class Monitor extends EventEmitter {
  #source;
  #dir;
  #intervalMs;
  #collect;
  #state = new Map();
  #lanes;
  #clients = new Map(); // id → { key, client }: the sign-in token is reused between reads
  #vault;
  stats = { reads: 0, failures: 0, lastReadMs: 0, startedAt: new Date().toISOString() };

  /**
   * @param {object} o
   * @param {{ ids(): string[], polled(id): boolean, connection(id): object }} o.source
   */
  constructor({ source, dataDir, intervalMinutes = 10, collectFn = collect, concurrency = Number(process.env.CC_READ_CONCURRENCY) || 10 }) {
    super();
    this.setMaxListeners(0);
    this.#lanes = new Lanes(Math.max(1, concurrency));
    this.#source = source;
    this.#dir = path.join(dataDir, 'snapshots');
    this.#vault = new Vault(dataDir);
    this.#collect = collectFn;
    this.setInterval(intervalMinutes);
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
  }

  get intervalMs() {
    return this.#intervalMs;
  }

  setInterval(minutes) {
    this.#intervalMs = Math.min(24 * 60, Math.max(1, Number(minutes) || 10)) * 60_000;
  }

  #entry(id) {
    let entry = this.#state.get(id);
    if (!entry) {
      entry = { snapshot: null, previous: null, error: null, history: [], proof: null, refreshing: null, timer: null, nextAt: null, failures: 0, slowAt: 0 };
      if (SAFE_ID.test(id)) {
        try {
          Object.assign(entry, this.#vault.readJson(path.join(this.#dir, `${id}.json`)), { refreshing: null, timer: null, nextAt: null, slowAt: 0 });
        } catch {}
      }
      this.#state.set(id, entry);
    }
    return entry;
  }

  #persist(id, entry) {
    if (!SAFE_ID.test(id)) return;
    // A snapshot is a cache of what Checkmarx One says: no previous copy is needed, the next read rebuilds it.
    this.#vault.writeFile(path.join(this.#dir, `${id}.json`), JSON.stringify({ snapshot: entry.snapshot, previous: entry.previous, error: entry.error, history: entry.history, failures: entry.failures, proof: entry.proof, baseline: entry.baseline ?? null }), { keepPrevious: false });
  }

  /** The first reads, spread over the interval (at most 10 minutes), the stalest first. */
  start() {
    const ids = this.#source.ids().sort((a, b) => (Date.parse(this.#entry(a).snapshot?.at ?? '') || 0) - (Date.parse(this.#entry(b).snapshot?.at ?? '') || 0));
    const span = Math.min(this.#intervalMs, 10 * 60_000);
    ids.forEach((id, i) => this.schedule(id, Math.round(2000 + (i * span) / Math.max(1, ids.length))));
  }

  /** How the reading is going: for Settings and the health check. */
  load() {
    const entries = [...this.#state.values()];
    return { ...this.stats, tenants: this.#source.ids().length, reading: this.#lanes.active, queued: this.#lanes.waiting, limit: this.#lanes.limit, failing: entries.filter((e) => e.error && e.failures).length, intervalMinutes: this.#intervalMs / 60_000 };
  }

  /** When the next read is due: longer for a quiet tenant, much longer for a failing one. */
  #nextDelay(entry) {
    if (entry.error) {
      // A key Checkmarx One refuses will not start working by itself: once an hour, until it is replaced.
      if ([400, 401, 403].includes(entry.error.status)) return MAX_BACKOFF_MS;
      return Math.min(MAX_BACKOFF_MS, this.#intervalMs * 2 ** Math.min(entry.failures, 6));
    }
    const s = summarize(entry.snapshot);
    const quiet = s && !(s.running + s.queued) && (!s.lastActivityAt || Date.now() - Date.parse(s.lastActivityAt) > 3 * 86_400_000);
    return quiet ? this.#intervalMs * 3 : this.#intervalMs;
  }

  #clientFor(id, connection) {
    const key = `${connection.apiKey}|${connection.baseUrl}|${connection.iamUrl}`;
    const hit = this.#clients.get(id);
    if (hit?.key === key) return hit.client;
    const client = new CxClient(connection);
    this.#clients.set(id, { key, client });
    return client;
  }

  stop() {
    for (const entry of this.#state.values()) clearTimeout(entry.timer);
  }

  /** Re-time every POV after the interval changed. */
  reschedule() {
    for (const id of this.#source.ids()) this.schedule(id);
  }

  schedule(id, delayMs) {
    const entry = this.#entry(id);
    delayMs ??= this.#nextDelay(entry);
    clearTimeout(entry.timer);
    entry.nextAt = Date.now() + delayMs;
    entry.timer = setTimeout(() => this.refresh(id).catch(() => {}), delayMs);
    entry.timer.unref?.();
  }

  forget(id) {
    const entry = this.#state.get(id);
    if (entry) clearTimeout(entry.timer);
    this.#state.delete(id);
    this.#clients.delete(id);
    if (SAFE_ID.test(id)) fs.rmSync(path.join(this.#dir, `${id}.json`), { force: true });
    this.emit('update', { id, removed: true });
  }

  refresh(id, { force = false } = {}) {
    const entry = this.#entry(id);
    if (!this.#source.ids().includes(id)) return Promise.resolve(null);
    if (!force && !this.#source.polled(id)) {
      this.schedule(id);
      return Promise.resolve(entry.snapshot);
    }
    entry.refreshing ??= (async () => {
      this.emit('update', { id, refreshing: true });
      const started = Date.now();
      try {
        const connection = this.#source.connection(id);
        const slow = force || !entry.snapshot || Date.now() - entry.slowAt >= SLOW_EVERY_MS;
        // The proof record: the whole scan history the first time (or for another tenant), then what is new.
        const sameTenant = entry.proof?.tenant === connection.tenant;
        const snapshot = await this.#lanes.run(() => this.#collect(connection, { client: this.#clientFor(id, connection), previous: entry.snapshot, slow, historyFrom: historyFrom(sameTenant ? entry.proof : null), scope: this.#source.scope?.(id) ?? null }), { high: force });
        const scansOk = !(snapshot.errors ?? []).some((e) => e.part === 'scans');
        entry.proof = mergeProof(sameTenant ? entry.proof : null, [...(snapshot.scans ?? []), ...(snapshot.older ?? [])], { tenant: connection.tenant, at: snapshot.at, complete: scansOk });
        delete snapshot.older;
        // The Analytics numbers at the start of the POV (its first answer), to show what changed by the end.
        if (snapshot.analytics && (!entry.baseline || !sameTenant)) entry.baseline = { at: snapshot.at, ...snapshot.analytics };
        if (slow) entry.slowAt = Date.now();
        entry.failures = 0;
        entry.previous = entry.snapshot;
        entry.snapshot = snapshot;
        entry.error = null;
        const f = snapshot.findings;
        entry.history.push({ at: snapshot.at, critical: f?.critical ?? null, high: f?.high ?? null, total: f?.total ?? null, scans24h: summarize(snapshot)?.scans24h ?? 0, running: snapshot.active?.length ?? 0, creditsUsed: snapshot.credits?.used ?? null });
        entry.history = entry.history.slice(-HISTORY);
      } catch (error) {
        entry.failures = (entry.failures ?? 0) + 1;
        this.stats.failures += 1;
        entry.error = { at: new Date().toISOString(), message: String(error.message ?? error).slice(0, 400), status: error.status ?? 0, failures: entry.failures };
        // A refused key: drop the cached client, so a replaced key is used at once.
        if ([400, 401, 403].includes(error.status)) this.#clients.delete(id);
      } finally {
        this.stats.reads += 1;
        this.stats.lastReadMs = Date.now() - started;
        entry.refreshing = null;
        try {
          this.#persist(id, entry);
        } catch {}
        this.schedule(id);
        this.emit('update', { id });
      }
      return entry.snapshot;
    })();
    return entry.refreshing;
  }

  refreshAll(ids = this.#source.ids()) {
    return Promise.all(ids.map((id) => this.refresh(id, { force: this.#source.polled(id) })));
  }

  snapshot(id) {
    return this.#entry(id).snapshot;
  }

  /** Everything the tenant has proven during the POV (engines, scan types, origins, with when and an example). */
  proof(id) {
    return this.#entry(id).proof;
  }

  /** The Analytics numbers now, and at the start of the POV. */
  analytics(id) {
    const e = this.#entry(id);
    return e.snapshot?.analytics ? { now: e.snapshot.analytics, start: e.baseline ?? null } : null;
  }

  /** The proving scans of the whole POV: the record's examples and the latest read's scans. */
  provingSnapshot(id) {
    const e = this.#entry(id);
    if (!e.snapshot && !e.proof) return null;
    const seen = new Set((e.snapshot?.scans ?? []).map((s) => s.id));
    return { ...(e.snapshot ?? {}), scans: [...(e.snapshot?.scans ?? []), ...proofScans(e.proof).filter((s) => !seen.has(s.id))] };
  }

  /** What the dashboards show of one tenant. */
  live(id, now = Date.now()) {
    const entry = this.#entry(id);
    const summary = summarize(entry.snapshot, entry.previous, now);
    return {
      health: entry.refreshing && !summary ? 'loading' : healthOf(summary, entry.error, now),
      summary,
      error: entry.error,
      refreshing: Boolean(entry.refreshing),
      nextAt: entry.nextAt && this.#source.polled(id) ? new Date(entry.nextAt).toISOString() : null,
      trend: entry.history.slice(-48).map((h) => ({ at: h.at, ch: (h.critical ?? 0) + (h.high ?? 0), scans24h: h.scans24h, running: h.running })),
    };
  }

  history(id) {
    return this.#entry(id).history;
  }
}
