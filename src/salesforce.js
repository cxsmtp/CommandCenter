/**
 * Salesforce without its API.
 *
 * In — a Salesforce report (Opportunities, with the Opportunity ID column) brought in three ways, all read the same:
 *   - a file dropped on the Portfolio (Export → .xlsx or .csv);
 *   - the report's subscription email, read from a mailbox (src/sf-mailbox.js): the attached file, or the table in
 *     the email itself when the org does not allow attachments.
 * Each row is matched to a POV by the Opportunity ID in the POV's Salesforce link (15 or 18 characters), else by the
 * opportunity name and account. Only the fields below are kept; Meridian never writes them back.
 *
 * Out — Email to Salesforce: each person's private address (Salesforce → Settings → My Email to Salesforce). Meridian
 * copies it on the POV emails it sends, and sends it short, structured log messages (a task, a note, a stage change,
 * the POV result). Salesforce saves each as an activity on the contacts, leads and opportunities it can match; one it
 * cannot match waits in My Unresolved Items. Salesforce only accepts mail from an address on the person's
 * "My Acceptable Email Addresses" list: Meridian's sending address has to be added there once.
 */
import JSZip from 'jszip';

/** The fields kept from a report row, with the headers Salesforce uses for them. */
export const SF_FIELDS = {
  id: ['opportunity id', 'opportunity: opportunity id', 'opp id', 'id', 'opportunity id (18)', 'opportunity id (15)', '18 digit opportunity id'],
  name: ['opportunity name', 'opportunity: opportunity name', 'opportunity'],
  account: ['account name', 'account: account name', 'account'],
  stage: ['stage', 'opportunity stage', 'stage name'],
  amount: ['amount', 'amount (converted)', 'total contract value', 'acv', 'arr', 'annual recurring revenue', 'expected revenue'],
  closeDate: ['close date', 'expected close date'],
  probability: ['probability (%)', 'probability'],
  forecast: ['forecast category', 'forecast'],
  nextStep: ['next step', 'next steps'],
  owner: ['opportunity owner', 'owner', 'owner name', 'account executive'],
  type: ['type', 'opportunity type'],
  lastActivity: ['last activity', 'last activity date', 'last modified date'],
};
export const SF_LABELS = { stage: 'Stage', amount: 'Amount', closeDate: 'Close date', probability: 'Probability', forecast: 'Forecast', nextStep: 'Next step', owner: 'Owner', type: 'Type', lastActivity: 'Last activity' };

const MAX_ROWS = 20_000;

/** The Salesforce record ID in an opportunity's link, if there is one (006…). */
export function opportunityIdOf(url) {
  const m = /(?:^|[/=])(006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)(?=$|[/?&#])/.exec(String(url ?? ''));
  return m ? m[1] : '';
}
const sameId = (a, b) => Boolean(a && b) && a.slice(0, 15) === b.slice(0, 15);

// ——— Reading a report ———

/** Rows (arrays of strings) from a file: .xlsx, .csv, or an HTML page or email with a table. */
export async function readTable(buf, { name = '', type = '' } = {}) {
  const lower = `${name} ${type}`.toLowerCase();
  if (buf.subarray(0, 2).toString('latin1') === 'PK' || /\.xlsx\b|spreadsheetml/.test(lower)) return readXlsx(buf);
  const s = decodeText(buf);
  if (/<table[\s>]/i.test(s) || /\.html?\b|text\/html/.test(lower)) return readHtmlTable(s);
  return readCsv(s);
}

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

export function readCsv(s) {
  const first = s.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const entities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** The table with the most rows in an HTML page (a report subscription email's body). */
export function readHtmlTable(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  let best = [];
  for (const t of tables) {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => entities(c[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()))
      .filter((r) => r.some(Boolean));
    if (rows.length > best.length) best = rows;
  }
  return best.slice(0, MAX_ROWS);
}

/** The first sheet of an .xlsx file. */
export async function readXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const shared = [];
  const ss = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (ss) for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(entities([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const sheetName = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
  if (!sheetName) throw Object.assign(new Error('No sheet found in the workbook.'), { status: 400 });
  const xml = await zip.file(sheetName).async('string');
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
      const inline = /<is>([\s\S]*?)<\/is>/.exec(c[2] ?? '')?.[1];
      let value = '';
      if (t === 's') value = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') value = entities([...(inline ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else value = v === undefined ? '' : entities(v);
      while (row.length < col) row.push('');
      row[col] = value;
    }
    if (row.some((x) => String(x).trim())) rows.push(row);
    if (rows.length > MAX_ROWS) break;
  }
  return rows;
}

// ——— From rows to records ———

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9%()]+/g, ' ').trim();

/** The header row (the first with an opportunity column in the first 15 rows) and which column holds what. */
export function mapColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const heads = rows[i].map(norm);
    const cols = {};
    for (const [key, names] of Object.entries(SF_FIELDS)) {
      const idx = heads.findIndex((h) => names.map(norm).includes(h));
      if (idx >= 0) cols[key] = idx;
    }
    if (cols.id !== undefined || cols.name !== undefined) return { header: i, cols };
  }
  return null;
}

