// Shared helpers for every view: the API, escaping, formatting, the dialog, toasts and the app's state.
import { colourIndex } from './tenant-colour.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString());
export const tc = (c) => `var(--tc-${colourIndex(c)})`;
export const initials = (name) => String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const state = { session: null, meta: null, users: null, tree: null, overview: null };
export const can = (p) => state.session?.permissions?.includes(p);

export const local = {
  get(k, d = null) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

export class ApiError extends Error {}
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: { 'X-Requested-With': 'CommandCenter', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    document.dispatchEvent(new CustomEvent('cc:signed-out'));
    throw new ApiError('Sign in first.');
  }
  if (!res.ok) throw new ApiError(data.error || `${res.status} ${res.statusText}`);
  return data;
}

/** POST that returns a file: saved through a temporary link. */
export async function download(path, body, fallbackName = 'download') {
  const res = await fetch(`/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Requested-With': 'CommandCenter', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error || `${res.status} ${res.statusText}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function ago(iso) {
  const t = Date.parse(iso ?? '');
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.ceil(f / 60)} min`;
    if (f < 86400) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} d`;
  }
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const day = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

let toastTimer;
export function toast(message, { bad = false } = {}) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: `toast${bad ? ' bad' : ''}`, textContent: message });
  el.setAttribute('role', 'status');
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

/** Run an action, saying what went wrong if it fails. */
export async function attempt(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (error) {
    toast(error.message, { bad: true });
    return undefined;
  }
}

/** The one dialog: `html` inside, `onOpen(el)` to wire it. Resolves when it closes. */
export function openDialog(html, { wide = false, onOpen } = {}) {
  const d = $('#dialog');
  d.className = `dialog${wide ? ' wide' : ''}`;
  d.innerHTML = html;
  d.showModal();
  onOpen?.(d);
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue), { once: true }));
}
export const closeDialog = (value = '') => $('#dialog').close(value);

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.list) (out[el.name] ??= []).push(...(el.checked ? [el.value] : []));
      else out[el.name] = el.checked;
    } else out[el.name] = el.value;
  }
  return out;
}

export async function copy(textValue) {
  try {
    await navigator.clipboard.writeText(textValue);
    toast('Copied');
  } catch {
    toast('Could not copy here; select the text and copy it.', { bad: true });
  }
}

// ——— Shared bits of markup ———
export const HEALTH = { healthy: 'Healthy', attention: 'Failed scans', idle: 'Quiet (3+ days)', failed: 'Cannot read', loading: 'Reading…' };
export const KIND = {
  completed: ['✓', 'Scan completed'],
  failed: ['✕', 'Scan failed'],
  partial: ['◐', 'Scan partly completed'],
  canceled: ['⊘', 'Scan canceled'],
  running: ['▶', 'Scan running'],
  queued: ['…', 'Scan queued'],
  project: ['＋', 'Project created'],
  other: ['•', 'Scan'],
};

