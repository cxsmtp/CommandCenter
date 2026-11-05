/**
 * The final POV presentation (.pptx), made from the opportunity and its tenant, in the house look: an espresso
 * cover with a brass rule, ivory pages, the answer first. Shared with the customer once the POV is marked
 * successful (attached to the completion email, or downloaded for SharePoint). The layout is a starting point until
 * the team's own presentation formats are supplied.
 */
import PptxGenJS from 'pptxgenjs';
import { CRITERION_STATUS, SESSION_TYPES, progressOf } from './opportunities.js';
import { platformView } from './platform.js';

const INK = '2A1C13';
const PAPER = 'FBF7F0';
const BRASS = 'B08D57';
const MUTED = '7D6754';
const LINE = 'DCCAB2';
const STATUS_COLOR = { met: '4F6B3A', not_met: '8C2A1E', in_progress: 'A8742A', not_started: '8A8F96', na: '8A8F96' };
const HEAD = 'Georgia';
const BODY = 'Calibri';
const day = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export async function finalDeck(opp, { owner, live, people, evidence = {}, categories = [], org = 'Command Center', catalog = null }) {
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

  // 1 — The platform slide, as designed, with only this POV's engines and their status
  platformSlide(pptx, platformView(opp, catalog));

  // 2 — The answer
  const answer = page(p.percent === 100 ? 'Every success criterion was met' : `${p.met} of ${p.total} success criteria met`, `${opp.customer} · ${day(opp.startDate)} – ${day(opp.endDate)}${owner?.name ? ` · ${owner.name}` : ''}`);
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

// ——— The platform slide ———
// Drawn on the original slide's own grid (1332 × 729 px) so every element keeps its place: nothing moves when an
// engine is not part of the POV, its place is simply left empty.
const W = 1332;
const H = 729;
const X = (px) => (px * 13.333) / W;
const Y = (px) => (px * 7.5) / H;
const BG = '140920';
const VIOLET = '6B34FD';
const FONT = 'Arial';
const SYMBOL = 'Segoe UI Symbol';
const DIM = 'B9B0CC';
const MARK = {
  done: { glyph: '✓', color: '3CCF8E' },
  progress: { glyph: '◷', color: 'F5C518' },
  planned: { glyph: '◷', color: '9E94B8' },
  missed: { glyph: '✕', color: '8A8197' },
};
const hex = (c) => [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
const SPARKLE = 'FFD44D';

function platformSlide(pptx, view) {
  const slide = pptx.addSlide();
  slide.background = { color: BG };
  const shown = new Set();
  for (const pl of view.pillars) {
    shown.add(pl.key);
    for (const g of pl.groups ?? []) shown.add(g.key);
  }
  const has = (key) => shown.has(key);
  const pillar = (key) => view.pillars.find((x) => x.key === key);

  // Title, with its violet-to-coral gradient one letter at a time
  const grad = 'Age of AI-Generated Risk';
  slide.addText(
    [{ text: 'AppSec for the ', options: { color: 'FFFFFF' } }, ...[...grad].map((ch, i) => ({ text: ch, options: { color: mix('BF4BD6', 'F2592D', i / (grad.length - 1)) } }))],
    { x: X(60), y: Y(28), w: X(1212), h: Y(85), fontFace: FONT, fontSize: 46, align: 'center', valign: 'middle', margin: 0 },
  );
  [['One Platform.', 270], ['Every Surface.', 569], ['One Risk View.', 872]].forEach(([t, x]) => slide.addText(t, { x: X(x - 10), y: Y(135), w: X(210), h: Y(34), fontFace: FONT, fontSize: 19, bold: true, color: 'FFFFFF', margin: 0 }));

  // The frame: rounded, its line running orange to violet
  const fx0 = 55, fx1 = 1300, fy0 = 221, fy1 = 631, r = 12;
  const lineAt = (x0, y0, x1, y1, color) => slide.addShape(pptx.ShapeType.line, { x: X(Math.min(x0, x1)), y: Y(Math.min(y0, y1)), w: X(Math.abs(x1 - x0)) || 0.001, h: Y(Math.abs(y1 - y0)) || 0.001, line: { color, width: 2.25 } });
  const colourAt = (x) => mix('F25933', '8C3DF8', (x - fx0) / (fx1 - fx0));
  const steps = 48;
  for (let i = 0; i < steps; i += 1) {
    const a = fx0 + r + ((fx1 - fx0 - 2 * r) * i) / steps;
    const b = fx0 + r + ((fx1 - fx0 - 2 * r) * (i + 1)) / steps;
    // The pill sits on the top edge: the line stops either side of it.
    if (!(a > 556 && b < 778)) lineAt(a, fy0, b, fy0, colourAt(a));
    lineAt(a, fy1, b, fy1, colourAt(a));
  }
  lineAt(fx0, fy0 + r, fx0, fy1 - r, colourAt(fx0));
  lineAt(fx1, fy0 + r, fx1, fy1 - r, colourAt(fx1));
  for (const [cx, cy, a0] of [[fx0, fy0, 180], [fx1 - 2 * r, fy0, 270], [fx1 - 2 * r, fy1 - 2 * r, 0], [fx0, fy1 - 2 * r, 90]]) {
    slide.addShape(pptx.ShapeType.arc, { x: X(cx), y: Y(cy), w: X(2 * r), h: Y(2 * r), angleRange: [a0, a0 + 90], line: { color: colourAt(cx + r), width: 2.25 }, fill: { type: 'none' } });
  }
  slide.addShape(pptx.ShapeType.roundRect, { x: X(556), y: Y(201), w: X(220), h: Y(43), rectRadius: 0.22, fill: { color: VIOLET }, line: { color: 'A98BFF', width: 1 } });
  slide.addText('Checkmarx One', { x: X(556), y: Y(201), w: X(220), h: Y(43), fontFace: FONT, fontSize: 16, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 });

  const sparkles = (x, y, n = 1) => slide.addText('✦'.repeat(n), { x: X(x), y: Y(y), w: X(30 * n), h: Y(28), fontFace: SYMBOL, fontSize: 17, color: SPARKLE, margin: 0, valign: 'middle' });
  const icon = (x, y, color, glyph) => {
    slide.addShape(pptx.ShapeType.ellipse, { x: X(x), y: Y(y), w: X(42), h: Y(42), fill: { color: mix(BG, color, 0.12) }, line: { color, width: 1.25 } });
    slide.addText(glyph, { x: X(x), y: Y(y), w: X(42), h: Y(42), fontFace: FONT, fontSize: glyph.length > 2 ? 7 : 9, bold: true, color, align: 'center', valign: 'middle', margin: 0 });
  };
  const header = (x, y, title, sub, color, uw, star) => {
    slide.addText(title, { x: X(x), y: Y(y - 12), w: X(360), h: Y(26), fontFace: FONT, fontSize: 14, bold: true, color, margin: 0 });
    slide.addText(sub, { x: X(x), y: Y(y + 13), w: X(360), h: Y(26), fontFace: FONT, fontSize: 14, color: 'FFFFFF', margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: X(x), y: Y(y + 47), w: X(uw), h: 0.001, line: { color, width: 1 } });
    if (star) sparkles(star, y + 12);
  };
  const markRun = (state) => ({ text: ` ${MARK[state].glyph}`, options: { fontFace: SYMBOL, color: MARK[state].color, bold: true } });
  const nameRun = (it) => ({ text: it.label, options: { color: it.state === 'done' ? 'FFFFFF' : DIM, bold: it.state === 'done' } });

  // Capture all risks
  if (has('capture')) {
    const c = pillar('capture');
    header(80, 287, 'CAPTURE ALL RISKS', 'Fusion Scanning Architecture', 'F25928', 192, 344);
    const slots = { code: [358, 0], supply: [425, 0], aisc: [493, 3], runtime: [559, 1] };
    const titleW = { code: 0, supply: 0, aisc: 206, runtime: 146 };
    for (const g of c.groups) {
      const [y, stars] = slots[g.key] ?? [];
      if (y === undefined) continue;
      icon(78, y - 7, 'F25928', g.icon);
      slide.addText(g.title, { x: X(129), y: Y(y - 5), w: X(330), h: Y(22), fontFace: FONT, fontSize: 13, bold: true, color: 'FFFFFF', margin: 0 });
      if (stars) sparkles(129 + titleW[g.key], y - 8, stars);
      const runs = [];
      g.items.forEach((it, i) => {
        if (i) runs.push({ text: '  ·  ', options: { color: DIM } });
        runs.push(nameRun(it), markRun(it.state));
      });
      slide.addText(runs, { x: X(129), y: Y(y + 15), w: X(370), h: Y(20), fontFace: FONT, fontSize: 8.5, margin: 0, valign: 'top' });
    }
  }

  // Eliminate & prevent risks, govern & unify risks: one row per agent or capability, each in its own place
  const rows = (key, x, headerY, title, sub, color, uw, slotYs, starAfter) => {
    const pl = pillar(key);
    if (!pl) return;
    header(x, headerY, title, sub, color, uw);
    const ids = key === 'prevent' ? ['dev-assist', 'ai-triage', 'ai-remediation'] : ['risk-orchestration', 'analytics', 'policy', 'mcp'];
    const extra = pl.rows.filter((r) => !ids.includes(r.id));
    ids.forEach((id, i) => {
      const row = pl.rows.find((r) => r.id === id);
      if (!row) return;
      const y = slotYs[i];
      icon(x - 1, y - 21, color, row.icon);
      slide.addText([nameRun({ ...row, state: row.state === 'done' ? 'done' : 'x' }), ...(starAfter[id] ? [{ text: ' ✦', options: { fontFace: SYMBOL, color: SPARKLE } }] : []), markRun(row.state)].map((r, k) => (k === 0 ? { ...r, options: { ...r.options, color: 'FFFFFF', bold: true } } : r)), { x: X(x + 56), y: Y(y - (row.sub ? 18 : 12)), w: X(330), h: Y(24), fontFace: FONT, fontSize: 13, margin: 0, valign: 'middle' });
      if (row.sub) slide.addText(row.sub, { x: X(x + 56), y: Y(y + 4), w: X(300), h: Y(16), fontFace: FONT, fontSize: 8, color: DIM, margin: 0 });
    });
    // New agents or capabilities added to the catalogue in this group: listed under the last row.
    if (extra.length) slide.addText(extra.flatMap((it, i) => [...(i ? [{ text: '  ·  ', options: { color: DIM } }] : []), nameRun(it), markRun(it.state)]), { x: X(x + 56), y: Y(slotYs[slotYs.length - 1] + 26), w: X(320), h: Y(20), fontFace: FONT, fontSize: 8.5, margin: 0 });
  };
  rows('prevent', 531, 291, 'ELIMINATE & PREVENT RISKS', 'Assist Family of Agents', VIOLET, 193, [377, 443, 510], { 'dev-assist': 1, 'ai-triage': 1, 'ai-remediation': 1 });
  rows('govern', 945, 287, 'GOVERN & UNIFY RISKS', 'Orchestration/Posture Management', 'A822BF', 195, [372, 439, 508, 569], { mcp: 1 });

  // The key, just inside the frame, and the footer band
  slide.addText(
    [
      { text: '✓', options: { fontFace: SYMBOL, color: MARK.done.color, bold: true } }, { text: ' Proven     ', options: { color: DIM } },
      { text: '◷', options: { fontFace: SYMBOL, color: MARK.progress.color, bold: true } }, { text: ' In progress     ', options: { color: DIM } },
      { text: '◷', options: { fontFace: SYMBOL, color: MARK.planned.color, bold: true } }, { text: ' Planned', options: { color: DIM } },
    ],
    { x: X(80), y: Y(605), w: X(600), h: Y(18), fontFace: FONT, fontSize: 8, margin: 0 },
  );
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: Y(669), w: 13.333, h: Y(60), fill: { color: VIOLET }, line: { color: VIOLET } });
  slide.addText('Checkmarx', { x: X(52), y: Y(686), w: X(200), h: Y(26), fontFace: FONT, fontSize: 11, bold: true, color: 'FFFFFF', margin: 0, valign: 'middle' });
  slide.addText('1', { x: X(1240), y: Y(686), w: X(50), h: Y(26), fontFace: FONT, fontSize: 8, color: 'FFFFFF', margin: 0, valign: 'middle', align: 'right' });
}
