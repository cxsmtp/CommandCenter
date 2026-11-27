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

// ——— Staying connected ———
// While Kendra restarts (an update, a restore) requests wait and try again for up to 45 s, with a small notice,
// instead of failing. A session that ended opens a sign-in box over the page: nothing on screen is lost, and the
// request that met the end runs again once signed in.
const RETRY_MS = 45_000;
let reconnecting = 0;
function reconnectNotice(on) {
  reconnecting = Math.max(0, reconnecting + (on ? 1 : -1));
  let el = document.getElementById('reconnect');
  if (!reconnecting) return el?.remove();
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'reconnect', role: 'status', textContent: 'Kendra is restarting — reconnecting…' });
    document.body.append(el);
  }
}
let reauth = null;
function signInAgain() {
  reauth ??= new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog reauth';
    d.innerHTML = `<form class="dbody" id="reauthF" data-no-draft><h2>Your session ended</h2><p class="muted" style="margin:0">Sign in to carry on. Everything on this page stays as it is.</p>
      <label class="field">Email<input name="email" type="email" autocomplete="username" required value="${esc(state.session?.user?.email ?? '')}"></label>
      <label class="field">Password<input name="password" type="password" autocomplete="current-password" required autofocus></label>
      <p class="form-error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-out>Go to the sign-in page</button><span class="spacer"></span><button class="btn primary">Sign in</button></div></form>`;
    document.body.append(d);
    d.showModal();
    const done = (ok) => {
      d.close();
      d.remove();
      reauth = null;
      resolve(ok);
    };
    d.addEventListener('cancel', (e) => e.preventDefault());
    d.querySelector('[data-out]').addEventListener('click', () => done(false));
    d.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const r = await fetch('/api/login', { method: 'POST', headers: { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) }).catch(() => null);
      const j = (await r?.json().catch(() => ({}))) ?? {};
      if (r?.ok) {
        if (state.session) state.session.expiresAt = j.expiresAt;
        return done(true);
      }
      f.querySelector('.form-error').textContent = j.error || 'Kendra cannot be reached right now.';
    });
  });
  return reauth;
}

