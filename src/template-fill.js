/**
 * Filling the team template's own slides with a POV's data, keeping their design exactly: the cover, the plan and
 * timeline, the environment details and the test plan per business goal. Text is replaced run by run and table rows
 * are cloned from the template's own first row, so fonts, colours and spacing stay the template's.
 */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Replace the text runs of a slide in order: `fn(index, currentText)` returns the new text, or undefined to keep. */
export function replaceRuns(xml, fn) {
  let i = 0;
  return xml.replace(/<a:t>([^<]*)<\/a:t>/g, (all, t) => {
    const next = fn(i++, t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    return next === undefined ? all : `<a:t>${esc(next)}</a:t>`;
  });
}

/** A cell's text replaced by lines [{ text, color?, bold? }], each a paragraph styled like the cell's first run. */
function setCell(tc, lines, styleFrom = '') {
  // An empty cell in a template often has no text style of its own: it borrows one (from its row's label, or the
  // first filled row), so every value reads like the template's own.
  const find = (x) => /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(x)?.[0];
  const rPr = (find(tc) ?? find(styleFrom) ?? '<a:rPr lang="en-US"/>').replace(/<a:rPr\b/, '<a:rPr').replace(/ dirty="\d"/, '');
  // Left to right always ("4 weeks", not "weeks 4"): a right-to-left cell is turned round, aligned to the left.
  let pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(tc)?.[0] ?? '';
  // (A cell without its own paragraph settings inherits right-to-left from the master: it is set left-to-right.)
  if (!pPr) pPr = '<a:pPr algn="l" rtl="0"/>';
  else if (/rtl="1"/.test(pPr)) pPr = pPr.replace(/rtl="1"/, 'rtl="0"').replace(/algn="r"/, 'algn="l"');
  else if (!/rtl=/.test(pPr)) pPr = pPr.replace(/<a:pPr\b/, '<a:pPr rtl="0"');
  const styled = (l) => {
    let r = rPr;
    if (l.bold) r = r.replace(/<a:rPr\b/, '<a:rPr b="1"').replace(/ b="0"/, '');
    if (l.color) {
      r = r.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, '');
      r = r.endsWith('/>') ? r.replace(/\/>$/, `><a:solidFill><a:srgbClr val="${l.color}"/></a:solidFill></a:rPr>`) : r.replace(/>/, `><a:solidFill><a:srgbClr val="${l.color}"/></a:solidFill>`);
    }
    return r;
  };
  const paras = lines.map((l) => `<a:p>${pPr}<a:r>${styled(l)}<a:t>${esc(l.text)}</a:t></a:r></a:p>`).join('') || `<a:p>${pPr}<a:endParaRPr lang="en-US"/></a:p>`;
  return tc.replace(/(<a:txBody>[\s\S]*?<a:lstStyle\/>|<a:txBody>[\s\S]*?<\/a:bodyPr>)[\s\S]*?(<\/a:txBody>)/, (_, head, tail) => `${head.includes('<a:lstStyle') ? head : `${head}<a:lstStyle/>`}${paras}${tail}`);
}

