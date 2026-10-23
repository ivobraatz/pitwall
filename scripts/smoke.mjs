// End-to-end smoke test against a running Pitwall API (dev admin from appsettings.Development.json).
// node scripts/smoke.mjs   (API=http://localhost:5180 by default)
const API = process.env.API ?? 'http://localhost:5180';
let cookie = '';
const log = (...a) => console.log(...a);
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } else log('ok -', msg); }

async function staff(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Pitwall-Staff': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const actor = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function product(key, method, path, body, act) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(act ? { 'Pitwall-Actor': actor(act) } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const login = await staff('POST', '/v1/staff/auth/login', { email: 'admin@pitwall.local', password: 'pitwall-dev-password' });
assert(login.status === 200 && cookie, 'staff login');

const slug = 'smoke' + Date.now().toString(36);
const p = await staff('POST', '/v1/staff/products', {
  slug, name: 'Smoke Test', description: 'A test product.',
  settings: { ownFramePrefixes: ['Smoke.'], locales: ['pt', 'en'], autoPublishReleases: true },
});
assert(p.status === 200, 'create product ' + JSON.stringify(p.body));
const k = await staff('POST', `/v1/staff/products/${p.body.id}/keys`, { name: 'backend', scopes: ['support', 'errors'] });
assert(k.status === 200 && k.body.token.startsWith(`pw_${slug}_`), 'create key');
const key = k.body.token;
const ci = await staff('POST', `/v1/staff/products/${p.body.id}/keys`, { name: 'ci', scopes: ['releases'] });

const alice = { customerId: 'ws-1', customerName: 'Acme Ltda', userId: 'u-1', userName: 'Alice Ção', userEmail: 'alice@acme.test' };
const bob = { customerId: 'ws-2', customerName: 'Outra', userId: 'u-2', userName: 'Bob' };

// Scope checks
const noScope = await product(ci.body.token, 'GET', '/v1/support/tickets', null, alice);
assert(noScope.status === 403, 'release key cannot read tickets');
const noActor = await product(key, 'GET', '/v1/support/tickets');
assert(noActor.status === 400, 'actor header required');
const badKey = await product('pw_nope_x', 'GET', '/v1/support/tickets', null, alice);
assert(badKey.status === 401, 'unknown key rejected');

// Server error first, then a ticket that carries its trace id
const err = await product(key, 'POST', '/v1/ingest/errors', { errors: [{
  traceId: 'trace-abc', customerId: 'ws-1', userId: 'u-1', method: 'POST', path: '/api/reports/42/run',
  routeTemplate: '/api/reports/{id}/run', statusCode: 500, exceptionType: 'System.InvalidOperationException',
  message: 'Sequence contains no elements',
  stackTrace: 'System.InvalidOperationException: Sequence contains no elements\n   at System.Linq.Enumerable.First()\n   at Smoke.Reports.Runner.Run(Int32 id) in /src/Runner.cs:line 42',
  release: '1.2.3',
}] });
assert(err.status === 200 && err.body.accepted === 1, 'ingest server error');

const created = await product(key, 'POST', '/v1/support/tickets', {
  title: 'Relatório não roda', body: 'Clico em rodar e dá erro.', category: 'bug', severity: 'high',
  route: '/reports/42', traceIds: ['trace-abc'],
  diagnostics: { capturedAt: new Date().toISOString(), context: { route: '/reports/42' }, logs: [], requests: [], errors: [], events: [], traceIds: ['trace-abc'] },
}, alice);
assert(created.status === 201 && /^\d{8}-[0-9A-Z]{4}$/.test(created.body.code), 'create ticket ' + created.body.code);
const id = created.body.id;

const mine = await product(key, 'GET', '/v1/support/tickets', null, alice);
assert(mine.body.total === 1, 'customer sees own ticket');
const other = await product(key, 'GET', `/v1/support/tickets/${id}`, null, bob);
assert(other.status === 404, 'other customer cannot read it');

// Recording upload
const form = new FormData();
form.append('file', new Blob([JSON.stringify([{ type: 4, data: {}, timestamp: 1 }, { type: 2, data: {}, timestamp: 2 }])], { type: 'application/json' }), 'recording.json');
form.append('kind', 'recording');
form.append('meta', JSON.stringify({ mode: 'procedure', durationMs: 1000, traceIds: ['trace-abc'] }));
const up = await product(key, 'POST', `/v1/support/tickets/${id}/attachments`, form, alice);
assert(up.status === 201 && up.body.kind === 'recording', 'upload recording');
const html = new FormData();
html.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
const upBad = await product(key, 'POST', `/v1/support/tickets/${id}/attachments`, html, alice);
assert(upBad.status === 400, 'html upload refused');
const dl = await fetch(`${API}/v1/support/tickets/${id}/attachments/${up.body.id}`, { headers: { Authorization: `Bearer ${key}`, 'Pitwall-Actor': actor(alice) } });
assert(dl.status === 200 && (await dl.text()).includes('timestamp'), 'download recording');

// Team side
const queue = await staff('GET', `/v1/staff/tickets?productId=${p.body.id}`);
assert(queue.body.total === 1 && queue.body.items[0].awaitingUs, 'ticket in staff queue, awaiting us');
const dossier = await staff('GET', `/v1/staff/tickets/${id}`);
assert(dossier.body.serverErrors.length === 1 && dossier.body.errorSignature, 'dossier joins server error by trace id');
assert(dossier.body.opener.email === 'alice@acme.test', 'team sees opener email');

const note = await staff('POST', `/v1/staff/tickets/${id}/messages`, { body: 'Nota interna: bug no Runner.', internal: true });
const reply = await staff('POST', `/v1/staff/tickets/${id}/messages`, { body: 'Estamos olhando!', status: 'fixed_pending_deploy' });
assert(note.status === 201 && reply.status === 201, 'team note + reply');
await staff('PATCH', `/v1/staff/tickets/${id}`, { fixedIn: '1.2.4', assigneeId: login.body.id });

const view = await product(key, 'GET', `/v1/support/tickets/${id}`, null, alice);
assert(view.body.messages.length === 1 && view.body.messages[0].author.id === 'team' && view.body.messages[0].author.name === 'Smoke Test',
  'customer sees only the team reply, signed by the team');
assert(view.body.status === 'fixed_pending_deploy' && view.body.fixedIn === '1.2.4', 'customer sees fix status');

// Known issue: Bob hits the same bug
await product(key, 'POST', '/v1/ingest/errors', { errors: [{
  traceId: 'trace-bob', customerId: 'ws-2', method: 'POST', path: '/api/reports/7/run', routeTemplate: '/api/reports/{id}/run',
  statusCode: 500, exceptionType: 'System.InvalidOperationException', message: 'Sequence contains no elements',
  stackTrace: 'System.InvalidOperationException\n   at System.Linq.Enumerable.First()\n   at Smoke.Reports.Runner.Run(Int32 id) in /src/Runner.cs:line 44',
}] });
const known = await product(key, 'GET', '/v1/support/known-issue?traceId=trace-bob', null, bob);
assert(known.body.known === true && known.body.status === 'fixed_pending_deploy' && known.body.ticketId === null, 'known issue for another customer, without the ticket link');
const knownOther = await product(key, 'GET', '/v1/support/known-issue?traceId=trace-bob', null, alice);
assert(knownOther.body.known === false, 'trace id of another customer is not a capability');

// Errors screen
const groups = await staff('GET', `/v1/staff/errors/groups?productId=${p.body.id}`);
assert(groups.body.length === 1 && groups.body[0].count === 2 && groups.body[0].customers === 2 && groups.body[0].tickets.open === 1,
  'errors grouped by signature across customers (line shift ignored)');

// Release mentioning the ticket code resolves it (note fails without an Anthropic key, tickets still resolve)
const rel = await product(ci.body.token, 'POST', '/v1/ingest/releases', {
  version: '1.2.4', commits: [{ sha: 'abcdef1234567', subject: `fix: runner on empty reports (${created.body.code})`, body: null }],
});
log('release outcome:', rel.status, JSON.stringify(rel.body).slice(0, 200));
const after = await product(key, 'GET', `/v1/support/tickets/${id}`, null, alice);
assert(after.body.status === 'resolved', 'release resolved the ticket');

// Webhook outbox (no URL configured → nothing queued)
const summary = await staff('GET', '/v1/staff/summary');
assert(summary.status === 200 && Array.isArray(summary.body.products), 'summary');

// Public changelog
const pub = await fetch(`${API}/v1/public/${slug}/releases`);
assert(pub.status === 200, 'public changelog reachable');

// CSRF: a staff write without the console header is refused
const csrf = await fetch(API + `/v1/staff/tickets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"status":"open"}' });
assert(csrf.status === 401, 'staff write without console header refused');

log('\nALL GOOD');
