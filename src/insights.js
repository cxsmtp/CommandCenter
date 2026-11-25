/**
 * Insights for managers and executives: where each POV is heading, why, and what is missing — worked out from
 * what is already known (the opportunity, its criteria, its tenant's last read), so it is always current.
 *
 *   prediction   a 0–100 score and a word (likely success · at risk · unlikely · too early), with the drivers that
 *                moved it, each said in plain words; deliberately simple and explainable, never a black box
 *   gaps         what is missing or going wrong right now, most serious first, each with what fixes it
 *   roll-ups     by region, team and SE: POVs, predicted successes, at risk, gaps, expected wins
 */
import { progressOf } from './opportunities.js';

const DAY = 86_400_000;
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * @param {object} opp     the opportunity
 * @param {object} row     its row in the portfolio (live summary, forecast, alerts, value…)
 * @param {object} ctx     { facts: tenantFacts(snapshot) or null, people: peopleActivity(snapshot) or null, now }
 */
export function predict(opp, row, { now = Date.now() } = {}) {
  if (opp.stage === 'won') return { score: 100, label: 'Won', tone: 'ok', drivers: [] };
  if (opp.stage === 'lost') return { score: 0, label: 'Lost', tone: 'bad', drivers: [] };
  if (opp.povResult === 'successful') return { score: 92, label: 'POV successful', tone: 'ok', drivers: [{ effect: 1, text: 'The POV was marked successful' }] };
  if (['discovery', 'technical'].includes(opp.stage)) return { score: null, label: 'Too early', tone: '', drivers: [{ effect: 0, text: 'The POV has not started' }] };
  let score = 50;
  const drivers = [];
  const add = (effect, text) => {
    score += effect;
    drivers.push({ effect, text });
  };
  const p = progressOf(opp);
  const f = row.forecast?.criteria;
  const s = row.live?.summary;
  if (!p.total) add(-20, 'No success criteria agreed');
  else {
    if (f?.state === 'done') add(30, 'Every criterion completed');
    else if (f?.state === 'on-track') add(20, `On pace: ${f.label.toLowerCase()}`);
    else if (f?.state === 'at-risk') add(-10, f.label);
    else if (f?.state === 'no-pace') add(-12, f.label);
    else if (f?.state === 'late') add(-25, f.label);
    if (p.must) add(Math.round((p.mustMet / p.must) * 20) - 5, `${p.mustMet} of ${p.must} must-haves completed`);
    if (p.demonstrated && p.demonstrated / Math.max(1, p.met) > 0.5) add(-4, `${p.demonstrated} of ${p.met} completed only by demonstration`);
  }
  if (!opp.tenant) add(-20, 'No Checkmarx One tenant connected');
  else if (row.live?.health === 'failed') add(-15, 'The tenant cannot be read');
  else if (s) {
    const quietDays = s.lastActivityAt ? (now - Date.parse(s.lastActivityAt)) / DAY : Infinity;
    if (quietDays <= 2) add(8, 'Scanning in the last 2 days');
    else if (quietDays > 5) add(-12, quietDays === Infinity ? 'No scans yet' : `No scans for ${Math.floor(quietDays)} days`);
    if (s.failed24h) add(-4, `${s.failed24h} failed scan${s.failed24h > 1 ? 's' : ''} in the last day`);
    const u = s.users;
    if (u?.total) {
      const share = (u.active + u.quiet) / u.total;
      if (share >= 0.5) add(8, `${u.active + u.quiet} of ${u.total} customer users active this week`);
      else if (u.active + u.quiet === 0) add(-10, 'No customer user active this week');
    }
  }
  const customers = (opp.stakeholders ?? []).filter((x) => x.side === 'customer');
  if (!customers.length) add(-5, 'No customer stakeholder recorded');
  if ((opp.sessions ?? []).length >= 2) add(4, `${opp.sessions.length} sessions held`);
  if (row.daysLeft !== null && row.daysLeft <= 3 && p.total > p.met) add(-6, `${Math.max(0, row.daysLeft)} days left with ${p.total - p.met} criteria open`);
  score = clamp(score);
  const label = score >= 70 ? 'Likely success' : score >= 40 ? 'At risk' : 'Unlikely';
  drivers.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return { score, label, tone: score >= 70 ? 'ok' : score >= 40 ? 'warn' : 'bad', drivers: drivers.slice(0, 6) };
}

