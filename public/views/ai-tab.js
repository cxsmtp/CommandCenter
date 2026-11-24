// The AI & value tab of a POV: what the AI actions saved, the credits (the tenant's and the POV's pool), the backlog
// AI could clear, a run planned and confirmed before any credit is spent, every run so far, and the value rates.
import { $, esc, api, fmt, when, toast, attempt, openDialog, closeDialog, ask } from '../core.js';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const money = (v, cur) => (v == null ? '—' : new Intl.NumberFormat('en', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(v));
const num = (v) => (v == null ? '—' : fmt(Math.round(v * 10) / 10));

export function aiTab() {
  return '<div id="aiTab"><section class="panel"><div class="body"><p class="muted" style="margin:0">Reading the credits and the value…</p></div></section></div>';
}

export async function wireAiTab(main, oppId, { canEdit, rerender }) {
  const box = $('#aiTab', main);
  if (!box) return;
  let d;
  try {
    d = await api(`/opportunities/${oppId}/ai`);
  } catch (e) {
    box.innerHTML = `<section class="panel"><div class="body"><p class="bad-t" style="margin:0">${esc(e.message)}</p></div></section>`;
    return;
  }
  const v = d.value ?? {};
  const cur = v.rates?.currency ?? d.rates?.currency ?? 'USD';
  const c = v.credits;
  const p = d.pool ?? {};
  const b = v.backlog;
  const tile = (value, label, sub = '') => `<div class="kpi"><b>${value}</b><span>${label}</span>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;
  box.innerHTML = `
    <section class="panel" style="margin-bottom:16px"><div class="head"><h3>Value of AI in this POV</h3><span class="small muted">from the AI actions Checkmarx One counted in 30 days</span></div>
      <div class="body"><div class="kpis">
        ${tile(num(v.hours?.total), 'hours saved', `${num(v.hours?.triage)} h triage · ${num(v.hours?.fix)} h fixing`)}
        ${tile(money(v.value, cur), 'worth of that time', `at ${money(v.rates?.hourlyRate, cur)} an hour`)}
        ${tile(fmt(v.actions?.triaged ?? 0), 'findings triaged by AI', v.actions?.fromKendra?.triage ? `${fmt(v.actions.fromKendra.triage)} run from Kendra` : '')}
        ${tile(fmt(v.actions?.fixed ?? 0), 'fixes proposed by AI', v.actions?.fromKendra?.remediation ? `${fmt(v.actions.fromKendra.remediation)} run from Kendra` : '')}
        ${v.roi != null ? tile(`${v.roi}×`, 'return on credits', `${money(v.cost, cur)} of credits`) : ''}
      </div></div></section>
    <div class="grid-2" style="margin-bottom:16px">
      <section class="panel"><div class="head"><h3>Credits</h3>${d.canAllocate ? '<button class="btn sm" data-act="pool">Set the POV’s pool</button>' : ''}</div><div class="body stack">
        ${c ? `<div class="kv"><span>Left in the tenant</span><b>${num(c.available)}</b></div><div class="kv"><span>Used in 30 days</span><b>${num(c.used30d)}</b></div><div class="kv"><span>…by AI actions</span><b>${num(c.ai)}</b></div><div class="kv"><span>…by Fusion scans</span><b>${num(c.fusion)}</b></div>` : `<p class="muted" style="margin:0">${d.hasTenant ? 'The tenant does not report credits (no AI licence, or the key lacks the permission).' : 'Connect a tenant to see its credits.'}</p>`}
        <hr class="sep"><div class="kv"><span>POV pool</span><b>${p.size == null ? 'Not set' : `${fmt(p.left)} left of ${fmt(p.size)}`}</b></div>
        ${p.size != null ? `<div class="bar-track"><i style="width:${Math.min(100, Math.round(((p.spent + (p.reserved ?? 0)) / Math.max(1, p.size)) * 100))}%"></i></div><p class="small muted" style="margin:0">${fmt(p.spent)} spent from Kendra${p.setBy ? ` · set by ${esc(p.setBy)}` : ''}</p>` : '<p class="small muted" style="margin:0">A manager sets how many credits this POV may spend from Kendra.</p>'}
      </div></section>
      <section class="panel"><div class="head"><h3>AI backlog</h3><span class="small muted">on the latest scans</span></div><div class="body stack">
        ${b ? `<div class="kv"><span>Findings to triage</span><b>${fmt(b.toTriage)}</b></div><div class="kv"><span>Confirmed, to fix</span><b>${fmt(b.toFix)}</b></div><div class="kv"><span>Credits to clear it with AI</span><b>${fmt(b.credits)}</b></div>
          <p class="small" style="margin:0">${b.covered == null ? '' : b.covered ? '<span class="ok-t">The tenant’s credits cover it.</span>' : `<span class="warn-t">Short by ${fmt(b.shortBy)} credits.</span>`} By hand it would take about <b>${num(b.hoursIfManual)} hours</b> (${money(b.valueIfAi, cur)}).</p>` : '<p class="muted" style="margin:0">Shown once the tenant has been read.</p>'}
      </div></section>
    </div>
    ${d.canRun && d.hasTenant ? `<section class="panel" style="margin-bottom:16px"><div class="head"><h3>Run AI on the findings</h3><span class="small muted">planned first: nothing is spent until you confirm</span></div><div class="body stack">
      <div class="seg" role="group" aria-label="Action" style="align-self:flex-start;width:auto"><button type="button" data-action="triage" aria-pressed="true">AI Triage</button><button type="button" data-action="remediation" aria-pressed="false">AI Remediation</button></div>
      <div class="wz-chips">${SEVERITIES.map((s) => `<button type="button" class="wz-chip ${['Critical', 'High'].includes(s) ? 'must' : ''}" data-sev="${s}" aria-pressed="${['Critical', 'High'].includes(s)}">${s}</button>`).join('')}</div>
      <div class="row"><button class="btn" data-act="plan">See what it would cost</button><span class="small muted" id="aiPlan"></span></div>
    </div></section>` : ''}
    <section class="panel" style="margin-bottom:16px"><div class="head"><h3>Runs from Kendra</h3></div>
      ${(d.ledger ?? []).length ? `<div class="list" style="padding:8px 16px">${d.ledger.slice(0, 30).map((e) => `<div class="item"><div class="top"><b>${e.action === 'triage' ? 'AI Triage' : 'AI Remediation'} · ${fmt(e.findings)} finding${e.findings === 1 ? '' : 's'}</b><span class="small muted">${esc(when(e.at))}</span></div><div class="small muted">${esc(e.by ?? '')} · ${fmt(e.credits ?? 0)} credits · ${esc(e.outcome)}</div></div>`).join('')}</div>` : '<p class="empty-line" style="padding:16px">No runs from Kendra yet.</p>'}</section>
    <section class="panel"><div class="head"><h3>Value rates</h3>${d.canEditRates ? '<button class="btn sm" data-act="rates">Change for this POV</button>' : ''}</div><div class="body small">
      ${num(v.rates?.triageMinutes)} minutes saved per finding triaged · ${num(v.rates?.fixMinutes)} minutes per fix · ${money(v.rates?.hourlyRate, cur)} an hour · ${v.rates?.creditPrice ? `${money(v.rates.creditPrice, cur)} a credit` : 'credit price not set'}${Object.keys(d.ownRates ?? {}).length ? ' · <b>set for this POV</b>' : ' · organisation rates'}
    </div></section>`;

  // Planning and running
  let action = 'triage';
  for (const bt of box.querySelectorAll('[data-action]'))
    bt.addEventListener('click', () => {
      action = bt.dataset.action;
      for (const x of box.querySelectorAll('[data-action]')) x.setAttribute('aria-pressed', String(x === bt));
    });
  for (const bt of box.querySelectorAll('[data-sev]'))
    bt.addEventListener('click', () => {
      const on = bt.getAttribute('aria-pressed') !== 'true';
      bt.setAttribute('aria-pressed', String(on));
      bt.classList.toggle('must', on);
    });
  box.querySelector('[data-act="plan"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const severities = [...box.querySelectorAll('[data-sev][aria-pressed="true"]')].map((x) => x.dataset.sev);
    if (!severities.length) return toast('Pick at least one severity.', { bad: true });
    btn.disabled = true;
    $('#aiPlan', box).textContent = 'Reading the findings…';
    try {
      await api(`/opportunities/${oppId}/ai/findings`, { method: 'POST', body: {} });
      const { plan } = await api(`/opportunities/${oppId}/ai/plan`, { method: 'POST', body: { action, severities } });
      $('#aiPlan', box).textContent = '';
      const what = action === 'triage' ? 'AI Triage' : 'AI Remediation';
      if (!plan.findings) return toast(plan.blockers?.[0] ?? 'Nothing to run on with these choices.', { bad: true });
      const ok = await ask(`${what} on ${fmt(plan.findings)} finding${plan.findings === 1 ? '' : 's'} (${severities.join(', ').toLowerCase()}) costs ${fmt(plan.credits)} credits.${plan.pool?.size != null ? ` The POV’s pool has ${fmt(plan.pool.left)} left.` : ''}${plan.blockers?.length ? `\n\n${plan.blockers.join('\n')}` : ''}`, { ok: plan.blockers?.length ? 'Close' : `Run it: ${fmt(plan.credits)} credits` });
      if (!ok || plan.blockers?.length) return;
      const r = await attempt(() => api(`/opportunities/${oppId}/ai/run`, { method: 'POST', body: { action, severities, confirm: true, credits: plan.credits } }));
      if (r) {
        toast(`${what} sent on ${fmt(r.result.sent)} finding${r.result.sent === 1 ? '' : 's'}: ${fmt(r.result.charged)} credits`);
        rerender();
      }
    } catch (err) {
      $('#aiPlan', box).textContent = '';
      toast(err.message, { bad: true });
    } finally {
      btn.disabled = false;
    }
  });

  // The pool and the rates
  box.querySelector('[data-act="pool"]')?.addEventListener('click', () =>
    openDialog(
      `<form id="poolF" class="dbody"><h2>The POV’s credit pool</h2><p class="small muted">How many credits this POV may spend on AI actions run from Kendra. Empty removes the limit.</p>
        <label class="field">Credits<input type="number" min="0" max="1000000" name="size" value="${esc(p.size ?? '')}"></label>
        <div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
      {
        onOpen(dl) {
          dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
          dl.querySelector('#poolF').addEventListener('submit', async (e) => {
            e.preventDefault();
            const size = e.target.size.value;
            if (await attempt(() => api(`/opportunities/${oppId}/ai/pool`, { method: 'PUT', body: { size: size === '' ? null : Number(size) } }), 'Pool saved')) {
              closeDialog();
              rerender();
            }
          });
        },
      },
    ),
  );
  box.querySelector('[data-act="rates"]')?.addEventListener('click', () => {
    const r = { ...(d.orgRates ?? {}), ...(d.ownRates ?? {}) };
    openDialog(
      `<form id="ratesF" class="dbody"><h2>Value rates for this POV</h2><p class="small muted">How the time AI saves is counted. Empty fields use the organisation’s rates.</p>
        <div class="row"><label class="field">Minutes saved per finding triaged<input type="number" min="0" name="triageMinutes" value="${esc(d.ownRates?.triageMinutes ?? '')}" placeholder="${esc(r.triageMinutes ?? 20)}"></label><label class="field">Minutes saved per fix<input type="number" min="0" name="fixMinutes" value="${esc(d.ownRates?.fixMinutes ?? '')}" placeholder="${esc(r.fixMinutes ?? 120)}"></label></div>
        <div class="row"><label class="field">Hourly rate<input type="number" min="0" name="hourlyRate" value="${esc(d.ownRates?.hourlyRate ?? '')}" placeholder="${esc(r.hourlyRate ?? 75)}"></label><label class="field">Price of a credit<input type="number" min="0" step="0.01" name="creditPrice" value="${esc(d.ownRates?.creditPrice ?? '')}" placeholder="${esc(r.creditPrice ?? 0)}"></label><label class="field">Currency<input name="currency" maxlength="3" value="${esc(d.ownRates?.currency ?? '')}" placeholder="${esc(r.currency ?? 'USD')}"></label></div>
        <div class="dialog-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`,
      {
        onOpen(dl) {
          dl.querySelector('[data-close]').addEventListener('click', () => closeDialog());
          dl.querySelector('#ratesF').addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = e.target;
            const valueRates = {};
            for (const k of ['triageMinutes', 'fixMinutes', 'hourlyRate', 'creditPrice']) if (f[k].value !== '') valueRates[k] = Number(f[k].value);
            if (f.currency.value.trim()) valueRates.currency = f.currency.value.trim().toUpperCase();
            if (await attempt(() => api(`/opportunities/${oppId}`, { method: 'PATCH', body: { valueRates } }), 'Rates saved')) {
              closeDialog();
              rerender();
            }
          });
        },
      },
    );
  });
}
