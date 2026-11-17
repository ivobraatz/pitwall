import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';

const URL_ = 'https://pitwall.example.com';
const TOKEN = 'pwt_SEGREDOsegredoSEGREDOsegredoSEGREDOsegr';
const N_ID = '0b6c0000-0000-0000-0000-000000000010';

const note = (over = {}) => ({
  id: N_ID, code: 'N-7K2QM', folder: { id: 'f1', name: 'Ideias' }, folderPath: 'Ideias', product: null,
  title: 'Cobrar taxa de cancelamento', excerpt: 'Hoje não cobramos nada.', stage: 'idea', labels: [], pinned: false,
  source: 'claude', createdBy: { ref: 's1', name: 'Ana (Claude)' }, updatedByName: 'Ana (Claude)', task: null,
  convertedAt: null, wordCount: 4, createdAt: '2026-11-10T10:00:00Z', updatedAt: '2026-11-10T10:00:00.123456Z', archivedAt: null,
  ...over,
});

const detail = (over = {}) => ({ ...note(), body: 'Hoje não cobramos nada.', backlinks: [], linked: [], ...over });

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

/** A connected MCP client over an in-memory pair, and the requests the server sent to Pitwall. */
async function connect({ respond = () => json(200, {}) } = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const call = { url: input, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return respond(call);
  };
  const { server } = createServer({ url: URL_, token: TOKEN, fetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, calls };
}

const text = (result) => result.content.map((c) => c.text).join('\n');

test('the notes tools are listed with schemas and read-only hints where they read', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ['list_note_folders', 'list_notes', 'get_note', 'note_task_preview']) {
    assert.equal(byName[name].annotations.readOnlyHint, true, `${name} is read-only`);
  }
  assert.deepEqual(byName.update_note.inputSchema.properties.folderId.type, ['string', 'null']);
  assert.deepEqual(byName.create_note.inputSchema.required, ['title']);
  assert.deepEqual(byName.list_notes.inputSchema.properties.stage.items.enum, ['idea', 'shaping', 'ready', 'converted']);
});

test('list_note_folders draws the tree with the inbox and the archive', async () => {
  const folders = {
    items: [
      { id: 'f2', parentId: 'f1', name: 'Estornos', position: 2048, noteCount: 1, createdAt: '', updatedAt: '' },
      { id: 'f1', parentId: null, name: 'Ideias', position: 1024, noteCount: 3, createdAt: '', updatedAt: '' },
      { id: 'f3', parentId: null, name: 'Pagamentos', position: 2048, noteCount: 0, createdAt: '', updatedAt: '' },
    ],
    inbox: 5,
    archived: 2,
  };
  const { client, calls } = await connect({ respond: () => json(200, folders) });
  const res = await client.callTool({ name: 'list_note_folders', arguments: {} });
  assert.equal(calls[0].url, `${URL_}/v1/staff/notes/folders`);
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].text.split('\n').join('|'),
    'Entrada (sem pasta) — 5|f1 — Ideias (3)|  f2 — Estornos (1)|f3 — Pagamentos (0)|Arquivadas — 2');
});

