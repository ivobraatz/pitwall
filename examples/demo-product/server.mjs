// A pretend product: what each real product's backend does to plug into Pitwall, in one file.
//
//   1. the support bridge — the browser calls /api/support/*, this forwards to Pitwall with the
//      product key and the signed-in person (here: a cookie that says who you are);
//   2. error reporting — an unhandled 5xx goes to Pitwall with the trace id the browser also got;
//   3. webhooks — Pitwall tells the product about replies, status changes and releases.
//
// PITWALL_URL, PITWALL_KEY (support + errors) and PITWALL_WEBHOOK_SECRET come from .env.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createErrorReporter, createSupportBridge, verifyWebhook } from '@pitwall/sdk/server';

const PORT = Number(process.env.PORT ?? 4300);
const { PITWALL_URL = 'http://localhost:5180', PITWALL_KEY = '', PITWALL_WEBHOOK_SECRET = '' } = process.env;

const PEOPLE = {
  ana: { customerId: 'acme', customerName: 'Acme Ltda', userId: 'u-ana', userName: 'Ana Souza', userEmail: 'ana@acme.test' },
  bruno: { customerId: 'acme', customerName: 'Acme Ltda', userId: 'u-bruno', userName: 'Bruno Lima' },
  carla: { customerId: 'globex', customerName: 'Globex', userId: 'u-carla', userName: 'Carla Dias' },
};
const whoIs = (cookieHeader) => {
  const m = /(?:^|;\s*)demo_user=(\w+)/.exec(cookieHeader ?? '');
  return PEOPLE[m?.[1] ?? 'ana'] ?? PEOPLE.ana;
};

const bridge = createSupportBridge({
  baseUrl: PITWALL_URL, apiKey: PITWALL_KEY,
  resolveActor: (req) => whoIs(req.headers.get('cookie')),
});
const errors = createErrorReporter({ baseUrl: PITWALL_URL, apiKey: PITWALL_KEY, release: 'demo-1.0.0', environment: 'local' });
const events = [];

function toRequest(req, body) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body, duplex: 'half' });
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const chunk of response.body) res.write(chunk);
  res.end();
}

const json = (res, status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/support/')) {
      const path = url.pathname.slice('/api/support/'.length).split('/');
      const body = req.method === 'POST' ? req : undefined;
      return send(res, await bridge.handle(toRequest(req, body), path));
    }
    if (url.pathname === '/api/reports/run') {
      // The product's own endpoint, failing: the browser gets the trace id, Pitwall gets the stack.
      const traceId = randomUUID().replaceAll('-', '');
      const person = whoIs(req.headers.cookie);
      try {
        const rows = [];
        return json(res, 200, { first: rows[0].total });
      } catch (err) {
        errors.reportError(err, { traceId, method: req.method, path: url.pathname, routeTemplate: '/api/reports/run', statusCode: 500, customerId: person.customerId, userId: person.userId });
        return json(res, 500, { message: 'Internal error', traceId }, { 'x-trace-id': traceId });
      }
    }
    if (url.pathname === '/api/me') return json(res, 200, whoIs(req.headers.cookie));
    if (url.pathname === '/webhooks/pitwall' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const evt = verifyWebhook(PITWALL_WEBHOOK_SECRET, req.headers['pitwall-signature'], raw);
      if (!evt) return json(res, 401, { message: 'bad signature' });
      events.unshift({ at: new Date().toISOString(), type: evt.type, data: evt.data });
      console.log(`[webhook] ${evt.type}`, JSON.stringify(evt.data).slice(0, 200));
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/webhook-log') return json(res, 200, events.slice(0, 20));
    const file = url.pathname === '/' || !url.pathname.includes('.') ? 'index.html' : url.pathname.slice(1);
    const content = await readFile(new URL(`./public/${file}`, import.meta.url));
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.map') ? 'application/json' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') return json(res, 404, { message: 'not found' });
    console.error(err);
    json(res, 500, { message: 'demo server error' });
  }
}).listen(PORT, () => console.log(`Demo product on http://localhost:${PORT} → Pitwall at ${PITWALL_URL}`));
