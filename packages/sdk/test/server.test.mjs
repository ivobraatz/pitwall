import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { bridgeTarget, createSupportBridge, encodeActor, signWebhook, verifyWebhook } from '../dist/server/index.js';

test('bridge targets stay inside the support surface', () => {
  assert.equal(bridgeTarget('https://pw.test/', ['tickets', 'abc'], '?x=1'), 'https://pw.test/v1/support/tickets/abc?x=1');
  assert.equal(bridgeTarget('https://pw.test', ['..', 'ingest', 'errors'], ''), null);
  assert.equal(bridgeTarget('https://pw.test', ['tickets%2F..'], ''), null);
  assert.equal(bridgeTarget('https://pw.test', ['a' + String.fromCharCode(92) + 'b'], ''), null);
});

test('bridge forwards with the key and the actor, and refuses without a session', async () => {
  let seen;
  const bridge = createSupportBridge({
    baseUrl: 'https://pw.test', apiKey: 'pw_x_key',
    resolveActor: (req) => (req.headers.get('cookie') === 'ok' ? { customerId: 'ws-1', userName: 'Ana Ção' } : null),
    fetch: async (url, init) => { seen = { url, init }; return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'leak=1' } }); },
  });
  const denied = await bridge.handle(new Request('https://app.test/api/support/tickets'), ['tickets']);
  assert.equal(denied.status, 401);

  const res = await bridge.handle(new Request('https://app.test/api/support/tickets?status=open', { headers: { cookie: 'ok' } }), ['tickets']);
  assert.equal(res.status, 200);
  assert.equal(seen.url, 'https://pw.test/v1/support/tickets?status=open');
  assert.equal(seen.init.headers.get('authorization'), 'Bearer pw_x_key');
  const actor = JSON.parse(Buffer.from(seen.init.headers.get('pitwall-actor'), 'base64url').toString('utf8'));
  assert.deepEqual(actor, { customerId: 'ws-1', userName: 'Ana Ção' });
  assert.equal(res.headers.get('set-cookie'), null, 'only content headers come back');

  const traversal = await bridge.handle(new Request('https://app.test/x', { headers: { cookie: 'ok' } }), ['..', 'ingest', 'errors']);
  assert.equal(traversal.status, 400);
});

test('actor encoding is base64url JSON', () => {
  assert.equal(Buffer.from(encodeActor({ customerId: 'a' }), 'base64url').toString(), '{"customerId":"a"}');
});

test('webhook signature matches the API format and is checked', () => {
  const body = '{"id":"1","type":"ping","createdAt":"x","product":{"id":"p","slug":"s"},"data":{}}';
  const ts = Math.floor(Date.now() / 1000);
  const header = signWebhook('pwhs_s', ts, body);
  const mac = createHmac('sha256', 'pwhs_s').update(`${ts}.${body}`).digest('hex');
  assert.equal(header, `t=${ts},v1=${mac}`);
  assert.equal(verifyWebhook('pwhs_s', header, body)?.type, 'ping');
  assert.equal(verifyWebhook('pwhs_other', header, body), null);
  assert.equal(verifyWebhook('pwhs_s', header, body.replace('ping', 'pong')), null);
  assert.equal(verifyWebhook('pwhs_s', header, body, Date.now() + 10 * 60_000), null);
});
