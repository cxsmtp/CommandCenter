/**
 * Single sign-on with SAML 2.0 (Settings → Single sign-on, Admin only): the company identity provider (Entra ID, Okta,
 * Ping, ADFS…) signs people in. Built on @node-saml/node-saml; the same as the FTR command center's (server/sso.js).
 *
 * - Every assertion must be signed by the identity provider's certificate the Admin pasted, for this service (its
 *   audience), recently (5 s clock skew), and in answer to a request this server made (InResponseTo, kept 10 minutes).
 * - Who it is: the email in the attribute the Admin names (or the NameID). Someone without access yet is refused,
 *   unless "Add people on their first sign-in" is on: then they join as Associates, under the leader chosen here.
 * - Passwords can stay for everyone, or only for Admins (a way in if the identity provider is down).
 */
import { X509Certificate } from 'node:crypto';
import { SAML, generateServiceProviderMetadata } from '@node-saml/node-saml';

import { fail } from './db.js';

export const DEFAULT_SSO = { enabled: false, label: 'Sign in with SSO', entryPoint: '', idpIssuer: '', idpCert: '', emailAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', nameAttribute: 'http://schemas.microsoft.com/identity/claims/displayname', wantResponseSigned: false, jit: false, jitManagerId: '', passwordSignIn: 'everyone' };
export const PASSWORD_POLICIES = ['everyone', 'admins'];

const clean = (v, max = 2000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

/** The PEM certificates in what was pasted (one or more, for a rollover), each checked. */
export function readCertificates(text) {
  const blocks = String(text ?? '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const bare = blocks.length ? [] : [String(text ?? '').replace(/\s+/g, '')].filter((b) => /^[A-Za-z0-9+/=]{200,}$/.test(b)).map((b) => `-----BEGIN CERTIFICATE-----\n${b.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`);
  return [...blocks, ...bare].map((pem) => {
    let cert;
    try {
      cert = new X509Certificate(pem);
    } catch {
      throw fail(400, 'That is not a certificate: paste the identity provider’s signing certificate (PEM, or its base64).');
    }
    return { pem: cert.toString(), subject: cert.subject.replace(/\n/g, ', '), validTo: new Date(cert.validTo).toISOString(), fingerprint: cert.fingerprint256 };
  });
}

/** The settings with what an Admin sent applied, checked. */
export function mergeSso(current, input = {}, { leaders = [] } = {}) {
  const next = { ...DEFAULT_SSO, ...current };
  if ('label' in input) next.label = clean(input.label, 60) || DEFAULT_SSO.label;
  if ('entryPoint' in input) {
    next.entryPoint = clean(input.entryPoint, 1000);
    if (next.entryPoint) {
      let u;
      try {
        u = new URL(next.entryPoint);
      } catch {
        throw fail(400, 'The sign-in URL of the identity provider is not a web address.');
      }
      if (u.protocol !== 'https:') throw fail(400, 'The identity provider’s sign-in URL must be https.');
    }
  }
  if ('idpIssuer' in input) next.idpIssuer = clean(input.idpIssuer, 500);
  if ('idpCert' in input) {
    const certs = readCertificates(input.idpCert);
    if (input.idpCert && !certs.length) throw fail(400, 'Paste the identity provider’s signing certificate.');
    next.idpCert = certs.map((c) => c.pem).join('\n');
  }
  if ('emailAttribute' in input) next.emailAttribute = clean(input.emailAttribute, 300);
  if ('nameAttribute' in input) next.nameAttribute = clean(input.nameAttribute, 300);
  if ('wantResponseSigned' in input) next.wantResponseSigned = Boolean(input.wantResponseSigned);
  if ('jit' in input) next.jit = Boolean(input.jit);
  if ('jitManagerId' in input) {
    if (input.jitManagerId && !leaders.some((u) => u.id === input.jitManagerId)) throw fail(400, 'Choose the leader people added on first sign-in report to.');
    next.jitManagerId = input.jitManagerId || '';
  }
  if ('passwordSignIn' in input) {
    if (!PASSWORD_POLICIES.includes(input.passwordSignIn)) throw fail(400, 'Choose who may still sign in with a password.');
    next.passwordSignIn = input.passwordSignIn;
  }
  if ('enabled' in input) next.enabled = Boolean(input.enabled);
  if (next.enabled && (!next.entryPoint || !next.idpCert)) throw fail(409, 'Give the identity provider’s sign-in URL and signing certificate before turning single sign-on on.');
  return next;
}

/** The service's own addresses, from PUBLIC_URL. */
export function spUrls(publicUrl) {
  let origin = '';
  try {
    const u = new URL(publicUrl);
    if (u.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname)) origin = u.origin;
  } catch {}
  return origin ? { entityId: `${origin}/saml/metadata`, acs: `${origin}/saml/acs`, metadata: `${origin}/saml/metadata`, login: `${origin}/saml/login` } : null;
}

export class Sso {
  #saml = null;
  #key = '';
  // The sign-ins under way (the request ids the identity provider must answer to), kept here and not inside the SAML
  // client, so they can be handed to the next version: a sign-in begun before an update ends well after it.
  #asked = new Map(); // request id -> { value, at }
  #cache = {
    saveAsync: async (key, value) => {
      if (this.#asked.has(key)) return null;
      const now = Date.now();
      for (const [k, v] of this.#asked) if (now - v.at > 10 * 60 * 1000) this.#asked.delete(k);
      const item = { value, createdAt: now };
      this.#asked.set(key, { value, at: now });
      return item;
    },
    getAsync: async (key) => {
      const v = this.#asked.get(key);
      return v && Date.now() - v.at <= 10 * 60 * 1000 ? v.value : null;
    },
    removeAsync: async (key) => {
      const had = this.#asked.has(key);
      this.#asked.delete(key);
      return had ? key : null;
    },
    // Taken and removed in one step: of two copies of an answer arriving together, only one is accepted.
    consumeAsync: async (key) => {
      const v = this.#asked.get(key);
      this.#asked.delete(key);
      return v && Date.now() - v.at <= 10 * 60 * 1000 ? v.value : null;
    },
  };
  /** For an update without a restart: the sign-ins under way (memory only). */
  handoff() {
    return { asked: [...this.#asked] };
  }
  adopt(state) {
    for (const [k, v] of state?.asked ?? []) if (v && Date.now() - v.at <= 10 * 60 * 1000) this.#asked.set(k, v);
  }
  constructor({ settings, publicUrl }) {
    this.settings = settings;
    this.publicUrl = publicUrl;
  }
  config() {
    return { ...DEFAULT_SSO, ...(this.settings() ?? {}) };
  }
  ready() {
    const c = this.config();
    return Boolean(c.enabled && c.entryPoint && c.idpCert && spUrls(this.publicUrl));
  }
  #client() {
    const c = this.config();
    const urls = spUrls(this.publicUrl);
    if (!urls) throw fail(409, 'Single sign-on needs CC_PUBLIC_URL, the https address people use.');
    const key = JSON.stringify([c.entryPoint, c.idpIssuer, c.idpCert, c.wantResponseSigned, urls.acs]);
    if (this.#key !== key) {
      this.#saml = new SAML({
        entryPoint: c.entryPoint,
        issuer: urls.entityId,
        callbackUrl: urls.acs,
        audience: urls.entityId,
        idpCert: c.idpCert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [],
        ...(c.idpIssuer ? { idpIssuer: c.idpIssuer } : {}),
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: Boolean(c.wantResponseSigned),
        validateInResponseTo: 'always',
        cacheProvider: this.#cache,
        requestIdExpirationPeriodMs: 10 * 60 * 1000,
        acceptedClockSkewMs: 5000,
        disableRequestedAuthnContext: true,
        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        signatureAlgorithm: 'sha256',
        digestAlgorithm: 'sha256',
      });
      this.#key = key;
    }
    return this.#saml;
  }
  /** Where to send the browser to sign in. */
  async loginUrl() {
    if (!this.ready()) throw fail(409, 'Single sign-on is not set up.');
    return this.#client().getAuthorizeUrlAsync('', undefined, {});
  }
  /** Who the identity provider says this is: { email, name }, or an error. */
  async verify(samlResponse) {
    if (!this.ready()) throw fail(409, 'Single sign-on is not set up.');
    let profile;
    try {
      ({ profile } = await this.#client().validatePostResponseAsync({ SAMLResponse: String(samlResponse ?? '') }));
    } catch (error) {
      // The details (which check failed) are for the Admin, in the server log; the person sees that it failed.
      console.warn(`[sso] SAML response refused: ${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 300)}`);
      throw fail(401, 'The identity provider’s answer was not accepted. Try again; if it keeps failing, an Admin can see why in the server log.');
    }
    if (!profile) throw fail(401, 'The identity provider signed nobody in.');
    const c = this.config();
    const pick = (attr) => {
      const v = attr ? profile[attr] ?? profile.attributes?.[attr] : undefined;
      return Array.isArray(v) ? v[0] : v;
    };
    const email = String(pick(c.emailAttribute) || profile.email || profile.mail || profile.nameID || '').trim().toLowerCase();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) throw fail(401, 'The identity provider did not say an email address for this person: check the email attribute in Settings → Single sign-on.');
    return { email, name: String(pick(c.nameAttribute) || '').trim().slice(0, 120) };
  }
  metadata() {
    const urls = spUrls(this.publicUrl);
    if (!urls) throw fail(409, 'Single sign-on needs CC_PUBLIC_URL, the https address people use.');
    return generateServiceProviderMetadata({ issuer: urls.entityId, callbackUrl: urls.acs, identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress', wantAssertionsSigned: true });
  }
  view() {
    const c = this.config();
    let certs = [];
    try {
      certs = readCertificates(c.idpCert);
    } catch {}
    const { idpCert, ...rest } = c;
    void idpCert;
    return { ...rest, certificates: certs.map(({ pem, ...x }) => (void pem, x)), sp: spUrls(this.publicUrl), ready: this.ready() };
  }
}
