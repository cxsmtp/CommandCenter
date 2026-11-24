/**
 * The POV work-in-progress deck: the document the SE keeps sharing with the customer during the POV. Cover, the
 * executive overview letter, the platform activated, the customer's toolchain, the APMA assessment (when one was
 * uploaded), plan and timeline, the environment and people, the test plan per business goal, and the meeting notes.
 *
 * It is drawn with pptxgenjs and, when an Admin uploaded the team's WIP template (.pptx), poured into that template:
 * its masters, layouts, backgrounds and closing slide are kept, its own slides are dropped.
 */
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { SESSION_TYPES } from './opportunities.js';
import { platformSlide } from './deck.js';
import { TOOLCHAIN, DEVSECOPS, PLAN_DEFAULTS } from './toolchain.js';

const BG = '170B2B';
const PANEL = '22123B';
const LINE = '3D2860';
const ORANGE = 'F25928';
const VIOLET = '7A45FF';
const WHITE = 'FFFFFF';
const MUTED = 'B9B0CC';
const FONT = 'Arial';
const STATE = { done: ['Completed', '3CCF8E'], demo: ['Demonstrated', '3CCF8E'], progress: ['In progress', 'F5C518'], planned: ['Planned', 'B9B0CC'], missed: ['Not met', '8A8197'] };
const PLATFORM_CATS = new Set(['code', 'supply', 'aisc', 'runtime', 'agents', 'aspm']);

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const longDay = (d) => {
  if (!d) return '—';
  const x = new Date(d.length === 10 ? `${d}T12:00:00Z` : d);
  return `${ordinal(x.getUTCDate())} ${x.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${x.getUTCFullYear()}`;
};
const today = () => new Date().toISOString().slice(0, 10);
const statusOf = (s) => s.status || (s.date <= today() ? 'done' : 'planned');
const lines = (t) => String(t ?? '').split(/\n+/).map((x) => x.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);

/** The deck's content, worked out once from the POV. */
function contentOf(opp, story, { owner, catalog }) {
  const caps = [...new Set((opp.criteria ?? []).map((c) => c.capabilityId || c.capRef).filter(Boolean))].map((id) => catalog?.get(id)).filter(Boolean);
  const engines = [...new Set(caps.filter((c) => PLATFORM_CATS.has(c.category)).map((c) => (c.name || c.cxName).replace(/\s*\(.*\)$/, '')))].slice(0, 10);
  const people = [...(opp.stakeholders ?? [])].sort((a, b) => (a.side === b.side ? 0 : a.side === 'customer' ? -1 : 1));
  if (owner && !people.some((p) => p.email && p.email === owner.email)) people.push({ name: owner.name, title: owner.title || 'Solution Engineer', email: owner.email, side: 'internal', povRole: 'Checkmarx technical lead' });
  const am = people.find((p) => p.side === 'internal' && (/account|sponsor|sales|ae\b/i.test(`${p.title} ${p.povRole}`)) && p.email !== owner?.email);
  return { caps, engines, people, am, se: owner };
}

