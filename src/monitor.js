/**
 * Keeps every POV fresh: reads each tenant every REFRESH_MINUTES (10 by default), staggered so they do not all go at
 * once, and keeps the latest read, the one before (for what changed) and a short history for the trend line.
 * Snapshots are saved, so a restart shows the last known state straight away.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { collect, summarize, healthOf, eventsOf } from './collector.js';
import { publicPov } from './store.js';

const HISTORY = 288; // 48 hours at 10 minutes

export class Monitor extends EventEmitter {
  #store;
  #dir;
  #intervalMs;
  #collect;
  #state = new Map(); // povId -> { snapshot, previous, error, history, refreshing, timer, nextAt }

  constructor({ store, dataDir, intervalMinutes = 10, collectFn = collect }) {
    super();
    this.#store = store;
    this.#dir = path.join(dataDir, 'snapshots');
    this.#intervalMs = Math.max(1, Number(intervalMinutes) || 10) * 60_000;
    this.#collect = collectFn;
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
  }

  get intervalMs() {
    return this.#intervalMs;
  }

  #entry(id) {
    let entry = this.#state.get(id);
    if (!entry) {
      entry = { snapshot: null, previous: null, error: null, history: [], refreshing: null, timer: null, nextAt: null };
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(this.#dir, `${id}.json`), 'utf8'));
        Object.assign(entry, { snapshot: saved.snapshot ?? null, previous: saved.previous ?? null, error: saved.error ?? null, history: saved.history ?? [] });
      } catch {}
      this.#state.set(id, entry);
    }
    return entry;
  }

  #persist(id, entry) {
    const file = path.join(this.#dir, `${id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ snapshot: entry.snapshot, previous: entry.previous, error: entry.error, history: entry.history }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** Start polling every POV, the first reads spread over the first minute. */
  start() {
    const povs = this.#store.list();
    povs.forEach((pov, i) => this.schedule(pov.id, Math.round((i * 60_000) / Math.max(1, povs.length))));
  }

  stop() {
    for (const entry of this.#state.values()) clearTimeout(entry.timer);
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
    fs.rmSync(path.join(this.#dir, `${id}.json`), { force: true });
    this.emit('update', { povId: id, removed: true });
  }

  /** Read one POV now (a refresh already running is shared). Paused or closed POVs are read only when asked. */
  refresh(id, { force = false } = {}) {
    const entry = this.#entry(id);
    const pov = this.#store.get(id);
    if (!pov) return Promise.resolve(null);
    if (!force && pov.stage !== 'active') {
      this.schedule(id);
      return Promise.resolve(entry.snapshot);
    }
    entry.refreshing ??= (async () => {
      this.emit('update', { povId: id, refreshing: true });
      try {
        const snapshot = await this.#collect(this.#store.connection(id));
        entry.previous = entry.snapshot;
        entry.snapshot = snapshot;
        entry.error = null;
        const f = snapshot.findings;
        entry.history.push({ at: snapshot.at, critical: f?.critical ?? null, high: f?.high ?? null, total: f?.total ?? null, scans24h: summarize(snapshot)?.scans24h ?? 0, running: snapshot.active?.length ?? 0 });
        entry.history = entry.history.slice(-HISTORY);
      } catch (error) {
        entry.error = { at: new Date().toISOString(), message: String(error.message ?? error).slice(0, 400), status: error.status ?? 0 };
      } finally {
        entry.refreshing = null;
        try {
          this.#persist(id, entry);
        } catch {}
        this.schedule(id);
        this.emit('update', { povId: id });
      }
      return entry.snapshot;
    })();
    return entry.refreshing;
  }

  refreshAll() {
    return Promise.all(this.#store.list().map((p) => this.refresh(p.id, { force: p.stage === 'active' })));
  }

  /** One POV's card. */
  card(pov, now = Date.now()) {
    const entry = this.#entry(pov.id);
    const summary = summarize(entry.snapshot, entry.previous, now);
    const health = entry.refreshing && !summary ? 'loading' : healthOf(summary, entry.error, now);
    const daysLeft = pov.endDate ? Math.ceil((Date.parse(`${pov.endDate}T23:59:59Z`) - now) / 86_400_000) : null;
    return {
      ...publicPov(pov),
      health,
      summary,
      error: entry.error,
      refreshing: Boolean(entry.refreshing),
      nextAt: entry.nextAt ? new Date(entry.nextAt).toISOString() : null,
      daysLeft,
      trend: entry.history.slice(-48).map((h) => ({ at: h.at, ch: (h.critical ?? 0) + (h.high ?? 0), scans24h: h.scans24h, running: h.running })),
    };
  }

  /** The consolidated view: every POV's card, the totals line and one activity feed. */
  overview({ since = 0, limit = 200 } = {}, now = Date.now()) {
    const povs = this.#store.list();
    const cards = povs.map((p) => this.card(p, now));
    const sum = (f) => cards.reduce((n, c) => n + (f(c) ?? 0), 0);
    const totals = {
      povs: cards.length,
      active: cards.filter((c) => c.stage === 'active').length,
      endingSoon: cards.filter((c) => c.stage === 'active' && c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 7).length,
      needsAttention: cards.filter((c) => c.health === 'failed' || c.health === 'attention').length,
      projects: sum((c) => c.summary?.projects),
      scans24h: sum((c) => c.summary?.scans24h),
      running: sum((c) => (c.summary ? c.summary.running + c.summary.queued : 0)),
      failed24h: sum((c) => c.summary?.failed24h),
      critical: sum((c) => c.summary?.findings?.critical),
      high: sum((c) => c.summary?.findings?.high),
    };
    const events = povs
      .flatMap((p) => eventsOf(this.#entry(p.id).snapshot, { povId: p.id, since }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit);
    return { at: new Date(now).toISOString(), intervalMinutes: this.#intervalMs / 60_000, totals, povs: cards, events };
  }

  /** One POV in full: its card, projects with their findings, scans and its own feed. */
  detail(id, { since = 0 } = {}, now = Date.now()) {
    const pov = this.#store.get(id);
    if (!pov) return null;
    const entry = this.#entry(id);
    const snap = entry.snapshot;
    const byProject = snap?.findings?.byProject ?? {};
    const lastScan = new Map();
    for (const s of snap?.scans ?? []) if (!lastScan.has(s.projectId)) lastScan.set(s.projectId, s);
    const projects = (snap?.projects?.list ?? []).map((p) => ({ ...p, findings: byProject[p.id] ?? null, lastScan: lastScan.get(p.id) ?? null }));
    projects.sort((a, b) => (Date.parse(b.lastScan?.createdAt ?? b.findings?.scanAt ?? '') || 0) - (Date.parse(a.lastScan?.createdAt ?? a.findings?.scanAt ?? '') || 0));
    return {
      card: this.card(pov, now),
      identity: snap?.identity ?? null,
      projects,
      active: snap?.active ?? [],
      scans: snap?.scans ?? [],
      events: eventsOf(snap, { povId: id, since }),
      history: entry.history,
    };
  }
}
