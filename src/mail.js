/**
 * Email: drafts written from an opportunity (discovery recap, POV kick-off, weekly status, POV completion), which the
 * SE edits and then sends through the server's SMTP account, downloads as an .eml to send from their own mail
 * client, or copies. Every draft and send is kept in the outbox, so a manager sees what went to the customer.
 */
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { randomUUID } from 'node:crypto';
import { fail, text, email as cleanEmail } from './db.js';
import { STAGES, CRITERION_STATUS, SESSION_TYPES, progressOf, statusText, demoText } from './opportunities.js';
import { CATEGORIES } from './catalog.js';

const daysTo = (date, now = Date.now()) => Math.round((Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) - Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export const TEMPLATES = {
  discovery: 'Discovery recap',
  kickoff: 'POV kick-off',
  weekly: 'Weekly POV status',
  completion: 'POV completion',
  blank: 'Blank email',
};

const fmtDate = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const bullet = (items) => items.filter(Boolean).map((x) => `  • ${x}`).join('\n');
const nice = (list) => (list ?? []).filter(Boolean).join(', ');

/**
 * A draft for `template`: { to, cc, subject, body } in plain text, which the page shows for editing.
 * `owner`: the SE; `live`: the tenant's summary when there is one; `catalog`: to name requested capabilities.
 */
export function draft(template, opp, { owner, live, catalog }) {
  const customerTo = (opp.stakeholders ?? []).filter((s) => s.side === 'customer' && s.notify && s.email).map((s) => s.email);
  const internalCc = (opp.stakeholders ?? []).filter((s) => s.side === 'internal' && s.notify && s.email).map((s) => s.email);
  const first = (opp.stakeholders ?? []).find((s) => s.side === 'customer' && s.name)?.name.split(/\s+/)[0] ?? 'team';
  const sign = `\nBest regards,\n${owner?.name ?? ''}${owner?.title ? `\n${owner.title}` : ''}${owner?.email ? `\n${owner.email}` : ''}`;
  const d = opp.discovery ?? {};
  const p = progressOf(opp);
  const capName = (id) => catalog.get(id)?.name ?? id;
  const catLabel = Object.fromEntries([...(catalog.categories?.() ?? CATEGORIES), ['custom', 'Other']]);
  const criteriaByCat = () => {
    const groups = new Map();
    for (const c of opp.criteria ?? []) {
      const k = catLabel[c.category] ?? 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    return [...groups].map(([k, list]) => `${k}\n${bullet(list.map((c) => `${c.title}${c.priority === 'nice' ? ' (nice to have)' : ''}`))}`).join('\n\n');
  };
  const statusLines = () => (opp.criteria ?? []).filter((c) => c.status !== 'na').map((c) => `${c.status === 'met' ? '✔' : c.status === 'not_met' ? '✘' : c.status === 'in_progress' ? '◐' : '○'} ${c.title} — ${statusText(c)}${demoText(c) && statusText(c) !== demoText(c) ? ` (${demoText(c).replace(/^Demonstrated by the SE /, '')})` : ''}`).join('\n');
  const s = live?.summary;
  // The check-ins as planned: twice a week, weekly, or as the meetings are.
  const checkIns = () => {
    const c = (opp.sessions ?? []).filter((x) => x.type === 'checkpoint').map((x) => x.date).sort();
    if (c.length < 2) return 'A 30-minute check-in each week';
    const span = (Date.parse(c.at(-1)) - Date.parse(c[0])) / 86_400_000 || 1;
    const perWeek = Math.round(((c.length - 1) * 7) / span);
    return perWeek >= 2 ? 'Two 30-minute check-ins a week' : 'A 30-minute check-in each week';
  };
  const tenantLine = s ? `\nIn the POV tenant this week: ${s.scans7d} scans (${s.fusion7d ? `${s.fusion7d} with Fusion, ` : ''}${s.failed24h ? `${s.failed24h} failed in the last day, ` : ''}${s.projects} projects), from ${nice(s.origins?.map((o) => o.name)) || 'the web portal'}.` : '';

  switch (template) {
    case 'discovery': {
      // The call itself: the first-call or discovery meeting (else the last one already held), never a planned one.
      const held = [...(opp.sessions ?? [])].filter((x) => x.date && x.date <= new Date().toISOString().slice(0, 10)).sort((a, b) => b.date.localeCompare(a.date));
      const callDay = d.callDate || held.find((x) => ['first_call', 'discovery'].includes(x.type))?.date || held[0]?.date || '';
      // Their tools as they named them in the toolchain; the discovery's own picks (by name) when there is none.
      const tools = (key, picked) => nice(opp.toolchain?.[key]?.tools?.length ? opp.toolchain[key].tools : (picked ?? []).map(capName));
      return {
        to: customerTo,
        cc: internalCc,
        subject: `${opp.customer} × Checkmarx — discovery recap and next steps`,
        body: `Hi ${first},

Thank you for your time${callDay ? ` on ${fmtDate(callDay)}` : ''}. Here is what we heard, so we can make sure we got it right.

What you want to achieve
${d.goals || '—'}

Where you are today
${d.currentTools || '—'}${d.environment ? `\n${d.environment}` : ''}

Challenges
${d.painPoints || '—'}

Your environment
${bullet([(d.languages || opp.toolchain?.languages) && `Languages: ${d.languages || opp.toolchain.languages}`, tools('scm', d.scm) && `Source control: ${tools('scm', d.scm)}`, tools('cicd', d.ci) && `CI/CD: ${tools('cicd', d.ci)}`, tools('feedback', d.tracking) && `Defect tracking: ${tools('feedback', d.tracking)}`, tools('ide', d.ide) && `IDEs: ${tools('ide', d.ide)}`, d.teamSize && `Teams: ${d.teamSize}`]) || '  • —'}

What you would like to see in Checkmarx One
${bullet((d.requested ?? []).map(capName)) || '  • —'}
${opp.criteria?.length ? `\nProposed success criteria\n${criteriaByCat()}\n` : ''}
Next steps
${d.nextSteps || bullet(['Agree the success criteria above', 'Schedule the technical session', 'Set up the POV tenant'])}

Please reply with anything we missed or got wrong.
${sign}`,
      };
    }
    case 'kickoff':
      return {
        to: customerTo,
        cc: internalCc,
        subject: `${opp.customer} × Checkmarx One POV — kick-off${opp.startDate ? ` (${fmtDate(opp.startDate)}${opp.endDate ? ` to ${fmtDate(opp.endDate)}` : ''})` : ''}`,
        body: `Hi ${first},

Your Checkmarx One POV environment is ready${opp.tenant ? ` (tenant "${opp.tenant.tenant}", ${opp.tenant.regionLabel})` : ''}. ${opp.endDate ? `We have until ${fmtDate(opp.endDate)} to show each of the success criteria below.` : ''}

Success criteria
${criteriaByCat() || '  • to be agreed'}

What we need from you
${bullet(['Access for the people who will take part (we will send the invitations)', 'The repositories and pipelines in scope', checkIns()])}

I will send a short status every week, with what has been shown and what is next.
${sign}`,
      };
    case 'weekly':
      return {
        to: customerTo,
        cc: internalCc,
        subject: `${opp.customer} POV — status, week of ${fmtDate(new Date().toISOString().slice(0, 10))}`,
        body: `Hi ${first},

Where the POV stands: ${p.met} of ${p.total} success criteria completed successfully (${p.percent}%)${p.must ? `, ${p.mustMet} of ${p.must} must-haves` : ''}${opp.endDate ? `, ${Math.max(0, daysTo(opp.endDate))} days to go` : ''}.
${tenantLine}

${statusLines() || 'No success criteria yet.'}

Next
${bullet((opp.tasks ?? []).filter((t) => !t.done).slice(0, 6).map((t) => `${t.title}${t.due ? ` (by ${fmtDate(t.due)})` : ''}`)) || '  • —'}
${sign}`,
      };
    case 'completion':
      return {
        to: customerTo,
        cc: internalCc,
        subject: `${opp.customer} × Checkmarx One POV — results`,
        body: `Hi ${first},

Thank you for the POV. ${p.met} of ${p.total} success criteria were met${p.must ? `, including ${p.mustMet} of the ${p.must} must-haves` : ''}.

${statusLines()}
${opp.summary ? `\nSummary\n${opp.summary}\n` : ''}${opp.sharepointUrl ? `\nThe full report and supporting documents: ${opp.sharepointUrl}\n` : ''}
${sign}`,
      };
    default:
      return { to: customerTo, cc: internalCc, subject: `${opp.customer} × Checkmarx`, body: `Hi ${first},\n\n\n${sign}` };
  }
}

const addresses = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map(cleanEmail).filter(Boolean))].slice(0, 50);

