// Single sign-on (SAML 2.0), as in the FTR command center: a test identity provider signs assertions.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { makeCertificate } from '../src/tls.js';

let env;
let idp;
let A;
const H = { 'X-Requested-With': 'Kendra', 'Content-Type': 'application/json' };
before(async () => {
  process.env.CC_PUBLIC_URL = 'https://k.example';
  process.env.CC_ADMIN_PASSWORD = 'admin-password-123';
  const { createApp } = await import('../src/server.js');
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-sso-')), startBackground: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  env = { app, base: `http://127.0.0.1:${app.server.address().port}` };
  const c = (await fetch(`${env.base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) })).headers.get('set-cookie').split(';')[0];
  A = { ...H, Cookie: c };
  await fetch(`${env.base}/api/users`, { method: 'POST', headers: A, body: JSON.stringify({ email: 'se1@northwind.example', name: 'SE One', role: 'associate', password: 'first-password-1' }) });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = makeCertificate({ subject: { cn: 'Test IdP' }, names: [], publicKey, signerKey: privateKey });
  idp = { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: typeof cert === 'string' ? cert : cert.pem ?? cert.toString() };
});
after(() => env.app.server.close());
const put = (b) => fetch(`${env.base}/api/settings/sso`, { method: 'PUT', headers: A, body: JSON.stringify(b) });

const requestId = async () => {
  const r = await fetch(`${env.base}/saml/login`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.get('location'));
  assert.equal(u.origin, 'https://idp.example');
  const xml = zlib.inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest'), 'base64')).toString();
  return /ID="([^"]+)"/.exec(xml)[1];
};

function assertion({ email, inResponseTo, sign = true, key = idp.key, audience = 'https://k.example/saml/metadata' }) {
  const now = new Date();
  const later = new Date(now.getTime() + 5 * 60_000).toISOString();
  const aid = `_${randomUUID()}`;
  const a = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aid}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>https://idp.example/issuer</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${later}" Recipient="https://k.example/saml/acs"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${new Date(now.getTime() - 60000).toISOString()}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="name"><saml:AttributeValue>Jo SSO</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  let signed = a;
  if (sign) {
    const sig = new SignedXml({ privateKey: key, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
    sig.addReference({ xpath: `//*[local-name(.)='Assertion']`, transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
    sig.computeSignature(a, { location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' } });
    signed = sig.getSignedXml();
  }
  const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${randomUUID()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="https://k.example/saml/acs" InResponseTo="${inResponseTo}"><saml:Issuer>https://idp.example/issuer</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`;
  return Buffer.from(response).toString('base64');
}
const acs = (samlResponse) => fetch(`${env.base}/saml/acs`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://idp.example' }, body: new URLSearchParams({ SAMLResponse: samlResponse }), redirect: 'manual' });


test('an Admin connects the identity provider; it is off until complete', async () => {
  assert.equal((await put({ enabled: true })).status, 409);
  assert.equal((await put({ entryPoint: 'http://idp.example/sso' })).status, 400);
  assert.equal((await put({ idpCert: 'not a cert' })).status, 400);
  const r = await put({ entryPoint: 'https://idp.example/sso', idpIssuer: 'https://idp.example/issuer', idpCert: idp.cert, emailAttribute: 'email', nameAttribute: 'name', enabled: true });
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.equal(saved.ready, true);
  assert.equal(saved.sp.acs, 'https://k.example/saml/acs');
  assert.equal(saved.idpCert, undefined, 'the certificate is not sent back');
  assert.match(await (await fetch(`${env.base}/saml/metadata`)).text(), /AssertionConsumerService/);
  assert.equal((await (await fetch(`${env.base}/api/auth/options`)).json()).sso.label, 'Sign in with SSO');
});

test('a signed assertion signs someone with an account in; forged, replayed or unasked-for ones are refused', async () => {
  const res = await acs(assertion({ email: 'se1@northwind.example', inResponseTo: await requestId() }));
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  assert.equal((await (await fetch(`${env.base}/api/session`, { headers: { cookie } })).json()).user.email, 'se1@northwind.example');
  assert.ok(!(await acs(assertion({ email: 'se1@northwind.example', inResponseTo: await requestId(), sign: false }))).headers.get('set-cookie'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.ok(!(await acs(assertion({ email: 'se1@northwind.example', inResponseTo: await requestId(), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }))).headers.get('set-cookie'));
  assert.ok(!(await acs(assertion({ email: 'se1@northwind.example', inResponseTo: '_never-asked' }))).headers.get('set-cookie'));
  assert.ok(!(await acs(assertion({ email: 'se1@northwind.example', inResponseTo: await requestId(), audience: 'https://other.example' }))).headers.get('set-cookie'));
  const once = assertion({ email: 'se1@northwind.example', inResponseTo: await requestId() });
  assert.ok((await acs(once)).headers.get('set-cookie'));
  assert.ok(!(await acs(once)).headers.get('set-cookie'), 'used once');
});

test('someone new is refused, unless added on first sign-in (as an Associate); passwords for Admins only', async () => {
  assert.ok(!(await acs(assertion({ email: 'new.person@northwind.example', inResponseTo: await requestId() }))).headers.get('set-cookie'));
  assert.equal((await put({ jit: true })).status, 200);
  const res = await acs(assertion({ email: 'new.person@northwind.example', inResponseTo: await requestId() }));
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  const me = (await (await fetch(`${env.base}/api/session`, { headers: { cookie } })).json()).user;
  assert.deepEqual([me.email, me.role, me.name], ['new.person@northwind.example', 'associate', 'Jo SSO']);
  assert.equal((await put({ passwordSignIn: 'admins' })).status, 200);
  const pw = await fetch(`${env.base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'se1@northwind.example', password: 'first-password-1' }) });
  assert.equal(pw.status, 403);
  assert.equal((await fetch(`${env.base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'admin@meridian.local', password: 'admin-password-123' }) })).status, 200, 'Admins keep a way in');
});
