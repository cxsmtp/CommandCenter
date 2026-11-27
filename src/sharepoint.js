/**
 * Publishing a POV's documents to its SharePoint site through Microsoft Graph, with an app registration (client
 * credentials): the WIP deck, the results deck and the results page land in a folder of the site's document library.
 *
 * Settings (Admin): directory (tenant) id, application (client) id, client secret (sealed), and the folder inside the
 * library (default "POV/<customer>"). The site comes from each POV's SharePoint link.
 * The app needs Sites.Selected (granted on the sites it may write to) or Sites.ReadWrite.All, as an application
 * permission with admin consent.
 */
import { fail } from './db.js';

const LOGIN = () => process.env.CC_MS_LOGIN_URL || 'https://login.microsoftonline.com';
const GRAPH = () => process.env.CC_MS_GRAPH_URL || 'https://graph.microsoft.com';

/** The site's host name and path from a SharePoint link (https://contoso.sharepoint.com/sites/Acme/Shared%20Documents/...). */
export function siteOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/\.sharepoint\.(com|us|de|cn)$/i.test(u.hostname) && !process.env.CC_MS_GRAPH_URL) return null;
  const m = /^\/(sites|teams)\/([^/]+)/i.exec(decodeURIComponent(u.pathname));
  return { host: u.hostname, path: m ? `/${m[1]}/${m[2]}` : '' };
}

const safeName = (s) => String(s ?? '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'POV';

export class SharePoint {
  #token = null;
  #fetch;
  constructor({ fetchFn = fetch } = {}) {
    this.#fetch = fetchFn;
  }

  async #accessToken(cfg) {
    if (this.#token && this.#token.key === `${cfg.tenantId}/${cfg.clientId}` && this.#token.until > Date.now() + 60_000) return this.#token.value;
    const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
    const r = await this.#fetch(`${LOGIN()}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw fail(502, `Microsoft sign-in refused the app: ${j.error_description?.split('\r')[0] ?? j.error ?? r.status}`);
    this.#token = { key: `${cfg.tenantId}/${cfg.clientId}`, value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return j.access_token;
  }

  async #graph(cfg, method, path, body, headers = {}) {
    const token = await this.#accessToken(cfg);
    const r = await this.#fetch(`${GRAPH()}/v1.0${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(r.status === 404 ? 404 : 502, `SharePoint: ${j.error?.message ?? r.status}`);
    return j;
  }

  /** Check the settings: sign in, and when a site link is given, find the site. */
  async test(cfg, siteUrl = '') {
    if (!cfg?.tenantId || !cfg?.clientId || !cfg?.clientSecret) throw fail(400, 'Save the directory id, the application id and the client secret first.');
    await this.#accessToken(cfg);
    if (!siteUrl) return { ok: true };
    const site = await this.#site(cfg, siteUrl);
    return { ok: true, site: site.displayName ?? site.name ?? site.webUrl };
  }

  async #site(cfg, siteUrl) {
    const s = siteOf(siteUrl);
    if (!s) throw fail(400, 'The POV’s SharePoint link is not a SharePoint site link (https://…sharepoint.com/sites/…).');
    return this.#graph(cfg, 'GET', `/sites/${s.host}:${s.path || '/'}`);
  }

  /**
   * Upload files [{ name, data, type }] into the folder for this POV. Returns where each landed.
   */
  async publish(cfg, { siteUrl, customer, files }) {
    if (!cfg?.tenantId || !cfg?.clientId || !cfg?.clientSecret) throw fail(400, 'SharePoint is not set up: an Admin adds the Microsoft app registration under Settings → Integrations.');
    const site = await this.#site(cfg, siteUrl);
    const folder = (cfg.folder || 'POV/{customer}').replace('{customer}', safeName(customer)).split('/').map(safeName).filter(Boolean).join('/');
    const out = [];
    for (const f of files) {
      const path = `${folder}/${safeName(f.name)}`.split('/').map(encodeURIComponent).join('/');
      const item = await this.#graph(cfg, 'PUT', `/sites/${site.id}/drive/root:/${path}:/content`, f.data, { 'Content-Type': f.type || 'application/octet-stream' });
      out.push({ name: f.name, url: item.webUrl ?? '', size: item.size ?? f.data.length });
    }
    return { site: site.webUrl ?? siteUrl, folder, files: out };
  }

  /**
   * An email from a person's own Microsoft 365 mailbox (it lands in their Sent Items). Needs the app's Mail.Send
   * application permission with admin consent; an Exchange application access policy can limit it to the SEs' mailboxes.
   */
  async sendMail(cfg, from, { to, cc = [], bcc = [], subject, body }, attachments = []) {
    if (!cfg?.tenantId || !cfg?.clientId || !cfg?.clientSecret) throw fail(400, 'The Microsoft app is not set up (Settings → Email).');
    const size = attachments.reduce((n, a) => n + a.content.length, 0);
    if (size > 3 * 1048576) throw fail(413, 'Attachments over 3 MB cannot go through Microsoft 365 this way: download the .eml or send the deck from SharePoint.');
    const who = (list) => list.map((address) => ({ emailAddress: { address } }));
    const message = { subject, body: { contentType: 'Text', content: body }, toRecipients: who(to), ccRecipients: who(cc), bccRecipients: who(bcc), attachments: attachments.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentBytes: Buffer.from(a.content).toString('base64') })) };
    const token = await this.#accessToken(cfg);
    const r = await this.#fetch(`${GRAPH()}/v1.0/users/${encodeURIComponent(from)}/sendMail`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true }) });
    if (r.status === 202) return true;
    const j = await r.json().catch(() => ({}));
    const why = j.error?.code === 'ErrorAccessDenied' || r.status === 403 ? 'the Microsoft app may not send as this mailbox yet (Mail.Send permission, admin consent, or the access policy)' : j.error?.message ?? `status ${r.status}`;
    throw fail(502, `Microsoft 365 did not send it: ${why}.`);
  }
}
