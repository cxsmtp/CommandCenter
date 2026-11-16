/**
 * The value AI delivered in a POV, and what the backlog would still cost: the figures behind the credits cards.
 *
 *   hours saved   AI triage actions × minutes a person needs to triage one finding, plus
 *                 AI remediation actions × minutes a person needs to fix one (both set in Settings → Value,
 *                 and per POV when the customer's own numbers are known)
 *   value         hours saved × the developer hourly rate
 *   cost          credits used × the price of one credit
 *   return        value ÷ cost
 *   backlog       findings still to triage (1 credit each) and confirmed findings still to fix (3 each),
 *                 against the credits the tenant has left
 *   Fusion        scans with Fusion on, their credits (what is left of the credits once triage and remediation
 *                 are taken out) and the credits per Fusion scan
 *
 * Every figure carries the rates it used, so a reader can check it. Conservative by design: only actions
 * Checkmarx One counted (its consumption report, last 30 days) and actions run from CommandCenter.
 */
export const CREDIT_COST = { triage: 1, remediation: 3 };
export const VALUE_DEFAULTS = { triageMinutes: 20, fixMinutes: 120, hourlyRate: 75, creditPrice: 0, currency: 'USD' };

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (v) => Math.round(v * 10) / 10;
const money = (v) => Math.round(v * 100) / 100;

/** The rates in force for an opportunity: its own where set, else the organisation's, else the defaults. */
export function ratesFor(orgRates = {}, oppRates = {}) {
  const out = { ...VALUE_DEFAULTS };
  for (const src of [orgRates ?? {}, oppRates ?? {}]) {
    for (const k of ['triageMinutes', 'fixMinutes', 'hourlyRate', 'creditPrice']) if (src[k] !== undefined && src[k] !== null && src[k] !== '' && Number.isFinite(Number(src[k])) && Number(src[k]) >= 0) out[k] = Number(src[k]);
    if (/^[A-Z]{3}$/.test(String(src.currency ?? ''))) out.currency = src.currency;
  }
  return out;
}

export function cleanRates(b = {}) {
  const out = {};
  const lim = { triageMinutes: [0, 600], fixMinutes: [0, 6000], hourlyRate: [0, 100000], creditPrice: [0, 100000] };
  for (const [k, [lo, hi]] of Object.entries(lim)) {
    if (b[k] === '' || b[k] === null || b[k] === undefined) continue;
    const v = Number(b[k]);
    if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  const c = String(b.currency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) out.currency = c;
  return out;
}

/**
 * @param {object} o
 * @param {object} o.credits   the tenant's credits as read (collector: available, used, total, used30d, actions)
 * @param {object} o.summary   the tenant's summary (fusion7d, last7d, ...)
 * @param {object} o.backlog   { toVerify, confirmed } on the latest scans (SAST and SCA)
 * @param {Array}  o.ledger    actions run from CommandCenter: [{ action, findings, credits, outcome }]
 * @param {object} o.rates     ratesFor(...)
 */
export function valueOf({ credits = null, summary = null, backlog = null, ledger = [], rates = VALUE_DEFAULTS } = {}) {
  const a = credits?.actions ?? { triage: 0, remediation: 0, other: 0 };
  // CommandCenter's own runs are part of what Checkmarx One counts; shown apart, never added twice.
  const cc = ledger.filter((e) => e.outcome === 'charged').reduce((t, e) => ({ triage: t.triage + (e.action === 'triage' ? n(e.findings) : 0), remediation: t.remediation + (e.action === 'remediation' ? n(e.findings) : 0), credits: t.credits + n(e.credits) }), { triage: 0, remediation: 0, credits: 0 });
  const triaged = Math.max(n(a.triage), cc.triage);
  const fixed = Math.max(n(a.remediation), cc.remediation);
  const hoursTriage = (triaged * rates.triageMinutes) / 60;
  const hoursFix = (fixed * rates.fixMinutes) / 60;
  const hours = hoursTriage + hoursFix;
  const value = hours * rates.hourlyRate;
  const used = n(credits?.used30d);
  const cost = used * rates.creditPrice;
  const aiCredits = triaged * CREDIT_COST.triage + fixed * CREDIT_COST.remediation;
  const fusionCredits = credits ? Math.max(0, round1(used - n(a.triage) * CREDIT_COST.triage - n(a.remediation) * CREDIT_COST.remediation)) : null;
  const fusionScans = n(summary?.fusion7d);
  const toTriage = n(backlog?.toVerify);
  const toFix = n(backlog?.confirmed);
  const backlogCredits = toTriage * CREDIT_COST.triage + toFix * CREDIT_COST.remediation;
  const available = credits?.available ?? null;
  return {
    rates,
    actions: { triaged, fixed, fromCommandCenter: cc },
    hours: { triage: round1(hoursTriage), fix: round1(hoursFix), total: round1(hours) },
    value: money(value),
    cost: money(cost),
    net: money(value - cost),
    roi: cost > 0 ? round1(value / cost) : null,
    credits: credits ? { available, used: credits.used ?? null, total: credits.total ?? null, used30d: used, ai: aiCredits, fusion: fusionCredits } : null,
    fusion: { scans7d: fusionScans, last7d: n(summary?.last7d), credits30d: fusionCredits, perScan: fusionScans && fusionCredits ? round1(fusionCredits / Math.max(1, (fusionScans * 30) / 7)) : null },
    backlog: backlog ? { toTriage, toFix, credits: backlogCredits, covered: available === null ? null : available >= backlogCredits, shortBy: available === null ? null : Math.max(0, backlogCredits - available), hoursIfManual: round1((toTriage * rates.triageMinutes + toFix * rates.fixMinutes) / 60), valueIfAi: money(((toTriage * rates.triageMinutes + toFix * rates.fixMinutes) / 60) * rates.hourlyRate) } : null,
  };
}

/** Across POVs: added up, in the organisation's currency (a POV in another currency is counted in hours only). */
export function totalValue(list, currency) {
  const same = list.filter((v) => v && v.rates.currency === currency);
  const sum = (f) => Math.round(same.reduce((t, v) => t + (f(v) ?? 0), 0) * 100) / 100;
  const cost = sum((v) => v.cost);
  const value = sum((v) => v.value);
  return {
    currency,
    hours: Math.round(list.reduce((t, v) => t + (v?.hours.total ?? 0), 0) * 10) / 10,
    triaged: list.reduce((t, v) => t + (v?.actions.triaged ?? 0), 0),
    fixed: list.reduce((t, v) => t + (v?.actions.fixed ?? 0), 0),
    value,
    cost,
    roi: cost > 0 ? Math.round((value / cost) * 10) / 10 : null,
    backlogCredits: list.reduce((t, v) => t + (v?.backlog?.credits ?? 0), 0),
    otherCurrencies: list.length - same.length,
  };
}
