/**
 * The team template's own slides, filled with a POV's data so its design stays exactly as made: every picture, icon,
 * shape, colour and font of the slide is kept, and only the words change. Unlike src/template-fill.js (which knows one
 * exact shape of each slide), these read what a slide is made of: its text boxes by what they say and where they sit.
 *
 *   cover      the people, the date, "Guide" or "Results", and the customer's name in place of the example's logo
 *   overview   the letter: greeting, paragraphs and closing line, each in the template's own paragraph style
 *   plan       Scope, Support and Success, and the timeline: one milestone per meeting (unused ones go)
 *   test       BG badge, the goal and its statement, one table row per success criterion
 *   notes      a meeting's date, and its headings and items in the template's styles
 *   shot       a screenshot slide: its title and its picture
 *   section    a divider (Appendix, Screenshots from POV) as it is
 */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (v) => String(v ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const textOf = (x) => unesc([...String(x).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).replace(/ /g, ' ');
const RPR = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/;
const PPR = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_NAMES = MONTHS;

/** The top-level drawing elements of a slide, with name, text and box (EMU). */
export function shapesOf(xml) {
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(xml)?.[1] ?? '';
  const out = [];
  let i = 0;
  const tags = ['p:sp', 'p:grpSp', 'p:pic', 'p:graphicFrame', 'p:cxnSp'];
  while (i < tree.length) {
    const next = tags.map((t) => [t, tree.indexOf(`<${t}>`, i)]).filter(([, p]) => p >= 0).sort((a, b) => a[1] - b[1])[0];
    if (!next) break;
    const [tag, start] = next;
    // Find the matching close tag, counting nested ones of the same name.
    let depth = 0;
    let j = start;
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    while (j < tree.length) {
      const o = tree.indexOf(open, j);
      const c = tree.indexOf(close, j);
      if (c < 0) break;
      if (o >= 0 && o < c) {
        depth += 1;
        j = o + open.length;
      } else {
        depth -= 1;
        j = c + close.length;
        if (depth === 0) break;
      }
    }
    const x = tree.slice(start, j);
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(x);
    out.push({ tag, xml: x, name: /<p:cNvPr\b[^>]*name="([^"]*)"/.exec(x)?.[1] ?? '', text: textOf(x).trim(), paras: [...x.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]), x: off ? +off[1] : 0, y: off ? +off[2] : 0, w: off ? +off[3] : 0, h: off ? +off[4] : 0 });
    i = j;
  }
  return out;
}
const cx = (s) => s.x + s.w / 2;
const cy = (s) => s.y + s.h / 2;

/** One paragraph in the style of `like` (its paragraph settings and its first, or its n-th, run). */
function para(like, segs) {
  const pPr = PPR.exec(like)?.[0] ?? '';
  const runs = [...like.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((m) => RPR.exec(m[1])?.[0] ?? '<a:rPr lang="en-US"/>');
  const base = runs[0] ?? RPR.exec(like)?.[0] ?? '<a:rPr lang="en-US"/>';
  const end = /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[^>]*>[\s\S]*?<\/a:endParaRPr>/.exec(like)?.[0] ?? '';
  const body = segs.map((s) => {
    let r = (s.style != null ? runs[s.style] : null) ?? base;
    if (s.bold === true) r = /\bb="/.test(r) ? r.replace(/\bb="0"/, 'b="1"') : r.replace(/<a:rPr\b/, '<a:rPr b="1"');
    if (s.bold === false) r = r.replace(/\bb="1"/, 'b="0"');
    if (s.color) {
      r = r.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, '');
      r = r.endsWith('/>') ? r.replace(/\/>$/, `><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:rPr>`) : r.replace(/(<a:rPr\b[^>]*>)/, `$1<a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>`);
    }
    if (s.size) r = /\bsz="/.test(r) ? r.replace(/\bsz="\d+"/, `sz="${s.size}"`) : r.replace(/<a:rPr\b/, `<a:rPr sz="${s.size}"`);
    return `<a:r>${r}<a:t>${esc(s.text)}</a:t></a:r>`;
  });
  return `<a:p>${pPr}${body.join('')}${end}</a:p>`;
}
/** A text shape with new paragraphs (built with `para`), its box and body settings kept. */
function withParas(spXml, paras) {
  const first = spXml.indexOf('<a:p>');
  const last = spXml.lastIndexOf('</a:p>');
  if (first < 0 || last < 0) return spXml;
  return spXml.slice(0, first) + paras.join('') + spXml.slice(last + 6);
}
/** Let PowerPoint shrink a box's text to fit, as its "Shrink text on overflow". */
const shrinkToFit = (spXml) => spXml.replace(/<a:bodyPr\b([^>]*)\/>/, '<a:bodyPr$1><a:normAutofit/></a:bodyPr>').replace(/<a:bodyPr\b([^>]*)>(?![\s\S]*?<a:normAutofit)([\s\S]*?)<\/a:bodyPr>/, (all, attrs, inner) => (/<a:(norm|sp)Autofit|<a:noAutofit/.test(inner) ? all.replace(/<a:noAutofit\/>|<a:spAutoFit\/>/, '<a:normAutofit/>') : `<a:bodyPr${attrs}>${inner}<a:normAutofit/></a:bodyPr>`));
const replaceShape = (xml, s, next) => xml.replace(s.xml, next);
const removeShape = (xml, s) => xml.replace(s.xml, '');
const splitLead = (line) => {
  const m = /^([^:]{2,42}):\s+(.+)$/.exec(line);
  return m ? [{ text: `${m[1]}: `, bold: true }, { text: m[2], bold: false }] : [{ text: line, bold: false }];
};
const STATUS = { done: ['Completed', null], demo: ['Demonstrated', null], progress: ['In progress', 'F5A524'], planned: ['Planned', 'F5C518'], missed: ['Not met', '8A8197'] };

// ——— Cover ———
export function fillCoverSlide(xml, { customer, results, people = [], date = '' }) {
  let out = xml;
  const shapes = shapesOf(out);
  const ppl = shapes.find((s) => s.tag === 'p:sp' && s.paras.some((p) => / \| /.test(textOf(p))));
  if (ppl && people.length) {
    const like = ppl.paras.find((p) => / \| /.test(textOf(p)));
    out = replaceShape(out, ppl, withParas(ppl.xml, people.map((p) => para(like, [{ text: `${p.name}${p.title ? ` | ${p.title}` : ''}` }]))));
  }
  const dt = shapes.find((s) => s.tag === 'p:sp' && /^\d{1,2}(st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}$/.test(s.text.replace(/\s+/g, ' ')));
  if (dt && date) out = replaceShape(out, dt, withParas(dt.xml, [para(dt.paras.find((p) => textOf(p).trim()) ?? dt.paras[0], [{ text: date }])]));
  if (results) out = out.replace(/(Proof of Value )Guide/, '$1Results');
  // The example's customer logo (the picture on the left, above the title) becomes this customer's name.
  const title = shapes.find((s) => /Proof of Value/i.test(s.text));
  const logo = shapes.filter((s) => s.tag === 'p:pic' && title && s.x < title.x + title.w && s.y < title.y).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (logo && customer) {
    const tRun = title.paras.map((p) => RPR.exec(p)?.[0]).find(Boolean) ?? '<a:rPr lang="en-US"/>';
    let r = tRun.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, '').replace(/\bsz="\d+"/, '').replace(/\bb="\d"/, '');
    r = r.endsWith('/>') ? r.replace(/<a:rPr\b/, '<a:rPr sz="3600" b="1"').replace(/\/>$/, '><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>') : r.replace(/<a:rPr\b([^>]*)>/, '<a:rPr$1 sz="3600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
    // The name sits where the logo's lettering was: the lower part of the picture, just above the title.
    const h = Math.round(Math.min(logo.h * 0.3, 900000));
    const y = Math.max(logo.y, title.y - h - 60000);
    const box = `<p:sp><p:nvSpPr><p:cNvPr id="8801" name="Kendra: customer"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${title.x}" y="${y}"/><a:ext cx="${Math.max(title.w, logo.w)}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l" rtl="0"/><a:r>${r}<a:t>${esc(String(customer).toUpperCase())}</a:t></a:r></a:p></p:txBody></p:sp>`;
    out = out.replace(logo.xml, box);
  }
  return out;
}

// ——— Executive overview ———
export function fillOverviewSlide(xml, { customer, letter = [], quote = '' }) {
  const shapes = shapesOf(xml);
  const body = shapes.find((s) => s.tag === 'p:sp' && /^\s*Dear\b/.test(textOf(s.paras[0] ?? '')));
  if (!body) return xml;
  const paras = body.paras.filter((p) => textOf(p).trim());
  const greet = paras[0];
  const bodyLike = paras[1] ?? greet;
  const quoteLike = paras.length > 2 && /^[“"]/.test(textOf(paras.at(-1)).trim()) ? paras.at(-1) : null;
  const next = [para(greet, [{ text: `Dear ${customer} Team,` }]), ...letter.map((t) => para(bodyLike, [{ text: t.trim() }]))];
  if (quoteLike && quote) next.push(para(quoteLike, [{ text: quote }]));
  return replaceShape(xml, body, shrinkToFit(withParas(body.xml, next)));
}

// ——— POV plan & timeline ———
export function fillPlanSlide(xml, { customer, scope = [], support = [], success = [], milestones = [] }) {
  let out = xml;
  const shapes = shapesOf(out);
  const focus = shapes.find((s) => /^Focus on\b/i.test(s.text));
  if (focus) out = replaceShape(out, focus, withParas(focus.xml, [para(focus.paras.find((p) => textOf(p).trim()), [{ text: `Focus on ${customer} goals` }])]));
  // Scope, Support, Success: the three boxes of bullet lines, left to right.
  const lists = shapes.filter((s) => s.tag === 'p:sp' && s.paras.filter((p) => textOf(p).trim()).length >= 2 && !/Meeting|Plan/.test(s.text)).sort((a, b) => a.x - b.x).slice(0, 3);
  [scope, support, success].forEach((items, i) => {
    const s = lists[i];
    if (!s || !items.length) return;
    const like = s.paras.find((p) => textOf(p).trim());
    out = replaceShape(out, s, shrinkToFit(withParas(s.xml, items.slice(0, 5).map((t) => para(like, [{ text: t }])))));
  });
  // The timeline: a column per month label, with its day, its meeting and its status near it.
  const all = shapesOf(out);
  const cols = all.filter((s) => s.tag === 'p:sp' && MONTHS.includes(s.text)).sort((a, b) => cx(a) - cx(b));
  if (!cols.length) return out;
  const gap = cols.length > 1 ? (cx(cols.at(-1)) - cx(cols[0])) / (cols.length - 1) : 1500000;
  const bandTop = Math.min(...cols.map((s) => s.y)) - 1400000;
  const bandBottom = Math.max(...cols.map((s) => s.y + s.h)) + 1400000;
  const near = (col, test) => all.filter((s) => s !== col && s.tag === 'p:sp' && test(s) && Math.abs(cx(s) - cx(col)) < gap * 0.55 && cy(s) > bandTop && cy(s) < bandBottom).sort((a, b) => Math.abs(cx(a) - cx(col)) - Math.abs(cx(b) - cx(col)))[0];
  const isStatus = (s) => /^(Completed|Planned|In progress|Scheduled|Done|Pending)$/i.test(s.text);
  const parts = cols.map((col) => ({ col, day: near(col, (s) => /^\d{1,2}$/.test(s.text)), status: near(col, isStatus), label: near(col, (s) => s.text && !MONTHS.includes(s.text) && !/^\d{1,2}$/.test(s.text) && !isStatus(s) && !lists.includes(s)) }));
  // More meetings than places: the first ones and the last (the wrap-up); fewer: the places after them go.
  const shown = milestones.length > parts.length ? [...milestones.slice(0, parts.length - 1), milestones.at(-1)] : milestones;
  const doneIds = new Set();
  parts.forEach((p, i) => {
    const m = shown[i];
    if (!m) {
      // This place and everything drawn for it (its card, its dot) go; the long arrow and bars stay.
      for (const s of all) if (!doneIds.has(s.xml) && Math.abs(cx(s) - cx(p.col)) < gap * 0.45 && cy(s) > bandTop && cy(s) < bandBottom && s.w < gap * 1.2) {
        out = removeShape(out, s);
        doneIds.add(s.xml);
      }
      return;
    }
    const set = (s, segs) => {
      if (!s || doneIds.has(s.xml)) return;
      const like = s.paras.find((q) => textOf(q).trim()) ?? s.paras[0];
      out = replaceShape(out, s, withParas(s.xml, [para(like, segs)]));
      doneIds.add(s.xml);
    };
    set(p.col, [{ text: MONTHS[m.month] }]);
    set(p.day, [{ text: String(m.day) }]);
    if (p.label) {
      const like = p.label.paras.find((q) => textOf(q).trim()) ?? p.label.paras[0];
      if (!doneIds.has(p.label.xml)) {
        out = replaceShape(out, p.label, shrinkToFit(withParas(p.label.xml, [para(like, [{ text: m.label }])])));
        doneIds.add(p.label.xml);
      }
    }
    const [word, color] = STATUS[m.state] ?? STATUS.planned;
    set(p.status, [{ text: word, color }]);
  });
  return out;
}

// ——— Test plan: one business goal ———
export function fillTestSlide(xml, { number, title, statement, rows = [] }) {
  let out = xml;
  const shapes = shapesOf(out);
  const badge = shapes.find((s) => /^BG\s*\d+$/i.test(s.text));
  if (badge) out = replaceShape(out, badge, withParas(badge.xml, [para(badge.paras.find((p) => textOf(p).trim()), [{ text: `BG${number}` }])]));
  // The goal: the text beside the badge (its first run the goal, bold; the rest the statement).
  const goal = shapes.filter((s) => s.tag === 'p:sp' && s !== badge && !/^Test Plan/i.test(s.text) && s.text.length > 20 && (!badge || Math.abs(cy(s) - cy(badge)) < 900000)).sort((a, b) => b.text.length - a.text.length)[0];
  if (goal) {
    const like = goal.paras.find((p) => textOf(p).trim());
    out = replaceShape(out, goal, shrinkToFit(withParas(goal.xml, [para(like, [{ text: `${title}${statement ? ' - ' : ''}`, style: 0 }, ...(statement ? [{ text: statement, style: 1 }] : [])])])));
  }
  const frame = shapesOf(out).find((s) => s.tag === 'p:graphicFrame' && /<a:tbl>/.test(s.xml));
  if (!frame) return out;
  const trs = [...frame.xml.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((m) => m[0]);
  if (!trs.length) return out;
  const header = trs.length > 1 && /criteria|description|result/i.test(textOf(trs[0])) && !/SC\s*\d/i.test(textOf(trs[0]));
  const base = header ? trs[1] : trs[0];
  const cellsOf = (tr) => [...tr.matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g)].map((m) => m[0]);
  const long = Math.max(0, ...rows.map((r) => Math.max((r.description ?? '').length, (r.measure ?? '').length)));
  // The table keeps the template's height: more rows than the example are shorter, their text a little smaller.
  const templateRows = trs.length - (header ? 1 : 0);
  const crowd = rows.length / Math.max(1, templateRows);
  const size = crowd > 1.5 || long > 230 ? 1100 : crowd > 1 || long > 160 ? 1250 : null;
  const fillCell = (tc, lines) => {
    const ps = [...tc.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]).filter((p) => /<a:r>/.test(p));
    const first = tc.indexOf('<a:p>');
    const last = tc.lastIndexOf('</a:p>');
    if (first < 0) return tc;
    const built = lines.map((l, i) => para(ps[Math.min(i, ps.length - 1)] ?? tc.slice(first, last + 6), [{ ...l, size: size ?? undefined }]));
    return tc.slice(0, first) + built.join('') + tc.slice(last + 6);
  };
  const cells = cellsOf(base);
  const built = rows.map((r) => {
    let tr = base;
    const [word, color] = STATUS[r.state] ?? STATUS.planned;
    const values = [[{ text: `${r.code}:` }, { text: r.name }], [{ text: r.description || '—' }], [{ text: r.measure || '—' }], [{ text: word, color }]];
    cells.forEach((tc, i) => {
      if (values[i]) tr = tr.replace(tc, fillCell(tc, values[i]));
    });
    return tr;
  });
  const baseH = Number(/<a:tr\b[^>]*\bh="(\d+)"/.exec(base)?.[1] ?? 0);
  const rowH = baseH && rows.length > templateRows ? Math.max(Math.round((baseH * templateRows) / rows.length), 520000) : baseH;
  if (rowH && rowH !== baseH) for (let i = 0; i < built.length; i++) built[i] = built[i].replace(/(<a:tr\b[^>]*\bh=")\d+(")/, `$1${rowH}$2`);
  const kept = header ? trs[0] : '';
  let tbl = frame.xml;
  const start = tbl.indexOf(trs[0]);
  const end = tbl.lastIndexOf(trs.at(-1)) + trs.at(-1).length;
  tbl = tbl.slice(0, start) + kept + built.join('') + tbl.slice(end);
  if (rowH) tbl = tbl.replace(/(<p:xfrm>[\s\S]*?<a:ext cx="\d+" cy=")(\d+)(")/, (all, a, h, b) => `${a}${rowH * (rows.length + (header ? 1 : 0))}${b}`);
  return out.replace(frame.xml, tbl);
}

// ——— Meeting notes ———
export function fillNotesSlide(xml, { date = '', sections = [] }) {
  let out = xml;
  const shapes = shapesOf(out);
  const title = shapes.find((s) => /Meeting Notes/i.test(s.text));
  if (title && date) {
    const dp = title.paras.find((p) => /Date:/i.test(textOf(p)));
    if (dp) {
      // The runs from "Date:" on become the date; "Meeting Notes" and the line break before it stay.
      let seen = false;
      const next = dp.replace(/<a:t>([^<]*)<\/a:t>/g, (all, t) => {
        if (!seen && /Date/i.test(t)) {
          seen = true;
          return `<a:t>${esc(`${t.slice(0, t.search(/Date/i))}Date: ${date}`)}</a:t>`;
        }
        return seen ? '<a:t></a:t>' : all;
      });
      out = out.replace(dp, next);
    }
    else out = out.replace(/(<a:t>)[^<]*\d{4}[^<]*(<\/a:t>)/, `$1${esc(date)}$2`);
  }
  const body = shapesOf(out).find((s) => s.tag === 'p:sp' && s !== title && s.paras.filter((p) => textOf(p).trim()).length >= 3);
  if (!body) return out;
  const ps = body.paras.filter((p) => textOf(p).trim());
  // A heading has no bullet (buNone, or no indent); an item is indented, its bold lead (when it has one) a run of its own.
  const isHead = (p) => /<a:buNone\/>/.test(p) || /marL="0"/.test(p);
  const runsIn = (p) => [...p.matchAll(/<a:r>/g)].length;
  const headLike = ps.find(isHead) ?? ps[0];
  const itemLike = ps.find((p) => !isHead(p) && runsIn(p) >= 2) ?? ps.find((p) => !isHead(p)) ?? ps[0];
  const plainLike = ps.find((p) => !isHead(p) && runsIn(p) === 1) ?? itemLike;
  const next = [];
  for (const sec of sections) {
    if (!sec.items.length) continue;
    next.push(para(headLike, [{ text: sec.heading }]));
    for (const line of sec.items) {
      const segs = splitLead(line);
      next.push(segs.length === 2 ? para(itemLike, [{ ...segs[0], style: 0 }, { ...segs[1], style: runsIn(itemLike) > 1 ? 1 : 0 }]) : para(plainLike, [{ text: line, style: runsIn(plainLike) > 1 ? 1 : 0, bold: false }]));
    }
  }
  if (!next.length) return out;
  return out.replace(body.xml, shrinkToFit(withParas(body.xml, next)));
}

// ——— A screenshot slide: its title, and its picture fitted to the screenshot's shape ———
export function fillShotSlide(xml, { caption, width, height }) {
  let out = xml;
  const shapes = shapesOf(out);
  const title = shapes.filter((s) => s.tag === 'p:sp' && s.text).sort((a, b) => a.y - b.y)[0];
  if (title) out = replaceShape(out, title, withParas(title.xml, [para(title.paras.find((p) => textOf(p).trim()), [{ text: caption }])]));
  const pic = shapesOf(out).filter((s) => s.tag === 'p:pic').sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!pic) return out;
  let w = pic.w;
  let h = pic.h;
  if (width && height) {
    const r = width / height;
    if (w / h > r) w = Math.round(h * r);
    else h = Math.round(w / r);
  }
  const x = Math.round(pic.x + (pic.w - w) / 2);
  const y = Math.round(pic.y + (pic.h - h) / 2);
  const next = pic.xml.replace(/<a:off x="-?\d+" y="-?\d+"\s*\/>\s*<a:ext cx="\d+" cy="\d+"\s*\/>/, `<a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/>`).replace(/<a:srcRect\b[^>]*\/>/, '<a:srcRect/>');
  return out.replace(pic.xml, next);
}
/** The relationship id of a screenshot slide's picture. */
export const picRelOf = (xml) => {
  const pic = shapesOf(xml).filter((s) => s.tag === 'p:pic').sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return pic ? /r:embed="([^"]+)"/.exec(pic.xml)?.[1] ?? null : null;
};
