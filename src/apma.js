/**
 * The APMA (AppSec Program Maturity Assessment) report, read from its PDF: the five dimensions with their current and
 * desired maturity, who was interviewed, the overall level and the recommendations for the first sprint. The PDF is
 * read with Node alone: its streams are inflated and the text decoded through each font's ToUnicode map.
 */
import zlib from 'node:zlib';
import { fail } from './db.js';

export const DIMENSIONS = ['Strategy & Governance', 'Planning', 'Security Testing - Tactical', 'Security Testing - Operational', 'Security Testing - Infrastructure'];

// ——— A minimal PDF text reader ———
function objects(buf) {
  const s = buf.toString('latin1');
  const map = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  const starts = [];
  while ((m = re.exec(s))) starts.push([Number(m[1]), m.index + m[0].length]);
  for (let i = 0; i < starts.length; i++) {
    const [id, from] = starts[i];
    const end = s.indexOf('endobj', from);
    const body = s.slice(from, end < 0 ? (starts[i + 1]?.[1] ?? s.length) : end);
    const sm = /stream\r?\n/.exec(body);
    let dict = body;
    let stream = null;
    if (sm) {
      dict = body.slice(0, sm.index);
      const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      const len = lm && !lm[2] ? Number(lm[1]) : NaN; // an indirect length: read up to endstream instead
      const at = from + sm.index + sm[0].length;
      const raw = Number.isFinite(len) ? buf.subarray(at, at + len) : buf.subarray(at, from + body.lastIndexOf('endstream'));
      stream = raw;
      if (/\/FlateDecode/.test(dict)) {
        try {
          stream = zlib.inflateSync(raw);
        } catch {
          try {
            stream = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
          } catch {
            stream = null;
          }
        }
      } else if (/\/Filter/.test(dict)) stream = null; // images and the like: not text
    }
    map.set(id, { dict, stream });
  }
  return map;
}

const ref = (dict, key) => Number(new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict)?.[1]) || null;

function cmapOf(text) {
  const map = new Map();
  map.width = ((/begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text)?.[1]?.length ?? 4) / 2) * 2;
  const hex = (h) => String.fromCodePoint(...(h.match(/.{1,4}/g) ?? []).map((x) => parseInt(x, 16)));
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const [, a, b] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(a, 16), hex(b));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const [, a, b, c] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const base = parseInt(c, 16);
      for (let k = parseInt(a, 16); k <= parseInt(b, 16); k++) map.set(k, String.fromCodePoint(base + k - parseInt(a, 16)));
    }
  return map;
}

/** The text of each page, one line per text-positioning step, in drawing order. */
export function pdfText(buf) {
  const objs = objects(buf);
  const pages = [...objs.values()].filter((o) => /\/Type\s*\/Page\b/.test(o.dict));
  const cmaps = new Map();
  const fontsOf = (resDict) => {
    const fonts = {};
    let fd = /\/Font\s*<<([\s\S]*?)>>/.exec(resDict)?.[1];
    if (!fd) {
      const r = ref(resDict, 'Font');
      if (r) fd = objs.get(r)?.dict ?? '';
    }
    for (const [, name, id] of (fd ?? '').matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) {
      const tu = ref(objs.get(Number(id))?.dict ?? '', 'ToUnicode');
      if (!tu) continue;
      if (!cmaps.has(tu)) cmaps.set(tu, cmapOf(objs.get(tu)?.stream?.toString('latin1') ?? ''));
      fonts[name] = cmaps.get(tu);
    }
    return fonts;
  };
  return pages.map((p) => {
    const resId = ref(p.dict, 'Resources');
    const fonts = fontsOf(resId ? objs.get(resId)?.dict ?? '' : p.dict);
    const contents = [...(/\/Contents\s*\[([^\]]*)\]/.exec(p.dict)?.[1] ?? /\/Contents\s+(\d+\s+0\s+R)/.exec(p.dict)?.[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)].map((m) => objs.get(Number(m[1]))?.stream?.toString('latin1') ?? '').join('\n');
    let font = null;
    const out = [];
    let line = '';
    const decode = (hex) => {
      if (!font) return '';
      let t = '';
      const w = font.width || 4;
      for (let i = 0; i + w <= hex.length; i += w) t += font.get(parseInt(hex.slice(i, i + w), 16)) ?? '';
      return t;
    };
    for (const m of contents.matchAll(/\/([\w.+-]+)\s+[\d.]+\s+Tf|<([0-9a-fA-F\s]*)>\s*Tj|\[((?:[^\]\\]|\\.)*)\]\s*TJ|(T\*|Td|TD|Tm|ET)\b/g)) {
      if (m[1]) font = fonts[m[1]] ?? null;
      else if (m[2] != null) line += decode(m[2].replace(/\s/g, ''));
      else if (m[3] != null)
        for (const part of m[3].matchAll(/<([0-9a-fA-F\s]*)>|(-?[\d.]+)/g)) {
          if (part[1] != null) line += decode(part[1].replace(/\s/g, ''));
          else if (Number(part[2]) < -200) line += ' ';
        }
      else if (m[4]) {
        if (line.trim()) out.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) out.push(line.trim());
    return out.join('\n');
  });
}