test('list_notes sends the filters, defaults the limit to 30 and formats each note', async () => {
  const { client, calls } = await connect({
    respond: () => json(200, { items: [note({ pinned: true, labels: ['pagamento'], product: { id: 'p1', slug: 'demo', name: 'Demo', color: null } })], nextCursor: 'abc', serverTime: '' }),
  });
  const res = await client.callTool({ name: 'list_notes', arguments: { folder: 'inbox', stage: ['idea', 'ready'], label: 'pagamento' } });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v1/staff/notes');
  assert.equal(url.searchParams.get('folder'), 'inbox');
  assert.equal(url.searchParams.get('stage'), 'idea,ready');
  assert.equal(url.searchParams.get('limit'), '30');
  assert.equal(url.searchParams.has('deep'), false);
  const out = text(res);
  assert.match(out, /^N-7K2QM \[idea\] Cobrar taxa de cancelamento \(demo\) · pasta: Ideias · fixada · #pagamento$/m);
  assert.match(out, /há mais resultados/);

  const empty = await connect({ respond: () => json(200, { items: [], nextCursor: null, serverTime: '' }) });
  assert.match(text(await empty.client.callTool({ name: 'list_notes', arguments: {} })), /Nenhuma anotação encontrada/);
});

test('create_note posts the body and reports the note line', async () => {
  const { client, calls } = await connect({ respond: () => json(201, detail({ folder: null, folderPath: '', stage: 'shaping' })) });
  const res = await client.callTool({ name: 'create_note', arguments: { title: 'Cobrar taxa de cancelamento', stage: 'shaping', body: '## Contexto\nNada.' } });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${URL_}/v1/staff/notes`);
  assert.deepEqual(calls[0].body, { title: 'Cobrar taxa de cancelamento', stage: 'shaping', body: '## Contexto\nNada.' });
  assert.equal(res.content[0].text, 'Criada: N-7K2QM [shaping] Cobrar taxa de cancelamento');
  assert.equal(JSON.parse(res.content[1].text).code, 'N-7K2QM');
});

test('update_note with append sends only append; null clears folder and product', async () => {
  const { client, calls } = await connect({ respond: () => json(200, detail({ body: 'antes\n\nAchado novo.' })) });
  const res = await client.callTool({ name: 'update_note', arguments: { note: 'n-7k2qm', append: 'Achado novo.' } });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, `${URL_}/v1/staff/notes/n-7k2qm`);
  assert.deepEqual(calls[0].body, { append: 'Achado novo.' });
  assert.match(text(res), /^Atualizada: N-7K2QM/);

  await client.callTool({ name: 'update_note', arguments: { note: 'N-7K2QM', folderId: null, product: null } });
  assert.deepEqual(calls[1].body, { folderId: null, product: null });

  const empty = await client.callTool({ name: 'update_note', arguments: { note: 'N-7K2QM' } });
  assert.equal(empty.isError, true);
  assert.match(text(empty), /Nada para editar/);
  assert.equal(calls.length, 2, 'an empty edit makes no request');
});

test('convert with a 400 shows the missing items from the api', async () => {
  const message = 'A anotação ainda não está estruturada: Título curto demais: diga a ação no imperativo.; Liste os passos como checklist (- [ ] passo).';
  const { client, calls } = await connect({ respond: () => json(400, { message, missing: ['x', 'y'] }) });
  const res = await client.callTool({ name: 'convert_note_to_task', arguments: { note: 'N-7K2QM' } });
  assert.equal(calls[0].url, `${URL_}/v1/staff/notes/N-7K2QM/convert`);
  assert.equal(res.isError, true);
  assert.match(text(res), /Título curto demais/);
  assert.match(text(res), /Liste os passos como checklist/);
});

test('convert returns the task and says the note became it', async () => {
  const task = { id: 't1', code: 'T-7K2QM', title: 'Cobrar taxa de cancelamento', status: 'todo' };
  const { client } = await connect({ respond: () => json(201, { note: detail({ task, stage: 'converted' }), task }) });
  const res = await client.callTool({ name: 'convert_note_to_task', arguments: { note: 'N-7K2QM', priority: 'high' } });
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].text, 'Tarefa criada: T-7K2QM [todo] Cobrar taxa de cancelamento. A anotação N-7K2QM virou essa tarefa.');
});

test('note_task_preview shows readiness, what is missing, and the draft', async () => {
  const draft = {
    title: 'Cobrar taxa de cancelamento', body: 'corpo', checklist: ['Ler o contrato', 'Testar'],
    links: [{ label: 'Stripe', url: 'https://example.com/doc' }], labels: ['pagamento'], productSlug: null,
    readiness: { score: 70, ready: false, missing: ['Escolha o sistema.', 'Diga como verificar que deu certo (## Como verificar).'] },
  };
  const { client, calls } = await connect({ respond: () => json(200, draft) });
  const out = text(await client.callTool({ name: 'note_task_preview', arguments: { note: 'N-7K2QM' } }));
  assert.equal(calls[0].url, `${URL_}/v1/staff/notes/N-7K2QM/task-preview`);
  assert.match(out, /Prontidão: 70\/100 \(falta: Escolha o sistema\.; Diga como verificar/);
  assert.match(out, /- \[ \] Ler o contrato/);
  assert.match(out, /Stripe: https:\/\/example\.com\/doc/);
});

test('get_note lists the notes that cite it and the ones it cites', async () => {
  const { client } = await connect({
    respond: () => json(200, detail({
      backlinks: [{ code: 'N-AAAAA', title: 'Fluxo de estorno' }],
      linked: [{ code: 'N-BBBBB', title: 'Taxa', missing: false }, { code: 'N-CCCCC', title: '', missing: true }],
    })),
  });
  const out = text(await client.callTool({ name: 'get_note', arguments: { note: 'N-7K2QM' } }));
  assert.match(out, /Citada por:\n- N-AAAAA Fluxo de estorno/);
  assert.match(out, /Cita:\n- N-BBBBB Taxa\n- N-CCCCC  \(não encontrada\)/);
});

test('archive_note answers 204 and reports the code', async () => {
  const { client, calls } = await connect({ respond: () => new Response(null, { status: 204 }) });
  const res = await client.callTool({ name: 'archive_note', arguments: { note: 'n-7k2qm' } });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${URL_}/v1/staff/notes/n-7k2qm/archive`);
  assert.equal(res.isError, undefined);
  assert.equal(text(res), 'Arquivada: N-7K2QM.');
});

test('a token without the notes scope gets the api message', async () => {
  const message = 'O token não tem o escopo notes. Marque notes no token, em Conta e equipe → Tokens pessoais.';
  const { client } = await connect({ respond: () => json(403, { message }) });
  const res = await client.callTool({ name: 'list_notes', arguments: {} });
  assert.equal(res.isError, true);
  assert.equal(text(res), message);
});
