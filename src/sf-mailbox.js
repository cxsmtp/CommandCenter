/**
 * The mailbox Salesforce report subscriptions are sent to (a shared or service mailbox, IMAP). Every half hour (or
 * when asked) Meridian reads the new messages from the allowed senders, takes the report from the attached .xlsx /
 * .csv or, when there is none, from the table in the email, and brings it in like a dropped file. Read messages are
 * marked read and moved to a "Meridian imported" folder; nothing is ever sent from this mailbox.
 *
 * Only messages from the allowed sender domains are read (Salesforce sends subscriptions from its own domain unless
 * your org set another), so an outsider mailing the box cannot change a POV.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const MAX_MESSAGES = 25;
const MAX_BYTES = 15 * 1048576;

export class SfMailbox {
  #settings;
  #open;
  #import;
  #timer = null;
  #running = null;
  last = null;

  /**
   * @param {object} o
   * @param {() => object} o.settings   the saved mailbox settings
   * @param {(sealed: string) => string} o.open   unseal the password
   * @param {(buf: Buffer, meta: object) => Promise<object>} o.importFile   bring a report in; returns a summary
   */
  constructor({ settings, open, importFile }) {
    this.#settings = settings;
    this.#open = open;
    this.#import = importFile;
  }

  #client(s) {
    return new ImapFlow({ host: s.host, port: Number(s.port) || 993, secure: s.secure !== false, auth: { user: s.user, pass: s.pass ? this.#open(s.pass) : '' }, logger: false, socketTimeout: 60_000, tls: { rejectUnauthorized: true } });
  }

  /** Sign in and open the folder, without reading anything. */
  async test(s = this.#settings()) {
    if (!s.host || !s.user) throw Object.assign(new Error('Set the mailbox host and user first.'), { status: 400 });
    const c = this.#client(s);
    try {
      await c.connect();
      const box = await c.mailboxOpen(s.folder || 'INBOX', { readOnly: true });
      return { ok: true, folder: box.path, messages: box.exists };
    } finally {
      await c.logout().catch(() => {});
    }
  }

  /** Read the new report emails now (one run at a time). */
  run() {
    this.#running ??= this.#run().finally(() => (this.#running = null));
    return this.#running;
  }

  async #run() {
    const s = this.#settings();
    if (!s.enabled || !s.host || !s.user) return (this.last = { at: new Date().toISOString(), ok: true, skipped: 'off', imported: [] });
    const allowed = String(s.senders || 'salesforce.com').split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    const fromAllowed = (addr) => allowed.some((d) => addr === d || addr.endsWith(`@${d}`) || addr.endsWith(`.${d}`));
    const c = this.#client(s);
    const done = [];
    const skipped = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock(s.folder || 'INBOX');
      try {
        const uids = ((await c.search({ seen: false }, { uid: true })) || []).slice(-MAX_MESSAGES);
        const target = 'Meridian imported';
        let canMove = true;
        try {
          await c.mailboxCreate(target);
        } catch {}
        for (const uid of uids) {
          const msg = await c.fetchOne(String(uid), { source: true, envelope: true, size: true }, { uid: true });
          if (!msg?.source || msg.size > MAX_BYTES) {
            skipped.push({ subject: msg?.envelope?.subject ?? '', why: 'too large' });
            continue;
          }
          const from = String(msg.envelope?.from?.[0]?.address ?? '').toLowerCase();
          if (!fromAllowed(from)) {
            skipped.push({ subject: msg.envelope?.subject ?? '', why: `from ${from || 'unknown'}, not an allowed sender` });
            continue; // left unread, for a person to look at
          }
          const mail = await simpleParser(msg.source);
          const file = (mail.attachments ?? []).find((a) => /\.(xlsx|csv)$/i.test(a.filename ?? '') || /spreadsheetml|text\/csv/.test(a.contentType ?? ''));
          const meta = { source: 'mailbox', subject: mail.subject ?? '', from, at: (mail.date ?? new Date()).toISOString() };
          try {
            const summary = file ? await this.#import(file.content, { ...meta, name: file.filename, type: file.contentType }) : mail.html ? await this.#import(Buffer.from(mail.html), { ...meta, name: 'email.html', type: 'text/html' }) : null;
            if (!summary) {
              skipped.push({ subject: meta.subject, why: 'no report file or table in it' });
              continue;
            }
            done.push({ subject: meta.subject, ...summary });
            await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
            if (canMove) await c.messageMove(String(uid), target, { uid: true }).catch(() => (canMove = false));
          } catch (error) {
            skipped.push({ subject: meta.subject, why: error.message });
          }
        }
      } finally {
        lock.release();
      }
      this.last = { at: new Date().toISOString(), ok: true, imported: done, skipped };
    } catch (error) {
      this.last = { at: new Date().toISOString(), ok: false, error: imapHint(error), imported: done, skipped };
    } finally {
      await c.logout().catch(() => {});
    }
    return this.last;
  }

  start() {
    const tick = () => {
      const s = this.#settings();
      const every = Math.max(5, Number(s.everyMinutes) || 30) * 60_000;
      if (s.enabled && (!this.last || Date.now() - Date.parse(this.last.at) >= every - 30_000)) this.run().catch(() => {});
    };
    setTimeout(tick, 45_000).unref();
    this.#timer = setInterval(tick, 5 * 60_000);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
  }
}

function imapHint(error) {
  const m = String(error?.responseText ?? error?.message ?? error);
  if (/AUTHENTICATE|LOGIN|credentials|auth/i.test(m)) return `The mailbox did not accept the user name or password (${m.slice(0, 160)}). Microsoft 365 and Gmail need IMAP turned on for the mailbox and an app password.`;
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'The mailbox server’s name cannot be found (DNS).';
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return 'No answer from the mailbox server: check the host, the port (993) and the firewall.';
  if (/certificate|self[- ]signed/i.test(m)) return 'The mailbox server’s certificate is not trusted: add your company root certificate under Network & certificates.';
  return m.slice(0, 240);
}
