/**
 * The Solution Engineering library (SEAL): the team's own references, imported as Markdown and kept encrypted on
 * this server — never in the code. Five kinds, told apart by their title:
 *
 *   Business Goals & Success Criteria   BG-xx   goal, statement, criteria (criterion · test item · benefit),
 *                                               success measures, persona, value driver, baseline, methodology,
 *                                               evidence, the capabilities it depends on, what it traces to
 *   Capability Reference                CAP-xx  what it does, how it works, when to use it, workflow fit, metrics
 *   Value Messaging                     VM-xx   persona, their concern, the value message, proof points, how to land it
 *   Value Map                           VMAP-xx value message, mental model, how it is delivered, capabilities
 *   Use Case Cards                      UC-xx   definition, solution, key capabilities, win themes
 *
 * The goals become the success criteria bank (bank.js); the rest is the talk track and the report's wording.
 */
import { fail } from './db.js';

/** The library's capabilities (CAP-xx) as Kendra's catalogue knows them, so the tenant can prove them. */
export const CAP_TO_CATALOG = {
  'CAP-01': 'sast', 'CAP-02': 'sast', 'CAP-03': 'sast', 'CAP-04': 'fusion', 'CAP-05': 'dev-assist', 'CAP-06': 'secrets', 'CAP-07': 'secrets', 'CAP-08': 'iac', 'CAP-09': 'apisec', 'CAP-10': 'apisec',
  'CAP-11': 'sca', 'CAP-12': 'sca', 'CAP-13': 'sca', 'CAP-14': 'sbom', 'CAP-15': 'malicious', 'CAP-16': 'malicious', 'CAP-17': 'malicious', 'CAP-18': 'sca', 'CAP-19': 'containers', 'CAP-20': 'containers',
  'CAP-21': 'scorecard', 'CAP-22': 'aisc', 'CAP-23': 'aisc', 'CAP-24': 'mcp-scanner', 'CAP-25': 'mcp-scanner', 'CAP-26': 'skills-scanner', 'CAP-27': 'dast', 'CAP-28': 'dast', 'CAP-29': 'dast',
  'CAP-31': 'dev-assist', 'CAP-32': 'dev-assist', 'CAP-33': 'ai-triage', 'CAP-34': 'ai-remediation', 'CAP-35': 'mcp', 'CAP-36': 'risk-orchestration', 'CAP-37': 'risk-orchestration', 'CAP-38': 'risk-orchestration',
  'CAP-39': 'risk-orchestration', 'CAP-40': 'analytics', 'CAP-41': 'analytics', 'CAP-43': 'policy', 'CAP-45': 'analytics', 'CAP-47': 'jira', 'CAP-48': 'rbac', 'CAP-50': 'secrets',
};

const KINDS = [
  ['goals', /business goals/i],
  ['capabilities', /capability reference/i],
  ['valueMap', /value map/i],
  ['values', /value messaging/i],
  ['useCases', /use case/i],
];

const clean = (s) => String(s ?? '').replace(/\r/g, '').trim();
const idsIn = (s) => [...String(s).matchAll(/\b((?:BG|CAP|VMAP|VM|UC)-\d+)\b/g)].map((m) => m[1]);