export function sevBar(f) {
  if (!f || !f.total) return '<div class="sevbar"></div>';
  const sum = Math.max(1, f.critical + f.high + f.medium + f.low);
  return `<div class="sevbar">${['critical', 'high', 'medium', 'low'].map((s) => `<span class="s-${s}" style="width:${(100 * f[s]) / sum}%" title="${s}: ${f[s]}"></span>`).join('')}</div>`;
}
export function sevLegend(f, delta) {
  if (!f) return '<div class="sev-legend">Results not read yet</div>';
  const d = (v) => (v > 0 ? ` <span class="delta-up">▲${v}</span>` : v < 0 ? ` <span class="delta-down">▼${-v}</span>` : '');
  return `<div class="sev-legend"><span>Critical <b>${fmt(f.critical)}</b>${delta ? d(delta.critical) : ''}</span><span>High <b>${fmt(f.high)}</b>${delta ? d(delta.high) : ''}</span><span>Medium <b>${fmt(f.medium)}</b></span><span>Low <b>${fmt(f.low)}</b></span></div>`;
}
export function spark(trend) {
  const pts = (trend ?? []).map((t) => t.ch);
  if (pts.length < 2) return '';
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 108 + 1).toFixed(1)},${(26 - ((v - min) / Math.max(1, max - min)) * 24).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 110 28" role="img" aria-label="Critical and high results over time"><path d="${d}"/></svg>`;
}
export function progressBar(p, { label = true } = {}) {
  return `${label ? `<div class="prog-line"><span>Success criteria ${p.met}/${p.total}${p.must ? ` · must-haves ${p.mustMet}/${p.must}` : ''}</span><b>${p.percent}%</b></div>` : ''}<div class="progress" title="${p.percent}%"><span style="width:${p.percent}%"></span></div>`;
}
export const scanTypeBadge = (t) => (t === 'fusion' ? '<span class="badge fusion">Fusion</span>' : t === 'last' ? '<span class="badge last">LAST</span>' : '');
export const stageBadge = (stage) => `<span class="badge ${stage === 'pov' ? 'accent' : stage === 'won' ? 'ok' : stage === 'lost' ? 'bad' : ''}">${esc(state.meta?.stages?.[stage] ?? stage)}</span>`;
export function daysBadge(r) {
  if (r.stage !== 'pov' || r.daysLeft === null || r.daysLeft === undefined) return '';
  const d = r.daysLeft;
  return `<span class="badge ${d < 0 ? 'bad' : d <= 7 ? 'warn' : ''}">${d < 0 ? `${-d} d over` : d === 0 ? 'ends today' : `${d} d left`}</span>`;
}
export function alertList(alerts, muted) {
  if (!alerts?.length) return '';
  return `<div class="alerts">${alerts.map((a) => `<div class="a ${muted ? 'muted' : a.level === 'bad' ? 'bad-t' : 'warn-t'}"><span class="dot ${muted ? '' : a.level}"></span>${esc(a.what)}</div>`).join('')}${muted ? '<div class="a muted small">🔕 Muted</div>' : ''}</div>`;
}

/** A sortable table. `columns`: [{ label, key(row), html(row), n }]. Sorting is kept per table id. */
const sorts = local.get('cc.sorts', {});
export function table(id, columns, rows, { rowAttrs = () => '', empty = 'None.' } = {}) {
  const s = sorts[id] ?? { col: null, dir: 1 };
  const sorted = s.col === null || !columns[s.col] ? rows : [...rows].sort((a, b) => {
    const x = columns[s.col].key(a);
    const y = columns[s.col].key(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * s.dir;
  });
  return `<div class="table-wrap"><table data-table="${id}"><thead><tr>${columns.map((c, i) => `<th class="${c.n ? 'n' : ''}" ${c.key ? `data-col="${i}"` : ''}>${c.label}${s.col === i ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${
    sorted.length ? sorted.map((r) => `<tr ${rowAttrs(r)}>${columns.map((c) => `<td class="${c.n ? 'n' : ''}">${c.html(r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="muted">${empty}</td></tr>`
  }</tbody></table></div>`;
}
document.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-col]');
  if (!th) return;
  const id = th.closest('table').dataset.table;
  const col = Number(th.dataset.col);
  sorts[id] = { col, dir: sorts[id]?.col === col ? -sorts[id].dir : 1 };
  local.set('cc.sorts', sorts);
  document.dispatchEvent(new CustomEvent('cc:rerender'));
});

/** People as <option>s, indented by their place in the tree. */
export function peopleOptions(selected = '', { any = false, anyLabel = 'Everyone' } = {}) {
  const out = any ? [`<option value="">${esc(anyLabel)}</option>`] : [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push(`<option value="${esc(n.id)}" ${n.id === selected ? 'selected' : ''}>${'  '.repeat(depth)}${depth ? '└ ' : ''}${esc(n.name)} · ${esc(n.roleLabel)}</option>`);
      walk(n.reports ?? [], depth + 1);
    }
  };
  walk(state.tree ?? [], 0);
  return out.join('');
}

export const avatar = (name) => `<span class="avatar" aria-hidden="true">${esc(initials(name))}</span>`;
export async function reloadPeople() {
  const people = await api('/users');
  state.users = people.users;
  state.tree = people.tree;
}
