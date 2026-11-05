/**
 * Forecasts, from what is already known (no extra calls to Checkmarx One):
 *
 *   criteria  At the pace criteria have been completed since the POV started, when will the last one be done, and is
 *             that before the POV's end date? Also the pace still needed to finish in time.
 *   credits   At the tenant's recent burn, how many days do its credits last?
 *   activity  Is the tenant's scanning speeding up or slowing down (last 24 h against the 7-day average)?
 *
 * Every forecast says what it is based on; one with too little to go on says so instead of guessing.
 */
const DAY = 86_400_000;
const at = (d) => (d ? Date.parse(d.length === 10 ? `${d}T12:00:00Z` : d) : NaN);

export function criteriaForecast(opp, now = Date.now()) {
  const counted = (opp.criteria ?? []).filter((c) => c.status !== 'na');
  const total = counted.length;
  const done = counted.filter((c) => c.status === 'met');
  const remaining = total - done.length;
  const end = at(opp.endDate) + DAY / 2; // the end of the end day
  const daysLeft = Number.isFinite(end) ? (end - now) / DAY : null;
  if (!total) return { state: 'none', label: 'No success criteria yet' };
  if (!remaining) {
    const last = Math.max(...done.map((c) => at(c.confirmedAt)).filter(Number.isFinite));
    return { state: 'done', label: 'All criteria completed', completedAt: Number.isFinite(last) ? new Date(last).toISOString() : null };
  }
  const start = at(opp.startDate) || at(opp.createdAt) || now;
  const elapsed = Math.max(1, (now - start) / DAY);
  const pace = done.length / elapsed; // criteria a day
  const needed = daysLeft !== null && daysLeft > 0 ? remaining / daysLeft : null;
  const base = { total, done: done.length, remaining, pacePerWeek: round(pace * 7), neededPerWeek: needed === null ? null : round(needed * 7), daysLeft: daysLeft === null ? null : Math.ceil(daysLeft) };
  if (daysLeft !== null && daysLeft <= 0) return { ...base, state: 'late', label: `${remaining} still open after the end date` };
  if (!done.length) return { ...base, state: daysLeft !== null && daysLeft < 7 ? 'at-risk' : 'no-pace', label: daysLeft !== null ? `None completed yet · ${base.neededPerWeek}/week needed` : 'None completed yet' };
  const projected = now + (remaining / pace) * DAY;
  const margin = daysLeft === null ? null : Math.round((end - projected) / DAY);
  const state = margin === null ? 'on-track' : margin >= 0 ? 'on-track' : margin >= -3 ? 'at-risk' : 'late';
  return {
    ...base,
    state,
    projectedAt: new Date(projected).toISOString(),
    marginDays: margin,
    label: margin === null ? `At this pace, done ${short(projected)}` : margin >= 0 ? `On pace to finish ${short(projected)} · ${margin} d to spare` : `At this pace, ${short(projected)} · ${-margin} d late`,
  };
}

/** Credits runway: available ÷ daily burn (from the last 30 days' use, or the trend between reads). */
export function creditsForecast(summary, history = [], now = Date.now()) {
  const c = summary?.credits;
  if (!c || c.available === null || c.available === undefined) return null;
  let burn = c.used30d ? c.used30d / 30 : null;
  const samples = history.filter((h) => h.creditsUsed !== null && h.creditsUsed !== undefined && now - Date.parse(h.at) <= 7 * DAY);
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const days = (Date.parse(last.at) - Date.parse(first.at)) / DAY;
    if (days >= 0.5 && last.creditsUsed >= first.creditsUsed) burn = Math.max(burn ?? 0, (last.creditsUsed - first.creditsUsed) / days);
  }
  if (!burn) return { available: c.available, burnPerDay: 0, runwayDays: null, label: `${fmt(c.available)} credits · no recent use` };
  const runway = c.available / burn;
  return { available: c.available, burnPerDay: round(burn), runwayDays: Math.floor(runway), runOutAt: new Date(now + runway * DAY).toISOString(), label: `${fmt(c.available)} credits · ~${Math.floor(runway)} d at ${round(burn)}/day` };
}

/** Scanning momentum: the last 24 hours against the 7-day daily average. */
export function activityForecast(summary) {
  if (!summary) return null;
  const avg = summary.scans7d / 7;
  if (!summary.scans7d) return { trend: 'idle', label: 'No scans this week' };
  const ratio = avg ? summary.scans24h / avg : 0;
  return { trend: ratio >= 1.25 ? 'up' : ratio <= 0.6 ? 'down' : 'steady', perDay: round(avg), label: `${round(avg)} scans/day · ${ratio >= 1.25 ? 'accelerating' : ratio <= 0.6 ? 'slowing' : 'steady'}` };
}

/** Across every POV shown: how many are on track, at risk or late, and the shortest credits runway. */
export function portfolioForecast(rows, now = Date.now()) {
  const povs = rows.filter((r) => r.stage === 'pov');
  const by = (s) => povs.filter((r) => r.forecast?.criteria?.state === s).length;
  const runways = rows.map((r) => ({ r, d: r.forecast?.credits?.runwayDays })).filter((x) => Number.isFinite(x.d)).sort((a, b) => a.d - b.d);
  const ends = povs.map((r) => ({ r, t: at(r.endDate) })).filter((x) => Number.isFinite(x.t) && x.t >= now - DAY).sort((a, b) => a.t - b.t);
  const monthEnd = new Date(now);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  return {
    povs: povs.length,
    onTrack: by('on-track') + by('done'),
    atRisk: by('at-risk') + by('no-pace'),
    late: by('late'),
    finishingThisMonth: povs.filter((r) => {
      const t = at(r.forecast?.criteria?.projectedAt ?? r.forecast?.criteria?.completedAt ?? '');
      return Number.isFinite(t) && t <= monthEnd.getTime();
    }).length,
    shortestRunway: runways[0] ? { days: runways[0].d, customer: runways[0].r.customer, id: runways[0].r.id } : null,
    nextEnd: ends[0] ? { customer: ends[0].r.customer, id: ends[0].r.id, endDate: ends[0].r.endDate, days: Math.ceil((ends[0].t + DAY / 2 - now) / DAY) } : null,
  };
}

const round = (n) => Math.round(n * 10) / 10;
const fmt = (n) => Number(n).toLocaleString('en-US');
const short = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