const rowsOf = (tbl) => [...tbl.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((m) => m[0]);
const cellsOf = (tr) => [...tr.matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>|<a:tc\/>/g)].map((m) => m[0]);
const textOf = (x) => [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('').replace(/&amp;/g, '&').trim();
const setRow = (tr, values, styleRow = '') => {
  const cells = cellsOf(tr);
  const styled = styleRow ? cellsOf(styleRow) : [];
  let out = tr;
  values.forEach((v, i) => {
    if (v === undefined || !cells[i]) return;
    // Style from the same column of the style row, else from this row's first (label) cell.
    const hasStyle = (x) => /<a:rPr\b/.test(x ?? '');
    const from = [styled[i], cells[i], ...styled, ...cells].find(hasStyle) ?? '';
    out = out.replace(cells[i], setCell(cells[i], Array.isArray(v) ? v : [{ text: v }], from));
  });
  return out;
};

/** The cover: the customer's name, the deck's subtitle, and who prepared it, when. */
export function fillCover(xml, { customer, results, people = [], date = '' }) {
  // The name on one line: the run's size comes down for a longer name (the placeholder is sized for a short one).
  const pt = Math.max(28, Math.min(54, Math.floor(620 / Math.max(8, String(customer).length * 0.56))));
  xml = xml.replace(/(<a:r>\s*)(<a:rPr\b[^>]*?)(\/?>)((?:(?!<\/a:r>)[\s\S])*?<a:t>[^<]*Customer\s*Name[^<]*<\/a:t>)/i, (all, a, rpr, close, rest) => `${a}${rpr.replace(/\ssz="\d+"/, '')} sz="${pt * 100}"${close}${rest}`);
  let out = replaceRuns(xml, (i, t) => {
    if (/customer\s*name/i.test(t)) return customer;
    if (results && /^\s*Guide\s*$/i.test(t)) return 'Results';
    return undefined;
  });
  const lines = [...people.map((p) => `${p.name}${p.title ? ` | ${p.title}` : ''}`), date].filter(Boolean);
  if (lines.length) {
    const paras = lines.map((l, i) => `<a:p><a:r><a:rPr lang="en-US" sz="${i < people.length ? 1500 : 1300}"><a:solidFill><a:srgbClr val="${i < people.length ? '8F7BFF' : 'FFFFFF'}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${esc(l)}</a:t></a:r></a:p>`).join('');
    out = out.replace('</p:spTree>', `<p:sp><p:nvSpPr><p:cNvPr id="9900" name="Meridian: prepared by"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="640080" y="5900000"/><a:ext cx="7000000" cy="1300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree>`);
  }
  return out;
}

/** Plan & timeline: the customer, scope, support and success lines, and the launch, check-in and wrap-up dates. */
export function fillPlan(xml, { customer, scope = [], support = [], success = [], launch, checkin, wrapup, champion = '' }) {
  const day = (m) => (m?.date ? String(new Date(`${m.date}T12:00:00Z`).getUTCDate()) : '—');
  const month = (m) => (m?.date ? new Date(`${m.date}T12:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }).toUpperCase() : '');
  // The run order of the template's slide (checked against it): customer, scope ×3, wrap-up label and date,
  // support ×3, success ×3, check-in label and date, launch label and date.
  const map = {
    2: 'Focus on ',
    3: customer,
    4: ' goals',
    5: scope[0] ?? '',
    6: scope[1] ?? '',
    7: scope[2] ?? '',
    8: wrapup?.title || 'Wrap-up call',
    9: champion ? ` with ${champion}` : '',
    10: '',
    11: month(wrapup),
    12: day(wrapup),
    13: support[0] ?? '',
    14: support[1] ?? '',
    15: support[2] ?? '',
    17: success[0] ?? '',
    18: success[1] ?? '',
    19: success[2] ?? '',
    21: checkin?.title || 'Check-in call',
    22: month(checkin),
    23: day(checkin),
    24: launch?.title || 'POV Launch &',
    25: launch?.title ? '' : 'quick setup',
    26: month(launch),
    27: day(launch),
  };
  // The template's "[customer]" and "[champion]" are red placeholders: the filled names take the text's colour.
  return replaceRuns(xml, (i) => map[i]).replace(/<a:solidFill><a:srgbClr val="FF0000"\/><\/a:solidFill>/g, '');
}

/** Environment details: the people, the environment, and the integrations, in the template's three tables. */
export function fillEnvironment(xml, { people = [], env = {}, integrations = {} }) {
  const tables = [...xml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)].map((m) => m[0]);
  let out = xml;
  for (const tbl of tables) {
    const rows = rowsOf(tbl);
    const head = rows[0] ? cellsOf(rows[0]).map(textOf) : [];
    let filled = tbl;
    if (/name/i.test(head[0] ?? '') && head.length >= 3) {
      const model = rows[1];
      rows.slice(1).forEach((tr, i) => {
        const p = people[i];
        filled = filled.replace(tr, p ? setRow(model, [p.name, p.title ?? '', p.povRole ?? '', p.email ?? ''], model) : setRow(tr, ['', '', '', ''], model));
      });
    } else if (/environment/i.test(head[0] ?? '')) {
      for (const tr of rows.slice(1)) {
        const label = textOf(cellsOf(tr)[0] ?? '').toLowerCase();
        const key = Object.keys(env).find((k) => label.startsWith(k.toLowerCase()));
        if (key !== undefined) filled = filled.replace(tr, setRow(tr, [undefined, env[key] || '—']));
      }
    } else if (/integration/i.test(head[0] ?? '')) {
      for (const tr of rows.slice(1)) {
        const cells = cellsOf(tr);
        const label = textOf(cells[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
        const key = Object.keys(integrations).find((k) => label.startsWith(k));
        if (!key) continue;
        const [access, tools] = integrations[key];
        filled = filled.replace(tr, setRow(tr, cells.length >= 3 ? [undefined, access ?? undefined, tools || '—'] : [undefined, tools || '—']));
      }
    }
    out = out.replace(tbl, filled);
  }
  return out;
}

/**
 * One test plan page: the business goal's number and statement, and up to six criteria rows (criteria with its
 * result under it, test item, benefit), cloned from the template's first row.
 */
export function fillTestPlan(xml, { number, title, statement, rows = [] }) {
  let out = replaceRuns(xml, (i, t) => {
    if (/^\s*\d+\s*$/.test(t)) return String(number);
    return undefined;
  });
  // The goal: the description shape is the one with the longest text that is not the title.
  const sps = [...out.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  const desc = sps.filter((sp) => !/Test Plan Overview/i.test(textOf(sp)) && textOf(sp).length > 20).sort((a, b) => textOf(b).length - textOf(a).length)[0];
  if (desc) {
    let first = true;
    const replaced = desc.replace(/(<a:p>[\s\S]*?<\/a:p>)/g, (p) => {
      if (!first) return '';
      first = false;
      const rPr = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(p)?.[0] ?? '<a:rPr lang="en-US"/>';
      const bold = rPr.replace(/<a:rPr\b/, '<a:rPr b="1"').replace(/ b="0"/, '');
      const pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(p)?.[0] ?? '';
      return `<a:p>${pPr}<a:r>${bold}<a:t>${esc(title)}</a:t></a:r>${statement ? `<a:r>${rPr}<a:t>${esc(` — ${statement}`)}</a:t></a:r>` : ''}</a:p>`;
    });
    out = out.replace(desc, replaced);
  }
  const tbl = /<a:tbl>[\s\S]*?<\/a:tbl>/.exec(out)?.[0];
  if (tbl) {
    const trs = rowsOf(tbl);
    const base = trs[0];
    const built = rows.map((r) => setRow(base, [[{ text: r.title, bold: true }, { text: r.result, color: r.color, bold: true }], r.test || '—', r.benefit || '—']));
    const start = tbl.indexOf(trs[0]);
    const end = tbl.lastIndexOf(trs.at(-1)) + trs.at(-1).length;
    out = out.replace(tbl, tbl.slice(0, start) + built.join('') + tbl.slice(end));
  }
  return out;
}