/** A Markdown table's rows as objects keyed by its header. */
function tableRows(lines) {
  const rows = lines.filter((l) => l.trim().startsWith('|')).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => clean(c)));
  if (rows.length < 2) return [];
  const [head, , ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** One entry (### ID: Title …) as { id, title, lead, fields, sections: { name: { text, list, table } } }. */
function parseEntry(block) {
  const lines = block.split('\n');
  const m = /^###\s+([A-Z]+-\d+):\s*(.+)$/.exec(lines[0]);
  const entry = { id: m[1], title: clean(m[2]), lead: '', fields: {}, sections: {} };
  let name = '';
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const table = tableRows(buf);
    const list = buf.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => clean(l.replace(/^\s*[-*]\s+/, '')));
    const text = buf.filter((l) => l.trim() && !/^\s*[-*]\s+/.test(l) && !l.trim().startsWith('|')).map((l) => clean(l.replace(/^>\s?/, ''))).join(' ').trim();
    if (!name && table.length && 'Field' in table[0]) for (const r of table) entry.fields[r.Field] = r.Value;
    else (entry.sections[name || '_'] ??= { text: '', list: [], table: [] }) && Object.assign(entry.sections[name || '_'], { text: [entry.sections[name || '_'].text, text].filter(Boolean).join(' '), list: [...entry.sections[name || '_'].list, ...list], table: [...entry.sections[name || '_'].table, ...table] });
    buf = [];
  };
  for (const line of lines.slice(1)) {
    if (/^---+\s*$/.test(line)) break;
    const bold = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
    if (bold) {
      const t = bold[1].trim();
      // A bold sentence right under the title is the entry's statement; a short bold line starts a section.
      if (!entry.lead && !name && !Object.keys(entry.sections).length && /[.!?]$/.test(t)) {
        entry.lead = t;
        continue;
      }
      flush();
      name = t;
      continue;
    }
    buf.push(line);
  }
  flush();
  return entry;
}

const sec = (e, ...names) => {
  for (const n of names) {
    const s = Object.entries(e.sections).find(([k]) => k.toLowerCase() === n.toLowerCase());
    if (s) return s[1];
  }
  return { text: '', list: [], table: [] };
};
const seFields = (e) => Object.fromEntries(sec(e, 'SE context').table.map((r) => [r.Field, r.Value]));

const SHAPE = {
  goals: (e) => {
    const se = seFields(e);
    const caps = [...new Set(sec(e, 'Capabilities').list.flatMap(idsIn))];
    return {
      id: e.id,
      title: e.title,
      statement: e.lead,
      criteria: (Object.values(e.sections).find((s) => s.table.some((r) => 'Test item' in r))?.table ?? []).map((r) => ({ name: r.Criteria ?? r.Criterion ?? '', test: r['Test item'] ?? '', benefit: r.Benefit ?? '' })).filter((r) => r.name),
      measures: sec(e, 'Success measures').list,
      persona: se.Persona ?? '',
      driver: se['GTM Value Driver'] ?? '',
      expectedBenefit: se['Expected benefit'] ?? '',
      scope: se.Scope ?? '',
      baseline: se.Baseline ?? '',
      methodology: se.Methodology ?? '',
      evidence: se.Evidence ?? '',
      capabilities: caps,
      traces: [...new Set(sec(e, 'Traces to').list.flatMap(idsIn))],
    };
  },
  capabilities: (e) => ({
    id: e.id,
    title: e.title,
    category: e.fields.Category ?? '',
    parent: e.fields.Parent ?? '',
    what: sec(e, 'What it does').text,
    how: sec(e, 'How it works').text,
    when: sec(e, 'When to use it').text,
    workflow: sec(e, 'Workflow fit').text,
    metrics: sec(e, 'Key metrics').text,
    catalogId: CAP_TO_CATALOG[e.id] ?? '',
  }),
  values: (e) => ({
    id: e.id,
    title: e.title,
    persona: e.fields.Persona ?? '',
    pillar: e.fields['Primary Messaging Pillar'] ?? '',
    driver: e.fields['Primary GTM Value Driver'] ?? '',
    concern: sec(e, 'Their concern').text,
    message: sec(e, 'Value message').text,
    proof: sec(e, 'Proof points').list,
    land: sec(e, 'How to land it').text,
    traces: [...new Set(sec(e, 'Traces to').list.flatMap(idsIn))],
  }),
  valueMap: (e) => ({
    id: e.id,
    title: e.title,
    persona: e.fields.Persona ?? '',
    message: sec(e, 'Value message').text,
    mentalModel: sec(e, 'Mental model').text,
    delivered: sec(e, 'How it is delivered').text,
    capabilities: [...new Set([...sec(e, 'Primary capabilities').list, ...sec(e, 'Supporting capabilities').list].flatMap(idsIn))],
    traces: [...new Set(sec(e, 'Traces to').list.flatMap(idsIn))],
  }),
  useCases: (e) => ({
    id: e.id,
    title: e.title,
    pillar: e.fields['Primary Messaging Pillar'] ?? '',
    driver: e.fields['Primary GTM Value Driver'] ?? '',
    definition: sec(e, 'Definition').text,
    solution: sec(e, 'Solution').text,
    capabilities: sec(e, 'Key capabilities').list,
    winThemes: sec(e, 'Win themes').list,
  }),
};

