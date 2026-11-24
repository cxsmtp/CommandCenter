/**
 * The POV work-in-progress deck: the document the SE keeps sharing with the customer during the POV. Cover, the
 * executive overview letter, the platform activated, the customer's toolchain, the APMA assessment (when one was
 * uploaded), plan and timeline, the environment and people, the test plan per business goal, and the meeting notes.
 *
 * It is drawn with pptxgenjs and, when an Admin uploaded the team's WIP template (.pptx), poured into that template:
 * its masters, layouts, backgrounds and closing slide are kept, its own slides are dropped.
 */
import { toolIcon } from './tool-icons.js';
import { impactTiles } from './impact.js';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { SESSION_TYPES } from './opportunities.js';
import { platformSlide } from './deck.js';
import { TOOLCHAIN, DEVSECOPS, PLAN_DEFAULTS } from './toolchain.js';
import { fillCover, fillPlan, fillEnvironment, fillTestPlan } from './template-fill.js';
import { DEFAULT_LAYOUT } from './deck-templates.js';

const BG = '170B2B';
const PANEL = '1F1235';
const LINE = '3D2860';
const ORANGE = 'F25928';
const VIOLET = '7A45FF';
const WHITE = 'FFFFFF';
const MUTED = 'B9B0CC';
const FONT = 'Arial';
// Status colours: completed green, in progress amber, planned yellow, not met grey (never red).
const STATE = { done: ['Completed', '3CCF8E'], demo: ['Demonstrated', '3CCF8E'], progress: ['In progress', 'F5A524'], planned: ['Planned', 'F5C518'], missed: ['Not met', '8A8197'] };
const PLATFORM_CATS = new Set(['code', 'supply', 'aisc', 'runtime', 'agents', 'aspm']);