export async function wipDeck(opp, { story, owner, catalog, template = null }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${opp.customer} — POV work in progress`;
  const templated = Boolean(template);
  const kinds = [];
  const c = contentOf(opp, story, { owner, catalog });
  const C = opp.customer;

  const add = (kind) => {
    const s = pptx.addSlide();
    s.background = { color: BG };
    kinds.push(kind);
    if (!templated) s.addText('Checkmarx', { x: 0.35, y: 7.08, w: 2, h: 0.3, fontFace: FONT, fontSize: 9, bold: true, color: WHITE, margin: 0 });
    return s;
  };
  const head = (s, title, sub, accent = '') => {
    s.addText(title, { x: 0.45, y: 0.3, w: 12.4, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: WHITE, margin: 0 });
    if (sub || accent) s.addText([{ text: sub ? `${sub} ` : '', options: { color: WHITE } }, { text: accent, options: { color: ORANGE } }], { x: 0.45, y: 0.9, w: 12.4, h: 0.35, fontFace: FONT, fontSize: 14, margin: 0 });
  };

  // 1 — Cover
  {
    const s = add('cover');
    s.addText(C.toUpperCase(), { x: 0.5, y: 2.6, w: 9, h: 0.8, fontFace: 'Georgia', fontSize: 34, bold: true, color: WHITE, margin: 0 });
    s.addText('CxOne Platform: Proof of Value Guide', { x: 0.5, y: 3.35, w: 9, h: 0.6, fontFace: FONT, fontSize: 26, color: ORANGE, margin: 0 });
    const who = [c.am, c.se && { name: c.se.name, title: c.se.title || 'Solution Engineer' }].filter(Boolean);
    s.addText(who.map((p) => ({ text: `${p.name} | ${p.title || ''}`, options: { breakLine: true } })), { x: 0.5, y: 5.2, w: 8, h: 0.75, fontFace: FONT, fontSize: 15, color: '8F7BFF', margin: 0, valign: 'top' });
    s.addText(longDay(today()), { x: 0.5, y: 6.3, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, color: WHITE, margin: 0 });
  }

  // 2 — Executive overview: the letter, written from what we know unless the SE wrote their own
  {
    const s = add('content');
    head(s, 'Executive Overview', 'Give your developers the skills they need to increase security and', 'reduce risk right from the start.');
    const pains = (opp.discovery?.painPoints ?? '').trim().replace(/\.$/, '');
    const letter = opp.plan?.letter
      ? opp.plan.letter.split(/\n{2,}/)
      : [
          `Based on our recent discussions${opp.apma ? ' and the findings from the APMA assessment' : ''}, we understand that ${C} is looking to strengthen its application security posture.${pains ? ` What we heard: ${pains}.` : ''}${opp.apma?.lowest ? ` Areas such as ${opp.apma.lowest} stand out as immediate priorities to build a solid foundation.` : ''}`,
          `With the Checkmarx One platform and its suite of security capabilities, ${C} can follow a clear, structured path to accelerate AppSec maturity: moving from a reactive approach to a proactive, developer-first security model${c.engines.length ? ` that spans ${c.engines.join(', ')}` : ''}.`,
          `This document gives you a structured view of the value Checkmarx One brings to your organization. It covers the business goals we identified together, the agreed success criteria for evaluating the solution${opp.apma ? ', maturity recommendations based on the APMA framework' : ''}, the current status of the POV, and any additional context needed to support the process.`,
          c.se ? `Your primary technical point of contact at Checkmarx is ${c.se.name}, available throughout the engagement to answer questions and make sure every business need and success criterion is accounted for as you make the best decision for your AppSec program.` : '',
        ].filter(Boolean);
    s.addText([{ text: `Dear ${C} Team,`, options: { breakLine: true, paraSpaceAfter: 8 } }, ...letter.map((p) => ({ text: p.trim(), options: { breakLine: true, paraSpaceAfter: 8 } })), { text: opp.plan?.quote || '“From code to confidence: building security from the ground up with Checkmarx.”', options: { bold: true, italic: true } }], {
      x: 0.45,
      y: 1.45,
      w: 12.4,
      h: 5.4,
      fontFace: FONT,
      fontSize: 13,
      color: WHITE,
      valign: 'top',
      margin: 0,
      fit: 'shrink',
    });
  }

  // 3 — The platform, with this POV's engines
  if (story?.platform) {
    platformSlide(pptx, story.platform);
    kinds.push('content');
  }

  // 4 — Tailored to your DevSecOps: the touch points, with the customer's tools lit
  {
    const s = add('content');
    head(s, 'Tailored to Your DevSecOps', 'Integrate with your SDLC and', 'secure your applications');
    s.addShape(pptx.ShapeType.roundRect, { x: 0.45, y: 1.5, w: 9.4, h: 1.05, rectRadius: 0.08, fill: { color: PANEL }, line: { color: VIOLET, width: 1 } });
    s.addText('DevSecOps', { x: 0.65, y: 1.5, w: 1.6, h: 1.05, fontFace: FONT, fontSize: 15, color: WHITE, valign: 'middle', margin: 0 });
    DEVSECOPS.forEach((st, i) => {
      s.addShape(pptx.ShapeType.roundRect, { x: 2.35 + i * 1.06, y: 1.65, w: 0.92, h: 0.75, rectRadius: 0.06, fill: { color: '3A2A55' }, line: { color: LINE, width: 0.75 } });
      s.addText(st, { x: 2.35 + i * 1.06, y: 1.65, w: 0.92, h: 0.75, fontFace: FONT, fontSize: 10, color: WHITE, align: 'center', valign: 'bottom', margin: 4 });
    });
    const t = opp.toolchain ?? {};
    const w = 12.4 / TOOLCHAIN.length;
    TOOLCHAIN.forEach((cat, i) => {
      const x = 0.45 + i * w;
      const picked = t[cat.key]?.tools ?? [];
      const names = [...cat.tools.map(([n]) => n), ...picked.filter((p) => !cat.tools.some(([n]) => n === p))];
      s.addShape(pptx.ShapeType.roundRect, { x, y: 2.8, w: w - 0.12, h: 4.05, rectRadius: 0.06, fill: { color: PANEL }, line: { color: LINE, width: 0.75 } });
      s.addText(cat.label.toUpperCase(), { x: x + 0.12, y: 2.88, w: w - 0.3, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: WHITE, margin: 0 });
      s.addShape(pptx.ShapeType.line, { x: x + 0.12, y: 3.3, w: w - 0.36, h: 0, line: { color: LINE, width: 0.75 } });
      names.slice(0, 11).forEach((n, k) => {
        const on = picked.includes(n);
        const y = 3.42 + k * 0.31;
        if (on) s.addShape(pptx.ShapeType.rect, { x: x + 0.1, y: y - 0.02, w: w - 0.32, h: 0.27, fill: { color: ORANGE, transparency: 85 }, line: { color: ORANGE, width: 1 } });
        s.addText(n, { x: x + 0.16, y, w: w - 0.4, h: 0.24, fontFace: FONT, fontSize: 9.5, color: on ? WHITE : '8C82A3', bold: on, margin: 0, valign: 'middle' });
      });
    });
  }

  // 5 — APMA, when the customer has an assessment
  const apma = opp.apma;
  if (apma?.dimensions?.some((d) => d.current != null)) {
    const s = add('content');
    head(s, 'APMA Assessment', 'Current status and future plan for', 'AppSec process maturity');
    const dims = apma.dimensions.filter((d) => d.current != null);
    const label = (n) => n.replace('Security Testing - Infrastructure', 'Security Testing - Architecture & Scale');
    s.addText(`The diagram shows the result of the APMA interview assessment with ${C}, and the desired state recommended for ${C}’s AppSec program.`, { x: 0.45, y: 1.45, w: 6.6, h: 0.6, fontFace: FONT, fontSize: 11, color: MUTED, margin: 0, valign: 'top' });
    s.addShape(pptx.ShapeType.roundRect, { x: 0.45, y: 2.1, w: 6.6, h: 4.8, rectRadius: 0.06, fill: { color: WHITE }, line: { color: LINE, width: 0.5 } });
    s.addChart(
      pptx.charts.RADAR,
      [
        { name: 'Initial state', labels: dims.map((d) => label(d.name)), values: dims.map((d) => d.current ?? 0) },
        { name: 'Desired state', labels: dims.map((d) => label(d.name)), values: dims.map((d) => d.desired ?? 0) },
      ],
      { x: 0.55, y: 2.2, w: 6.4, h: 4.6, radarStyle: 'standard', chartColors: ['EF5D7A', '2DBE4E'], lineSize: 2, showLegend: true, legendPos: 't', legendFontSize: 9, catAxisLabelFontSize: 9, catAxisLabelColor: '333333', valAxisMinVal: 0, valAxisMaxVal: 4, valAxisMajorUnit: 1, valAxisLabelFontSize: 7, valAxisLabelColor: '888888' },
    );
    const rows = [
      ['Dimension', 'Today', 'Desired'].map((h) => ({ text: h, options: { bold: true, color: WHITE, fill: { color: ORANGE }, fontSize: 10 } })),
      ...dims.map((d) => [{ text: label(d.name), options: { color: WHITE, fontSize: 10 } }, { text: String(d.current ?? '—'), options: { color: 'EF5D7A', bold: true, fontSize: 11, align: 'center' } }, { text: String(d.desired ?? '—'), options: { color: '2DBE4E', bold: true, fontSize: 11, align: 'center' } }]),
    ];
    s.addTable(rows, { x: 7.35, y: 1.5, w: 5.5, colW: [3.5, 1, 1], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, fill: { color: PANEL }, rowH: 0.34, valign: 'middle' });
    const recY = 1.6 + 0.36 * (dims.length + 1) + 0.25;
    if (apma.overall) s.addText([{ text: 'Overall maturity: ', options: { bold: true, color: WHITE } }, { text: apma.overall, options: { color: MUTED } }], { x: 7.35, y: recY, w: 5.5, h: 0.45, fontFace: FONT, fontSize: 10, margin: 0, valign: 'top' });
    if (apma.recommendations?.length) {
      s.addText('RECOMMENDED FIRST STEPS', { x: 7.35, y: recY + 0.55, w: 5.5, h: 0.3, fontFace: FONT, fontSize: 10, color: ORANGE, charSpacing: 2, margin: 0 });
      s.addText(
        apma.recommendations.slice(0, 4).map((r) => ({ text: `${r.title}${r.dimension ? ` (${r.dimension})` : ''}`, options: { bullet: { code: '25B8' }, breakLine: true, paraSpaceAfter: 5 } })),
        { x: 7.35, y: recY + 0.9, w: 5.5, h: Math.max(1, 6.9 - recY - 0.9), fontFace: FONT, fontSize: 10, color: WHITE, valign: 'top', margin: 0, fit: 'shrink' },
      );
    }
  }

  // 6 — Plan and timeline
  {
    const s = add('content');
    head(s, 'POV Plan & Timeline');
    const plan = opp.plan ?? {};
    const scope = plan.scope?.length ? plan.scope : (story?.goals ?? []).filter((g) => g.key !== 'other').map((g) => g.title).slice(0, 5);
    const cards = [
      ['Scope', `Focus on ${C} goals`, scope.length ? scope : ['Agreed with the team at the start of the POV']],
      ['Support', 'Ensuring a smooth POV', plan.support?.length ? plan.support : PLAN_DEFAULTS.support],
      ['Success', 'Real-world outcomes', plan.success?.length ? plan.success : PLAN_DEFAULTS.success],
    ];
    cards.forEach(([t, sub, items], i) => {
      const x = 0.45 + i * 4.2;
      s.addShape(pptx.ShapeType.roundRect, { x, y: 1.2, w: 4.0, h: 3.0, rectRadius: 0.06, fill: { color: PANEL }, line: { color: VIOLET, width: 0.75 } });
      s.addText(t, { x: x + 0.2, y: 1.3, w: 3.6, h: 0.4, fontFace: FONT, fontSize: 16, color: WHITE, margin: 0 });
      s.addText(sub, { x: x + 0.2, y: 1.7, w: 3.6, h: 0.28, fontFace: FONT, fontSize: 10, color: MUTED, margin: 0 });
      s.addText(items.slice(0, 6).map((it) => ({ text: it, options: { bullet: { code: '00BB' }, breakLine: true, paraSpaceAfter: 4 } })), { x: x + 0.2, y: 2.05, w: 3.6, h: 2.05, fontFace: FONT, fontSize: 10, color: WHITE, valign: 'top', margin: 0, fit: 'shrink' });
    });
    const meetings = [...(opp.sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-9);
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.05, w: 12.9, h: 0.16, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
    s.addShape(pptx.ShapeType.triangle, { x: 12.85, y: 4.93, w: 0.4, h: 0.4, rotate: 90, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
    if (!meetings.length) s.addText('Meetings appear here as they are planned.', { x: 0.45, y: 5.4, w: 12, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });
    const step = Math.min(1.45, 12.2 / Math.max(1, meetings.length));
    meetings.forEach((m, i) => {
      const x = 0.45 + i * step;
      const d = new Date(`${m.date}T12:00:00Z`);
      const done = statusOf(m) === 'done';
      s.addShape(pptx.ShapeType.roundRect, { x: x + 0.15, y: 4.5, w: 0.95, h: 1.05, rectRadius: 0.06, fill: { color: WHITE }, line: { color: done ? ORANGE : '9E94B8', width: 1.5 } });
      s.addText([{ text: String(d.getUTCDate()), options: { fontSize: 22, bold: true, color: ORANGE, breakLine: true } }, { text: d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }), options: { fontSize: 8, color: '5B4A7A' } }], { x: x + 0.15, y: 4.55, w: 0.95, h: 0.95, fontFace: FONT, align: 'center', valign: 'middle', margin: 0 });
      s.addText(m.title || SESSION_TYPES[m.type] || 'Meeting', { x, y: 5.65, w: step - 0.05, h: 0.45, fontFace: FONT, fontSize: 8.5, color: WHITE, align: 'center', valign: 'top', margin: 0, fit: 'shrink' });
      s.addText(done ? 'Completed' : 'Planned', { x, y: 6.15, w: step - 0.05, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: done ? '3CCF8E' : 'F5C518', align: 'center', margin: 0 });
    });
  }

  // 7 — Environment: the people, the tenant, the touch points
  {
    const s = add('content');
    head(s, 'POV Environment Details');
    const H = (t, color = VIOLET) => ({ text: t, options: { bold: true, color: WHITE, fill: { color }, fontSize: 10 } });
    const cell = (t, o = {}) => ({ text: String(t ?? '') || '—', options: { color: WHITE, fontSize: 9, ...o } });
    const ppl = c.people.slice(0, 8);
    s.addTable([[H('Name'), H('Title'), H('POV role'), H('Email address')], ...ppl.map((p) => [cell(p.name), cell(p.title), cell(p.povRole), cell(p.email)])], { x: 0.45, y: 1.15, w: 12.4, colW: [2.6, 3.2, 2.8, 3.8], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, fill: { color: PANEL }, rowH: 0.28, valign: 'middle' });
    const top = 1.15 + 0.3 * (ppl.length + 1) + 0.25;
    const t = opp.tenant;
    const weeks = opp.startDate && opp.endDate ? Math.max(1, Math.round((new Date(opp.endDate) - new Date(opp.startDate)) / (7 * 864e5))) : null;
    const env = [
      ['POV dates', opp.startDate ? `${longDay(opp.startDate)} to ${longDay(opp.endDate)}` : '—'],
      ['POV duration', weeks ? `${weeks} week${weeks > 1 ? 's' : ''}` : '—'],
      ['Solutions for testing', c.engines.join(', ')],
      ['Tenant instance', t ? `${t.regionLabel || t.region || ''}`.trim() : ''],
      ['Account name', opp.plan?.accountName || t?.tenant || ''],
      ['Tenant URL', t?.baseUrl ?? ''],
      ['Out of scope', opp.plan?.outOfScope || '—'],
    ];
    s.addTable([[H('Environment details', '8C3DF8'), H('', '8C3DF8')], ...env.map(([k, v]) => [cell(k, { color: MUTED }), cell(v)])], { x: 0.45, y: top, w: 5.9, colW: [2.0, 3.9], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, fill: { color: PANEL }, rowH: 0.27, valign: 'middle', autoPage: false });
    const tc = opp.toolchain ?? {};
    const capIds = new Set(c.caps.map((x) => x.id));
    const integ = TOOLCHAIN.filter((cat) => tc[cat.key]?.tools?.length).map((cat) => [cat.label, tc[cat.key].access || cat.access, tc[cat.key].tools.join(', ')]);
    integ.push(['Languages & frameworks', '', tc.languages || opp.discovery?.languages || '—']);
    integ.push(['Developer Assist', '', capIds.has('dev-assist') ? (tc.ide?.tools ?? []).join(', ') || 'Yes' : '—']);
    integ.push(['Triage & Remediation Assist', '', capIds.has('ai-triage') || capIds.has('ai-remediation') ? 'Yes' : '—']);
    s.addTable([[H('Integration', '8C3DF8'), H('Access needed', '8C3DF8'), H('Tools', '8C3DF8')], ...integ.map(([a, b, d]) => [cell(a, { color: MUTED }), cell(b), cell(d)])], { x: 6.6, y: top, w: 6.25, colW: [2.0, 1.9, 2.35], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, fill: { color: PANEL }, rowH: 0.27, valign: 'middle', autoPage: false });
  }

  // 8… — The test plan, one business goal at a time
  {
    const crit = Object.fromEntries((story?.criteria ?? []).map((x) => [x.id, x]));
    let goals = (story?.goals ?? []).filter((g) => g.ids.length);
    if (!goals.length && story?.criteria?.length) goals = [{ key: 'all', title: 'Success criteria', statement: 'Agreed with the team for this POV.', ids: story.criteria.map((x) => x.id) }];
    goals.forEach((g, gi) => {
      const ids = g.ids.filter((id) => crit[id]);
      for (let k = 0; k < ids.length; k += 4) {
        const s = add('table');
        s.addText('Test Plan Overview', { x: 0.45, y: 0.25, w: 12, h: 0.5, fontFace: FONT, fontSize: 26, color: WHITE, margin: 0 });
        s.addText([{ text: 'Business Goals', options: { color: ORANGE } }, { text: ' and ', options: { color: WHITE } }, { text: 'Success Criteria', options: { color: ORANGE } }], { x: 0.45, y: 0.72, w: 12, h: 0.3, fontFace: FONT, fontSize: 13, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: 0.45, y: 1.2, w: 12.4, h: 5.75, rectRadius: 0.06, fill: { color: PANEL }, line: { color: VIOLET, width: 0.75 } });
        s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 1.35, w: 0.9, h: 0.5, rectRadius: 0.08, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        s.addText(`BG${gi + 1}`, { x: 0.6, y: 1.35, w: 0.9, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        s.addText([{ text: `${g.title}${ids.length > 4 ? ` (${k / 4 + 1} of ${Math.ceil(ids.length / 4)})` : ''}`, options: { bold: true } }, { text: g.statement ? ` - ${g.statement}` : '' }], { x: 1.65, y: 1.3, w: 11.05, h: 0.65, fontFace: FONT, fontSize: 12, color: WHITE, margin: 0, valign: 'middle', fit: 'shrink' });
        const H = (t) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: ORANGE }, fontSize: 10, align: 'center' } });
        const rows = ids.slice(k, k + 4).map((id, i) => {
          const x = crit[id];
          const [label, color] = STATE[x.state] ?? ['—', MUTED];
          return [
            { text: [{ text: `SC${k + i + 1}:`, options: { bold: true, breakLine: true } }, { text: x.title }], options: { color: WHITE, fontSize: 10, align: 'center' } },
            { text: x.benefit || x.statement || '', options: { color: WHITE, fontSize: 9 } },
            { text: x.test || '', options: { color: WHITE, fontSize: 9 } },
            { text: label, options: { color, bold: true, fontSize: 10, align: 'center' } },
          ];
        });
        s.addTable([[H('Success Criteria'), H('Description'), H('How to measure'), H('Result')], ...rows], { x: 0.6, y: 2.05, w: 12.1, colW: [2.2, 4.2, 4.2, 1.5], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: [0.32, ...rows.map(() => 1.1)], valign: 'middle', autoPage: false });
      }
    });
  }

  // Closing, then the appendix: the notes of each meeting held
  kinds.push('closing');
  if (!templated) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText([{ text: 'Secure what ', options: { color: WHITE } }, { text: 'comes next.', options: { color: ORANGE } }], { x: 0.8, y: 3.0, w: 11, h: 1.4, fontFace: FONT, fontSize: 54, margin: 0 });
  } else pptx.addSlide(); // replaced by the template's own closing slide
  const held = [...(opp.sessions ?? [])].filter((m) => statusOf(m) === 'done' && (m.did || m.notes || m.theirNext || m.ourNext)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (held.length) {
    const s = add('section');
    s.addText('Appendix', { x: 0.8, y: 3.1, w: 11, h: 1, fontFace: FONT, fontSize: 44, bold: true, color: WHITE, margin: 0 });
    for (const m of held) {
      const n = add('notes');
      n.addText([{ text: 'Meeting Notes', options: { bold: true, color: WHITE, fontSize: 26 } }, { text: `  Date: ${longDay(m.date)}`, options: { color: ORANGE, fontSize: 16 } }], { x: 0.45, y: 0.3, w: 12.4, h: 0.6, fontFace: FONT, margin: 0 });
      const block = (title, body) => (lines(body).length ? [{ text: title, options: { bold: true, color: ORANGE, fontSize: 13, breakLine: true, paraSpaceBefore: 6 } }, ...lines(body).map((l) => ({ text: l, options: { bullet: true, color: WHITE, fontSize: 11, breakLine: true, paraSpaceAfter: 3 } }))] : []);
      n.addText([...block('What we did today', m.did || m.notes), ...block(`Next steps from ${C}`, m.theirNext), ...block('From the Checkmarx side', m.ourNext || m.followUps)], { x: 0.45, y: 1.1, w: 12.4, h: 5.8, fontFace: FONT, valign: 'top', margin: 0, fit: 'shrink' });
    }
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return template ? intoTemplate(template, out, kinds) : out;
}

// ——— Pouring the deck into the team's template ———
const EMU_WIDE = 12192000;

/** Which of the template's layouts to use for each kind of slide, found from its own slides. */
async function readTemplate(zip) {
  const pres = await zip.file('ppt/presentation.xml').async('string');
  const presRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  const rel = Object.fromEntries([...presRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]]));
  const order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => rel[m[1]].replace(/^\/?(ppt\/)?/, 'ppt/'));
  const slides = [];
  for (const p of order) {
    const xml = (await zip.file(p)?.async('string')) ?? '';
    const rels = (await zip.file(p.replace('slides/', 'slides/_rels/') + '.rels')?.async('string')) ?? '';
    const layout = /Target="\.\.\/slideLayouts\/([^"]+)"/.exec(rels)?.[1];
    slides.push({ path: p, xml, rels, layout, text: [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ') });
  }
  const find = (re) => slides.find((s) => re.test(s.text));
  const content = find(/Executive Overview/i)?.layout ?? slides[1]?.layout ?? slides[0]?.layout;
  return {
    pres,
    presRels,
    slides,
    cx: Number(/<p:sldSz[^>]*cx="(\d+)"/.exec(pres)?.[1]) || EMU_WIDE,
    layouts: {
      cover: slides[0]?.layout ?? content,
      content,
      table: find(/Test Plan/i)?.layout ?? content,
      section: slides.find((s) => /^\s*Appendix\s*$/i.test(s.text))?.layout ?? content,
      notes: find(/Meeting Notes/i)?.layout ?? content,
    },
    closing: [...slides].reverse().find((s) => /Secure\s+what\s+comes\s+next/i.test(s.text)) ?? null,
  };
}

/** Scale a slide drawn at 13.33 in wide to the template's width. */
function scaleXml(xml, f) {
  if (Math.abs(f - 1) < 0.001) return xml;
  const k = (v) => String(Math.round(Number(v) * f));
  return xml
    .replace(/<a:(off|chOff) x="(-?\d+)" y="(-?\d+)"/g, (_, t, x, y) => `<a:${t} x="${k(x)}" y="${k(y)}"`)
    .replace(/<a:(ext|chExt) cx="(\d+)" cy="(\d+)"/g, (_, t, x, y) => `<a:${t} cx="${k(x)}" cy="${k(y)}"`)
    .replace(/<a:gridCol w="(\d+)"/g, (_, w) => `<a:gridCol w="${k(w)}"`)
    .replace(/<a:tr h="(\d+)"/g, (_, h) => `<a:tr h="${k(h)}"`)
    .replace(/(<a:(?:rPr|defRPr|endParaRPr)\b[^>]*?\bsz=")(\d+)"/g, (_, a, sz) => `${a}${Math.round((Number(sz) * f) / 100) * 100}"`);
}