// ——— The APMA report ———
const num = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
};

/** The assessment, from the PDF's text. Throws when the file is not an APMA report. */
export function readApma(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString() !== '%PDF-') throw fail(400, 'That is not a PDF. Drop the APMA report as it was sent (a PDF).');
  const pages = pdfText(buf);
  const all = pages.join('\n');
  if (!/APMA/i.test(all) || !/Strategy\s*&\s*Governance/i.test(all)) throw fail(400, 'That PDF is not an APMA assessment report.');
  const flat = all.replace(/\s+/g, ' ');
  const customer = /Maturity Assessment for (.+?) Results and Recommendations/i.exec(flat)?.[1]?.trim() ?? '';
  const interviewee = /interview assessment with (.+?)\.\s/i.exec(flat)?.[1]?.trim() ?? '';
  const overall = /overall maturity of your AppSec program is currently at an? ([^.]+?)\s*\(([^)]+)\)/i.exec(flat);
  // High level scores: the dimension, then its current and desired state.
  const scoresAt = flat.search(/High Level Scores and Recommendations\s+Dimension/i);
  const table = scoresAt >= 0 ? flat.slice(scoresAt, scoresAt + 6000) : flat;
  const dims = DIMENSIONS.map((name) => {
    const parts = name.split(/\s+/).map((w) => w.replace(/[-&]/g, (c) => `\\${c}`));
    // The name can be split over lines around the numbers: find its first word(s), then the next two numbers.
    const head = name.startsWith('Security Testing') ? `Security\\s+Testing\\s*-?\\s*(?:${name.split(' - ')[1]})?` : parts.slice(0, 1).join('');
    const re = new RegExp(`${head}[^0-9]{0,40}?(\\d(?:[.,]\\d)?)\\s+(\\d(?:[.,]\\d)?)`, 'i');
    let m = re.exec(table);
    if (name.startsWith('Security Testing')) {
      const tail = name.split(' - ')[1];
      const near = new RegExp(`Security\\s+(\\d(?:[.,]\\d)?)\\s+(\\d(?:[.,]\\d)?)\\s+[^]{0,400}?Testing\\s*-\\s*${tail}`, 'i').exec(table);
      const direct = new RegExp(`Security\\s+Testing\\s*-\\s*${tail}\\s+(\\d(?:[.,]\\d)?)\\s+(\\d(?:[.,]\\d)?)`, 'i').exec(table);
      m = direct ?? near ?? null;
    }
    return { name, current: m ? num(m[1]) : null, desired: m ? num(m[2]) : null };
  });
  // The recommendations for the first sprint.
  const recs = [...flat.matchAll(/Recommendation \d+:\s*(.+?)\s+This recommendation for practice (.+?) in dimension (.+?) will increase the maturity of this practice from level (\d) to level (\d)/gi)].map((m) => ({ title: m[1].trim(), practice: m[2].trim(), dimension: m[3].trim(), from: Number(m[4]), to: Number(m[5]) }));
  const low = /\. The dimensions? ([^.]+?) (?:are|is) among the dimensions with the lowest maturity/i.exec(flat)?.[1] ?? '';
  return {
    customer,
    interviewee,
    overall: overall ? `${overall[1].trim()} (${overall[2].trim()})` : '',
    lowest: low,
    dimensions: dims,
    recommendations: recs.slice(0, 6),
    found: dims.filter((d) => d.current != null).length,
  };
}

/** Clean an assessment typed or corrected by hand. */
export function cleanApma(a) {
  if (!a || typeof a !== 'object') return null;
  const t = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  return {
    customer: t(a.customer, 200),
    interviewee: t(a.interviewee, 200),
    overall: t(a.overall, 200),
    lowest: t(a.lowest, 300),
    date: /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '') ? a.date : '',
    dimensions: DIMENSIONS.map((name) => {
      const d = (Array.isArray(a.dimensions) ? a.dimensions : []).find((x) => x?.name === name) ?? {};
      return { name, current: num(d.current), desired: num(d.desired) };
    }),
    recommendations: (Array.isArray(a.recommendations) ? a.recommendations : []).slice(0, 8).map((r) => ({ title: t(r?.title), practice: t(r?.practice, 120), dimension: t(r?.dimension, 120), from: Number(r?.from) || 0, to: Number(r?.to) || 0 })).filter((r) => r.title),
    file: a.file ? { name: t(a.file.name, 200), at: t(a.file.at, 40) } : null,
  };
}
