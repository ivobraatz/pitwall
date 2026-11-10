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

test('lists the board and the atlas tools with schemas', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'atlas_attention', 'atlas_overview', 'atlas_processes', 'board_summary', 'comment_task', 'create_task', 'finish_activity',
    'finish_routine_run', 'get_task', 'link_services', 'list_errors', 'list_products', 'list_routines', 'list_tasks', 'move_task',
    'register_process', 'register_repo', 'register_routine', 'register_service', 'register_system', 'start_activity',
    'start_routine_run', 'update_process_step', 'update_task',
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

test('start_activity posts and tells how to finish; finish posts the result', async () => {
  const { client, calls } = await connect({ respond: (call) => (call.url.endsWith('/finish') ? json(200, { id: 'a1', status: 'ok' }) : json(201, { id: 'a1', status: 'running' })) });
  const started = await client.callTool({ name: 'start_activity', arguments: { system: 'acme', component: 'api', description: 'Corrigindo o frete' } });
  assert.equal(started.isError, undefined);
  assert.equal(calls[0].url, `${URL_}/v1/staff/atlas/activities`);
  assert.deepEqual(calls[0].body, { system: 'acme', component: 'api', description: 'Corrigindo o frete' });
  assert.match(text(started), /finish_activity\(id="a1"\)/);

  await client.callTool({ name: 'finish_activity', arguments: { id: 'a1', result: 'PR aberto' } });
  assert.equal(calls[1].url, `${URL_}/v1/staff/atlas/activities/a1/finish`);
  assert.equal(calls[1].body.result, 'PR aberto');
});

test('routine run reports what it produced', async () => {
  const { client, calls } = await connect({ respond: () => json(200, { id: 'r1' }) });
  await client.callTool({ name: 'start_routine_run', arguments: { routine: 'triagem' } });
  assert.equal(calls[0].url, `${URL_}/v1/staff/atlas/routines/triagem/runs`);
  await client.callTool({
    name: 'finish_routine_run',
    arguments: { id: 'r1', status: 'ok', result: '1 PR', links: [{ kind: 'pr', label: 'Corrige o frete', url: 'https://git.example.com/acme/acme/pull/7' }] },
  });
  assert.equal(calls[1].url, `${URL_}/v1/staff/atlas/runs/r1/finish`);
  assert.equal(calls[1].body.links[0].kind, 'pr');
});

test('an empty atlas says so, and a token without the scope gets the api message', async () => {
  const empty = { systems: [], now: [], discoveries: [], collectors: [] };
  const { client } = await connect({ respond: () => json(200, empty) });
  assert.match(text(await client.callTool({ name: 'atlas_overview', arguments: {} })), /Atlas está vazio/);

  const message = 'O token não tem o escopo atlas. Gere outro em Configurações → Tokens pessoais.';
  const denied = await connect({ respond: () => json(403, { message }) });
  const res = await denied.client.callTool({ name: 'register_system', arguments: { slug: 'acme', name: 'Acme' } });
  assert.equal(res.isError, true);
  assert.equal(text(res), message);
});

test('atlas_overview summarises health, now and what was found', async () => {
  const overview = {
    systems: [
      { slug: 'acme', name: 'Acme', health: { total: 3, up: 2, down: 1, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 2, tickets: 1, errors: 4, alerts: null } },
      { slug: 'globex', name: 'Globex', health: { total: 0, up: 0, down: 0, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: 0 } },
    ],
    now: [{ kind: 'activity', title: 'Corrigindo o frete', detail: 'api', actor: 'Ana (Claude)' }],
    discoveries: [{ source: 'railway', kind: 'service', name: 'acme/worker', environment: 'production' }],
    collectors: [{ name: 'railway', connected: true, error: null }, { name: 'vercel', connected: false, error: null }],
  };
  const { client } = await connect({ respond: () => json(200, overview) });
  const out = text(await client.callTool({ name: 'atlas_overview', arguments: {} }));
  assert.match(out, /acme — 1 fora do ar · 2 tarefas · 1 chamados · 4 erros \(24h\) · \? alertas/);
  assert.match(out, /globex — sem serviços/);
  assert.match(out, /\[activity\] Corrigindo o frete \(Ana \(Claude\)\)/);
  assert.match(out, /railway: acme\/worker @production/);
  assert.match(out, /Coletores não conectados: vercel\./);
});

test('a service carries what the collectors do not see, and a link its kind', async () => {
  const { client, calls } = await connect({ respond: () => json(200, { id: 's1', name: 'App da loja', created: true }) });
  await client.callTool({
    name: 'register_service',
    arguments: { system: 'acme', name: 'App da loja', kind: 'app', condition: 'gap', impact: 'high', owner: 'person', task: 'T-ABC12', facts: { Loja: 'Play' }, items: ['Mastodon'] },
  });
  assert.deepEqual(calls[0].body, { system: 'acme', name: 'App da loja', kind: 'app', condition: 'gap', impact: 'high', owner: 'person', task: 'T-ABC12', facts: { Loja: 'Play' }, items: ['Mastodon'] });
  const linked = await client.callTool({ name: 'link_services', arguments: { from: 'acme/API', to: 'acme/App da loja', kind: 'deploy', planned: true } });
  assert.equal(calls[1].url, `${URL_}/v1/staff/atlas/links`);
  assert.equal(calls[1].body.kind, 'deploy');
  assert.match(text(linked), /\(planejado\)/);
  const wrong = await client.callTool({ name: 'link_services', arguments: { from: 'a', to: 'b', kind: 'magic' } });
  assert.equal(wrong.isError, true);
});

test('a process is written whole, a step alone, and both read back in order', async () => {
  const process = {
    slug: 'acme-venda', name: 'Venda', description: null, system: { slug: 'acme' },
    stages: [{ key: 'oferta', name: 'Oferta' }],
    steps: [
      { slug: 'contato', name: 'Contato', status: 'ok', stage: 'oferta', owner: 'auto', today: null, ideal: null, next: null, task: null, impact: null, system: null },
      { slug: 'contrato', name: 'Contrato', status: 'gap', stage: null, owner: null, today: null, ideal: null, next: 'Escolher a plataforma.', task: 'T-ABC12', impact: 'high', system: { slug: 'acme' } },
    ],
  };
  const { client, calls } = await connect({
    respond: (call) => {
      if (call.url.endsWith('/steps')) return json(200, { ...process.steps[1], status: 'next' });
      if (call.method === 'POST') return json(200, { slug: 'acme-venda', name: 'Venda', steps: 2, created: true });
      return json(200, [process]);
    },
  });
  const written = await client.callTool({ name: 'register_process', arguments: { slug: 'acme-venda', name: 'Venda', steps: [{ slug: 'contato', name: 'Contato' }, { slug: 'contrato', name: 'Contrato' }] } });
  assert.match(text(written), /Cadastrado: acme-venda — Venda \(2 etapas\)/);
  assert.equal(calls[0].body.steps.length, 2);

  await client.callTool({ name: 'update_process_step', arguments: { process: 'acme-venda', slug: 'contrato', status: 'next' } });
  assert.equal(calls[1].url, `${URL_}/v1/staff/atlas/processes/acme-venda/steps`);
  assert.deepEqual(calls[1].body, { slug: 'contrato', status: 'next' });

  const out = text(await client.callTool({ name: 'atlas_processes', arguments: { system: 'acme' } }));
  assert.equal(calls[2].url, `${URL_}/v1/staff/atlas/processes?system=acme`);
  assert.match(out, /\[ok\] contato: Contato — Oferta/);
  assert.match(out, /\[gap\] contrato: Contrato — acme \(T-ABC12, impacto alto\)\n {6}próximo: Escolher a plataforma\./);
});

test('atlas_attention lists gaps with impact and what to do next', async () => {
  const items = [
    { source: 'service', status: 'gap', title: 'App da loja', detail: 'Sai como pacote avulso.', next: null, impact: 'high', owner: 'person', task: 'T-ABC12', system: { slug: 'acme' }, where: 'Na web' },
    { source: 'step', status: 'warn', title: 'Nota fiscal', detail: null, next: 'Ligar a emissão.', impact: null, owner: null, task: null, system: null, where: 'Venda' },
  ];
  const { client } = await connect({ respond: () => json(200, items) });
  const out = text(await client.callTool({ name: 'atlas_attention', arguments: {} }));
  assert.match(out, /\[gap\] App da loja — acme · Na web \(impacto alto, T-ABC12\)\n {4}Sai como pacote avulso\./);
  assert.match(out, /\[warn\] Nota fiscal — Venda\n {4}Ligar a emissão\./);
  const { client: empty } = await connect({ respond: () => json(200, []) });
  assert.match(text(await empty.callTool({ name: 'atlas_attention', arguments: {} })), /Nada declarado/);
});

test('list_errors sends the period, product and limit and summarises each group', async () => {
  const report = {
    since: '2026-11-09T10:00:00Z',
    items: [
      {
        product: { slug: 'acme', name: 'Acme' }, signature: 'abc123', route: '/api/orders/{id}', method: 'POST', exceptionType: 'NullReferenceException',
        message: 'Object reference not set', statusCode: 500, count: 12, customers: 3, firstSeen: '2026-11-09T11:00:00Z', lastSeen: '2026-11-10T08:00:00Z',
        traceId: 'trace-1', tickets: { total: 1, open: 1 }, tasks: { total: 1, open: 1, codes: ['T-7K2QM'] }, tracked: true,
      },
      {
        product: { slug: 'globex', name: 'Globex' }, signature: 'def456', route: null, method: 'GET', exceptionType: 'TimeoutException',
        message: 'Timed out', statusCode: 500, count: 1, customers: 1, firstSeen: '2026-11-10T07:00:00Z', lastSeen: '2026-11-10T07:00:00Z',
        traceId: 'trace-2', tickets: { total: 0, open: 0 }, tasks: { total: 0, open: 0, codes: [] }, tracked: false,
      },
    ],
  };
  const { client, calls } = await connect({ respond: () => json(200, report) });
  const res = await client.callTool({ name: 'list_errors', arguments: { since: '48', product: 'acme', limit: 10 } });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, `${URL_}/v1/staff/errors/recent?since=48&product=acme&limit=10`);
  const out = text(res);
  assert.match(out, /acme POST \/api\/orders\/\{id\} — NullReferenceException: Object reference not set/);
  assert.match(out, /12x \(3 cliente\(s\)\).* trace trace-1 · assinatura abc123/);
  assert.match(out, /já registrado: 1 chamado\(s\) \+ tarefa T-7K2QM/);
  assert.match(out, /sem chamado nem tarefa/);

  await client.callTool({ name: 'list_errors', arguments: {} });
  assert.equal(calls[1].url, `${URL_}/v1/staff/errors/recent`);
});

test('list_errors says so when there is nothing, and relays a missing scope', async () => {
  const empty = await connect({ respond: () => json(200, { since: '2026-11-09T10:00:00Z', items: [] }) });
  assert.match(text(await empty.client.callTool({ name: 'list_errors', arguments: {} })), /Nenhum erro no período/);

  const message = 'O token não tem o escopo errors. Gere outro em Configurações → Tokens pessoais.';
  const denied = await connect({ respond: () => json(403, { message }) });
  const res = await denied.client.callTool({ name: 'list_errors', arguments: {} });
  assert.equal(res.isError, true);
  assert.equal(text(res), message);
});