export async function intoTemplate(templateBuf, deckBuf, kinds) {
  const zip = await JSZip.loadAsync(templateBuf);
  const gen = await JSZip.loadAsync(deckBuf);
  const t = await readTemplate(zip);
  const f = t.cx / EMU_WIDE;
  let types = await zip.file('[Content_Types].xml').async('string');

  // Keep the closing slide's drawing; everything else of the template's slides goes.
  const closingXml = t.closing?.xml ?? null;
  const closingRels = t.closing ? t.closing.rels.replace(/<Relationship\b[^>]*(notesSlide|comments|commentAuthors|tags)[^>]*\/>/g, '') : null;
  for (const name of Object.keys(zip.files)) if (/^ppt\/(slides|notesSlides|comments)\//.test(name)) zip.remove(name);

  const genPres = await gen.file('ppt/presentation.xml').async('string');
  const genRels = await gen.file('ppt/_rels/presentation.xml.rels').async('string');
  const gRel = Object.fromEntries([...genRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]]));
  const genOrder = [...genPres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => `ppt/${gRel[m[1]]}`);

  const newSlides = [];
  const overrides = [];
  let media = 0;
  let n = 0;
  for (let i = 0; i < genOrder.length; i++) {
    const kind = kinds[i] ?? 'content';
    if (kind === 'closing' && !closingXml) continue;
    n += 1;
    let xml;
    let rels;
    if (kind === 'closing' && closingXml) {
      xml = closingXml;
      rels = closingRels;
    } else {
      // Left to right whatever the template's master says, and no background of its own: the layout's shows.
      xml = scaleXml((await gen.file(genOrder[i]).async('string')).replace(/<p:bg>[\s\S]*?<\/p:bg>/, ''), f)
        .replace(/<a:pPr(?![^>]*\brtl=)/g, '<a:pPr rtl="0"')
        .replace(/<a:p>(?!<a:pPr)/g, '<a:p><a:pPr rtl="0"/>')
        .replace(/<a:pPr(?![^>]*\balgn=)/g, '<a:pPr algn="l"');
      rels = (await gen.file(genOrder[i].replace('slides/', 'slides/_rels/') + '.rels')?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      const layout = t.layouts[kind] ?? t.layouts.content;
      rels = rels.replace(/Target="(?:\.\.|\/ppt)\/slideLayouts\/[^"]+"/, `Target="../slideLayouts/${layout}"`).replace(/<Relationship\b[^>]*notesSlide[^>]*\/>/g, '');
      // Media and charts travel with the slide, renamed so they never clash with the template's own.
      for (const m of [...rels.matchAll(/Target="((?:\.\.|\/ppt)\/(media|charts)\/([^"]+))"/g)]) {
        const [, target, dir, file] = m;
        const to = `wip${++media}-${file}`;
        const data = await gen.file(`ppt/${dir}/${file}`).async('nodebuffer');
        zip.file(`ppt/${dir}/${to}`, dir === 'charts' ? scaleChart(data) : data);
        rels = rels.replace(`"${target}"`, `"../${dir}/${to}"`);
        if (dir === 'charts') {
          overrides.push(`<Override PartName="/ppt/charts/${to}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
          const cRels = await gen.file(`ppt/charts/_rels/${file}.rels`)?.async('string');
          if (cRels) {
            let r = cRels;
            for (const e of [...cRels.matchAll(/Target="((?:\.\.|\/ppt)\/embeddings\/([^"]+))"/g)]) {
              const eTo = `wip${media}-${e[2]}`;
              zip.file(`ppt/embeddings/${eTo}`, await gen.file(`ppt/embeddings/${e[2]}`).async('nodebuffer'));
              r = r.replace(`"${e[1]}"`, `"../embeddings/${eTo}"`);
            }
            zip.file(`ppt/charts/_rels/${to}.rels`, r);
          }
        }
      }
    }
    zip.file(`ppt/slides/slide${n}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels);
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    newSlides.push(n);
  }

  // The presentation's slide list and relationships.
  let presRels = t.presRels.replace(/<Relationship\b[^>]*Target="slides\/[^"]+"[^>]*\/>/g, '');
  const sldIds = newSlides.map((n) => {
    presRels = presRels.replace('</Relationships>', `<Relationship Id="rIdWip${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/></Relationships>`);
    return `<p:sldId id="${300 + n}" r:id="rIdWip${n}"/>`;
  });
  let pres = t.pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>`);
  if (!/<p:sldIdLst>/.test(pres)) pres = pres.replace(/(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>(?:<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>)?(?:<p:handoutMasterIdLst>[\s\S]*?<\/p:handoutMasterIdLst>)?)/, `$1<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>`);
  pres = pres.replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/, '').replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, '');
  zip.file('ppt/presentation.xml', pres);
  zip.file('ppt/_rels/presentation.xml.rels', presRels);

  // Content types: the new parts in, the parts that are gone out.
  for (const ext of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['jpg', 'image/jpeg'], ['svg', 'image/svg+xml'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) if (!new RegExp(`Extension="${ext[0]}"`, 'i').test(types)) types = types.replace('<Override', `<Default Extension="${ext[0]}" ContentType="${ext[1]}"/><Override`);
  types = types.replace(/<Override PartName="\/ppt\/(slides|notesSlides|comments)\/[^"]+"[^>]*\/>/g, '');
  types = types.replace('</Types>', `${overrides.join('')}</Types>`);
  zip.file('[Content_Types].xml', types);

  // Drop media nothing points to any more (the template's screenshots).
  const used = new Set();
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) for (const m of (await zip.file(name).async('string')).matchAll(/Target="([^"]+)"/g)) used.add(m[1].split('/').pop());
  for (const name of Object.keys(zip.files)) if (/^ppt\/media\//.test(name) && !used.has(name.split('/').pop())) zip.remove(name);
  // Nothing of the template's history travels: revisions, authors, comment authors, who made or last saved it.
  for (const name of Object.keys(zip.files)) if (/^ppt\/(changesInfos\/|revisionInfo\.xml|authors\.xml|commentAuthors\.xml)/.test(name)) zip.remove(name);
  zip.file('ppt/_rels/presentation.xml.rels', (await zip.file('ppt/_rels/presentation.xml.rels').async('string')).replace(/<Relationship\b[^>]*Target="(?:changesInfos\/[^"]*|revisionInfo\.xml|authors\.xml|commentAuthors\.xml)"[^>]*\/>/g, ''));
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace(/<Override PartName="\/([^"]+)"[^>]*\/>/g, (all, part) => (zip.file(part) ? all : ''));
  zip.file('[Content_Types].xml', ct);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const title = (await gen.file('docProps/core.xml')?.async('string'))?.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] ?? '';
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>Meridian</dc:creator><cp:lastModifiedBy>Meridian</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  const app = await zip.file('docProps/app.xml')?.async('string');
  if (app) zip.file('docProps/app.xml', app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${newSlides.length}</Slides>`).replace(/<Company>[^<]*<\/Company>/, '<Company></Company>').replace(/<Manager>[^<]*<\/Manager>/, '').replace(/<Notes>\d+<\/Notes>/, '<Notes>0</Notes>'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const scaleChart = (buf) => buf;

/** Is this a PowerPoint file we can use as the template? Returns what was found in it. */
export async function checkTemplate(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return null;
  }
  if (!zip.file('ppt/presentation.xml')) return null;
  const t = await readTemplate(zip);
  return { slides: t.slides.length, closing: Boolean(t.closing), widthIn: Math.round((t.cx / 914400) * 100) / 100 };
}