/** Which kind of reference a Markdown file is, and its entries, shaped. */
export function parseLibraryFile(markdown) {
  const md = String(markdown ?? '').replace(/\r/g, '');
  const h1 = /^#\s+(.+)$/m.exec(md)?.[1] ?? '';
  const kind = KINDS.find(([, re]) => re.test(h1))?.[0];
  if (!kind) throw fail(400, `“${h1 || 'This file'}” is not one of the library’s references (Business Goals & Success Criteria, Capability Reference, Value Messaging, Value Map, Use Case Cards).`);
  const blocks = md.split(/\n(?=###\s+[A-Z]+-\d+:)/).filter((b) => /^###\s+[A-Z]+-\d+:/.test(b));
  const entries = blocks.map(parseEntry).map(SHAPE[kind]);
  return { kind, title: h1.trim(), entries };
}

export class Library {
  #db;
  constructor(db) {
    this.#db = db;
  }

  get data() {
    return this.#db.read('library', null);
  }

  /** Bring in one or more reference files; each replaces the earlier copy of its kind. */
  import(files, actor) {
    const lib = { ...(this.data ?? {}) };
    const taken = [];
    for (const f of files) {
      const r = parseLibraryFile(f.text);
      lib[r.kind] = r.entries;
      lib.files = { ...(lib.files ?? {}), [r.kind]: { name: f.name, title: r.title, entries: r.entries.length, at: new Date().toISOString(), by: actor?.name ?? '' } };
      taken.push({ kind: r.kind, title: r.title, entries: r.entries.length });
    }
    this.#db.write('library', lib);
    return taken;
  }

  remove() {
    this.#db.write('library', null);
  }

  summary() {
    const d = this.data;
    return d ? { files: d.files ?? {}, counts: Object.fromEntries(['goals', 'capabilities', 'values', 'valueMap', 'useCases'].map((k) => [k, d[k]?.length ?? 0])) } : null;
  }

  goals() {
    return this.data?.goals ?? [];
  }

  byId(id) {
    const d = this.data;
    if (!d) return null;
    for (const k of ['goals', 'capabilities', 'values', 'valueMap', 'useCases']) {
      const hit = (d[k] ?? []).find((x) => x.id === id);
      if (hit) return { kind: k, ...hit };
    }
    return null;
  }

  /** What to say for a goal: the value messages and use cases it traces to. */
  talkTrack(goalIds) {
    const d = this.data;
    if (!d) return [];
    return goalIds
      .map((gid) => {
        const g = (d.goals ?? []).find((x) => x.id === gid);
        if (!g) return null;
        const values = (d.values ?? []).filter((v) => g.traces.includes(v.id) || g.traces.includes(v.id.replace('VM-', 'VMAP-')));
        const useCases = (d.useCases ?? []).filter((u) => g.traces.includes(u.id));
        return { goal: { id: g.id, title: g.title, persona: g.persona, driver: g.driver }, values, useCases: useCases.map((u) => ({ id: u.id, title: u.title, definition: u.definition, winThemes: u.winThemes })) };
      })
      .filter(Boolean);
  }

  capability(catalogId) {
    return (this.data?.capabilities ?? []).find((c) => c.catalogId === catalogId) ?? null;
  }
}
