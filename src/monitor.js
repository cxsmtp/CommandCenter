/**
 * Keeps every POV tenant fresh: reads each one every REFRESH_MINUTES (10 by default), staggered so they do not all
 * go at once, and keeps the latest read, the one before (for what changed) and a short history for trend lines.
 * Snapshots are saved, so a restart shows the last known state straight away. Only opportunities whose POV is
 * running are read on the clock; any other is read when someone asks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { collect, summarize, healthOf } from './collector.js';

const HISTORY = 288; // 48 hours at 10 minutes
const SAFE_ID = /^[0-9a-f-]{36}$/;

export class Monitor extends EventEmitter {
  #source;
  #dir;
  #intervalMs;
  #collect;
  #state = new Map();

  /**
   * @param {object} o
   * @param {{ ids(): string[], polled(id): boolean, connection(id): object }} o.source
   */
  constructor({ source, dataDir, intervalMinutes = 10, collectFn = collect }) {
    super();
    this.#source = source;
    this.#dir = path.join(dataDir, 'snapshots');
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
      entry = { snapshot: null, previous: null, error: null, history: [], refreshing: null, timer: null, nextAt: null };
      if (SAFE_ID.test(id)) {
        try {
          Object.assign(entry, JSON.parse(fs.readFileSync(path.join(this.#dir, `${id}.json`), 'utf8')), { refreshing: null, timer: null, nextAt: null });
        } catch {}
      }
      this.#state.set(id, entry);
    }
    return entry;
  }

  #persist(id, entry) {
    if (!SAFE_ID.test(id)) return;
    const file = path.join(this.#dir, `${id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ snapshot: entry.snapshot, previous: entry.previous, error: entry.error, history: entry.history }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  start() {
    const ids = this.#source.ids();
    ids.forEach((id, i) => this.schedule(id, Math.round((i * 60_000) / Math.max(1, ids.length))));
  }

  stop() {
    for (const entry of this.#state.values()) clearTimeout(entry.timer);
  }

  /** Re-time every POV after the interval changed. */
  reschedule() {
    for (const id of this.#source.ids()) this.schedule(id);
  }

  schedule(id, delayMs = this.#intervalMs) {
    const entry = this.#entry(id);
    clearTimeout(entry.timer);
    entry.nextAt = Date.now() + delayMs;
    entry.timer = setTimeout(() => this.refresh(id).catch(() => {}), delayMs);
    entry.timer.unref?.();
  }

  forget(id) {
    const entry = this.#state.get(id);
    if (entry) clearTimeout(entry.timer);
    this.#state.delete(id);
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
      try {
        const snapshot = await this.#collect(this.#source.connection(id));
        entry.previous = entry.snapshot;
        entry.snapshot = snapshot;
        entry.error = null;
        const f = snapshot.findings;
        entry.history.push({ at: snapshot.at, critical: f?.critical ?? null, high: f?.high ?? null, total: f?.total ?? null, scans24h: summarize(snapshot)?.scans24h ?? 0, running: snapshot.active?.length ?? 0, creditsUsed: snapshot.credits?.used ?? null });
        entry.history = entry.history.slice(-HISTORY);
      } catch (error) {
        entry.error = { at: new Date().toISOString(), message: String(error.message ?? error).slice(0, 400), status: error.status ?? 0 };
      } finally {
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