export async function api(path, { method = 'GET', body } = {}) {
  const started = Date.now();
  let waiting = false;
  try {
    for (;;) {
      let res;
      try {
        res = await fetch(`/api${path}`, { method, headers: { 'X-Requested-With': 'Kendra', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      } catch {
        // Not reached at all (the server is between processes): nothing was done, so it is safe to try again.
        if (Date.now() - started < RETRY_MS) {
          if (!waiting) reconnectNotice((waiting = true));
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw new ApiError('Kendra cannot be reached. Check your connection, then try again.');
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.restarting && Date.now() - started < RETRY_MS) {
        if (!waiting) reconnectNotice((waiting = true));
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (res.status === 401 && path !== '/login') {
        if (state.session?.user && (await signInAgain())) continue;
        document.dispatchEvent(new CustomEvent('cc:signed-out'));
        throw new ApiError('Sign in first.');
      }
      if (!res.ok) throw new ApiError(data.error || `${res.status} ${res.statusText}`);
      return data;
    }
  } finally {
    if (waiting) reconnectNotice(false);
  }
}

// ——— Drafts: what someone is typing is kept until it is saved ———
// Any form with an id keeps its typed values (not passwords or files) per page, for a day. If the page reloads or the
// form opens again before it was saved, they are put back.
const DRAFT_DAY = 86_400_000;
const draftKey = (f) => `cc.draft.${state.session?.user?.id ?? ''}.${location.hash.split('?')[0]}.${f.id}`;
// Never kept: passwords, keys, secrets and tokens (by type, by name, or a form or field marked data-no-draft).
const SECRET = /pass|secret|token|api.?key|private|credential|(^|_)key$/i;
const draftable = (el) => el.name && !['password', 'file', 'hidden', 'submit', 'button'].includes(el.type) && !SECRET.test(el.name) && el.dataset?.noDraft == null && el.autocomplete !== 'new-password';
// Drafts written before secrets were left out, and other people's drafts on this browser, go.
export function purgeDrafts({ all = false } = {}) {
  try {
    const me = state.session?.user?.id ?? '';
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('cc.draft.')) continue;
      let bad = all || !me || !k.startsWith(`cc.draft.${me}.`);
      if (!bad) {
        try {
          const d = JSON.parse(localStorage.getItem(k) ?? 'null');
          bad = !d || Object.keys(d.values ?? {}).some((n) => SECRET.test(n)) || Date.now() - d.at > DRAFT_DAY;
        } catch {
          bad = true;
        }
      }
      if (bad) localStorage.removeItem(k);
    }
  } catch {}
}
let draftTimer;
document.addEventListener('input', (e) => {
  const f = e.target.closest?.('form[id]');
  if (!f || f.dataset.noDraft != null || !draftable(e.target)) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const values = {};
    for (const el of f.elements) if (draftable(el)) values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    try {
      localStorage.setItem(draftKey(f), JSON.stringify({ at: Date.now(), values }));
    } catch {}
  }, 400);
});
// Sent: the draft is done with, at once (a form that stays on the page must not refill itself after Add or Save).
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (!f.id) return;
  clearTimeout(draftTimer);
  try {
    localStorage.removeItem(draftKey(f));
  } catch {}
  f.querySelector('.draft-note')?.remove();
}, true);
new MutationObserver(() => {
  for (const f of document.querySelectorAll('form[id]:not([data-draft-checked])')) {
    f.dataset.draftChecked = '1';
    let d;
    try {
      d = JSON.parse(localStorage.getItem(draftKey(f)) ?? 'null');
    } catch {}
    if (!d || Date.now() - d.at > DRAFT_DAY || f.dataset.noDraft != null) continue;
    let changed = 0;
    for (const el of f.elements) {
      if (!draftable(el) || !(el.name in d.values)) continue;
      const v = d.values[el.name];
      if (el.type === 'checkbox' ? el.checked !== v : el.value !== v) {
        el.type === 'checkbox' ? (el.checked = v) : (el.value = v);
        changed += 1;
      }
    }
    if (changed) {
      const note = Object.assign(document.createElement('p'), { className: 'small draft-note', innerHTML: 'Put back what you were typing. <button type="button" class="linkish">Discard it</button>' });
      note.querySelector('button').addEventListener('click', () => {
        localStorage.removeItem(draftKey(f));
        note.remove();
        f.reset();
      });
      f.prepend(note);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

/** POST that returns a file: saved through a temporary link. */
export async function download(path, body, fallbackName = 'download') {
  // A deck takes a few seconds to make: say so, then say it is done.
  const slow = setTimeout(() => toast('Preparing the file…'), 600);
  let res;
  try {
    res = await fetch(`/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Requested-With': 'Kendra', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } finally {
    clearTimeout(slow);
  }
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error || `${res.status} ${res.statusText}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Downloaded: ${decodeURIComponent(name)}`);
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

// ——— Dialogs and sheets ———
// One dialog element for forms (#dialog) and one for questions (#ask), both native <dialog> (focus stays inside,
// Escape closes). On a phone they are full-height sheets. The phone's Back button closes the one on top instead of
// leaving the page, and focus goes back to what opened it.
const openStack = [];
// Back steps we take ourselves when a sheet closes by its own button: their popstate must not close the next sheet.
let ownBacks = 0;
function track(d) {
  const opener = document.activeElement;
  history.pushState({ meridianSheet: openStack.length + 1 }, '');
  openStack.push(d);
  d.addEventListener(
    'close',
    () => {
      const i = openStack.indexOf(d);
      if (i >= 0) openStack.splice(i, 1);
      // Closed by a button or Escape: take back the history entry we added (not when Back closed it).
      if (!d.dataset.closedByBack && history.state?.meridianSheet) {
        ownBacks += 1;
        history.back();
      }
      delete d.dataset.closedByBack;
      if (opener && document.contains(opener)) opener.focus?.({ preventScroll: true });
    },
    { once: true },
  );
}
addEventListener('popstate', () => {
  if (ownBacks > 0) {
    ownBacks -= 1;
    return;
  }
  const top = openStack.at(-1);
  if (top?.open) {
    top.dataset.closedByBack = '1';
    top.close('');
  }
});

/** Resolves once the Back steps of closed sheets have happened, so a navigation made after a dialog is not undone. */
export const sheetsSettled = (limit = 600) =>
  new Promise((resolve) => {
    const end = Date.now() + limit;
    const check = () => (ownBacks > 0 && Date.now() < end ? setTimeout(check, 15) : resolve());
    setTimeout(check, 0);
  });

/** The form dialog: `html` inside, `onOpen(el)` to wire it. Resolves with its return value when it closes. */
export function openDialog(html, { wide = false, onOpen } = {}) {
  const d = $('#dialog');
  d.className = `dialog${wide ? ' wide' : ''}`;
  d.innerHTML = html;
  d.showModal();
  track(d);
  onOpen?.(d);
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue), { once: true }));
}
export const closeDialog = (value = '') => $('#dialog').close(value);

/**
 * The app's own question, never the browser's: `ask('Remove this note?', { ok: 'Remove', danger: true })` resolves
 * true or false; with `input` it resolves the text typed (or null when cancelled). Focus starts on Cancel for a
 * destructive question.
 */
export function ask(message, { title = '', ok = 'OK', cancel = 'Cancel', danger = false, input = null, placeholder = '', detail = '' } = {}) {
  let d = $('#ask');
  if (!d) {
    d = Object.assign(document.createElement('dialog'), { id: 'ask', className: 'dialog ask' });
    document.body.append(d);
  }
  d.innerHTML = `<form method="dialog" class="ask-form">
    ${title ? `<h2>${esc(title)}</h2>` : ''}<p class="ask-msg">${esc(message)}</p>${detail ? `<p class="muted small" style="margin:0">${esc(detail)}</p>` : ''}
    ${input !== null ? `<input name="answer" value="${esc(input)}" placeholder="${esc(placeholder)}" autocomplete="off">` : ''}
    <div class="dialog-actions"><button value="cancel" class="btn" ${danger ? 'autofocus' : ''}>${esc(cancel)}</button><button value="ok" class="btn ${danger ? 'danger-fill' : 'primary'}" ${danger ? '' : 'autofocus'}>${esc(ok)}</button></div>
  </form>`;
  d.showModal();
  track(d);
  if (input !== null) d.querySelector('input').focus();
  return new Promise((resolve) =>
    d.addEventListener('close', () => {
      const yes = d.returnValue === 'ok';
      resolve(input !== null ? (yes ? d.querySelector('input').value : null) : yes);
    }, { once: true }),
  );
}

/** A button that cannot be pressed twice while its action runs. */
export async function busy(button, fn) {
  if (button?.disabled) return undefined;
  if (button) button.disabled = true;
  try {
    return await fn();
  } finally {
    if (button) button.disabled = false;
  }
}

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
  project: ['+', 'Project created'],
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
/** A ring gauge: the share of success criteria completed. */
export function ring(p, { size = 56, label = true } = {}) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = p.total ? p.percent : 0;
  return `<span class="ring" style="width:${size}px;height:${size}px" title="${p.met} of ${p.total} criteria completed successfully"><svg viewBox="0 0 56 56" aria-hidden="true"><circle class="ring-track" cx="28" cy="28" r="${r}"/><circle class="ring-fill" cx="28" cy="28" r="${r}" stroke-dasharray="${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/></svg>${label ? `<b>${p.total ? `${pct}<small>%</small>` : '—'}</b>` : ''}</span>`;
}
const FORECAST_CLASS = { 'on-track': 'ok', done: 'ok', 'at-risk': 'warn', 'no-pace': 'warn', late: 'bad', none: '' };
export const forecastLine = (f) => (f ? `<div class="fc fc-${esc(f.state)} ${FORECAST_CLASS[f.state] ?? ''}"><span class="fc-dot"></span>${esc(f.label)}</div>` : '');
export const scanTypeBadge = (t) => (t === 'fusion' ? '<span class="badge fusion">Fusion</span>' : t === 'last' ? '<span class="badge last">LAST</span>' : '');
export const stageBadge = (stage) => `<span class="badge ${stage === 'pov' ? 'accent' : stage === 'won' ? 'ok' : stage === 'lost' ? 'bad' : ''}">${esc(state.meta?.stages?.[stage] ?? stage)}</span>`;
export function daysBadge(r) {
  if (r.stage !== 'pov' || r.daysLeft === null || r.daysLeft === undefined) return '';
  const d = r.daysLeft;
  return `<span class="badge ${d < 0 ? 'bad' : d <= 7 ? 'warn' : ''}">${d < 0 ? `${-d} d over` : d === 0 ? 'ends today' : `${d} d left`}</span>`;
}
export function alertList(alerts, muted) {
  if (!alerts?.length) return '';
  return `<div class="alerts">${alerts.map((a) => `<div class="a ${muted ? 'muted' : a.level === 'bad' ? 'bad-t' : 'warn-t'}"><span class="dot ${muted ? '' : a.level}"></span>${esc(a.what)}</div>`).join('')}${muted ? '<div class="a muted small">Muted</div>' : ''}</div>`;
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
    sorted.length ? sorted.map((r) => `<tr ${rowAttrs(r)}>${columns.map((c) => `<td class="${c.n ? 'n' : ''}" data-label="${esc(String(c.label).replace(/<[^>]+>/g, ''))}">${c.html(r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="muted">${empty}</td></tr>`
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