export function cleanMessage(m) {
  const msg = { to: addresses(m.to), cc: addresses(m.cc), subject: text(m.subject, 300), body: text(m.body, 100_000) };
  if (!msg.to.length) throw fail(400, 'Add at least one recipient.');
  if (!msg.subject) throw fail(400, 'Add a subject.');
  return msg;
}

/** The message as a .eml file, to open in the SE's own mail client. */
export function toEml(msg, from, attachments = []) {
  return new Promise((resolve, reject) => {
    new MailComposer({ from: from || undefined, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.body, attachments, headers: { 'X-Unsent': '1' } }).compile().build((err, raw) => (err ? reject(err) : resolve(raw)));
  });
}

export class Mailer {
  #db;
  constructor(db) {
    this.#db = db;
  }

  get settings() {
    const s = this.#db.read('settings', {}).smtp ?? {};
    return { host: s.host ?? '', port: s.port ?? 587, secure: Boolean(s.secure), user: s.user ?? '', from: s.from ?? '', fromName: s.fromName ?? '', checkCert: s.checkCert !== false, hasPassword: Boolean(s.pass), testedAt: s.testedAt ?? null };
  }

  get configured() {
    return Boolean(this.settings.host && this.settings.from);
  }

  save(body) {
    const all = this.#db.read('settings', {});
    const before = all.smtp ?? {};
    const port = Math.trunc(Number(body.port));
    const host = text(body.host, 253).replace(/^smtps?:\/\//i, '');
    if (/[\s/]/.test(host)) throw fail(400, 'The SMTP host is a name such as smtp.office365.com, without a path.');
    all.smtp = {
      host,
      port: port > 0 && port < 65536 ? port : 587,
      // Port and TLS mode go together: 465 is TLS from the start, 587 / 25 / 2525 upgrade with STARTTLS.
      secure: port === 465 ? true : [587, 25, 2525].includes(port) ? false : Boolean(body.secure),
      user: text(body.user, 254),
      from: text(body.from, 300),
      fromName: text(body.fromName, 120),
      checkCert: body.checkCert !== false,
      // A new host never inherits the old host's password.
      pass: body.pass ? this.#db.seal(body.pass) : body.clearPass || host !== before.host ? '' : before.pass ?? '',
      testedAt: null,
    };
    this.#db.write('settings', all);
    return this.settings;
  }

  #from() {
    const s = this.settings;
    return s.fromName ? { name: s.fromName, address: s.from } : s.from;
  }