/** What is missing or going wrong now, most serious first. */
export function gaps(opp, row, { facts = null, people = null, catalog = null, now = Date.now() } = {}) {
  const out = [];
  const add = (level, key, text, fix) => out.push({ level, key, text, fix });
  const p = progressOf(opp);
  const live = !['won', 'lost'].includes(opp.stage);
  if (!live) return out;
  const pov = opp.stage === 'pov';
  if (pov && !opp.tenant) add('bad', 'tenant', 'The POV is running without a Checkmarx One tenant connected', 'Connect the tenant’s API key');
  if (pov && row.live?.health === 'failed') add('bad', 'read', `The tenant cannot be read: ${row.live.error?.message ?? ''}`.trim(), 'Replace the API key or check the network');
  if (['pov', 'completed'].includes(opp.stage) && !p.total) add('bad', 'criteria', 'No success criteria agreed', 'Add them from the capabilities');
  if (pov && !opp.endDate) add('warn', 'end', 'No POV end date', 'Set the end date');
  if (pov && row.daysLeft !== null && row.daysLeft < 0) add('bad', 'overdue', `The end date passed ${-row.daysLeft} day${row.daysLeft === -1 ? '' : 's'} ago and the POV is still running`, 'Complete the POV or move the end date');
  const open = (opp.criteria ?? []).filter((c) => c.status === 'not_started' && c.priority === 'must');
  if (pov && open.length && row.daysLeft !== null && row.daysLeft <= 7) add('bad', 'must-open', `${open.length} must-have${open.length > 1 ? 's' : ''} not started, ${Math.max(0, row.daysLeft)} days left: ${open.slice(0, 3).map((c) => c.title).join(', ')}${open.length > 3 ? '…' : ''}`, 'Plan a session for them, or record a demo');
  // Asked for in discovery, never made a criterion.
  const caps = new Set((opp.criteria ?? []).map((c) => c.capabilityId || c.capRef).filter(Boolean));
  const asked = (opp.discovery?.requested ?? []).filter((id) => !caps.has(id));
  if (asked.length && ['technical', 'pov'].includes(opp.stage)) add('warn', 'asked', `Asked for in discovery but not a success criterion: ${asked.slice(0, 4).map((id) => catalog?.get(id)?.name?.split(' (')[0].split(' — ')[0] ?? id).join(', ')}${asked.length > 4 ? '…' : ''}`, 'Make them success criteria, or agree they are out of scope');
  // The customer's tools, never seen in the tenant and not covered by a criterion.
  if (facts && pov) {
    const said = [...(opp.discovery?.ci ?? []), ...(opp.discovery?.scm ?? [])].filter((id) => !caps.has(id));
    const unseen = said.filter((id) => {
      const cap = catalog?.get(id);
      if (!cap) return false;
      const o = cap.detect?.origins ?? [];
      const h = cap.detect?.repoHosts ?? [];
      return !o.some((x) => facts.origins.some((y) => y.includes(x))) && !h.some((x) => facts.repoHosts.some((y) => y.includes(x)));
    });
    if (unseen.length) add('warn', 'tools', `Their ${unseen.map((id) => catalog.get(id).name.split(' (')[0]).slice(0, 3).join(', ')} not used in the tenant yet`, 'Run a scan from them, or agree they are out of scope');
  }
  // Selected engines that never ran.
  if (facts && pov && row.daysLeft !== null && row.daysLeft <= 10) {
    const engines = (opp.criteria ?? []).filter((c) => c.status !== 'met' && c.capabilityId && catalog?.get(c.capabilityId)?.detect?.engines?.length && !catalog.get(c.capabilityId).detect.engines.some((e) => facts.engines.has(e)));
    if (engines.length) add('warn', 'engines', `${engines.length} selected engine${engines.length > 1 ? 's have' : ' has'} not run in the tenant: ${engines.slice(0, 3).map((c) => c.title).join(', ')}`, 'Run a scan with them, or record a demo');
  }
  const s = row.live?.summary;
  if (pov && s && (!s.lastActivityAt || now - Date.parse(s.lastActivityAt) > 3 * DAY)) add('warn', 'quiet', s.lastActivityAt ? `No scans for ${Math.floor((now - Date.parse(s.lastActivityAt)) / DAY)} days` : 'No scans in the tenant yet', 'Check in with the customer');
  if (pov && people?.iamRead) {
    const never = people.users.filter((u) => u.inIam && u.status === 'never').length;
    if (people.total && !(people.active + people.quiet)) add('warn', 'people', 'No customer user active in the tenant this week', 'Check in with the champion');
    else if (never >= 3) add('warn', 'people', `${never} customer users have never signed in`, 'Send them the sign-in steps');
  }
  if (opp.tenant?.keyExpiresAt) {
    const left = Math.ceil((Date.parse(opp.tenant.keyExpiresAt) - now) / DAY);
    if (left < 0) add('bad', 'key', 'The API key has expired', 'Replace the key');
    else if (left <= 14 && pov) add('warn', 'key', `The API key expires in ${left} day${left === 1 ? '' : 's'}`, 'Replace the key before then');
  }
  if (!(opp.stakeholders ?? []).some((x) => x.side === 'customer' && x.email)) add('warn', 'stakeholders', 'No customer stakeholder with an email', 'Add the champion and decision makers');
  const sf = opp.salesforce;
  if (!opp.salesforceUrl && !sf) add('info', 'salesforce', 'No Salesforce link', 'Add the opportunity’s link');
  if (sf) {
    // Salesforce (from the latest report) and the POV should tell the same story.
    if (/lost/i.test(sf.stage ?? '')) add('bad', 'sf-lost', `Salesforce says “${sf.stage}” while the POV is still open`, 'Check with the account executive, then close or reopen');
    else if (/closed\s*won|\bwon\b/i.test(sf.stage ?? '') && opp.stage !== 'won') add('info', 'sf-won', `Salesforce says “${sf.stage}”`, 'Mark the opportunity won');
    if (sf.closeDate && !/closed/i.test(sf.stage ?? '')) {
      if (Date.parse(`${sf.closeDate}T23:59:59Z`) < now) add('warn', 'sf-past', `The Salesforce close date (${sf.closeDate}) has passed`, 'Ask the account executive to update it');
      else if (pov && opp.endDate && sf.closeDate < opp.endDate) add('warn', 'sf-close', `Salesforce closes on ${sf.closeDate}, before the POV ends on ${opp.endDate}`, 'Align the close date and the POV plan');
    }
    if (sf.reportAt && now - Date.parse(sf.reportAt) > 14 * DAY) add('info', 'sf-stale', `The Salesforce figures are ${Math.floor((now - Date.parse(sf.reportAt)) / DAY)} days old`, 'Bring in a newer report');
  }
  if (!opp.sharepointUrl && ['pov', 'completed'].includes(opp.stage)) add('info', 'sharepoint', 'No SharePoint site linked', 'Add the site’s link');
  const overdue = (opp.tasks ?? []).filter((t) => !t.done && t.due && Date.parse(`${t.due}T23:59:59Z`) < now);
  if (overdue.length) add('warn', 'tasks', `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}: ${overdue.slice(0, 2).map((t) => t.title).join(', ')}`, 'Close or re-date them');
  if (opp.stage === 'completed' && !opp.povResult) add('warn', 'result', 'The POV is complete but not marked successful or not', 'Record the result');
  if (row.creditPool && row.value?.backlog?.toTriage && row.creditPool.size === null && pov) add('info', 'pool', `${row.value.backlog.toTriage} findings could be triaged by AI, but no credit pool is set`, 'A manager sets the POV’s credit pool');
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * Roll-ups for the Insights page, from the rows the viewer can see (each row carrying prediction and gaps).
 * `teamOf(ownerId)` names the team (the SE's team lead), `regionOf(ownerId)` the person's sales region.
 */
export function rollups(rows, { teamOf, regionOf, now = Date.now() } = {}) {
  const live = rows.filter((r) => !['won', 'lost'].includes(r.stage));
  const povs = live.filter((r) => r.stage === 'pov' || r.stage === 'completed');
  const group = (keyOf) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r) || '—';
      if (!m.has(k)) m.set(k, { name: k, povs: 0, running: 0, likely: 0, atRisk: 0, unlikely: 0, won: 0, lost: 0, gaps: 0, critical: 0, expected: 0, scored: 0, scoreSum: 0, pipeline: 0 });
      const g = m.get(k);
      g.povs += 1;
      if (r.stage === 'won') g.won += 1;
      if (r.stage === 'lost') g.lost += 1;
      if (r.stage === 'pov') g.running += 1;
      const pr = r.prediction;
      if (pr?.score !== null && pr?.score !== undefined && !['won', 'lost'].includes(r.stage)) {
        g.scored += 1;
        g.scoreSum += pr.score;
        g.expected += pr.score / 100;
        if (pr.score >= 70) g.likely += 1;
        else if (pr.score >= 40) g.atRisk += 1;
        else g.unlikely += 1;
      }
      if (r.sf?.amount?.value && !['won', 'lost'].includes(r.stage)) g.pipeline += r.sf.amount.value;
      g.gaps += (r.gaps ?? []).filter((x) => x.level !== 'info').length;
      g.critical += (r.gaps ?? []).filter((x) => x.level === 'bad').length;
    }
    return [...m.values()].map((g) => ({ ...g, expected: Math.round(g.expected * 10) / 10, avgScore: g.scored ? Math.round(g.scoreSum / g.scored) : null })).sort((a, b) => b.povs - a.povs);
  };
  const ending30 = povs.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30);
  const scored = povs.filter((r) => r.prediction?.score !== null && r.prediction?.score !== undefined);
  // Revenue from the Salesforce reports: open pipeline in the main currency, and weighted by each POV's outlook.
  const curCount = new Map();
  for (const r of live) if (r.sf?.amount?.value) curCount.set(r.sf.amount.currency || '', (curCount.get(r.sf.amount.currency || '') ?? 0) + 1);
  const currency = [...curCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const inCur = live.filter((r) => r.sf?.amount?.value && (r.sf.amount.currency || '') === currency);
  const revenue = {
    currency: currency || 'USD',
    pipeline: Math.round(inCur.reduce((t, r) => t + r.sf.amount.value, 0)),
    weighted: Math.round(inCur.reduce((t, r) => t + r.sf.amount.value * ((r.prediction?.score ?? r.sf.probability ?? 0) / 100), 0)),
    povs: inCur.length,
    otherCurrencies: live.filter((r) => r.sf?.amount?.value).length - inCur.length,
    closing30: Math.round(inCur.filter((r) => r.sf.closeDate && Date.parse(`${r.sf.closeDate}T23:59:59Z`) - now <= 30 * DAY && Date.parse(`${r.sf.closeDate}T23:59:59Z`) >= now).reduce((t, r) => t + r.sf.amount.value, 0)),
    linked: rows.filter((r) => r.sf).length,
    // The figures come only from Salesforce reports someone imported (Kendra does not read Salesforce): their latest date.
    reportAt: rows.map((r) => r.sf?.reportAt).filter(Boolean).sort().pop() ?? null,
  };
  const gapCounts = new Map();
  for (const r of live) for (const g of r.gaps ?? []) if (g.level !== 'info') gapCounts.set(g.key, { key: g.key, text: g.text.split(':')[0], count: (gapCounts.get(g.key)?.count ?? 0) + 1, level: g.level });
  return {
    totals: {
      open: live.length,
      running: live.filter((r) => r.stage === 'pov').length,
      likely: scored.filter((r) => r.prediction.score >= 70).length,
      atRisk: scored.filter((r) => r.prediction.score >= 40 && r.prediction.score < 70).length,
      unlikely: scored.filter((r) => r.prediction.score < 40).length,
      expectedWins: Math.round(scored.reduce((t, r) => t + r.prediction.score / 100, 0) * 10) / 10,
      ending30: ending30.length,
      ending30Expected: Math.round(ending30.reduce((t, r) => t + (r.prediction?.score ?? 0) / 100, 0) * 10) / 10,
      won: rows.filter((r) => r.stage === 'won').length,
      lost: rows.filter((r) => r.stage === 'lost').length,
      critical: live.reduce((t, r) => t + (r.gaps ?? []).filter((g) => g.level === 'bad').length, 0),
    },
    revenue,
    byRegion: group((r) => regionOf(r.owner.id) || r.tenant?.regionLabel || ''),
    byTenantRegion: group((r) => r.tenant?.regionLabel ?? 'No tenant'),
    byTeam: group((r) => teamOf(r.owner.id)),
    bySe: group((r) => r.owner.name),
    commonGaps: [...gapCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    atRisk: scored.filter((r) => r.prediction.score < 70).sort((a, b) => a.prediction.score - b.prediction.score).slice(0, 15).map((r) => ({ id: r.id, customer: r.customer, owner: r.owner.name, score: r.prediction.score, label: r.prediction.label, daysLeft: r.daysLeft, why: r.prediction.drivers.filter((d) => d.effect < 0).slice(0, 2).map((d) => d.text) })),
  };
}

// ——— The deeper read, after the best revenue and presales tools (Clari, Gong, Salesforce, Vivun) ———

/** One day's reading of every POV, kept to show what moved: { id: { s: score, c: critical gaps, a: amount } }. */
export function dayReading(rows) {
  const out = {};
  for (const r of rows) {
    if (['won', 'lost'].includes(r.stage)) continue;
    const s = r.prediction?.score;
    if (s === null || s === undefined) continue;
    out[r.id] = { s, c: (r.gaps ?? []).filter((g) => g.level === 'bad').length, a: r.sf?.amount?.value ?? 0 };
  }
  return out;
}

/**
 * @param {object[]} rows      the viewer's rows (with prediction and gaps)
 * @param {object} o
 * @param {(id) => object} o.oppOf      the opportunity behind a row (criteria, result)
 * @param {object} o.catalog
 * @param {object} o.history   { 'YYYY-MM-DD': dayReading } kept by the server
 */
export function insightsMore(rows, { oppOf, catalog, history = {}, now = Date.now() } = {}) {
  const live = rows.filter((r) => !['won', 'lost'].includes(r.stage));
  const scored = live.filter((r) => r.prediction?.score !== null && r.prediction?.score !== undefined && ['pov', 'completed'].includes(r.stage));
  const amount = (r) => r.sf?.amount?.value ?? 0;
  // Where the POVs are heading, by Kendra's own score of each: likely to succeed (70+), at risk (40-69), unlikely.
  const cat = (test) => {
    const list = scored.filter((r) => test(r.prediction.score));
    return { count: list.length, amount: Math.round(list.reduce((t, r) => t + amount(r), 0)) };
  };
  const categories = { commit: cat((s) => s >= 70), best: cat((s) => s >= 40 && s < 70), pipeline: cat((s) => s < 40) };

  // Outcomes: the technical win rate (POVs successful), the win rate after one, and how long a POV takes.
  const decided = rows.filter((r) => ['successful', 'unsuccessful'].includes(r.povResult));
  const successful = decided.filter((r) => r.povResult === 'successful');
  const closedAfter = successful.filter((r) => ['won', 'lost'].includes(r.stage));
  const lengths = rows.filter((r) => ['completed', 'won', 'lost'].includes(r.stage) && r.startDate && r.endDate).map((r) => (Date.parse(r.endDate) - Date.parse(r.startDate)) / DAY).filter((d) => d > 0 && d < 365);
  const outcomes = {
    decided: decided.length,
    techWinRate: decided.length ? Math.round((100 * successful.length) / decided.length) : null,
    winAfterSuccess: closedAfter.length ? Math.round((100 * closedAfter.filter((r) => r.stage === 'won').length) / closedAfter.length) : null,
    avgDays: lengths.length ? Math.round(lengths.reduce((t, d) => t + d, 0) / lengths.length) : null,
    won: rows.filter((r) => r.stage === 'won').length,
    lost: rows.filter((r) => r.stage === 'lost').length,
  };

  // SE workload: what each SE carries now, and who is stretched.
  const se = new Map();
  for (const r of live) {
    const k = r.owner.id;
    if (!se.has(k)) se.set(k, { id: k, name: r.owner.name, running: 0, endingSoon: 0, openMust: 0, scoreSum: 0, scored: 0, critical: 0, open: 0 });
    const g = se.get(k);
    g.open += 1;
    if (r.stage === 'pov') g.running += 1;
    if (r.stage === 'pov' && r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 14) g.endingSoon += 1;
    g.openMust += Math.max(0, (r.progress?.must ?? 0) - (r.progress?.mustMet ?? 0));
    g.critical += (r.gaps ?? []).filter((x) => x.level === 'bad').length;
    if (r.prediction?.score !== null && r.prediction?.score !== undefined && r.stage === 'pov') {
      g.scoreSum += r.prediction.score;
      g.scored += 1;
    }
  }
  const workload = [...se.values()]
    .map((g) => ({ ...g, avgScore: g.scored ? Math.round(g.scoreSum / g.scored) : null, load: g.running >= 4 || g.endingSoon >= 3 ? 'stretched' : g.running >= 2 ? 'busy' : 'room' }))
    .sort((a, b) => b.running - a.running || b.endingSoon - a.endingSoon || a.name.localeCompare(b.name));

  // Capabilities: how often each is proven where it is tested; the ones that stall POVs first.
  const caps = new Map();
  for (const r of rows.filter((x) => ['pov', 'completed', 'won', 'lost'].includes(x.stage))) {
    for (const c of oppOf(r.id)?.criteria ?? []) {
      const id = c.capabilityId || c.capRef;
      if (!id || c.status === 'na') continue;
      if (!caps.has(id)) caps.set(id, { id, name: (catalog?.get(id)?.name ?? id).replace(/\s*\(.*\)$/, ''), povs: new Set(), tested: 0, met: 0, missed: 0 });
      const g = caps.get(id);
      g.povs.add(r.id);
      g.tested += 1;
      if (c.status === 'met') g.met += 1;
      if (c.status === 'not_met') g.missed += 1;
    }
  }
  const capabilities = [...caps.values()]
    .map((g) => ({ id: g.id, name: g.name, povs: g.povs.size, tested: g.tested, met: g.met, missed: g.missed, rate: g.tested ? Math.round((100 * g.met) / g.tested) : 0 }))
    .sort((a, b) => b.povs - a.povs || a.rate - b.rate)
    .slice(0, 14);

  // Ending in the next 30 days, soonest first, with where each is heading.
  const ending = live
    .filter((r) => r.stage === 'pov' && r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((r) => ({ id: r.id, customer: r.customer, owner: r.owner.name, daysLeft: r.daysLeft, endDate: r.endDate, score: r.prediction?.score ?? null, amount: amount(r), met: r.progress?.met ?? 0, total: r.progress?.total ?? 0 }));

  // What moved: the totals now against a week ago, the last 30 days, and the POVs that moved most.
  const ids = new Set(live.map((r) => r.id));
  const days = Object.keys(history).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const totalsOf = (reading) => {
    const vals = Object.entries(reading ?? {}).filter(([id]) => ids.has(id)).map(([, v]) => v);
    return { likely: vals.filter((v) => v.s >= 70).length, atRisk: vals.filter((v) => v.s >= 40 && v.s < 70).length, expected: Math.round(vals.reduce((t, v) => t + v.s / 100, 0) * 10) / 10, critical: vals.reduce((t, v) => t + v.c, 0), weighted: Math.round(vals.reduce((t, v) => t + (v.a * v.s) / 100, 0)) };
  };
  const today = new Date(now).toISOString().slice(0, 10);
  const weekAgoDay = [...days].reverse().find((d) => d <= new Date(now - 7 * DAY).toISOString().slice(0, 10)) ?? (days[0] !== today ? days[0] : null);
  const series = days.slice(-30).map((d) => ({ day: d, ...totalsOf(history[d]) }));
  const before = weekAgoDay ? totalsOf(history[weekAgoDay]) : null;
  const movers = [];
  if (weekAgoDay) {
    for (const r of scored) {
      const was = history[weekAgoDay]?.[r.id]?.s;
      if (was === undefined) continue;
      const d = r.prediction.score - was;
      if (Math.abs(d) >= 5) movers.push({ id: r.id, customer: r.customer, owner: r.owner.name, from: was, to: r.prediction.score, delta: d, why: (r.prediction.drivers ?? []).find((x) => Math.sign(x.effect) === Math.sign(d))?.text ?? '' });
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
  return { categories, outcomes, workload, capabilities, ending, trend: { since: weekAgoDay, before, series }, movers: movers.slice(0, 12) };
}