/** An Excel date serial (days since 1899-12-30) or a written date, as YYYY-MM-DD. */
function isoDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    // Salesforce writes dates in the person's locale; month first only when the first number cannot be a day of a month (> 12) the other way.
    const [a, b, y] = [Number(dmy[1]), Number(dmy[2]), dmy[3]];
    const [mm, dd] = a > 12 ? [b, a] : b > 12 ? [a, b] : [a, b];
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : s.slice(0, 20);
}

function amountOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const currency = /^[A-Z]{3}\b/.exec(s)?.[0] ?? (s.includes('€') ? 'EUR' : s.includes('£') ? 'GBP' : s.includes('$') ? 'USD' : '');
  const n = Number(s.replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? { value: n, currency } : null;
}

export function recordsOf(rows) {
  const m = mapColumns(rows);
  if (!m) throw Object.assign(new Error('This does not look like an opportunities report: no Opportunity ID or Opportunity Name column in the first rows.'), { status: 400 });
  const out = [];
  for (const r of rows.slice(m.header + 1)) {
    const get = (k) => (m.cols[k] === undefined ? '' : String(r[m.cols[k]] ?? '').trim().slice(0, 500));
    const rec = { id: get('id').replace(/[^A-Za-z0-9]/g, ''), name: get('name'), account: get('account') };
    if (!rec.id && !rec.name) continue;
    if (/^(total|subtotal|grand total|count)\b/i.test(rec.name || rec.id)) continue;
    for (const k of ['stage', 'forecast', 'nextStep', 'owner', 'type']) if (get(k)) rec[k] = get(k);
    for (const k of ['closeDate', 'lastActivity']) if (get(k)) rec[k] = isoDate(get(k));
    if (get('amount')) rec.amount = amountOf(get('amount'));
    if (get('probability')) rec.probability = Number(get('probability').replace(/[^0-9.]/g, '')) || 0;
    out.push(rec);
  }
  return { records: out, columns: Object.keys(m.cols) };
}

/** Which POV each record belongs to: by ID first, else by opportunity name with the customer. */
export function matchRecords(records, opps) {
  const byId = opps.map((o) => ({ o, id: opportunityIdOf(o.salesforceUrl) }));
  const loose = (s) => norm(s).replace(/\b(inc|ltd|llc|plc|gmbh|ag|sa|corp|corporation|limited|the)\b/g, '').replace(/\s+/g, ' ').trim();
  const matched = [];
  const unmatched = [];
  for (const rec of records) {
    let hit = rec.id ? byId.find((x) => sameId(x.id, rec.id))?.o : null;
    let how = hit ? 'id' : '';
    if (!hit && rec.name) {
      const c = opps.filter((o) => !opportunityIdOf(o.salesforceUrl) && loose(o.name) === loose(rec.name) && (!rec.account || loose(o.customer) === loose(rec.account)));
      if (c.length === 1) [hit, how] = [c[0], 'name'];
    }
    if (hit) matched.push({ opp: hit, rec, how });
    else unmatched.push(rec);
  }
  return { matched, unmatched };
}

/** What changed since the last import, for the history ("Stage: Proposal → Negotiation"). */
export function changesOf(before, after) {
  if (!before) return [];
  const show = (k, v) => (k === 'amount' ? (v ? `${v.currency ? `${v.currency} ` : ''}${Math.round(v.value).toLocaleString('en')}` : '—') : v ?? '—');
  return Object.keys(SF_LABELS)
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => `${SF_LABELS[k]}: ${show(k, before[k])} → ${show(k, after[k])}`);
}

// ——— Out: Email to Salesforce ———

/** A structured message Salesforce saves as an activity. */
export function logMessage(opp, { kind, title, lines = [], due = '', by = '', link = '' }) {
  const subject = `${opp.customer} — ${kind}: ${title}`.slice(0, 250);
  const body = [
    `${kind}: ${title}`,
    due ? `Due: ${due}` : '',
    ...lines,
    '',
    `Customer: ${opp.customer}${opp.name && opp.name !== opp.customer ? ` · ${opp.name}` : ''}`,
    opp.salesforceUrl ? `Salesforce: ${opp.salesforceUrl}` : '',
    by ? `By: ${by}` : '',
    link ? `In Meridian: ${link}` : '',
    '',
    '— Logged from Meridian',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0));
  return { subject, body: body.join('\n') };
}