  #transport() {
    const s = this.#db.read('settings', {}).smtp ?? {};
    if (!s.host || !s.from) throw fail(400, 'No email server is set up (Settings → Email server).');
    return nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      requireTLS: !s.secure && Boolean(s.user), // the password only ever goes over an encrypted connection
      auth: s.user ? { user: s.user, pass: s.pass ? this.#db.open(s.pass) : '' } : undefined,
      tls: { rejectUnauthorized: s.checkCert !== false },
      connectionTimeout: 20_000,
    });
  }

  /** Connect and sign in, sending nothing. */
  async verify() {
    await this.#transport().verify();
    const all = this.#db.read('settings', {});
    all.smtp = { ...(all.smtp ?? {}), testedAt: new Date().toISOString() };
    // These settings work: kept as the last good ones, to go back to if a later change does not.
    all.smtpLastGood = { ...all.smtp };
    this.#db.write('settings', all);
  }

  /**
   * After a change: check the new settings; if they fail and others worked before, put those back.
   * Returns { ok } or { ok: false, restored, error }.
   */
  async checkOrRevert() {
    try {
      await this.verify();
      return { ok: true };
    } catch (error) {
      const all = this.#db.read('settings', {});
      const good = all.smtpLastGood;
      if (!good || (good.host === all.smtp?.host && good.user === all.smtp?.user && good.pass === all.smtp?.pass && good.port === all.smtp?.port)) return { ok: false, restored: false, error };
      all.smtp = { ...good };
      this.#db.write('settings', all);
      return { ok: false, restored: true, error, to: `${good.host}:${good.port}` };
    }
  }

  async test(to) {
    await this.#transport().sendMail({ from: this.#from(), to, subject: 'Kendra test email', text: 'Your email server works with Kendra.' });
  }

  async send(msg, { replyTo, attachments = [], bcc = [] } = {}) {
    const info = await this.#transport().sendMail({ from: this.#from(), replyTo: replyTo || undefined, to: msg.to, cc: msg.cc, bcc: bcc.length ? bcc : undefined, subject: msg.subject, text: msg.body, attachments });
    return info.messageId ?? '';
  }

  // ——— Outbox ———
  record(entry) {
    const all = this.#db.read('outbox', []);
    const row = { id: randomUUID(), at: new Date().toISOString(), ...entry };
    all.push(row);
    this.#db.write('outbox', all.slice(-5000));
    return row;
  }

  outbox(oppIds) {
    return this.#db.read('outbox', []).filter((r) => oppIds.has(r.oppId)).reverse();
  }
}

export { STAGES, SESSION_TYPES };
