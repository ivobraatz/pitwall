import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';

const URL_ = 'https://pitwall.example.com';
const TOKEN = 'pwt_SEGREDOsegredoSEGREDOsegredoSEGREDOsegr';

const task = (over = {}) => ({
  id: '0b6c0000-0000-0000-0000-000000000001', code: 'T-7K2QM',
  product: { id: 'p1', slug: 'demo', name: 'Demo', color: null },
  title: 'Configurar callback OAuth', status: 'todo', position: 1024, priority: 'normal', labels: [], dueDate: null,
  assignee: null, source: 'claude', createdBy: { ref: 's1', name: 'Ana (Claude)' }, blockedNote: null,
  checklistDone: 0, checklistTotal: 0, commentCount: 0, overdue: false,
  createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00.123456Z', doneAt: null, archivedAt: null,
  ...over,
});

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

/** A connected MCP client over an in-memory pair, and the requests the server sent to Pitwall. */
async function connect({ url = URL_, token = TOKEN, respond = () => json(200, {}) } = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const call = { url: input, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return respond(call);
  };
  const { server } = createServer({ url, token, fetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, calls };
}

const text = (result) => result.content.map((c) => c.text).join('\n');

test('lists the eight tools with schemas', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'board_summary', 'comment_task', 'create_task', 'get_task', 'list_products', 'list_tasks', 'move_task', 'update_task',
  ]);
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} has a description`);
    assert.equal(t.inputSchema.type, 'object');
  }
  const create = tools.find((t) => t.name === 'create_task');
  assert.deepEqual(create.inputSchema.required, ['title']);
  const move = tools.find((t) => t.name === 'move_task');
  assert.deepEqual(move.inputSchema.properties.status.enum, ['todo', 'doing', 'blocked', 'done']);
});

test('missing env returns configuration error', async () => {
  const { client, calls } = await connect({ url: undefined, token: '' });
  const res = await client.callTool({ name: 'board_summary', arguments: {} });
  assert.equal(res.isError, true);
  assert.match(text(res), /Configure PITWALL_URL e PITWALL_TOKEN/);
  assert.equal(calls.length, 0);
});

test('401 becomes token message without leaking token', async () => {
  const { client, calls } = await connect({ respond: () => json(401, { message: `bad ${TOKEN}` }) });
  const res = await client.callTool({ name: 'list_tasks', arguments: { status: ['blocked'] } });
  assert.equal(res.isError, true);
  assert.match(text(res), /Token inválido, expirado ou revogado/);
  assert.ok(!JSON.stringify(res).includes(TOKEN), 'the token never shows in a result');
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
});

test('network error mentions url', async () => {
  const { client } = await connect({ url: `${URL_}///`, respond: () => { throw new TypeError(`fetch failed ${TOKEN}`); } });
  const res = await client.callTool({ name: 'get_task', arguments: { task: 'T-7K2QM' } });
  assert.equal(res.isError, true);
  assert.equal(text(res), `Não consegui falar com ${URL_}. Verifique a URL e se o console está no ar.`);
  assert.ok(!text(res).includes(TOKEN));
});

test('create_task posts body and formats result', async () => {
  const { client, calls } = await connect({
    respond: () => json(201, task({ priority: 'high', checklistTotal: 2, labels: ['oauth'] })),
  });
  const res = await client.callTool({
    name: 'create_task',
    arguments: { title: 'Configurar callback OAuth', product: 'demo', priority: 'high', labels: ['oauth'], checklist: ['Salvar domínio', 'Testar'] },
  });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${URL_}/v1/staff/tasks`);
  assert.deepEqual(calls[0].body.checklist, [{ text: 'Salvar domínio' }, { text: 'Testar' }]);
  assert.equal(calls[0].body.product, 'demo');
  assert.equal(res.content[0].text, 'Criada: T-7K2QM [todo] Configurar callback OAuth (demo) · alta · ✓0/2 · #oauth');
  assert.equal(JSON.parse(res.content[1].text).code, 'T-7K2QM');
});

test('update_task applies checklistToggle over current checklist', async () => {
  const current = task({
    checklist: [{ id: 'c1', text: 'Salvar domínio', done: false }, { id: 'c2', text: 'Testar', done: false }],
    checklistTotal: 2, comments: [], events: [],
  });
  const { client, calls } = await connect({
    respond: (call) => (call.method === 'GET' ? json(200, current) : json(200, task({ checklistDone: 1, checklistTotal: 2 }))),
  });
  const res = await client.callTool({ name: 'update_task', arguments: { task: 'T-7K2QM', checklistToggle: [{ id: 'c2', done: true }] } });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, `${URL_}/v1/staff/tasks/T-7K2QM`);
  assert.deepEqual(calls[1].body.checklist, [
    { id: 'c1', text: 'Salvar domínio', done: false }, { id: 'c2', text: 'Testar', done: true },
  ]);
  assert.equal(calls[1].body.ifUpdatedAt, current.updatedAt);
  assert.match(text(res), /✓1\/2/);

  const missing = await client.callTool({ name: 'update_task', arguments: { task: 'T-7K2QM', checklistToggle: [{ id: 'c9', done: true }] } });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /c9 não existe/);
});

test('move_task to blocked without note returns api message', async () => {
  const message = 'Para bloquear, escreva a nota de bloqueio (o que deu errado).';
  const { client, calls } = await connect({ respond: () => json(400, { message }) });
  const res = await client.callTool({ name: 'move_task', arguments: { task: 't-7k2qm', status: 'blocked' } });
  assert.equal(res.isError, true);
  assert.equal(text(res), message);
  assert.equal(calls[0].url, `${URL_}/v1/staff/tasks/t-7k2qm/move`);
  assert.deepEqual(calls[0].body, { status: 'blocked' });
});

test('board_summary lists blocked notes and counts', async () => {
  const board = {
    columns: {
      todo: [task({ code: 'T-AAAAA', overdue: true, dueDate: '2026-11-01' })],
      doing: [task({ code: 'T-BBBBB', status: 'doing', title: 'Testar login' })],
      blocked: [task({ code: 'T-CCCCC', status: 'blocked', blockedNote: 'erro 400 ao salvar\nmais detalhes' })],
      done: [],
    },
    counts: { todo: 1, doing: 1, blocked: 1, done: 0, overdue: 1 },
    serverTime: '2026-11-03T10:00:00Z',
  };
  const { client, calls } = await connect({ respond: () => json(200, board) });
  const res = await client.callTool({ name: 'board_summary', arguments: { product: 'demo' } });
  assert.equal(calls[0].url, `${URL_}/v1/staff/tasks/board?product=demo`);
  const summary = res.content[0].text;
  assert.match(summary, /1 a fazer, 1 fazendo, 1 bloqueadas, 0 concluídas; 1 atrasada/);
  assert.match(summary, /T-CCCCC \[blocked\] .* — nota: erro 400 ao salvar$/m);
  assert.match(summary, /T-BBBBB \[doing\] Testar login/);
  assert.match(summary, /Atrasadas em A fazer:\nT-AAAAA/);
});

test('a page that is not Pitwall is reported as a wrong url', async () => {
  const { client } = await connect({ respond: () => new Response('<html>login</html>', { status: 200 }) });
  const res = await client.callTool({ name: 'list_products', arguments: {} });
  assert.equal(res.isError, true);
  assert.match(text(res), /não é do Pitwall/);
});
