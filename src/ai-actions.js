/**
 * Mass AI actions on a POV tenant, from Kendra: Checkmarx One AI Triage (1 credit a finding) and AI
 * Remediation (3 credits a confirmed finding), the same calls CxMissionZero makes (src/routes/credits.js there):
 *
 *   POST /api/ai-triage/triage          { scanID, buckets: [{ scannerType, resultIDs }] }
 *   POST /api/remediation/remediate     { scanID, buckets: [{ scannerType, resultIDs }] }
 *
 * The findings are read live from each project's latest completed scan (GET /api/results, SAST and SCA: what the
 * AI engines support), with their result ids (alternateId).
 *
 * Credit control, in this order, for every run:
 *   1. a plan first: what would be sent, what it costs, what stops it — nothing is sent from a plan
 *   2. the POV's credit pool: set by a manager; a run never spends past what is left of it
 *   3. the tenant's own credits, read again just before sending: never asks for more than it has left
 *   4. never twice: a finding already triaged (or remediated) from here is not sent again, and one being sent
 *      right now (another person's run) is skipped
 *   5. stop at the first refusal for credits (402) or rights (403)
 * Every request and its outcome goes in the POV's ledger (who, when, what, credits, Checkmarx One's job id).
 */
import { randomUUID } from 'node:crypto';
import { CxClient, mapWithConcurrency } from './cxone/client.js';
import { fail, text } from './db.js';
import { CREDIT_COST } from './value.js';

const PAGE = 500;
const MAX_PAGES = 40;
const CACHE_MS = 10 * 60_000;
const MAX_RUN = 2000;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const AI_TYPES = new Set(['sast', 'sca']);
const ELIGIBLE = { triage: (r) => r.state === 'TO_VERIFY', remediation: (r) => r.state === 'CONFIRMED' };

export class AiActions {
  #db;
  #client;
  #cache = new Map(); // oppId → { at, findings, projects }
  #inFlight = new Map(); // `${oppId}|${action}` → Set(alternateId)
  #reserved = new Map(); // oppId → credits reserved by runs in progress

  /** @param {{ db, clientFor?: (connection) => CxClient }} o */
  constructor({ db, clientFor = (c) => new CxClient(c) }) {
    this.#db = db;
    this.#client = clientFor;
  }

  ledger(oppId) {
    return this.#db.read('ailedger', {})[oppId] ?? [];
  }

