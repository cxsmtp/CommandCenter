// Trimmed from CxMissionZero (cxsmtp/CxDetectionDateBaseReminder, src/cxone/client.js):
// authenticated requests, retries, token refresh on 401, access token pinned to the tenant's own hosts.
import { TokenProvider } from './auth.js';
import { scrubText } from './endpoints.js';

export { scrubText };

const MAX_CONCURRENT = Math.max(1, Number(process.env.CX_MAX_CONCURRENCY) || 8);
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.CX_REQUEST_TIMEOUT_MS) || 60_000);
const RETRYABLE = new Set([429, 502, 503, 504]);
export const ACCEPT = 'application/json; version=1.0';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CxApiError extends Error {
  constructor(message, { status = 0, path = '', body = '' } = {}) {
    super(scrubText(message));
    this.name = 'CxApiError';
    this.status = Number(status) || 0;
    this.path = scrubText(path);
    this.body = scrubText(body);
  }
}

export class Semaphore {
  #queue = [];
  #active = 0;
  constructor(limit) {
    this.limit = limit;
  }
  async run(task) {
    if (this.#active >= this.limit) await new Promise((resolve) => this.#queue.push(resolve));
    else this.#active += 1;
    try {
      return await task();
    } finally {
      const next = this.#queue.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }
}

/** "fetch failed" says nothing: name the network reason. */
export function networkReason(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return `no answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} s`;
  const code = error?.cause?.code || error?.code || '';
  const known = {
    ENOTFOUND: 'host name not found (DNS)',
    EAI_AGAIN: 'DNS lookup failed temporarily',
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection reset',
    ETIMEDOUT: 'connection timed out',
    UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'its certificate is not trusted here (usually a company proxy that inspects HTTPS)',
    SELF_SIGNED_CERT_IN_CHAIN: 'its certificate is not trusted here (usually a company proxy that inspects HTTPS)',
  };
  return known[code] || [code, error?.cause?.message || error?.message].filter(Boolean).join(': ') || 'network error';
}

export class CxClient {
  #connection;
  #tokens;
  #limit = new Semaphore(MAX_CONCURRENT);

  /** @param {{baseUrl: string, iamUrl: string, tokenUrl: string, apiKey: string}} connection */
  constructor(connection, tokenProvider = new TokenProvider(connection)) {
    this.#connection = connection;
    this.#tokens = tokenProvider;
  }

  get baseUrl() {
    return this.#connection.baseUrl;
  }

  /** Who the key acts as, from the access token's claims. Never throws. */
  async identity() {
    try {
      const token = await this.#tokens.getToken();
      const claims = JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString('utf8'));
      return { user: claims.preferred_username || claims.email || claims.name || claims.sub || '', email: claims.email || '' };
    } catch {
      return { user: '', email: '' };
    }
  }

  #target(path) {
    const raw = String(path ?? '');
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `${this.baseUrl}${raw}`);
    } catch {
      throw new CxApiError('That is not a Checkmarx One API address.', { status: 400 });
    }
    const own = new Set([this.#connection.baseUrl, this.#connection.iamUrl].filter(Boolean).map((a) => new URL(a).origin));
    if (!own.has(url.origin) || url.username || url.password) {
      throw new CxApiError(`Refused to send the access token to ${url.host}, which is not this tenant's Checkmarx One host.`, { status: 400 });
    }
    return url;
  }

  async request(path, { method = 'GET', query, body, accept = ACCEPT, retries = 2 } = {}) {
    const url = this.#target(path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
      else url.searchParams.set(key, String(value));
    }
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const token = await this.#tokens.getToken();
      let response;
      let text = '';
      try {
        [response, text] = await this.#limit.run(async () => {
          const r = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, Accept: accept, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          return [r, await r.text().catch(() => '')];
        });
      } catch (error) {
        lastError = new CxApiError(`Could not reach Checkmarx One at ${url.host}: ${networkReason(error)}.`, { status: 502, path: url.pathname });
        if (attempt === retries) throw lastError;
        await sleep(2 ** attempt * 500);
        continue;
      }
      if (response.ok) {
        if (response.status === 204 || !text) return null;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      if (response.status === 401 && attempt < retries) {
        this.#tokens.reset();
        continue;
      }
      lastError = new CxApiError(`${method} ${url.pathname} failed: ${response.status} ${response.statusText}`, { status: response.status, path: url.pathname, body: text.slice(0, 1000) });
      if (!RETRYABLE.has(response.status) || attempt === retries) throw lastError;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500);
    }
    throw lastError;
  }

  /** Walk an offset/limit collection; `itemsKey` names where the rows live. */
  async *paginate(path, { query = {}, itemsKey, limit = 100, maxItems = 1000 } = {}) {
    let offset = 0;
    let fetched = 0;
    while (fetched < maxItems) {
      const page = await this.request(path, { query: { ...query, offset, limit } });
      const items = extractItems(page, itemsKey);
      for (const item of items) {
        yield item;
        if (++fetched >= maxItems) return;
      }
      const total = Number(page?.filteredTotalCount ?? page?.totalCount);
      if (items.length < limit || (Number.isFinite(total) && fetched >= total)) return;
      offset += limit;
    }
  }
}

export function extractItems(page, itemsKey) {
  if (Array.isArray(page)) return page;
  if (!page || typeof page !== 'object') return [];
  if (itemsKey && Array.isArray(page[itemsKey])) return page[itemsKey];
  for (const key of ['items', 'results', 'data', 'projects', 'scans', 'applications']) if (Array.isArray(page[key])) return page[key];
  const arrays = Object.values(page).filter(Array.isArray);
  return arrays.length === 1 ? arrays[0] : [];
}

export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}
