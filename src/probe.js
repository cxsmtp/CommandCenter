/**
 * Is the server on this machine answering? Its /healthz, over HTTPS (any certificate: it is our own, on loopback)
 * or plain http. For the launcher's start check and the container's health check.
 */
import http from 'node:http';
import https from 'node:https';

function get(mod, port) {
  return new Promise((resolve) => {
    const req = mod.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 3000, rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** The /healthz answer, or null. */
export async function probe(port, { https: first = process.env.HTTPS === undefined ? null : !/^(off|false|no|0)$/i.test(process.env.HTTPS) } = {}) {
  const order = first === false ? [http, https] : [https, http];
  for (const mod of order) {
    const r = await get(mod, port);
    if (r) return r;
  }
  return null;
}