  #record(oppId, entry) {
    const all = this.#db.read('ailedger', {});
    const list = all[oppId] ?? [];
    list.push({ id: randomUUID(), at: new Date().toISOString(), ...entry });
    all[oppId] = list.slice(-2000);
    this.#db.write('ailedger', all);
  }

  forget(oppId) {
    const all = this.#db.read('ailedger', {});
    delete all[oppId];
    this.#db.write('ailedger', all);
    this.#cache.delete(oppId);
  }

  /** Credits charged from Kendra for this POV. */
  spent(oppId) {
    return this.ledger(oppId).filter((e) => e.outcome === 'charged').reduce((t, e) => t + (e.credits ?? 0), 0);
  }

  pool(opp) {
    const size = opp.creditPool?.size ?? null;
    const spent = this.spent(opp.id);
    const reserved = this.#reserved.get(opp.id) ?? 0;
    return { size, spent, reserved, left: size === null ? null : Math.max(0, size - spent - reserved), setBy: opp.creditPool?.by ?? '', setAt: opp.creditPool?.at ?? null };
  }

  /** Result ids already sent from here for an action (not sent again). */
  #sent(oppId, action) {
    const s = new Set();
    for (const e of this.ledger(oppId)) if (e.action === action && ['charged', 'not-charged'].includes(e.outcome)) for (const id of e.alternateIds ?? []) s.add(id);
    return s;
  }

  /**
   * The tenant's SAST and SCA findings on each project's latest completed scan, read live (kept 10 minutes).
   * `projects`: [{ id, name }] (from the tenant's last read).
   */
  async findings(opp, connection, projects, { force = false } = {}) {
    const hit = this.#cache.get(opp.id);
    if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit;
    const client = this.#client(connection);
    const ids = projects.map((p) => p.id);
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const last = {};
    for (let i = 0; i < ids.length; i += 50) {
      const answer = await client.request('/api/projects/last-scan', { query: { 'project-ids': ids.slice(i, i + 50), 'scan-status': 'Completed' } });
      for (const [pid, scan] of Object.entries(answer ?? {})) if (scan?.id && !['__proto__', 'constructor', 'prototype'].includes(pid)) last[pid] = String(scan.id);
    }
    const rows = [];
    const errors = [];
    await mapWithConcurrency(Object.entries(last), 4, async ([pid, scanId]) => {
      try {
        // GET /api/results numbers pages, not rows: page 0, 1, 2… until a short page.
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const body = await client.request('/api/results/', { query: { 'scan-id': scanId, 'include-nodes': false, offset: page, limit: PAGE }, retries: 1 });
          const list = Array.isArray(body?.results) ? body.results : [];
          for (const r of list) {
            const type = String(r?.type ?? '').toLowerCase();
            if (!AI_TYPES.has(type) || !r.alternateId) continue;
            rows.push({
              projectId: pid,
              projectName: names.get(pid) ?? pid,
              scanId,
              type,
              alternateId: String(r.alternateId),
              severity: String(r.severity ?? '').toUpperCase(),
              state: String(r.state ?? '').toUpperCase(),
              name: text(r.data?.queryName ?? r.data?.packageIdentifier ?? r.vulnerabilityDetails?.cweId ?? r.id, 160),
            });
          }
          if (list.length < PAGE) break;
        }
      } catch (error) {
        errors.push(`${names.get(pid) ?? pid}: ${error.message}`);
      }
    });
    const out = { at: Date.now(), readAt: new Date().toISOString(), findings: rows, projects: this.#byProject(rows, names), errors };
    this.#cache.set(opp.id, out);
    return out;
  }

  /** Per project and severity: to verify (triage) and confirmed (remediation). */
  #byProject(rows, names) {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.projectId)) map.set(r.projectId, { projectId: r.projectId, name: names.get(r.projectId) ?? r.projectId, toVerify: {}, confirmed: {}, total: 0 });
      const p = map.get(r.projectId);
      p.total += 1;
      if (r.state === 'TO_VERIFY') p.toVerify[r.severity] = (p.toVerify[r.severity] ?? 0) + 1;
      if (r.state === 'CONFIRMED') p.confirmed[r.severity] = (p.confirmed[r.severity] ?? 0) + 1;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** What a run would send and cost, and what stops it. Sends nothing. */
  plan(opp, loaded, { action, projectIds = [], severities = [], tenantAvailable = null }) {
    if (!ELIGIBLE[action]) throw fail(400, 'Choose triage or remediation.');
    const sev = severities.map((s) => String(s).toUpperCase()).filter((s) => SEVERITIES.includes(s));
    if (!sev.length) throw fail(400, 'Choose at least one severity.');
    const projects = new Set(projectIds.map(String));
    const sent = this.#sent(opp.id, action);
    const busy = this.#inFlight.get(`${opp.id}|${action}`) ?? new Set();
    const candidates = loaded.findings.filter((r) => (!projects.size || projects.has(r.projectId)) && sev.includes(r.severity) && ELIGIBLE[action](r));
    const already = candidates.filter((r) => sent.has(r.alternateId));
    const inFlight = candidates.filter((r) => !sent.has(r.alternateId) && busy.has(r.alternateId));
    const selected = candidates.filter((r) => !sent.has(r.alternateId) && !busy.has(r.alternateId)).slice(0, MAX_RUN);
    const unit = CREDIT_COST[action];
    const credits = selected.length * unit;
    const pool = this.pool(opp);
    const blockers = [];
    if (!selected.length) blockers.push(candidates.length ? 'Everything chosen was already sent from here, or is being sent now.' : action === 'triage' ? 'Nothing to triage: no finding of these severities is To verify.' : 'Nothing to remediate: no finding of these severities is Confirmed (triage first).');
    if (pool.size === null) blockers.push('No credit pool is set for this POV yet: a manager sets it on this page.');
    else if (credits > pool.left) blockers.push(`The POV’s credit pool has ${pool.left} left; this needs ${credits}.`);
    if (tenantAvailable !== null && credits > tenantAvailable) blockers.push(`The tenant has ${tenantAvailable} credits left; this needs ${credits}.`);
    const byProject = new Map();
    for (const r of selected) byProject.set(r.projectName, (byProject.get(r.projectName) ?? 0) + 1);
    return {
      action,
      severities: sev,
      findings: selected.length,
      credits,
      unit,
      alreadySent: already.length,
      inFlight: inFlight.length,
      capped: candidates.length - already.length - inFlight.length > MAX_RUN,
      projects: [...byProject].map(([name, count]) => ({ name, count })),
      pool,
      tenantAvailable,
      blockers,
      ok: !blockers.length,
      selected,
    };
  }

  /** Send a planned run. One request per scan and engine, up to 100 result ids each. */
  async run(opp, connection, plan, actor) {
    if (!plan.ok) throw fail(409, plan.blockers[0]);
    const client = this.#client(connection);
    const key = `${opp.id}|${plan.action}`;
    const busy = this.#inFlight.get(key) ?? new Set();
    this.#inFlight.set(key, busy);
    for (const r of plan.selected) busy.add(r.alternateId);
    this.#reserved.set(opp.id, (this.#reserved.get(opp.id) ?? 0) + plan.credits);
    const path = plan.action === 'triage' ? '/api/ai-triage/triage' : '/api/remediation/remediate';
    const out = { sent: 0, charged: 0, failed: 0, refused: 0, errors: [], jobs: [] };
    let stopped = '';
    try {
      const buckets = new Map();
      for (const r of plan.selected) {
        const k = `${r.scanId}|${r.type}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(r);
      }
      for (const group of buckets.values()) {
        for (let i = 0; i < group.length; i += 100) {
          const chunk = group.slice(i, i + 100);
          const { scanId, type, projectId, projectName } = chunk[0];
          const ids = [...new Set(chunk.map((r) => r.alternateId))];
          const credits = ids.length * plan.unit;
          const base = { action: plan.action, by: actor.id, byName: actor.name, projectId, projectName, scanId, type, findings: ids.length, alternateIds: ids, severities: [...new Set(chunk.map((r) => r.severity))] };
          if (stopped) {
            out.refused += ids.length;
            this.#record(opp.id, { ...base, credits: 0, outcome: 'refused', reason: `Not sent: ${stopped}` });
            continue;
          }
          const started = Date.now();
          try {
            const body = await client.request(path, { method: 'POST', body: { scanID: scanId, buckets: [{ scannerType: type, resultIDs: ids }] }, retries: 1 });
            const published = body?.published !== false;
            const jobId = text(body?.triageID ?? body?.remediationJobId ?? body?.id ?? '', 100);
            out.sent += ids.length;
            if (published) out.charged += credits;
            if (jobId) out.jobs.push(jobId);
            this.#record(opp.id, { ...base, credits: published ? credits : 0, outcome: published ? 'charged' : 'not-charged', jobId, ms: Date.now() - started, reason: published ? '' : 'Checkmarx One already had this job; no new credits.' });
          } catch (error) {
            out.failed += ids.length;
            const why = error.status === 402 ? 'Checkmarx One has no credits left for this.' : error.status === 403 ? 'The POV’s API key may not run this AI action (its role needs AI Triage / AI Remediation rights).' : error.message;
            out.errors.push(`${projectName}: ${why}`);
            this.#record(opp.id, { ...base, credits: 0, outcome: 'failed', reason: why, status: error.status ?? 0, ms: Date.now() - started });
            if (error.status === 402 || error.status === 403) stopped = why;
          }
        }
      }
    } finally {
      for (const r of plan.selected) busy.delete(r.alternateId);
      this.#reserved.set(opp.id, Math.max(0, (this.#reserved.get(opp.id) ?? 0) - plan.credits));
      // States change once AI has run: the next look reads them again.
      this.#cache.delete(opp.id);
    }
    out.errors = [...new Set(out.errors)];
    return out;
  }
}
