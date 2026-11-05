/**
 * Email: drafts written from an opportunity (discovery recap, POV kick-off, weekly status, POV completion), which the
 * SE edits and then sends through the server's SMTP account, downloads as an .eml to send from their own mail
 * client, or copies. Every draft and send is kept in the outbox, so a manager sees what went to the customer.
 */
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { randomUUID } from 'node:crypto';
import { fail, text, email as cleanEmail } from './db.js';
import { STAGES, CRITERION_STATUS, SESSION_TYPES, progressOf } from './opportunities.js';
import { CATEGORIES } from './catalog.js';

export const TEMPLATES = {
  discovery: 'Discovery recap',
  kickoff: 'POV kick-off',
  weekly: 'Weekly POV status',
  completion: 'POV completion',
  blank: 'Blank email',
};

const catLabel = Object.fromEntries(CATEGORIES);
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
  const criteriaByCat = () => {
    const groups = new Map();
    for (const c of opp.criteria ?? []) {
      const k = catLabel[c.category] ?? 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    return [...groups].map(([k, list]) => `${k}\n${bullet(list.map((c) => `${c.title}${c.priority === 'nice' ? ' (nice to have)' : ''}`))}`).join('\n\n');
  };
  const statusLines = () => (opp.criteria ?? []).filter((c) => c.status !== 'na').map((c) => `${c.status === 'met' ? '✔' : c.status === 'not_met' ? '✘' : c.status === 'in_progress' ? '◐' : '○'} ${c.title} — ${CRITERION_STATUS[c.status]}`).join('\n');
  const s = live?.summary;
  const tenantLine = s ? `\nIn the POV tenant this week: ${s.scans7d} scans (${s.fusion7d ? `${s.fusion7d} with Fusion, ` : ''}${s.failed24h ? `${s.failed24h} failed in the last day, ` : ''}${s.projects} projects), from ${nice(s.origins?.map((o) => o.name)) || 'the web portal'}.` : '';

  switch (template) {
    case 'discovery':
      return {
        to: customerTo,
        cc: internalCc,
        subject: `${opp.customer} × Checkmarx — discovery recap and next steps`,
        body: `Hi ${first},

Thank you for your time${opp.sessions?.length ? ` on ${fmtDate([...opp.sessions].sort((a, b) => b.date.localeCompare(a.date))[0].date)}` : ''}. Here is what we heard, so we can make sure we got it right.

What you want to achieve
${d.goals || '—'}

Where you are today
${d.currentTools || '—'}${d.environment ? `\n${d.environment}` : ''}

Challenges
${d.painPoints || '—'}

Your environment
${bullet([d.languages && `Languages: ${d.languages}`, d.scm?.length && `Source control: ${nice(d.scm)}`, d.ci?.length && `CI/CD: ${nice(d.ci)}`, d.tracking?.length && `Defect tracking: ${nice(d.tracking)}`, d.ide?.length && `IDEs: ${nice(d.ide)}`, d.teamSize && `Teams: ${d.teamSize}`]) || '  • —'}

What you would like to see in Checkmarx One
${bullet((d.requested ?? []).map(capName)) || '  • —'}
${opp.criteria?.length ? `\nProposed success criteria\n${criteriaByCat()}\n` : ''}
Next steps
${d.nextSteps || bullet(['Agree the success criteria above', 'Schedule the technical session', 'Set up the POV tenant'])}

Please reply with anything we missed or got wrong.
${sign}`,
      };
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
${bullet(['Access for the people who will take part (we will send the invitations)', 'The repositories and pipelines in scope', 'A 30-minute weekly check-in'])}

I will send a short status every week, with what has been shown and what is next.
${sign}`,
      };
    case 'weekly':
      return {
        to: customerTo,
        cc: internalCc,
        subject: `${opp.customer} POV — status, week of ${fmtDate(new Date().toISOString().slice(0, 10))}`,
        body: `Hi ${first},

Where the POV stands: ${p.met} of ${p.total} success criteria met (${p.percent}%)${p.must ? `, ${p.mustMet} of ${p.must} must-haves` : ''}${opp.endDate ? `, ${Math.max(0, Math.ceil((Date.parse(`${opp.endDate}T23:59:59Z`) - Date.now()) / 864e5))} days to go` : ''}.
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
export function toEml(msg, from) {
  return new Promise((resolve, reject) => {
    new MailComposer({ from: from || undefined, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.body, headers: { 'X-Unsent': '1' } }).compile().build((err, raw) => (err ? reject(err) : resolve(raw)));
  });
}

export class Mailer {
  #db;
  constructor(db) {
    this.#db = db;
  }

  get settings() {
    const s = this.#db.read('settings', {}).smtp ?? {};
    return { host: s.host ?? '', port: s.port ?? 587, secure: Boolean(s.secure), user: s.user ?? '', from: s.from ?? '', hasPassword: Boolean(s.pass) };
  }

  get configured() {
    return Boolean(this.settings.host && this.settings.from);
  }

  save(body) {
    const all = this.#db.read('settings', {});
    const before = all.smtp ?? {};
    const port = Math.trunc(Number(body.port));
    all.smtp = {
      host: text(body.host, 253),
      port: port > 0 && port < 65536 ? port : 587,
      secure: Boolean(body.secure),
      user: text(body.user, 254),
      from: text(body.from, 300),
      pass: body.pass ? this.#db.seal(body.pass) : body.clearPass ? '' : before.pass ?? '',
    };
    this.#db.write('settings', all);
    return this.settings;
  }

  #transport() {
    const s = this.#db.read('settings', {}).smtp ?? {};
    if (!s.host || !s.from) throw fail(400, 'No email server is set up (Settings → Email).');
    return nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass ? this.#db.open(s.pass) : '' } : undefined, connectionTimeout: 20_000 });
  }

  async test(to) {
    const s = this.settings;
    await this.#transport().sendMail({ from: s.from, to, subject: 'CommandCenter test email', text: 'Your email server works with CommandCenter.' });
  }

  async send(msg, { replyTo } = {}) {
    const s = this.settings;
    const info = await this.#transport().sendMail({ from: s.from, replyTo: replyTo || undefined, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.body });
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
