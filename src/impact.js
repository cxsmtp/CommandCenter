/**
 * What the POV changed, from the Analytics dashboard: six tiles (scans, projects, lines of code, critical fix
 * time, share of findings triaged, findings fixed), each with the start of the POV where it moved. The results
 * deck, the results page and the Analytics criterion all say it the same way.
 */
const big = (n) => (n == null ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString('en-GB'));
const share = (st) => (st?.total ? Math.round((100 * (st.total - (st.toVerify ?? 0))) / st.total) : null);
const days = (n) => (n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`);

export function impactTiles(a) {
  const now = a?.now;
  if (!now) return [];
  const start = a.start ?? null;
  const window = now.range === '90d' ? 'last 90 days' : 'last 30 days';
  const tri = share(now.states);
  const triStart = start ? share(start.states) : null;
  const crit = now.mttrDays?.critical ?? null;
  const critStart = start?.mttrDays?.critical ?? null;
  return [
    { label: 'Scans run', value: big(now.scans), sub: window },
    { label: 'Projects scanned', value: big(now.projects), sub: window },
    { label: 'Lines of code scanned', value: big(now.loc), sub: window },
    { label: 'Critical fix time', value: days(crit), sub: critStart != null && crit != null && critStart !== crit ? `from ${days(critStart)} at the start` : 'mean time to resolve' },
    { label: 'Findings triaged', value: tri == null ? '—' : `${tri}%`, sub: triStart != null && tri != null && triStart !== tri ? `from ${triStart}% at the start` : 'moved out of To verify' },
    { label: 'Findings fixed', value: big(now.resolved), sub: window },
  ];
}

/** One line for the Analytics criterion's evidence. */
export function impactLine(now) {
  if (!now) return '';
  const parts = [];
  if (now.mttrDays?.critical != null) parts.push(`critical fix time ${days(now.mttrDays.critical)}`);
  const tri = share(now.states);
  if (tri != null) parts.push(`${tri}% of findings triaged`);
  if (now.scans) parts.push(`${big(now.scans)} scans`);
  return parts.length ? `Analytics shows ${parts.join(', ')} (${now.range === '90d' ? 'last 90 days' : 'last 30 days'})` : '';
}