const mixHex = (a, b, t) => [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
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

export async function wipDeck(opp, { story, owner, catalog, template = null, mode = 'wip', live = null, layout = null, texts = {} }) {
  // The same deck, two moments: 'wip' while the POV runs, 'results' for the final readout in the team's template.
  const results = mode === 'results';
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${opp.customer} — ${results ? 'POV results' : 'POV work in progress'}`;
  const templated = Boolean(template);
  // Which of the template's own slides this deck can use (filled with the POV's data, or with its items boxed).
  const tinfo = template ? await readTemplate(await JSZip.loadAsync(template)) : null;
  const use = { cover: Boolean(tinfo?.cover), plan: Boolean(tinfo?.plan), env: Boolean(tinfo?.env), test: Boolean(tinfo?.test) };
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

  // ——— Shared pieces, so every slide reads as one family ———
  const L = 0.5; // left margin
  const W = 12.33; // content width
  const card = (s, x, y, w, h, o = {}) => s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: o.fill ?? PANEL }, line: { color: o.line ?? LINE, width: o.lineW ?? 0.75, dashType: o.dash ?? 'solid' } });
  const label = (s, text, x, y, w, color = ORANGE) => {
    s.addShape(pptx.ShapeType.rect, { x, y: y + 0.05, w: 0.05, h: 0.2, fill: { color }, line: { color, width: 0 } });
    s.addText(text.toUpperCase(), { x: x + 0.13, y, w: w - 0.13, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color, charSpacing: 2, margin: 0, valign: 'middle' });
  };
  const pill = (s, text, x, y, w, color, o = {}) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: o.h ?? 0.28, rectRadius: (o.h ?? 0.28) / 2, fill: { color, transparency: o.solid ? 0 : 78 }, line: { color, width: 0.75 } });
    s.addText(text, { x, y, w, h: o.h ?? 0.28, fontFace: FONT, fontSize: o.size ?? 9, bold: true, color: o.solid ? WHITE : color, align: 'center', valign: 'middle', margin: 0 });
  };
  const bullets = (items, o = {}) => items.map((t) => ({ text: t, options: { bullet: { code: o.code ?? '25AA', indent: 14 }, breakLine: true, paraSpaceAfter: o.space ?? 6, color: o.color ?? WHITE } }));


  const sCover = () => {
  // 1 — Cover
  {
    const s = add(use.cover ? { kind: 'cover', reuse: 'cover', fill: { customer: C, results, people: [c.am, c.se && { name: c.se.name, title: c.se.title || 'Solution Engineer' }].filter(Boolean), date: longDay(today()) } } : 'cover');
    s.addText(C.toUpperCase(), { x: 0.5, y: 2.6, w: 9, h: 0.8, fontFace: FONT, fontSize: 38, bold: true, color: WHITE, margin: 0 });
    s.addText(results ? 'CxOne Platform: Proof of Value Results' : 'CxOne Platform: Proof of Value Guide', { x: 0.5, y: 3.35, w: 9, h: 0.6, fontFace: FONT, fontSize: 26, color: ORANGE, margin: 0 });
    const who = [c.am, c.se && { name: c.se.name, title: c.se.title || 'Solution Engineer' }].filter(Boolean);
    s.addText(who.map((p) => ({ text: `${p.name} | ${p.title || ''}`, options: { breakLine: true } })), { x: 0.5, y: 5.2, w: 8, h: 0.75, fontFace: FONT, fontSize: 15, color: '8F7BFF', margin: 0, valign: 'top' });
    s.addText(longDay(today()), { x: 0.5, y: 6.3, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, color: WHITE, margin: 0 });
  }
  };

  const sGlance = () => {
  // 2r — Results at a glance: the answer first
  if (results) {
    const s = add('content');
    const p = story?.progress ?? { met: 0, total: 0, percent: 0, must: 0, mustMet: 0 };
    const t = live?.summary ?? story?.tenant ?? null;
    head(s, p.total && p.met === p.total ? 'Every success criterion met' : `${p.met} of ${p.total} success criteria met`, `${C} · ${longDay(opp.startDate)} – ${longDay(opp.endDate)}`, '');
    const figs = [
      [`${p.percent}%`, 'success criteria met', ORANGE],
      [`${p.mustMet}/${p.must}`, 'must-haves met', VIOLET],
      [t?.projects != null ? String(t.projects) : '—', 'projects scanned', '3CCF8E'],
      story?.value?.hours?.total ? [`${Math.round(story.value.hours.total)} h`, 'saved by AI', 'F5C518'] : [t?.users?.total != null ? `${(t.users.active ?? 0) + (t.users.quiet ?? 0)}/${t.users.total}` : '—', 'people active', 'F5C518'],
    ];
    const fw = (W - 0.45) / 4;
    figs.forEach(([v, l, color], i) => {
      const x = L + i * (fw + 0.15);
      card(s, x, 1.55, fw, 1.7);
      s.addShape(pptx.ShapeType.rect, { x: x + 0.25, y: 1.75, w: 0.4, h: 0.05, fill: { color }, line: { color, width: 0 } });
      s.addText(v, { x: x + 0.25, y: 1.9, w: fw - 0.5, h: 0.8, fontFace: FONT, fontSize: 40, bold: true, color: WHITE, margin: 0, valign: 'middle' });
      s.addText(l.toUpperCase(), { x: x + 0.25, y: 2.75, w: fw - 0.5, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: MUTED, charSpacing: 2, margin: 0 });
    });
    label(s, 'Business goals', L, 3.55, 5);
    const goals = (story?.goals ?? []).filter((g) => g.key !== 'other').slice(0, 5);
    goals.forEach((g, i) => {
      const y = 3.95 + i * 0.5;
      const frac = g.total ? g.done / g.total : 0;
      s.addText(g.title, { x: L, y, w: 6.2, h: 0.3, fontFace: FONT, fontSize: 11.5, color: WHITE, margin: 0, valign: 'middle', fit: 'shrink' });
      s.addShape(pptx.ShapeType.roundRect, { x: L + 6.35, y: y + 0.08, w: 3.4, h: 0.16, rectRadius: 0.08, fill: { color: '2E1D4A' }, line: { color: '2E1D4A', width: 0 } });
      if (frac) s.addShape(pptx.ShapeType.roundRect, { x: L + 6.35, y: y + 0.08, w: Math.max(0.16, 3.4 * frac), h: 0.16, rectRadius: 0.08, fill: { color: frac === 1 ? '3CCF8E' : ORANGE }, line: { color: frac === 1 ? '3CCF8E' : ORANGE, width: 0 } });
      s.addText(`${g.done}/${g.total}`, { x: L + 9.9, y, w: 0.8, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: WHITE, margin: 0, valign: 'middle' });
    });
    const summary = (opp.summary ?? '').trim();
    card(s, L + 10.9, 3.55, W - 10.9, 2.95);
    s.addText(summary || (story?.completedAt ? `POV completed on ${longDay(story.completedAt.slice(0, 10))}.` : 'The POV is still running.'), { x: L + 11.05, y: 3.7, w: W - 11.2, h: 2.65, fontFace: FONT, fontSize: 10.5, italic: !summary, color: summary ? WHITE : MUTED, margin: 0, valign: 'top', fit: 'shrink' });
  }
  };

  const sOverview = () => {
  // 2 — Executive overview: the letter on the left, the POV at a glance on the right
  if (!results) {
    const s = add('content');
    head(s, 'Executive Overview', 'Give your developers the skills they need to increase security and', 'reduce risk right from the start.');
    const pains = (opp.discovery?.painPoints ?? '').trim().replace(/\.$/, '');
    const letter = opp.plan?.letter
      ? opp.plan.letter.split(/\n{2,}/)
      : [
          `Based on our recent discussions${opp.apma ? ' and the findings from the APMA assessment' : ''}, we understand that ${C} is looking to strengthen its application security posture.${pains ? ` What we heard: ${pains}.` : ''}${opp.apma?.lowest ? ` ${opp.apma.lowest} stand out as immediate priorities to build a solid foundation.` : ''}`,
          `With Checkmarx One, ${C} can follow a clear, structured path to AppSec maturity: from a reactive approach to a proactive, developer-first security model.`,
          `This document gives a structured view of that value: the business goals we identified together, the agreed success criteria${opp.apma ? ', maturity recommendations from the APMA framework' : ''}, and the current status of the POV.`,
          c.se ? `Your primary technical contact at Checkmarx is ${c.se.name}, available throughout the engagement to make sure every business need and success criterion is accounted for.` : '',
        ].filter(Boolean);
    s.addText(`Dear ${C} Team,`, { x: L, y: 1.55, w: 7.4, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: WHITE, margin: 0 });
    s.addText(letter.map((p) => ({ text: p.trim(), options: { breakLine: true, paraSpaceAfter: 10 } })), { x: L, y: 2.0, w: 7.4, h: 3.95, fontFace: FONT, fontSize: 12.5, color: 'E6E0F2', valign: 'top', margin: 0, lineSpacingMultiple: 1.12, fit: 'shrink' });
    s.addShape(pptx.ShapeType.rect, { x: L, y: 6.15, w: 0.06, h: 0.55, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
    s.addText(opp.plan?.quote || texts.quote || '“From code to confidence: building security from the ground up with Checkmarx.”', { x: L + 0.2, y: 6.1, w: 7.2, h: 0.65, fontFace: FONT, fontSize: 13, italic: true, bold: true, color: WHITE, margin: 0, valign: 'middle' });
    // At a glance
    const gx = 8.4;
    const gw = L + W - gx;
    card(s, gx, 1.55, gw, 5.2);
    label(s, 'At a glance', gx + 0.25, 1.75, gw - 0.5);
    const goals = (story?.goals ?? []).filter((g) => g.key !== 'other').slice(0, 4);
    let y = 2.2;
    if (goals.length) {
      s.addText('Business goals', { x: gx + 0.25, y, w: gw - 0.5, h: 0.28, fontFace: FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
      y += 0.32;
      goals.forEach((g, i) => {
        s.addShape(pptx.ShapeType.ellipse, { x: gx + 0.25, y: y + 0.03, w: 0.26, h: 0.26, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        s.addText(String(i + 1), { x: gx + 0.25, y: y + 0.03, w: 0.26, h: 0.26, fontFace: FONT, fontSize: 9, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        s.addText(g.title, { x: gx + 0.62, y, w: gw - 0.85, h: 0.34, fontFace: FONT, fontSize: 10.5, color: WHITE, margin: 0, valign: 'middle', fit: 'shrink' });
        y += 0.4;
      });
      y += 0.1;
    }
    s.addText('Platform in this POV', { x: gx + 0.25, y, w: gw - 0.5, h: 0.28, fontFace: FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
    y += 0.34;
    let cx = gx + 0.25;
    for (const e of c.engines.slice(0, 10)) {
      const pw = Math.min(gw - 0.5, 0.3 + e.length * 0.075);
      if (cx + pw > gx + gw - 0.25) {
        cx = gx + 0.25;
        y += 0.36;
      }
      if (y > 5.6) break;
      pill(s, e, cx, y, pw, VIOLET, { size: 8.5, h: 0.27 });
      cx += pw + 0.08;
    }
    y += 0.5;
    const facts = [opp.startDate ? ['POV', `${longDay(opp.startDate)} – ${longDay(opp.endDate)}`] : null, c.se ? ['Your contact', `${c.se.name}${c.se.email ? ` · ${c.se.email}` : ''}`] : null].filter(Boolean);
    for (const [k, v] of facts) {
      if (y > 6.25) break;
      s.addText([{ text: `${k}  `, options: { bold: true, color: MUTED } }, { text: v, options: { color: WHITE } }], { x: gx + 0.25, y, w: gw - 0.5, h: 0.3, fontFace: FONT, fontSize: 10, margin: 0, fit: 'shrink' });
      y += 0.34;
    }
  }
  };

  // CheckmarxOne: components of the platform activated in this POV. Drawn in the team template's own language (the
  // same sections, colours and frame), with every product in the catalogue in its section, each a chip of known size,
  // so a highlight always fits: activated in orange, met with a tick.
  const sPlatform = () => {
    const s = add('content');
    s.addText('CheckmarxOne', { x: L, y: 0.32, w: 9, h: 0.6, fontFace: FONT, fontSize: 30, bold: true, color: WHITE, margin: 0 });
    s.addText([{ text: 'Components of the platform ', options: { color: WHITE } }, { text: 'activated in this POV', options: { color: ORANGE } }], { x: L, y: 0.92, w: 10, h: 0.36, fontFace: FONT, fontSize: 16, margin: 0 });
    const inPov = new Map((opp.criteria ?? []).map((x) => [x.capabilityId || x.capRef, x]).filter(([k]) => k));
    const hasIntegrations = TOOLCHAIN.some((t) => (opp.toolchain?.[t.key]?.tools ?? []).length) || (opp.criteria ?? []).some((x) => ['scm', 'ci', 'ide', 'tracking'].includes(catalog?.get(x.capabilityId)?.category));
    const BAND = '1C1238';
    const BLUE = '1F6FE5';
    const MAGENTA = 'A322C9';
    const DIMTXT = 'B8B0CC';
    const chip = (x, y, w, label, id, { fixed = false } = {}) => {
      const crit = id ? inPov.get(id) : null;
      const on = Boolean(crit) || (id === '*integrations' && hasIntegrations);
      const met = crit && ['met'].includes(crit.status);
      const h = 0.27;
      if (on) s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.07, fill: { color: ORANGE, transparency: 82 }, line: { color: ORANGE, width: 1 } });
      s.addShape(pptx.ShapeType.ellipse, { x: x + 0.09, y: y + 0.085, w: 0.1, h: 0.1, fill: { color: on ? ORANGE : '5A4C78' }, line: { color: on ? ORANGE : '5A4C78', width: 0 } });
      s.addText([{ text: label, options: { color: on ? WHITE : fixed ? DIMTXT : DIMTXT, bold: on } }, ...(met ? [{ text: '  ✓', options: { color: '3CCF8E', bold: true } }] : [])], { x: x + 0.26, y, w: w - 0.3, h, fontFace: FONT, fontSize: 10, margin: 0, valign: 'middle', fit: 'shrink' });
    };
    const pill = (x, y, w, text, color) => {
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.32, rectRadius: 0.05, fill: { color }, line: { color, width: 0 } });
      s.addText(text, { x, y, w, h: 0.32, fontFace: FONT, fontSize: 12, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
    };
    const textW = (t) => 0.42 + String(t).length * 0.078;
    // The frame
    s.addShape(pptx.ShapeType.roundRect, { x: L, y: 1.45, w: W, h: 5.45, rectRadius: 0.1, fill: { color: BG, transparency: 100 }, line: { color: VIOLET, width: 1 } });
    const X0 = L + 0.15;
    const RW = W - 0.3;
    // A full-width row: its label, then its items in a line
    const row = (y, label, color, items, { band = BAND } = {}) => {
      s.addShape(pptx.ShapeType.roundRect, { x: X0, y, w: RW, h: 0.46, rectRadius: 0.05, fill: { color: band }, line: { color: band, width: 0 } });
      pill(X0 + 0.1, y + 0.07, 1.45, label, color);
      let x = X0 + 1.8;
      for (const [t, id] of items) {
        const w = textW(t);
        chip(x, y + 0.095, w, t, id, { fixed: !id });
        x += w + 0.18;
      }
    };
    row(1.6, 'Insights', '6B34FD', [['Unified dashboard & reporting', 'analytics'], ['Cloud Insights', 'cloud-insights']]);
    row(2.14, 'Posture', '6B34FD', [['Application Risk Management (ASPM)', 'arm'], ['Risk Orchestration', 'risk-orchestration'], ['Policy management', 'policy']]);
    row(2.68, 'Agentic AI', ORANGE, [['Developer Assist', 'dev-assist'], ['Triage Assist', 'ai-triage'], ['Remediation Assist', 'ai-remediation'], ['Checkmarx MCP', 'mcp']], { band: '2A1A5E' });
    // The engines, in their families
    const blocks = [
      ['Code Security', BLUE, 2.45, [['SAST', 'sast'], ['Fusion SAST', 'fusion'], ['LLM-based SAST (LAST)', 'last'], ['Secrets Detection', 'secrets'], ['IaC Security', 'iac'], ['API Security', 'apisec']]],
      ['Supply Chain', BLUE, 2.45, [['SCA', 'sca'], ['Malicious Packages', 'malicious'], ['Container Security', 'containers'], ['Repository Health', 'scorecard'], ['SBOM', 'sbom']]],
      ['AI Supply Chain', BLUE, 2.45, [['AI Inventory', 'aisc'], ['MCP Scanner', 'mcp-scanner'], ['LLM Scanner', 'llm-scanner'], ['Skills Scanner', 'skills-scanner']]],
      ['Runtime', BLUE, 1.85, [['DAST', 'dast'], ['DAST for AI', 'dast-ai']]],
    ];
    const by = 3.22;
    const bh = 2.36;
    let bx = X0;
    for (const [label, color, w, items] of blocks) {
      s.addShape(pptx.ShapeType.roundRect, { x: bx, y: by, w, h: bh, rectRadius: 0.05, fill: { color: BAND }, line: { color: BAND, width: 0 } });
      pill(bx + 0.1, by + 0.1, Math.min(w - 0.2, textW(label) + 0.2), label, color);
      items.forEach(([t, id], i) => chip(bx + 0.1, by + 0.52 + i * 0.3, w - 0.2, t, id));
      bx += w + 0.13;
    }
    // Partners, as the template shows them
    const pw = X0 + RW - bx;
    s.addShape(pptx.ShapeType.roundRect, { x: bx, y: by, w: pw, h: bh, rectRadius: 0.05, fill: { color: BAND }, line: { color: '3A3A8C', width: 0.75, dashType: 'dash' } });
    s.addText('Partners', { x: bx + 0.15, y: by + 0.1, w: pw - 0.3, h: 0.32, fontFace: FONT, fontSize: 12, bold: true, color: '5EE0D2', margin: 0, valign: 'middle' });
    [['Cloud security', null], ['Runtime protection', null]].forEach(([t], i) => chip(bx + 0.1, by + 0.52 + i * 0.3, pw - 0.2, t, null, { fixed: true }));
    row(5.7, 'Dev Enablement', MAGENTA, [['Codebashing', null], ['IDE Remediation Guidance', null]]);
    row(6.24, 'DevSecOps', MAGENTA, [['75+ technologies and languages, 100+ frameworks', null], ['SDLC integrations', '*integrations']]);
  };

  // The Classic deck's first slide (AppSec for the Age of AI-Generated Risk: this POV's engines with their status),
  // right after the cover; the template's footer shows instead of its own band.
  const sAge = () => {
    if (!story?.platform) return;
    platformSlide(pptx, story.platform, { band: false });
    kinds.push('content');
  };

  const sDevSecOps = (viaTemplate = true) => {
  // 4 — Tailored to your DevSecOps: the lifecycle as a pipeline, the touch points with the customer's tools lit
  {
    // The template's own toolchain slide is used instead when it has one, with the customer's tools boxed.
    const s = add(viaTemplate ? { kind: 'content', reuse: 'devsecops', marks: TOOLCHAIN.flatMap((cat) => opp.toolchain?.[cat.key]?.tools ?? []) } : 'content');
    head(s, 'Tailored to Your DevSecOps', 'Integrate with your SDLC and', 'secure your applications');
    const n = DEVSECOPS.length;
    const sw = (W + 0.25 * (n - 1)) / n;
    DEVSECOPS.forEach((st, i) => {
      const x = L + i * (sw - 0.25);
      const color = mixHex('6B34FD', 'F25928', i / (n - 1));
      s.addShape(i === 0 ? pptx.ShapeType.homePlate : pptx.ShapeType.chevron, { x, y: 1.5, w: sw, h: 0.62, fill: { color }, line: { color: BG, width: 1.5 } });
      s.addText(st, { x: x + (i === 0 ? 0 : 0.2), y: 1.5, w: sw - 0.3, h: 0.62, fontFace: FONT, fontSize: 12, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
    });
    const t = opp.toolchain ?? {};
    const cw = (W - 0.15 * (TOOLCHAIN.length - 1)) / TOOLCHAIN.length;
    TOOLCHAIN.forEach((cat, i) => {
      const x = L + i * (cw + 0.15);
      const picked = t[cat.key]?.tools ?? [];
      const names = [...picked, ...cat.tools.map(([nm]) => nm).filter((nm) => !picked.includes(nm))];
      card(s, x, 2.45, cw, 4.35, { line: picked.length ? ORANGE : LINE, lineW: picked.length ? 1 : 0.75 });
      s.addText(cat.label.toUpperCase(), { x: x + 0.15, y: 2.58, w: cw - 0.3, h: 0.32, fontFace: FONT, fontSize: 12.5, bold: true, color: WHITE, margin: 0, valign: 'middle' });
      s.addText(picked.length ? `${picked.length} in use` : 'not in scope', { x: x + 0.15, y: 2.9, w: cw - 0.3, h: 0.24, fontFace: FONT, fontSize: 8.5, color: picked.length ? ORANGE : '7D7396', margin: 0 });
      s.addShape(pptx.ShapeType.line, { x: x + 0.15, y: 3.2, w: cw - 0.3, h: 0, line: { color: LINE, width: 0.75 } });
      names.slice(0, 10).forEach((nm, k) => {
        const on = picked.includes(nm);
        const y = 3.32 + k * 0.33;
        // Each tool with its logo (or a lettered tile): white on the orange pill when in use, muted otherwise.
        const icon = toolIcon(nm, on);
        const tx = icon ? 0.46 : 0.2;
        if (on) {
          s.addShape(pptx.ShapeType.roundRect, { x: x + 0.1, y, w: cw - 0.2, h: 0.28, rectRadius: 0.14, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        }
        if (icon) s.addImage({ data: icon, x: x + 0.2, y: y + 0.05, w: 0.18, h: 0.18 });
        // One line always: a long name gets a smaller size (about 0.55 em a character, bold).
        const tw = cw - tx - 0.15;
        const size = Math.max(7, Math.min(9.5, (tw * 72) / (nm.length * (on ? 0.56 : 0.5))));
        s.addText(nm, { x: x + tx, y, w: tw, h: 0.28, fontFace: FONT, fontSize: Math.round(size * 2) / 2, bold: on, color: on ? WHITE : '7D7396', margin: 0, valign: 'middle' });
      });
    });
  }
  };

  const sApma = () => {
  // 5 — APMA, when the customer has an assessment
  const apma = opp.apma;
  if (apma?.dimensions?.some((d) => d.current != null)) {
    const s = add('content');
    head(s, 'APMA Assessment', 'Current status and future plan for', 'AppSec process maturity');
    const dims = apma.dimensions.filter((d) => d.current != null);
    const name = (n) => n.replace('Security Testing - Infrastructure', 'Security Testing - Architecture & Scale');
    card(s, L, 1.5, 6.2, 5.3);
    s.addChart(
      pptx.charts.RADAR,
      [
        { name: 'Today', labels: dims.map((d) => name(d.name).replace('Security Testing - ', 'Testing: ')), values: dims.map((d) => d.current ?? 0) },
        { name: 'Desired', labels: dims.map((d) => name(d.name).replace('Security Testing - ', 'Testing: ')), values: dims.map((d) => d.desired ?? 0) },
      ],
      {
        x: L + 0.1, y: 1.6, w: 6.0, h: 5.1,
        radarStyle: 'marker', chartColors: ['A98BFF', '3CCF8E'], lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 7,
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendColor: 'E6E0F2', legendFontFace: FONT,
        catAxisLabelFontSize: 9.5, catAxisLabelColor: 'E6E0F2', catAxisLabelFontFace: FONT, catAxisLineColor: '4A3670',
        valAxisMinVal: 0, valAxisMaxVal: 4, valAxisMajorUnit: 1, valAxisLabelFontSize: 8, valAxisLabelColor: '8C82A3', valGridLine: { color: '4A3670', size: 0.75 },
        plotArea: { fill: { color: PANEL } }, chartArea: { fill: { color: PANEL } },
      },
    );
    const rx = 7.05;
    const rw = L + W - rx;
    label(s, 'Maturity by dimension', rx, 1.5, rw);
    s.addText([{ text: '●', options: { color: 'A98BFF' } }, { text: ' Today   ', options: { color: MUTED } }, { text: '●', options: { color: '3CCF8E' } }, { text: ' Desired', options: { color: MUTED } }], { x: rx + rw - 1.8, y: 1.5, w: 1.8, h: 0.3, fontFace: FONT, fontSize: 9, align: 'right', margin: 0 });
    dims.forEach((d, i) => {
      const y = 1.95 + i * 0.5;
      const track = rw - 1.1;
      s.addText(name(d.name), { x: rx, y, w: rw - 1.1, h: 0.22, fontFace: FONT, fontSize: 10, color: WHITE, margin: 0 });
      s.addText(`${d.current} → ${d.desired ?? '—'}`, { x: rx + rw - 1.05, y: y + 0.08, w: 1.05, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: WHITE, align: 'right', margin: 0 });
      s.addShape(pptx.ShapeType.roundRect, { x: rx, y: y + 0.26, w: track, h: 0.16, rectRadius: 0.08, fill: { color: '2E1D4A' }, line: { color: '2E1D4A', width: 0 } });
      if (d.desired) s.addShape(pptx.ShapeType.roundRect, { x: rx, y: y + 0.26, w: (track * Math.min(4, d.desired)) / 4, h: 0.16, rectRadius: 0.08, fill: { color: '3CCF8E', transparency: 55 }, line: { color: '3CCF8E', width: 0.75 } });
      s.addShape(pptx.ShapeType.roundRect, { x: rx, y: y + 0.26, w: Math.max(0.16, (track * Math.min(4, d.current)) / 4), h: 0.16, rectRadius: 0.08, fill: { color: 'A98BFF' }, line: { color: 'A98BFF', width: 0 } });
    });
    let y = 1.95 + dims.length * 0.5 + 0.15;
    if (apma.overall) {
      s.addText([{ text: 'Overall maturity  ', options: { bold: true, color: MUTED } }, { text: apma.overall.replace(/^./, (x) => x.toUpperCase()), options: { color: WHITE } }], { x: rx, y, w: rw, h: 0.3, fontFace: FONT, fontSize: 10, margin: 0, fit: 'shrink' });
      y += 0.45;
    }
    if (apma.recommendations?.length) {
      label(s, 'Recommended first steps', rx, y, rw);
      y += 0.4;
      apma.recommendations.slice(0, 3).forEach((r, i) => {
        s.addShape(pptx.ShapeType.ellipse, { x: rx, y: y + 0.02, w: 0.28, h: 0.28, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        s.addText(String(i + 1), { x: rx, y: y + 0.02, w: 0.28, h: 0.28, fontFace: FONT, fontSize: 10, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        s.addText([{ text: r.title, options: { color: WHITE, breakLine: true } }, { text: r.dimension, options: { color: MUTED, fontSize: 8.5 } }], { x: rx + 0.4, y: y - 0.02, w: rw - 0.4, h: 0.55, fontFace: FONT, fontSize: 10, margin: 0, valign: 'top', fit: 'shrink' });
        y += 0.6;
      });
    }
  }
  };

  const sPlan = (viaTemplate = true) => {
  // 6 — Plan and timeline
  {
    // The template's own plan slide, when it has one: the real milestones, the goals, the champion.
    const ms = [...(opp.sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const launch = ms.find((m) => m.type === 'launch') ?? ms[0];
    const checks = ms.filter((m) => m.type === 'checkpoint');
    const checkin = checks.find((m) => statusOf(m) === 'planned') ?? checks.at(-1) ?? ms[1];
    const wrapup = ms.find((m) => m.type === 'wrapup') ?? ms.at(-1);
    const champion = (opp.stakeholders ?? []).find((p) => p.side === 'customer' && /champion|admin|sponsor/i.test(p.povRole ?? ''))?.name ?? '';
    const pl = opp.plan ?? {};
    const fill = { customer: C, scope: (pl.scope?.length ? pl.scope : (story?.goals ?? []).filter((g) => g.key !== 'other').map((g) => g.title)).slice(0, 3), support: (pl.support?.length ? pl.support : (texts.support?.length ? texts.support : PLAN_DEFAULTS.support)).slice(0, 3), success: (pl.success?.length ? pl.success : (texts.success?.length ? texts.success : PLAN_DEFAULTS.success)).slice(0, 3), launch, checkin, wrapup, champion };
    const s = add(viaTemplate && use.plan ? { kind: 'content', reuse: 'plan', fill } : 'content');
    head(s, 'POV Plan & Timeline', 'Focus on', `${C}’s goals`);
    const plan = opp.plan ?? {};
    const scope = plan.scope?.length ? plan.scope : (story?.goals ?? []).filter((g) => g.key !== 'other').map((g) => g.title).slice(0, 5);
    const cards = [
      ['Scope', `Focus on ${C} goals`, scope.length ? scope : ['Agreed with the team at the start of the POV']],
      ['Support', 'Ensuring a smooth POV', plan.support?.length ? plan.support : (texts.support?.length ? texts.support : PLAN_DEFAULTS.support)],
      ['Success', 'Real-world outcomes', plan.success?.length ? plan.success : (texts.success?.length ? texts.success : PLAN_DEFAULTS.success)],
    ];
    const kw = (W - 0.3) / 3;
    cards.forEach(([t, sub, items], i) => {
      const x = L + i * (kw + 0.15);
      card(s, x, 1.5, kw, 2.7);
      s.addShape(pptx.ShapeType.rect, { x: x + 0.25, y: 1.72, w: 0.4, h: 0.05, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
      s.addText(t, { x: x + 0.25, y: 1.82, w: kw - 0.5, h: 0.38, fontFace: FONT, fontSize: 17, bold: true, color: WHITE, margin: 0 });
      s.addText(sub, { x: x + 0.25, y: 2.2, w: kw - 0.5, h: 0.26, fontFace: FONT, fontSize: 10, color: MUTED, margin: 0 });
      s.addText(bullets(items.slice(0, 5), { space: 4 }), { x: x + 0.25, y: 2.55, w: kw - 0.45, h: 1.55, fontFace: FONT, fontSize: 10.5, valign: 'top', margin: 0, fit: 'shrink' });
    });
    const meetings = [...(opp.sessions ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-9);
    const ly = 5.05;
    s.addShape(pptx.ShapeType.rect, { x: L, y: ly - 0.03, w: W - 0.25, h: 0.06, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
    s.addShape(pptx.ShapeType.triangle, { x: L + W - 0.3, y: ly - 0.16, w: 0.3, h: 0.32, rotate: 90, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
    if (!meetings.length) s.addText('Meetings appear here as they are planned.', { x: L, y: 5.5, w: W, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED, align: 'center' });
    const step = (W - 0.4) / Math.max(1, meetings.length);
    meetings.forEach((m, i) => {
      const cxm = L + step * (i + 0.5);
      const d = new Date(`${m.date}T12:00:00Z`);
      const done = statusOf(m) === 'done';
      const bw = 0.98;
      if (done) card(s, cxm - bw / 2, ly - 0.55, bw, 1.0, { fill: WHITE, line: ORANGE, lineW: 1.5 });
      else card(s, cxm - bw / 2, ly - 0.55, bw, 1.0, { fill: '24163C', line: '9E94B8', lineW: 1, dash: 'dash' });
      s.addText([{ text: String(d.getUTCDate()), options: { fontSize: 24, bold: true, color: done ? ORANGE : WHITE, breakLine: true } }, { text: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase(), options: { fontSize: 9, bold: true, color: done ? '5B4A7A' : MUTED, charSpacing: 1 } }], { x: cxm - bw / 2, y: ly - 0.53, w: bw, h: 0.96, fontFace: FONT, align: 'center', valign: 'middle', margin: 0 });
      s.addText(m.title || SESSION_TYPES[m.type] || 'Meeting', { x: cxm - step / 2 + 0.05, y: ly + 0.55, w: step - 0.1, h: 0.45, fontFace: FONT, fontSize: 10, color: WHITE, align: 'center', valign: 'top', margin: 0, fit: 'shrink' });
      pill(s, done ? 'Completed' : 'Planned', cxm - 0.5, ly + 1.05, 1.0, done ? '3CCF8E' : 'F5C518', { size: 8.5, h: 0.26 });
    });
  }
  };

  const sEnv = (main = true) => {
  // The template's own environment slide carries the essentials; the full detail is in the appendix.
  const tenant = opp.tenant;
  const weeksN = opp.startDate && opp.endDate ? Math.max(1, Math.round((new Date(opp.endDate) - new Date(opp.startDate)) / (7 * 864e5))) : null;
  const tcx = opp.toolchain ?? {};
  const pair = (k) => [tcx[k]?.access || TOOLCHAIN.find((x) => x.key === k)?.access, (tcx[k]?.tools ?? []).join(', ')];
  const envFill = {
    people: c.people.slice(0, 7),
    env: { 'POV dates': opp.startDate ? `${longDay(opp.startDate)} – ${longDay(opp.endDate)}` : '', 'POV duration': weeksN ? `${weeksN} week${weeksN > 1 ? 's' : ''}` : '', 'Solutions tested': c.engines.join(', '), 'Tenant name': opp.plan?.accountName || tenant?.tenant || '', 'Tenant URL': tenant?.baseUrl ?? '' },
    integrations: { scm: pair('scm'), ide: pair('ide'), cicd: pair('cicd'), feedback: pair('feedback'), languages: [undefined, tcx.languages || opp.discovery?.languages || ''] },
  };
  // 7 — Environment: the people, the tenant, the touch points (the WIP deck only)
  {
    const s = add(main && use.env ? { kind: 'content', reuse: 'env', fill: envFill } : 'content');
    head(s, main ? 'POV Environment Details' : 'Environment & Toolchain in Full');
    const H = (t) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: VIOLET }, fontSize: 10.5 } });
    const zebra = (i) => (i % 2 ? '1A0F2E' : PANEL);
    const cell = (t, i, o = {}) => ({ text: String(t ?? '') || '—', options: { color: WHITE, fontSize: 10, fill: { color: zebra(i) }, ...o } });
    const opts = { fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, valign: 'middle', autoPage: false, margin: [3, 6, 3, 6] };
    const ppl = c.people.slice(0, 6);
    label(s, 'People', L, 1.3, 4);
    s.addTable([[H('Name'), H('Title'), H('POV role'), H('Email address')], ...ppl.map((p, i) => [cell(p.name, i, { bold: true }), cell(p.title, i), cell(p.povRole, i, { color: p.povRole ? ORANGE : MUTED }), cell(p.email, i, { color: MUTED })])], { ...opts, x: L, y: 1.65, w: W, colW: [2.6, 3.3, 2.7, 3.73], rowH: 0.32 });
    const top = 1.65 + 0.36 * (ppl.length + 1) + 0.55;
    const t = opp.tenant;
    const weeks = opp.startDate && opp.endDate ? Math.max(1, Math.round((new Date(opp.endDate) - new Date(opp.startDate)) / (7 * 864e5))) : null;
    const env = [
      ['POV dates', opp.startDate ? `${longDay(opp.startDate)} – ${longDay(opp.endDate)}` : ''],
      ['Duration', weeks ? `${weeks} week${weeks > 1 ? 's' : ''}` : ''],
      ['Solutions for testing', c.engines.join(', ')],
      ['Tenant region', t ? `${t.regionLabel || t.region || ''}`.trim() : ''],
      ['Account name', opp.plan?.accountName || t?.tenant || ''],
      ['Tenant URL', t?.baseUrl ?? ''],
      ['Out of scope', opp.plan?.outOfScope || ''],
    ];
    label(s, 'Environment', L, top - 0.35, 4);
    s.addTable(env.map(([k, v], i) => [cell(k, i, { color: MUTED, bold: true }), cell(v, i)]), { ...opts, x: L, y: top, w: 5.9, colW: [1.9, 4.0], rowH: 0.31 });
    const tc = opp.toolchain ?? {};
    const capIds = new Set(c.caps.map((x) => x.id));
    const integ = TOOLCHAIN.filter((cat) => tc[cat.key]?.tools?.length).map((cat) => [cat.label, tc[cat.key].access || cat.access, tc[cat.key].tools.join(', ')]);
    integ.push(['Languages', '', tc.languages || opp.discovery?.languages || '']);
    integ.push(['Developer Assist', '', capIds.has('dev-assist') ? (tc.ide?.tools ?? []).join(', ') || 'Yes' : '']);
    integ.push(['Triage & Remediation', '', capIds.has('ai-triage') || capIds.has('ai-remediation') ? 'Yes' : '']);
    label(s, 'Integrations', 6.75, top - 0.35, 4);
    s.addTable([[H('Touch point'), H('Access needed'), H('Tools')], ...integ.map(([a, b2, d], i) => [cell(a, i, { color: MUTED, bold: true }), cell(b2, i), cell(d, i)])], { ...opts, x: 6.75, y: top, w: L + W - 6.75, colW: [1.75, 1.9, L + W - 6.75 - 3.65], rowH: 0.31 });
  }
  };

  const sTests = (viaTemplate = true) => {
    const tpl = viaTemplate && use.test;
  // 8… — The test plan, one business goal at a time
  {
    const crit = Object.fromEntries((story?.criteria ?? []).map((x) => [x.id, x]));
    let goals = (story?.goals ?? []).filter((g) => g.ids.length);
    if (!goals.length && story?.criteria?.length) goals = [{ key: 'all', title: 'Success criteria', statement: 'Agreed with the team for this POV.', ids: story.criteria.map((x) => x.id) }];
    const rowH = (x) => Math.max(0.62, 0.2 + 0.17 * Math.max(Math.ceil(String(x.benefit || x.statement || '').length / 62), Math.ceil(String(x.test || '').length / 62), Math.ceil(String(x.title).length / 26) + 1));
    goals.forEach((g, gi) => {
      const ids = g.ids.filter((id) => crit[id]);
      // As many criteria as fit on the slide, never squeezed.
      const pages = [];
      let cur = [];
      let h = 0;
      for (const id of ids) {
        const rh = rowH(crit[id]);
        if (cur.length && (tpl ? cur.length >= 6 : h + rh > 4.3)) {
          pages.push(cur);
          cur = [];
          h = 0;
        }
        cur.push(id);
        h += rh;
      }
      if (cur.length) pages.push(cur);
      let n = 0;
      pages.forEach((page, pi) => {
        // The template's own test plan slide, when it has one: six rows a page, the result under each criterion.
        const fillRows = page.map((id) => {
          const x = crit[id];
          const [label, color] = STATE[x.state] ?? ['Planned', MUTED];
          return { title: x.title, result: label, color, test: x.test, benefit: x.benefit || x.statement };
        });
        const s = add(tpl ? { kind: 'content', reuse: 'test', fill: { number: gi + 1, title: `${g.title}${pages.length > 1 ? ` (${pi + 1} of ${pages.length})` : ''}`, statement: g.statement, rows: fillRows } } : 'content');
        s.addText('Test Plan Overview', { x: L, y: 0.3, w: 9, h: 0.55, fontFace: FONT, fontSize: 26, bold: true, color: WHITE, margin: 0 });
        s.addText([{ text: 'Business Goals', options: { color: ORANGE } }, { text: ' and ', options: { color: WHITE } }, { text: 'Success Criteria', options: { color: ORANGE } }], { x: L, y: 0.85, w: 9, h: 0.3, fontFace: FONT, fontSize: 13, margin: 0 });
        if (pages.length > 1) s.addText(`${pi + 1} of ${pages.length}`, { x: L + W - 2, y: 0.4, w: 2, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED, align: 'right', margin: 0 });
        card(s, L, 1.4, W, 0.85, { line: VIOLET });
        s.addShape(pptx.ShapeType.roundRect, { x: L + 0.18, y: 1.55, w: 0.95, h: 0.55, rectRadius: 0.1, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        s.addText(`BG${gi + 1}`, { x: L + 0.18, y: 1.55, w: 0.95, h: 0.55, fontFace: FONT, fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        s.addText([{ text: g.title, options: { bold: true, fontSize: 14, color: WHITE, breakLine: Boolean(g.statement) } }, ...(g.statement ? [{ text: g.statement, options: { fontSize: 10.5, color: MUTED } }] : [])], { x: L + 1.3, y: 1.45, w: W - 1.5, h: 0.75, fontFace: FONT, margin: 0, valign: 'middle', fit: 'shrink' });
        const H = (t, al = 'left') => ({ text: t, options: { bold: true, color: WHITE, fill: { color: ORANGE }, fontSize: 10, align: al } });
        const rows = page.map((id, i) => {
          const x = crit[id];
          const [lab, color] = STATE[x.state] ?? ['—', MUTED];
          const f = { fill: { color: i % 2 ? '1A0F2E' : PANEL } };
          n += 1;
          return [
            { text: [{ text: `SC${n}  `, options: { bold: true, color: ORANGE } }, { text: x.title, options: { bold: true, color: WHITE } }], options: { fontSize: 10.5, ...f } },
            { text: x.test || '', options: { color: 'E6E0F2', fontSize: 9.5, ...f } },
            { text: x.benefit || x.statement || '', options: { color: 'E6E0F2', fontSize: 9.5, ...f } },
            { text: lab, options: { color, bold: true, fontSize: 10, align: 'center', valign: 'middle', ...f } },
          ];
        });
        s.addTable([[H('Criteria'), H('Test item'), H('Benefit'), H('Result', 'center')], ...rows], { x: L, y: 2.45, w: W, colW: [2.75, 4.0, 4.08, 1.5], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: [0.36, ...page.map((id) => rowH(crit[id]))], valign: 'middle', autoPage: false, margin: [4, 8, 4, 8] });
      });
    });
  }
  };

  // ——— The guide's business goals (Version Kendra): the goals at a glance, then each goal with its criteria ———
  const guideGoals = () => {
    const crit = Object.fromEntries((story?.criteria ?? []).map((x) => [x.id, x]));
    let goals = (story?.goals ?? []).filter((g) => g.ids.length);
    if (!goals.length && story?.criteria?.length) goals = [{ key: 'all', title: 'Success criteria', statement: 'Agreed with the team for this POV.', ids: story.criteria.map((x) => x.id) }];
    return goals.map((g) => ({ ...g, list: g.ids.filter((id) => crit[id]).map((id) => crit[id]) }));
  };
  const sGoals = () => {
    const goals = guideGoals();
    if (!goals.length) return;
    const s = add('content');
    head(s, 'Business Goals', `What ${C} set out to achieve:`, `${goals.length} goal${goals.length === 1 ? '' : 's'}, ${goals.reduce((n, g) => n + g.list.length, 0)} success criteria`);
    const cols = goals.length <= 3 ? goals.length : goals.length === 4 ? 2 : 3;
    const rows = Math.ceil(goals.length / cols);
    const gap = 0.22;
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = Math.min(2.5, (5.35 - gap * (rows - 1)) / rows);
    goals.slice(0, 9).forEach((g, i) => {
      const x = L + (i % cols) * (cw + gap);
      const y = 1.55 + Math.floor(i / cols) * (ch + gap);
      card(s, x, y, cw, ch, { line: VIOLET });
      s.addShape(pptx.ShapeType.roundRect, { x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5, rectRadius: 0.08, fill: { color: VIOLET }, line: { color: VIOLET, width: 0 } });
      s.addText(String(i + 1), { x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
      s.addText(`GOAL ${i + 1}`, { x: x + 0.85, y: y + 0.2, w: cw - 1.05, h: 0.22, fontFace: FONT, fontSize: 9, bold: true, color: ORANGE, charSpacing: 1, margin: 0 });
      s.addText(g.title, { x: x + 0.85, y: y + 0.42, w: cw - 1.05, h: 0.62, fontFace: FONT, fontSize: 13, bold: true, color: WHITE, margin: 0, valign: 'top', fit: 'shrink' });
      if (g.statement && ch > 1.6) s.addText(g.statement, { x: x + 0.2, y: y + 1.1, w: cw - 0.4, h: ch - 1.55, fontFace: FONT, fontSize: 10, color: MUTED, margin: 0, valign: 'top', fit: 'shrink' });
      const met = g.list.filter((x2) => ['done', 'demo'].includes(x2.state)).length;
      s.addText(`${g.list.length} success criteria${results ? `  ·  ${met} met` : ''}`, { x: x + 0.2, y: y + ch - 0.4, w: cw - 0.4, h: 0.25, fontFace: FONT, fontSize: 9.5, bold: true, color: results && met === g.list.length ? '3CCF8E' : 'C9B8FF', margin: 0 });
    });
  };
  const sGoalsPlan = () => {
    const goals = guideGoals();
    const rowH = (x) => Math.max(0.6, 0.2 + 0.165 * Math.max(Math.ceil(String(x.benefit || x.statement || '').length / 52), Math.ceil(String(x.test || '').length / 58), Math.ceil(String(x.title).length / 24) + 1));
    goals.forEach((g, gi) => {
      const pages = [];
      let cur = [];
      let h = 0;
      g.list.forEach((x, n) => {
        const rh = rowH(x);
        if (cur.length && h + rh > 4.15) {
          pages.push(cur);
          cur = [];
          h = 0;
        }
        cur.push([x, `${gi + 1}.${n + 1}`]);
        h += rh;
      });
      if (cur.length) pages.push(cur);
      pages.forEach((page, pi) => {
        const s = add('content');
        s.addText('Business goals and success criteria', { x: L, y: 0.3, w: 10, h: 0.55, fontFace: FONT, fontSize: 24, bold: true, color: WHITE, margin: 0 });
        s.addText([{ text: 'Each goal lists ', options: { color: WHITE } }, { text: 'what we test', options: { color: ORANGE } }, { text: ' and ', options: { color: WHITE } }, { text: `what ${C} gains`, options: { color: ORANGE } }], { x: L, y: 0.85, w: 10, h: 0.3, fontFace: FONT, fontSize: 13, margin: 0 });
        if (pages.length > 1) s.addText(`${pi + 1} of ${pages.length}`, { x: L + W - 2, y: 0.4, w: 2, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED, align: 'right', margin: 0 });
        card(s, L, 1.35, W, 0.95, { line: VIOLET });
        s.addShape(pptx.ShapeType.roundRect, { x: L + 0.2, y: 1.55, w: 0.55, h: 0.55, rectRadius: 0.08, fill: { color: VIOLET }, line: { color: VIOLET, width: 0 } });
        s.addText(String(gi + 1), { x: L + 0.2, y: 1.55, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        const meta = [`${g.list.length} success criteria`, g.driver && `Value driver: ${g.driver}`, g.measures?.length && `Measured by: ${g.measures.slice(0, 3).join('; ')}`].filter(Boolean).join('  ·  ');
        s.addText([{ text: g.title, options: { bold: true, fontSize: 14, color: WHITE, breakLine: true } }, ...(g.statement ? [{ text: g.statement, options: { fontSize: 10.5, color: 'E6E0F2', breakLine: true } }] : []), { text: meta, options: { fontSize: 9, color: MUTED } }], { x: L + 0.95, y: 1.38, w: W - 1.15, h: 0.9, fontFace: FONT, margin: 0, valign: 'middle', fit: 'shrink' });
        const H = (t, align = 'left') => ({ text: t, options: { bold: true, color: WHITE, fill: { color: '2B1A4A' }, fontSize: 9.5, align } });
        const rows = page.map(([x, num], i) => {
          const f = { fill: { color: i % 2 ? '1A0F2E' : PANEL } };
          const [lab, color] = STATE[x.state] ?? ['Planned', MUTED];
          const refs = String(x.refs ?? '').split(/[,;\s]+/).filter(Boolean);
          return [
            { text: [{ text: `${num}\n`, options: { bold: true, color: 'A98BFF', fontSize: 9.5 } }, { text: x.title, options: { bold: true, color: WHITE } }, ...(refs.length ? [{ text: `\nTracker: ${refs.map((r) => `#${r.replace(/^#/, '')}`).join(', ')}`, options: { color: MUTED, fontSize: 8.5 } }] : [])], options: { fontSize: 10.5, valign: 'top', ...f } },
            { text: x.test || '', options: { color: 'E6E0F2', fontSize: 9.5, valign: 'top', ...f } },
            { text: x.benefit || x.statement || '', options: { color: 'E6E0F2', fontSize: 9.5, valign: 'top', ...f } },
            { text: [...(x.milestone ? [{ text: `${x.milestone.replace(/M(\d)/g, 'Milestone $1')}\n`, options: { color: '6FB3FF', bold: true, fontSize: 9 } }] : []), { text: lab, options: { color, bold: true, fontSize: 9.5 } }], options: { align: 'center', valign: 'middle', ...f } },
          ];
        });
        s.addTable([[H('Criterion'), H('Test item'), H('Benefit'), H(results ? 'Milestone · result' : 'Milestone · status', 'center')], ...rows], { x: L, y: 2.5, w: W, colW: [2.9, 4.05, 3.68, 1.7], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: [0.34, ...page.map(([x]) => rowH(x))], autoPage: false, margin: [5, 8, 5, 8] });
      });
    });
  };

  // ——— What the POV changed (Analytics): six tiles in the main deck, the charts behind them in the appendix ———
  const sImpact = () => {
    const tiles = impactTiles(story?.analytics);
    if (!tiles.length) return;
    const s = add('content');
    head(s, 'What the POV Changed', 'From the Checkmarx One Analytics dashboard,', story.analytics.now.range === '90d' ? 'last 90 days' : 'last 30 days');
    const gap = 0.25;
    const tw = (W - gap * 2) / 3;
    const th = 2.35;
    tiles.forEach((t, i) => {
      const x = L + (i % 3) * (tw + gap);
      const y = 1.6 + Math.floor(i / 3) * (th + gap);
      card(s, x, y, tw, th, { line: i === 3 || i === 4 ? ORANGE : LINE });
      s.addText(t.value, { x: x + 0.2, y: y + 0.3, w: tw - 0.4, h: 0.95, fontFace: FONT, fontSize: 40, bold: true, color: i === 3 || i === 4 ? ORANGE : WHITE, align: 'center', valign: 'middle', margin: 0, fit: 'shrink' });
      s.addText(t.label.toUpperCase(), { x: x + 0.2, y: y + 1.35, w: tw - 0.4, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: 'C9B8FF', charSpacing: 1, align: 'center', margin: 0 });
      s.addText(t.sub, { x: x + 0.2, y: y + 1.7, w: tw - 0.4, h: 0.4, fontFace: FONT, fontSize: 10.5, color: MUTED, align: 'center', valign: 'top', margin: 0 });
    });
  };
  const sAnalyticsDetail = () => {
    const now = story?.analytics?.now;
    if (!now || (!now.mttrDays && !now.aging)) return;
    const start = story.analytics.start;
    const s = add('content');
    head(s, 'Fix Time and Ageing', 'Behind the numbers:', 'how fast findings are fixed, and how old the open ones are');
    const SEV = ['critical', 'high', 'medium'];
    const LAB = ['Critical', 'High', 'Medium'];
    const axis = { catAxisLabelFontSize: 10, catAxisLabelColor: 'E6E0F2', catAxisLabelFontFace: FONT, catAxisLineColor: '4A3670', valAxisLabelFontSize: 9, valAxisLabelColor: '8C82A3', valGridLine: { color: '3A2A57', size: 0.5 }, plotArea: { fill: { color: PANEL } }, chartArea: { fill: { color: PANEL } }, showLegend: true, legendPos: 'b', legendFontSize: 10, legendColor: 'E6E0F2', legendFontFace: FONT };
    const half = (W - 0.3) / 2;
    if (now.mttrDays) {
      card(s, L, 1.55, half, 5.25);
      label(s, 'Mean time to resolve, days', L + 0.2, 1.7, half - 0.4);
      const series = [{ name: 'Now', labels: LAB, values: SEV.map((k) => now.mttrDays[k] ?? 0) }];
      if (start?.mttrDays && SEV.some((k) => start.mttrDays[k] !== now.mttrDays[k])) series.unshift({ name: 'At the start', labels: LAB, values: SEV.map((k) => start.mttrDays[k] ?? 0) });
      s.addChart(pptx.charts.BAR, series, { x: L + 0.15, y: 2.1, w: half - 0.3, h: 4.55, barDir: 'col', chartColors: series.length > 1 ? ['6B5A8E', 'F25928'] : ['F25928'], showValue: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: 10, dataLabelPosition: 'outEnd', valAxisMinVal: 0, ...axis });
    }
    if (now.aging?.length) {
      const x = now.mttrDays ? L + half + 0.3 : L;
      const w = now.mttrDays ? half : W;
      card(s, x, 1.55, w, 5.25);
      label(s, 'Open findings by age', x + 0.2, 1.7, w - 0.4);
      const bands = now.aging.map((b) => b.label);
      s.addChart(pptx.charts.BAR, SEV.map((k, i) => ({ name: LAB[i], labels: bands, values: now.aging.map((b) => b[k] ?? 0) })), { x: x + 0.15, y: 2.1, w: w - 0.3, h: 4.55, barDir: 'col', barGrouping: 'stacked', chartColors: ['A98BFF', 'F25928', 'F5C518'], ...axis });
    }
  };

  const sTenant = () => {
  // Results: what the tenant showed, from proof to rollout, next steps
    const t = live?.summary ?? story?.tenant ?? null;
    if (t) {
      const s = add('content');
      head(s, 'What Checkmarx One Showed', 'In the POV tenant, as of', longDay(new Date().toISOString().slice(0, 10)));
      const tiles = [
        ['Projects', t.projects ?? '—'],
        ['Scans, last 7 days', t.scans7d ?? '—'],
        ['Fusion scans', t.fusion7d ?? 0],
        ['Critical + high open', t.findings ? (t.findings.critical ?? 0) + (t.findings.high ?? 0) : '—'],
        ['AI triage actions', t.credits?.actions?.triage ?? 0],
        ['AI remediation actions', t.credits?.actions?.remediation ?? 0],
      ];
      const tw = (W - 0.3) / 3;
      tiles.forEach(([k, v], i) => {
        const x = L + (i % 3) * (tw + 0.15);
        const y = 1.55 + Math.floor(i / 3) * 1.45;
        card(s, x, y, tw, 1.3);
        s.addText(String(v), { x: x + 0.25, y: y + 0.12, w: tw - 0.5, h: 0.75, fontFace: FONT, fontSize: 34, bold: true, color: WHITE, margin: 0, valign: 'middle' });
        s.addText(k.toUpperCase(), { x: x + 0.25, y: y + 0.88, w: tw - 0.5, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: MUTED, charSpacing: 2, margin: 0 });
      });
      label(s, 'Engines used', L, 4.6, 4);
      s.addText((t.engines ?? []).join(' · ') || '—', { x: L, y: 4.95, w: W / 2 - 0.2, h: 0.5, fontFace: FONT, fontSize: 12, color: WHITE, margin: 0, valign: 'top' });
      label(s, 'Scans came from', L + W / 2, 4.6, 4);
      s.addText((t.origins ?? []).map((o) => `${o.name} (${o.count})`).join(' · ') || '—', { x: L + W / 2, y: 4.95, w: W / 2, h: 0.5, fontFace: FONT, fontSize: 12, color: WHITE, margin: 0, valign: 'top' });
    }
  };

  const sExpansion = () => {
    const ex = story?.expansion;
    if (ex) {
      const s = add('content');
      head(s, 'From Proof to Rollout', 'What is proven, and what', 'comes next on the platform');
      card(s, L, 1.55, 6.0, 5.2);
      label(s, 'Proven in this POV', L + 0.25, 1.75, 5.5);
      s.addText(bullets((ex.proven.length ? ex.proven : ['Proven work appears here as criteria are met.']).slice(0, 8), { code: '2713', space: 6 }), { x: L + 0.25, y: 2.2, w: 5.5, h: 3.2, fontFace: FONT, fontSize: 11.5, valign: 'top', margin: 0, fit: 'shrink' });
      const figs = [[ex.projects, 'projects'], [ex.integrations.length || null, 'integrations'], [ex.people, 'people']].filter(([v]) => v != null);
      figs.forEach(([v, l], i) => {
        s.addText([{ text: String(v), options: { fontSize: 26, bold: true, color: WHITE, breakLine: true } }, { text: l.toUpperCase(), options: { fontSize: 9, bold: true, color: MUTED, charSpacing: 1 } }], { x: L + 0.25 + i * 1.8, y: 5.55, w: 1.7, h: 0.95, fontFace: FONT, margin: 0, valign: 'top' });
      });
      const nx = L + 6.3;
      label(s, 'Next on the platform', nx, 1.6, W - 6.3);
      ex.next.slice(0, 6).forEach((n, i) => {
        const y = 2.05 + i * 0.78;
        s.addShape(pptx.ShapeType.rect, { x: nx, y, w: 0.06, h: 0.62, fill: { color: VIOLET }, line: { color: VIOLET, width: 0 } });
        s.addText([{ text: n.name, options: { bold: true, color: WHITE, fontSize: 12 } }, ...(n.isNew ? [{ text: '  NEW', options: { bold: true, color: ORANGE, fontSize: 8.5 } }] : []), { text: `\n${[n.group, n.goal].filter(Boolean).join(' · ')}${n.benefit ? ` — ${String(n.benefit).slice(0, 120)}` : ''}`, options: { color: MUTED, fontSize: 9.5 } }], { x: nx + 0.2, y, w: W - 6.5, h: 0.66, fontFace: FONT, margin: 0, valign: 'top', fit: 'shrink' });
      });
    }
  };

  const sNext = () => {
    {
      const s = add('content');
      head(s, 'Next Steps', 'Together with', C);
      const steps = (opp.tasks ?? []).filter((x) => !x.done).map((x) => x.title);
      const list = (steps.length ? steps : ['Agree the rollout plan and the first teams', 'Confirm the commercial proposal', 'Schedule the onboarding']).slice(0, 6);
      list.forEach((t, i) => {
        const y = 1.6 + i * 0.85;
        card(s, L, y, W, 0.7);
        s.addShape(pptx.ShapeType.ellipse, { x: L + 0.2, y: y + 0.15, w: 0.4, h: 0.4, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        s.addText(String(i + 1), { x: L + 0.2, y: y + 0.15, w: 0.4, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        s.addText(t, { x: L + 0.8, y, w: W - 1.0, h: 0.7, fontFace: FONT, fontSize: 14, color: WHITE, margin: 0, valign: 'middle' });
      });
    }
  };

  const sClosing = () => {
  // Closing, then the appendix: the notes of each meeting held
  kinds.push('closing');
  if (!templated) {
    const s = pptx.addSlide();
    s.background = { color: BG };
    s.addText([{ text: 'Secure what ', options: { color: WHITE } }, { text: 'comes next.', options: { color: ORANGE } }], { x: 0.8, y: 3.0, w: 11, h: 1.4, fontFace: FONT, fontSize: 54, margin: 0 });
  } else pptx.addSlide(); // replaced by the template's own closing slide
  };

  const sNotes = () => {
  const held = [...(opp.sessions ?? [])].filter((m) => statusOf(m) === 'done' && (m.did || m.notes || m.theirNext || m.ourNext)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (held.length) {
    for (const m of held) {
      const n = add('notes');
      n.addText([{ text: 'Meeting Notes', options: { bold: true, color: WHITE, fontSize: 26 } }, { text: `   ${longDay(m.date)}`, options: { color: ORANGE, fontSize: 15 } }], { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontFace: FONT, margin: 0, valign: 'middle' });
      n.addText(m.title || SESSION_TYPES[m.type] || '', { x: 0.5, y: 0.88, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 12, color: MUTED, margin: 0 });
      if (!templated) n.addShape(pptx.ShapeType.roundRect, { x: 0.63, y: 1.37, w: 12.03, h: 5.58, rectRadius: 0.08, fill: { color: PANEL }, line: { color: LINE, width: 0.75 } });
      const did = lines(m.did || m.notes);
      const theirs = lines(m.theirNext);
      const ours = lines(m.ourNext || m.followUps);
      const head2 = (t, x, y, w) => {
        n.addShape(pptx.ShapeType.rect, { x, y: y + 0.06, w: 0.05, h: 0.22, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        n.addText(t, { x: x + 0.15, y, w: w - 0.15, h: 0.34, fontFace: FONT, fontSize: 14, bold: true, color: WHITE, margin: 0, valign: 'middle' });
      };
      const two = theirs.length || ours.length;
      const lw = two ? 6.6 : 11.4;
      head2('What we did', 0.95, 1.65, lw);
      n.addText(bullets(did.length ? did : ['—'], { code: '25B8', space: 7 }), { x: 0.95, y: 2.1, w: lw, h: 4.6, fontFace: FONT, fontSize: 12, color: WHITE, valign: 'top', margin: 0, fit: 'shrink' });
      if (two) {
        n.addShape(pptx.ShapeType.line, { x: 7.85, y: 1.7, w: 0, h: 5.0, line: { color: LINE, width: 0.75 } });
        let y = 1.65;
        for (const [t, list] of [[`Next steps from ${C}`, theirs], ['From the Checkmarx side', ours]]) {
          if (!list.length) continue;
          head2(t, 8.1, y, 4.3);
          const h = Math.min(2.2, 0.3 + list.length * 0.42);
          n.addText(bullets(list, { code: '25B8', space: 6 }), { x: 8.1, y: y + 0.45, w: 4.3, h, fontFace: FONT, fontSize: 11.5, color: WHITE, valign: 'top', margin: 0, fit: 'shrink' });
          y += 0.45 + h + 0.3;
        }
      }
    }
  }
  };

  // Your challenges, answered: what the customer told us, against what the POV proved, and what it is worth
  const sChallenges = () => {
    const s = add('content');
    head(s, 'Your Challenges, Answered', `What ${C} told us, and`, 'what the POV proved');
    const said = [opp.discovery?.painPoints, ...(opp.sessions ?? []).filter((m) => m.type === 'first_call').map((m) => m.notes)]
      .join('\n')
      .split(/\n|;|(?<=\.)\s+/)
      .map((x) => x.replace(/^\s*[-*•]\s*/, '').trim().replace(/\.$/, ''))
      .filter((x) => x.length > 3);
    const pains = [...new Set(said)].slice(0, 5);
    const goals = (story?.goals ?? []).filter((g) => g.key !== 'other').slice(0, 5);
    const crit = Object.fromEntries((story?.criteria ?? []).map((x) => [x.id, x]));
    // Left: their words. Right: each business goal, how far the POV took it, and what was proven for it.
    card(s, L, 1.55, 4.5, 3.9);
    label(s, 'What you told us', L + 0.25, 1.75, 4);
    s.addText(bullets(pains.length ? pains : goals.map((g) => g.statement || g.title).slice(0, 4), { code: '201C', space: 8 }), { x: L + 0.25, y: 2.2, w: 4.0, h: 3.1, fontFace: FONT, fontSize: 12, italic: true, valign: 'top', margin: 0, fit: 'shrink' });
    const gx = L + 4.75;
    const gw = W - 4.75;
    label(s, 'What the POV proved', gx, 1.6, gw);
    const each = Math.min(0.78, 3.7 / Math.max(1, goals.length));
    goals.forEach((g, i) => {
      const y = 2.0 + i * each;
      const frac = g.total ? g.done / g.total : 0;
      const proved = g.ids.map((id) => crit[id]).filter((x) => x && ['done', 'demo'].includes(x.state)).map((x) => x.title);
      s.addText(g.title, { x: gx, y, w: gw - 1.8, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: WHITE, margin: 0, valign: 'middle', fit: 'shrink' });
      s.addShape(pptx.ShapeType.roundRect, { x: gx + gw - 1.7, y: y + 0.08, w: 1.15, h: 0.14, rectRadius: 0.07, fill: { color: '2E1D4A' }, line: { color: '2E1D4A', width: 0 } });
      if (frac) s.addShape(pptx.ShapeType.roundRect, { x: gx + gw - 1.7, y: y + 0.08, w: Math.max(0.14, 1.15 * frac), h: 0.14, rectRadius: 0.07, fill: { color: frac === 1 ? '3CCF8E' : ORANGE }, line: { color: frac === 1 ? '3CCF8E' : ORANGE, width: 0 } });
      s.addText(`${g.done}/${g.total}`, { x: gx + gw - 0.5, y, w: 0.5, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: WHITE, align: 'right', margin: 0, valign: 'middle' });
      s.addText(proved.length ? `Proven: ${proved.slice(0, 3).join(' · ')}${proved.length > 3 ? ` +${proved.length - 3}` : ''}` : 'To be proven in the remaining sessions', { x: gx, y: y + 0.3, w: gw, h: 0.3, fontFace: FONT, fontSize: 9.5, color: proved.length ? '3CCF8E' : MUTED, margin: 0, valign: 'top', fit: 'shrink' });
    });
    // The value, in a strip along the bottom
    const p = story?.progress ?? { met: 0, total: 0, must: 0, mustMet: 0 };
    const v = story?.value;
    const tiles = [
      [`${p.met}/${p.total}`, 'success criteria met'],
      [`${p.mustMet}/${p.must}`, 'must-haves met'],
      [v?.hours?.total ? `${Math.round(v.hours.total)} h` : '—', 'saved by AI'],
      [v?.value ? new Intl.NumberFormat('en', { style: 'currency', currency: v.rates?.currency || 'USD', maximumFractionDigits: 0 }).format(v.value) : '—', 'worth of that time'],
    ];
    const tw = (W - 0.45) / 4;
    tiles.forEach(([val, l], i) => {
      const x = L + i * (tw + 0.15);
      card(s, x, 5.7, tw, 1.05);
      s.addText([{ text: val, options: { fontSize: 24, bold: true, color: WHITE, breakLine: true } }, { text: l.toUpperCase(), options: { fontSize: 9, bold: true, color: MUTED, charSpacing: 1 } }], { x: x + 0.2, y: 5.75, w: tw - 0.4, h: 0.95, fontFace: FONT, margin: 0, valign: 'middle' });
    });
  };

  // The evidence behind each criterion (appendix): what proved it, the proving scans, when it was confirmed
  const sEvidence = () => {
    const list = story?.criteria ?? [];
    if (!list.length) return;
    const STATE_TXT = Object.fromEntries(Object.entries(STATE).map(([k, [lab]]) => [k, lab]));
    const evidence = (x) => {
      const parts = [];
      if (x.evidence?.level === 'detected') parts.push(...x.evidence.evidence);
      if (x.demo) parts.push(`Demonstrated by ${x.demo.by || 'the SE'}${x.demo.at ? ` on ${longDay(String(x.demo.at).slice(0, 10))}` : ''}`);
      if (x.notes) parts.push(x.notes);
      if (x.evidenceLink) parts.push(x.evidenceLink);
      return parts.join(' · ') || '—';
    };
    const scans = (x) => (x.scans?.length ? `${x.scans.length} scan${x.scans.length > 1 ? 's' : ''}; latest ${x.scans[0].project ?? ''}${x.scans[0].branch ? ` (${x.scans[0].branch})` : ''}, ${longDay(String(x.scans[0].at ?? '').slice(0, 10))}` : '—');
    const H = (t) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: ORANGE }, fontSize: 10 } });
    for (let i = 0; i < list.length; i += 8) {
      const s = add('table');
      head(s, 'Evidence', `Every success criterion and what proves it${list.length > 8 ? ` · ${i / 8 + 1} of ${Math.ceil(list.length / 8)}` : ''}`, '');
      const rows = list.slice(i, i + 8).map((x, k) => {
        const f = { fill: { color: k % 2 ? '1A0F2E' : PANEL } };
        const [, color] = STATE[x.state] ?? ['', MUTED];
        return [
          { text: x.title, options: { bold: true, color: WHITE, fontSize: 10, ...f } },
          { text: STATE_TXT[x.state] ?? '—', options: { bold: true, color, fontSize: 10, ...f } },
          { text: evidence(x).slice(0, 260), options: { color: 'E6E0F2', fontSize: 9, ...f } },
          { text: scans(x), options: { color: 'E6E0F2', fontSize: 9, ...f } },
          { text: x.confirmedAt ? longDay(String(x.confirmedAt).slice(0, 10)) : '—', options: { color: MUTED, fontSize: 9, ...f } },
        ];
      });
      s.addTable([[H('Criteria'), H('Result'), H('Evidence'), H('Proving scans'), H('Confirmed')], ...rows], { x: L, y: 1.5, w: W, colW: [2.6, 1.3, 4.4, 2.6, 1.43], fontFace: FONT, border: { type: 'solid', color: LINE, pt: 0.5 }, rowH: 0.6, valign: 'middle', autoPage: false, margin: [3, 6, 3, 6] });
    }
  };

  const sAppendix = () => {
    const s = add('section');
    s.addText('Appendix', { x: 0.8, y: 3.1, w: 11, h: 1, fontFace: FONT, fontSize: 44, bold: true, color: WHITE, margin: 0 });
  };

  // ——— The order: the WIP deck is the working document; the results deck is a short story, the detail behind it ———
  const heldNotes = (opp.sessions ?? []).some((m) => statusOf(m) === 'done' && (m.did || m.notes || m.theirNext || m.ourNext));
  // The order comes from the presentation template: its main deck, then its appendix. A Meridian variant that would
  // repeat its template version exactly (no team design for it) is left out.
  const plan = layout?.[results ? 'results' : 'wip'] ?? DEFAULT_LAYOUT[results ? 'results' : 'wip'];
  const usedKeys = new Set([...plan.main, ...plan.appendix]);
  const same = { devsecopsFull: ['devsecops', !tinfo?.devsecops], planFull: ['plan', !use.plan], envFull: ['env', !use.env], testsFull: ['tests', !use.test] };
  const MAKE = {
    cover: sCover,
    age: sAge,
    devsecops: () => sDevSecOps(true),
    devsecopsFull: () => sDevSecOps(false),
    components: sPlatform,
    plan: () => sPlan(true),
    planFull: () => sPlan(false),
    env: () => sEnv(true),
    envFull: () => sEnv(false),
    tests: () => sTests(true),
    testsFull: () => sTests(false),
    closing: sClosing,
    overview: sOverview,
    challenges: sChallenges,
    glance: sGlance,
    expansion: sExpansion,
    next: sNext,
    apma: sApma,
    tenant: sTenant,
    evidence: sEvidence,
    notes: () => heldNotes && sNotes(),
    goals: sGoals,
    goalsPlan: sGoalsPlan,
    impact: sImpact,
    analyticsDetail: sAnalyticsDetail,
  };
  const keep = (k) => MAKE[k] && !(same[k] && same[k][1] && usedKeys.has(same[k][0]));
  const appendix = plan.appendix.filter(keep);
  const order = [...plan.main.filter(keep).map((k) => MAKE[k]), ...(appendix.length ? [sAppendix, ...appendix.map((k) => MAKE[k])] : [])];
  for (const make of order) make();

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
  // Ordinary slides take a plain layout: the Executive Overview's or the Environment Details' when the template has
  // one, else the least busy layout among its slides (never one that draws a whole diagram, like the toolchain).
  // Every layout in the file (unused ones too: templates often carry a clean "Title & Content" no slide uses).
  const busy = {};
  const layoutName = {};
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    const lx = await zip.file(f).async('string');
    const name = f.split('/').pop();
    layoutName[name] = /<p:cSld name="([^"]*)"/.exec(lx)?.[1] ?? '';
    // Text, pictures, and above all lines (a divider would cut through Meridian's tables) make a layout busy.
    busy[name] = (lx.match(/<a:t>/g) ?? []).length + (lx.match(/<p:pic>/g) ?? []).length + 50 * (lx.match(/<p:cxnSp>|prst="line"/g) ?? []).length;
  }
  const closingSlide = [...slides].reverse().find((sl) => /Secure\s+what\s+comes\s+next/i.test(sl.text));
  const avoid = new Set([slides[0]?.layout, closingSlide?.layout].filter(Boolean));
  const plain = Object.keys(busy).filter((n) => !avoid.has(n) && !/closing|title \d+ dark|cover/i.test(layoutName[n])).sort((a, b) => busy[a] - busy[b])[0];
  const named = find(/Executive Overview|Environment Details/i)?.layout;
  const content = (named && busy[named] < 50 ? named : null) ?? plain ?? slides[1]?.layout ?? slides[0]?.layout;
  return {
    pres,
    presRels,
    slides,
    cx: Number(/<p:sldSz[^>]*cx="(\d+)"/.exec(pres)?.[1]) || EMU_WIDE,
    layouts: {
      cover: slides[0]?.layout ?? content,
      content,
      // Tables go on the plain layout too: a template's test-plan layout often draws its own header row or arrows.
      table: content,
      section: slides.find((s) => /^\s*Appendix\s*$/i.test(s.text))?.layout ?? content,
      notes: find(/Meeting Notes/i)?.layout ?? content,
    },
    closing: [...slides].reverse().find((s) => /Secure\s+what\s+comes\s+next/i.test(s.text)) ?? null,
    // The template's own toolchain and platform slides (logos and icons), reused with this POV's items boxed
    devsecops: find(/Tailored\s+to\s+Your\s+DevSecOps/i) ?? null,
    components: find(/Components\s+of\s+the\s+platform/i) ?? null,
    // Slides Meridian fills with the POV's data, used only in the shape the filler knows.
    cover: slides[0] && /customer\s*name/i.test(slides[0].text) ? slides[0] : null,
    plan: (() => {
      const sl = find(/POV\s+Plan/i);
      const runs = sl ? [...sl.xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]) : [];
      return sl && runs.length === 31 && runs[28] === 'Scope' && runs[30] === 'Success' ? sl : null;
    })(),
    env: (() => {
      const sl = find(/Environment\s+Details/i);
      return sl && (sl.xml.match(/<a:tbl>/g) ?? []).length >= 2 ? sl : null;
    })(),
    test: (() => {
      const sl = find(/Test\s+Plan\s+Overview/i);
      const tr = sl && /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/.exec(sl.xml)?.[0];
      const cells = tr ? (tr.match(/<a:tc\b/g) ?? []).length : 0;
      return sl && cells === 3 && !/criteria|success criterion/i.test(tr.replace(/<[^>]+>/g, '')) ? sl : null;
    })(),
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
    const k = typeof kinds[i] === 'string' ? { kind: kinds[i] } : kinds[i] ?? { kind: 'content' };
    const kind = k.kind;
    const reuse = k.reuse ? t[k.reuse] : null;
    if (kind === 'closing' && !closingXml) continue;
    n += 1;
    let xml;
    let rels;
    if (kind === 'closing' && closingXml) {
      xml = closingXml;
      rels = closingRels;
    } else if (reuse) {
      // The template's slide as designed, with orange boxes around what this POV uses.
      const layoutXml = (await zip.file(`ppt/slideLayouts/${reuse.layout}`)?.async('string')) ?? '';
      const boxes = k.marks ? markShapes([...textShapes(layoutXml), ...textShapes(reuse.xml)], k.marks) : '';
      const FILL = { cover: fillCover, plan: fillPlan, env: fillEnvironment, test: fillTestPlan };
      const source = k.fill ? FILL[k.reuse](reuse.xml, k.fill) : reuse.xml;
      // The template's example highlights (outlined boxes with no text) go: Meridian draws this POV's own.
      const clean = source.replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<\/p:sp>/g, (sp) => (!/<a:t>/.test(sp) && /prst="roundRect"/.test(sp) && /<a:ln\b/.test(sp) && !/<a:solidFill>(?:(?!<\/a:solidFill>)[\s\S])*<\/a:solidFill>\s*<a:ln/.test(sp) ? '' : sp));
      xml = clean.replace('</p:spTree>', `${boxes}</p:spTree>`);
      rels = reuse.rels.replace(/<Relationship\b[^>]*(notesSlide|comments|commentAuthors|tags)[^>]*\/>/g, '');
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
  // (Files only: removing the folder entry a pptxgenjs file carries would take every picture with it.)
  for (const name of Object.keys(zip.files)) if (/^ppt\/media\/[^/]+$/.test(name) && !used.has(name.split('/').pop())) zip.remove(name);
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

// ——— Marking what is in the POV on the template's own slides ———
// The team template draws the toolchain and the platform components itself (logos, icons). Rather than redraw them,
// Meridian keeps that slide and boxes what this POV uses, in orange, the way SEs mark it by hand.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = { openai: ['chatgpt'], azurepipelines: ['azuredevops'], azurerepos: ['azuredevops'], jira: ['jira'], dockerhub: ['dockerhu'], anthropicclaude: ['claude', 'anthropic'], awskiro: ['kiro'], gitlabcicd: ['gitlabci'], developerassistagent: ['developerassistagent'] };
const matches = (label, want) => {
  const a = norm(label);
  const b = norm(want);
  if (!a || !b) return false;
  // The same name, its plural, or a known other name; never a prefix ("GitHub" is not "GitHub Copilot").
  return a === b || a === `${b}s` || b === `${a}s` || (ALIAS[b] ?? []).includes(a);
};

/**
 * Every text shape of a slide or layout with its text and its box in slide coordinates (EMU), groups resolved.
 */
export function textShapes(xml) {
  const out = [];
  const tf = [{ ox: 0, oy: 0, cx: 0, cy: 0, sx: 1, sy: 1 }];
  const re = /<p:grpSp>|<\/p:grpSp>|<p:sp>[\s\S]*?<\/p:sp>|<p:pic>[\s\S]*?<\/p:pic>/g;
  let m;
  const apply = (t, x, y) => [t.ox + (x - t.cx) * t.sx, t.oy + (y - t.cy) * t.sy];
  while ((m = re.exec(xml))) {
    if (m[0] === '<p:grpSp>') {
      const head = xml.slice(m.index, xml.indexOf('</p:grpSpPr>', m.index));
      const n = (k) => Number(new RegExp(`<a:${k} (?:x|cx)="(-?\\d+)" (?:y|cy)="(-?\\d+)"`).exec(head)?.slice(1) ?? NaN);
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(head);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(head);
      const choff = /<a:chOff x="(-?\d+)" y="(-?\d+)"/.exec(head);
      const chext = /<a:chExt cx="(\d+)" cy="(\d+)"/.exec(head);
      const parent = tf.at(-1);
      if (off && ext && choff && chext) {
        const [ox, oy] = apply(parent, Number(off[1]), Number(off[2]));
        tf.push({ ox, oy, cx: Number(choff[1]), cy: Number(choff[2]), sx: parent.sx * (Number(ext[1]) / Math.max(1, Number(chext[1]))), sy: parent.sy * (Number(ext[2]) / Math.max(1, Number(chext[2]))) });
      } else tf.push(parent);
      void n;
      continue;
    }
    if (m[0] === '</p:grpSp>') {
      if (tf.length > 1) tf.pop();
      continue;
    }
    const sp = m[0];
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/.exec(sp);
    if (!off) continue;
    const t = tf.at(-1);
    const [x, y] = apply(t, Number(off[1]), Number(off[2]));
    const box = { x, y, w: Number(off[3]) * t.sx, h: Number(off[4]) * t.sy };
    if (sp.startsWith('<p:pic>')) {
      out.push({ pic: true, text: '', ...box });
      continue;
    }
    const text = [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x2) => x2[1]).join('').replace(/&amp;/g, '&').trim();
    if (!text) continue;
    const sz = Number(/<a:(?:rPr|defRPr|endParaRPr)\b[^>]*\bsz="(\d+)"/.exec(sp)?.[1]) || 1200;
    const align = /<a:pPr\b[^>]*algn="ctr"/.test(sp) ? 'ctr' : /<a:pPr\b[^>]*algn="r"/.test(sp) ? 'r' : 'l';
    const ins = Number(/<a:bodyPr\b[^>]*lIns="(\d+)"/.exec(sp)?.[1] ?? 91440) * t.sx;
    out.push({ text, sz: (sz / 100) * Math.min(t.sx, t.sy), align, ins, ...box });
  }
  return out;
}

/**
 * Orange boxes, as slide shapes, around what this POV uses: each wraps the item's own icon (the picture just left of
 * its name, on the same row) and the width of its words (from the text's size and alignment, not its text frame), with
 * the same padding everywhere, so boxes never run into their neighbours.
 */
export function markShapes(shapes, names, { id = 9000 } = {}) {
  const pics = shapes.filter((p) => p.pic);
  const texts = shapes.filter((s) => !s.pic && s.text.length <= 60 && names.some((n) => matches(s.text, n)));
  const EMU_PT = 12700;
  return texts
    .map((s, i) => {
      // Arial-like text: about half an em per character, a little more for capitals.
      const em = s.sz * EMU_PT;
      const words = [...s.text].reduce((n, ch) => n + (/[A-Z]/.test(ch) ? 0.64 : /[ il.,']/.test(ch) ? 0.3 : 0.52), 0) * em;
      const inner = Math.max(0, s.w - 2 * s.ins);
      const textW = Math.min(words, inner);
      const tx = s.x + s.ins + (s.align === 'ctr' ? (inner - textW) / 2 : s.align === 'r' ? inner - textW : 0);
      const lineH = em * 1.25;
      const ty = s.y + Math.max(0, (s.h - lineH) / 2);
      const midY = ty + lineH / 2;
      const icon = pics
        .filter((p) => Math.abs(p.y + p.h / 2 - midY) < Math.max(p.h, lineH) * 0.6 && p.x + p.w <= tx + 30000 && tx - (p.x + p.w) < 520000 && p.w < 700000)
        .sort((a2, b2) => b2.x + b2.w - (a2.x + a2.w))[0];
      const pad = Math.round(em * 0.35);
      const left = Math.round((icon ? icon.x : tx) - pad);
      const top = Math.round(Math.min(ty, icon ? icon.y : ty) - pad * 0.6);
      const bottom = Math.round(Math.max(ty + lineH, icon ? icon.y + icon.h : 0) + pad * 0.6);
      const right = Math.round(tx + textW + pad);
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id + i}" name="Meridian: in this POV"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${left}" y="${top}"/><a:ext cx="${right - left}" cy="${bottom - top}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 22000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="F25928"><a:alpha val="12000"/></a:srgbClr></a:solidFill><a:ln w="15875"><a:solidFill><a:srgbClr val="F25928"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
    })
    .join('');
}

/** Template labels for the catalogue's engines (the platform components slide). */
export const COMPONENT_LABELS = {
  sast: ['SAST'], fusion: ['SAST'], last: ['SAST'], secrets: ['Secrets Detection'], iac: ['IaC Security'], apisec: ['API Security'],
  sca: ['SCA'], containers: ['Container Security'], malicious: ['Malicious Packages'], scorecard: ['Repository Health'], sbom: ['SCA'],
  aisc: ['AI Supply Chain'], 'mcp-scanner': ['AI Supply Chain'], 'llm-scanner': ['AI Supply Chain'], 'skills-scanner': ['AI Supply Chain'],
  dast: ['DAST'], 'dast-ai': ['DAST'], 'dev-assist': ['Developer Assist Agent', 'Developer Assist'], 'ai-triage': ['Triage Agent'], 'ai-remediation': ['Remediation Agent'],
  'risk-orchestration': ['Application Security Posture Management'], arm: ['Application Security Posture Management'], 'cloud-insights': ['Cloud Insights'], analytics: ['Unified dashboard & reporting'], policy: ['Application Security Posture Management'], mcp: ['Developer Assist Agent'],
};
