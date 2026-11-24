/**
 * What a POV's tenant has ever proven, kept for the whole POV: every engine, scan type and scan origin seen in a
 * completed scan, with when it was first and last seen and a scan that shows it. The dashboards read the last 7 days;
 * success criteria are judged on this record, so a SAST scan from three weeks ago still counts.
 *
 * The first read of a tenant takes its whole scan history; later reads only what is new since the last (with a day
 * of overlap), so the record stays complete even when the server was down for a while.
 */
const MAX_KEYS = 200;

const done = (s) => /completed|partial/i.test(String(s?.status ?? ''));
const atOf = (s) => s.updatedAt ?? s.createdAt ?? null;
const example = (s) => ({ id: s.id, project: s.projectName, branch: s.branch, at: atOf(s), startedAt: s.createdAt, initiator: s.initiator, origin: s.origin, engines: s.engines, scanType: s.scanType, status: s.status });

/** An empty record for a tenant. */
export const emptyProof = (tenant = '') => ({ tenant, syncedTo: null, scans: 0, engines: {}, scanTypes: {}, origins: {} });

/** Where the next read should start fetching scans from: everything the first time, since the last read after. */
export function historyFrom(proof) {
  if (!proof?.syncedTo) return '2000-01-01T00:00:00.000Z';
  return new Date(Date.parse(proof.syncedTo) - 86_400_000).toISOString();
}

/** Add a read's scans to the record. `complete` says the scans were read without error, so the record can move on. */
export function mergeProof(proof, scans, { tenant = '', at = new Date().toISOString(), complete = true } = {}) {
  const p = proof && proof.tenant === tenant ? structuredClone(proof) : emptyProof(tenant);
  p.seen ??= [];
  const seenIds = new Set(p.seen);
  const note = (bucket, key, s) => {
    if (!key) return;
    const k = String(key).toLowerCase().slice(0, 120);
    const cur = bucket[k];
    const when = atOf(s);
    if (!cur) {
      if (Object.keys(bucket).length >= MAX_KEYS) return;
      bucket[k] = { first: when, last: when, count: 1, firstScan: example(s), lastScan: example(s) };
      return;
    }
    if (!seenIds.has(s.id)) cur.count += 1;
    if (Date.parse(when) < Date.parse(cur.first)) Object.assign(cur, { first: when, firstScan: example(s) });
    if (Date.parse(when) > Date.parse(cur.last)) Object.assign(cur, { last: when, lastScan: example(s) });
  };
  for (const s of scans ?? []) {
    if (!s?.id || !done(s)) continue;
    for (const e of s.engines ?? []) note(p.engines, e, s);
    if (s.scanType && s.scanType !== 'none') note(p.scanTypes, s.scanType, s);
    for (const o of [s.origin, s.originRaw, s.userAgent]) note(p.origins, o, s);
    if (!seenIds.has(s.id)) {
      seenIds.add(s.id);
      p.scans += 1;
    }
  }
  // Remember recent scan ids only (the overlap between reads), not the whole history.
  p.seen = [...seenIds].slice(-2000);
  if (complete) p.syncedTo = at;
  return p;
}

/** The record's proving scans, as a list like a snapshot's scans (first and last of each thing seen). */
export function proofScans(proof) {
  const out = new Map();
  for (const bucket of [proof?.engines, proof?.scanTypes, proof?.origins]) for (const v of Object.values(bucket ?? {})) for (const s of [v.firstScan, v.lastScan]) if (s?.id && !out.has(s.id)) out.set(s.id, s);
  return [...out.values()].map((s) => ({ id: s.id, projectName: s.project, branch: s.branch, status: s.status || 'Completed', createdAt: s.startedAt, updatedAt: s.at, initiator: s.initiator, origin: s.origin, engines: s.engines ?? [], scanType: s.scanType }));
}
