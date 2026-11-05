/**
 * The final POV presentation (.pptx), made from the opportunity and its tenant, in the house look: an espresso
 * cover with a brass rule, ivory pages, the answer first. Shared with the customer once the POV is marked
 * successful (attached to the completion email, or downloaded for SharePoint). The layout is a starting point until
 * the team's own presentation formats are supplied.
 */
import PptxGenJS from 'pptxgenjs';
import { CRITERION_STATUS, SESSION_TYPES, progressOf } from './opportunities.js';

const INK = '2A1C13';
const PAPER = 'FBF7F0';
const BRASS = 'B08D57';
const MUTED = '7D6754';
const LINE = 'DCCAB2';
const STATUS_COLOR = { met: '4F6B3A', not_met: '8C2A1E', in_progress: 'A8742A', not_started: '8A8F96', na: '8A8F96' };
const HEAD = 'Georgia';
const BODY = 'Calibri';
const day = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export async function finalDeck(opp, { owner, live, people, evidence = {}, categories = [], org = 'Command Center' }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  pptx.title = `${opp.customer} — POV results`;
  pptx.company = org;
  const p = progressOf(opp);
  const s = live?.summary;
  const catLabel = Object.fromEntries(categories);

  const page = (title, kicker) => {
    const slide = pptx.addSlide();
    slide.background = { color: PAPER };
    slide.addText(String(kicker ?? '').toUpperCase(), { x: 0.6, y: 0.35, w: 12, h: 0.3, fontFace: BODY, fontSize: 10, color: BRASS, charSpacing: 4 });
    slide.addText(title, { x: 0.6, y: 0.62, w: 12, h: 0.7, fontFace: HEAD, fontSize: 30, color: INK });
    slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 1.35, w: 1.2, h: 0, line: { color: BRASS, width: 1 } });
    slide.addText(`${opp.customer} · ${org}`, { x: 0.6, y: 7.0, w: 8, h: 0.3, fontFace: BODY, fontSize: 9, color: MUTED });
    return slide;
  };

  // 1 — Cover
  const cover = pptx.addSlide();
  cover.background = { color: INK };
  cover.addShape(pptx.ShapeType.rect, { x: 0.35, y: 0.35, w: 12.63, h: 6.8, fill: { type: 'none' }, line: { color: BRASS, width: 0.75, dashType: 'dash' } });
  cover.addText('PROOF OF VALUE', { x: 1, y: 2.0, w: 11.3, h: 0.4, fontFace: BODY, fontSize: 12, color: BRASS, charSpacing: 8, align: 'center' });
  cover.addText(opp.customer, { x: 1, y: 2.5, w: 11.3, h: 1.2, fontFace: HEAD, fontSize: 48, color: 'F1E6D2', align: 'center' });
  cover.addShape(pptx.ShapeType.line, { x: 6.07, y: 3.85, w: 1.2, h: 0, line: { color: BRASS, width: 1 } });
  cover.addText('Checkmarx One · Results', { x: 1, y: 4.05, w: 11.3, h: 0.5, fontFace: HEAD, fontSize: 20, color: 'D8C19A', align: 'center', italic: true });
  cover.addText(`${day(opp.startDate)} – ${day(opp.endDate)}${owner?.name ? `  ·  ${owner.name}${owner.title ? `, ${owner.title}` : ''}` : ''}`, { x: 1, y: 5.4, w: 11.3, h: 0.4, fontFace: BODY, fontSize: 12, color: 'A99178', align: 'center' });

  // 2 — The answer
  const answer = page(p.percent === 100 ? 'Every success criterion was met' : `${p.met} of ${p.total} success criteria met`, 'The answer');
  const figures = [
    [`${p.percent}%`, 'criteria met'],
    [`${p.mustMet}/${p.must}`, 'must-haves met'],
    [s ? String(s.scans7d) : '—', 'scans in the last 7 days'],
    [s?.users?.total != null ? `${s.users.active + s.users.quiet}/${s.users.total}` : s?.people?.length ? String(s.people.length) : '—', 'people active'],
  ];
  figures.forEach(([v, l], i) => {
    const x = 0.6 + i * 3.1;
    answer.addShape(pptx.ShapeType.rect, { x, y: 1.8, w: 2.9, h: 1.7, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 0.75 } });
    answer.addText(v, { x, y: 1.95, w: 2.9, h: 0.9, fontFace: HEAD, fontSize: 40, color: INK, align: 'center' });
    answer.addText(l.toUpperCase(), { x, y: 2.9, w: 2.9, h: 0.4, fontFace: BODY, fontSize: 10, color: MUTED, align: 'center', charSpacing: 2 });
  });
  if (opp.summary) answer.addText(opp.summary, { x: 0.6, y: 3.9, w: 12.1, h: 2.8, fontFace: BODY, fontSize: 15, color: INK, valign: 'top', paraSpaceAfter: 6 });

  // 3… — Success criteria, by group, twelve to a page
  const rows = [...(opp.criteria ?? [])].sort((a, b) => String(catLabel[a.category] ?? 'zz').localeCompare(String(catLabel[b.category] ?? 'zz')));
  for (let i = 0; i < rows.length; i += 11) {
    const slide = page('Success criteria', `Success criteria ${rows.length > 11 ? `${Math.floor(i / 11) + 1} of ${Math.ceil(rows.length / 11)}` : ''}`);
    const head = ['Group', 'Criterion', 'Status', 'Evidence'].map((t) => ({ text: t.toUpperCase(), options: { bold: false, color: MUTED, fontSize: 9, charSpacing: 2, fill: { color: PAPER } } }));
    const body = rows.slice(i, i + 11).map((c) => [
      { text: catLabel[c.category] ?? 'Custom', options: { color: MUTED, fontSize: 10 } },
      { text: `${c.title}${c.priority === 'nice' ? ' (nice to have)' : ''}`, options: { color: INK, fontSize: 11 } },
      { text: CRITERION_STATUS[c.status], options: { color: STATUS_COLOR[c.status], bold: true, fontSize: 11 } },
      { text: [c.notes, ...(evidence[c.id]?.level === 'detected' ? evidence[c.id].evidence : [])].filter(Boolean).join(' · ').slice(0, 220), options: { color: MUTED, fontSize: 9 } },
    ]);
    slide.addTable([head, ...body], { x: 0.6, y: 1.65, w: 12.1, colW: [2.2, 4.3, 1.5, 4.1], fontFace: BODY, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: 0.42, valign: 'middle' });
  }

  // What Checkmarx One showed
  if (s) {
    const shown = page('What Checkmarx One showed', 'In the POV tenant');
    const lines = [
      ['Projects', s.projects ?? '—'],
      ['Scans (last 7 days)', `${s.scans7d}${s.fusion7d ? ` · ${s.fusion7d} Fusion` : ''}${s.last7d ? ` · ${s.last7d} LAST` : ''}`],
      ['Engines used', (s.engines ?? []).join(', ') || '—'],
      ['Scans came from', (s.origins ?? []).map((o) => `${o.name} (${o.count})`).join(', ') || '—'],
      ['Open results on latest scans', s.findings ? `${s.findings.critical} critical · ${s.findings.high} high · ${s.findings.medium} medium · ${s.findings.low} low` : '—'],
      ['AI actions (30 days)', s.credits?.actions ? `${s.credits.actions.triage} triage · ${s.credits.actions.remediation} remediation` : '—'],
      ['People active', s.users?.total != null ? `${s.users.active} active, ${s.users.quiet} in the week, of ${s.users.total}` : '—'],
    ];
    shown.addTable(lines.map(([k, v]) => [{ text: k.toUpperCase(), options: { color: MUTED, fontSize: 10, charSpacing: 2 } }, { text: String(v), options: { color: INK, fontSize: 14 } }]), { x: 0.6, y: 1.7, w: 12.1, colW: [3.6, 8.5], fontFace: BODY, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: 0.6, valign: 'middle' });
    const top = (people?.users ?? []).filter((u) => u.status !== 'never' && u.status !== 'unknown').slice(0, 6);
    if (top.length) shown.addText(`Most active: ${top.map((u) => u.name || u.email || u.username).join(', ')}`, { x: 0.6, y: 6.3, w: 12.1, h: 0.4, fontFace: BODY, fontSize: 11, color: MUTED, italic: true });
  }

  // Sessions
  if (opp.sessions?.length) {
    const sess = page('How we got here', 'Sessions');
    const list = [...opp.sessions].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
    sess.addTable(list.map((x) => [{ text: day(x.date), options: { color: MUTED, fontSize: 10 } }, { text: x.title, options: { color: INK, fontSize: 12 } }, { text: SESSION_TYPES[x.type] ?? '', options: { color: BRASS, fontSize: 10 } }]), { x: 0.6, y: 1.7, w: 12.1, colW: [2.4, 7.2, 2.5], fontFace: BODY, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: 0.42 });
  }

  // Next steps
  const next = page('Next steps', 'From here');
  const steps = (opp.tasks ?? []).filter((t) => !t.done).map((t) => t.title);
  next.addText((steps.length ? steps : ['Agree the rollout plan and the first teams', 'Confirm the commercial proposal', 'Schedule the onboarding']).slice(0, 8).map((t) => ({ text: t, options: { bullet: { code: '25C6' }, paraSpaceAfter: 10 } })), { x: 0.6, y: 1.8, w: 12.1, h: 4.5, fontFace: BODY, fontSize: 18, color: INK, valign: 'top' });

  return pptx.write({ outputType: 'nodebuffer' });
}
