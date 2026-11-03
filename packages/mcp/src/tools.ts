import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CONFIG_MESSAGE, PitwallError, type PitwallClient } from './client.js';
import { boardSummary, taskDetail, taskLine, taskList, type Board, type ChecklistItem, type ProductRef, type Task, type TaskDetail } from './format.js';

const STATUS = z.enum(['todo', 'doing', 'blocked', 'done']);
const PRIORITY = z.enum(['low', 'normal', 'high']);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');
const TASK = z.string().min(1).describe('Código da tarefa (T-7K2QM) ou o id.');
const LINK = z.object({ label: z.string().max(80).optional(), url: z.string().url().max(500) });
const LABELS = z.array(z.string().max(32)).max(10).describe('Etiquetas em minúsculas, sem acento: [a-z0-9-].');

const TASKS = '/v1/staff/tasks';
const path = (task: string, rest = '') => `${TASKS}/${encodeURIComponent(task.trim())}${rest}`;

function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The short text first; the JSON after it, for when the model needs a field the text left out. */
function ok(text: string, data?: unknown): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text }];
  if (data !== undefined && data !== null) content.push({ type: 'text', text: JSON.stringify(data) });
  return { content };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Runs a tool body; any failure becomes a message the model can act on, never a stack trace or a secret. */
function guarded<A>(client: PitwallClient, run: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    if (!client.configured) return fail(CONFIG_MESSAGE);
    try {
      return await run(args);
    } catch (e) {
      if (e instanceof PitwallError) return fail(e.message);
      return fail('Erro inesperado no pitwall-mcp.');
    }
  };
}

export function registerTools(server: McpServer, client: PitwallClient): void {
  server.registerTool('list_products', {
    title: 'Listar sistemas',
    description: 'Lista os sistemas (produtos) do Pitwall: slug e nome. Use o slug no campo product das outras tools.',
    annotations: { readOnlyHint: true },
  }, guarded(client, async () => {
    const meta = await client.request<{ products: ProductRef[] }>('GET', `${TASKS}/meta`);
    const text = meta.products.length === 0 ? 'Nenhum sistema cadastrado.' : meta.products.map((p) => `${p.slug} — ${p.name}`).join('\n');
    return ok(text, meta.products);
  }));

  server.registerTool('list_tasks', {
    title: 'Buscar tarefas',
    description:
      'Busca tarefas da equipe, da mudança mais recente para a mais antiga. Busque antes de criar, para não duplicar. ' +
      'Para retomar o trabalho, filtre status [blocked, doing]. Para ver o que a pessoa concluiu, filtre [done] com updatedSince.',
    inputSchema: {
      status: z.array(STATUS).optional().describe('Colunas: todo, doing, blocked, done.'),
      product: z.string().optional().describe('Slug do sistema (veja list_products).'),
      q: z.string().optional().describe('Texto no título, no código ou no corpo.'),
      label: z.string().optional(),
      updatedSince: z.string().optional().describe('Só o que mudou desde esta data/hora ISO 8601.'),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Padrão 50.'),
    },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { status?: string[]; product?: string; q?: string; label?: string; updatedSince?: string; includeArchived?: boolean; limit?: number }) => {
    const res = await client.request<{ items: Task[]; nextCursor: string | null }>('GET', TASKS + query({
      status: a.status?.join(','), product: a.product, q: a.q, label: a.label, updatedSince: a.updatedSince,
      includeArchived: a.includeArchived, limit: a.limit ?? 50,
    }));
    const more = res.nextCursor ? '\n(há mais resultados: refine o filtro ou aumente limit)' : '';
    return ok(taskList(res.items) + more, res.items);
  }));

  server.registerTool('get_task', {
    title: 'Ler tarefa',
    description:
      'Traz a tarefa inteira: corpo, checklist (com os ids dos itens), links, nota de bloqueio, comentários e histórico. ' +
      'Leia antes de conferir, comentar ou mover uma tarefa.',
    inputSchema: { task: TASK },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { task: string }) => {
    const t = await client.request<TaskDetail>('GET', path(a.task));
    return ok(taskDetail(t), t);
  }));

  server.registerTool('create_task', {
    title: 'Criar tarefa',
    description:
      'Registra uma tarefa manual para a equipe. Só para o que a pessoa precisa fazer à mão e você não consegue: ' +
      'configurar um painel externo, testar num aparelho, obter uma credencial, aprovar algo. Um título por ação. ' +
      'No corpo (markdown): por que, os passos exatos e como saber se deu certo. Rode list_tasks antes, para não duplicar. ' +
      'Nunca crie tarefa para o que você mesmo pode fazer agora.',
    inputSchema: {
      title: z.string().min(1).max(200).describe('A ação, no imperativo: "Configurar callback OAuth no painel da Meta".'),
      body: z.string().max(20000).optional().describe('Markdown: contexto, passos, como verificar.'),
      product: z.string().optional().describe('Slug do sistema. Omita para tarefa geral da equipe.'),
      priority: PRIORITY.optional(),
      labels: LABELS.optional(),
      dueDate: DATE.optional().describe('Prazo, AAAA-MM-DD.'),
      checklist: z.array(z.string().min(1).max(300)).max(50).optional().describe('Passos marcáveis, um por item.'),
      links: z.array(LINK).max(20).optional(),
    },
  }, guarded(client, async (a: { title: string; body?: string; product?: string; priority?: string; labels?: string[]; dueDate?: string; checklist?: string[]; links?: { label?: string; url: string }[] }) => {
    const t = await client.request<Task>('POST', TASKS, {
      title: a.title, body: a.body, product: a.product, priority: a.priority, labels: a.labels, dueDate: a.dueDate,
      checklist: a.checklist?.map((text) => ({ text })), links: a.links,
    });
    return ok(`Criada: ${taskLine(t)}`, t);
  }));

  server.registerTool('update_task', {
    title: 'Editar tarefa',
    description:
      'Edita campos de uma tarefa; só os campos enviados mudam. Não muda o status: use move_task. ' +
      'Para marcar itens da checklist, use checklistToggle com os ids que get_task mostra. ' +
      'product, dueDate e assigneeId aceitam null para limpar.',
    inputSchema: {
      task: TASK,
      title: z.string().min(1).max(200).optional(),
      body: z.string().max(20000).optional(),
      product: z.string().nullable().optional(),
      priority: PRIORITY.optional(),
      labels: LABELS.optional(),
      dueDate: DATE.nullable().optional(),
      assigneeId: z.string().nullable().optional(),
      checklist: z.array(z.object({ id: z.string().optional(), text: z.string().min(1).max(300), done: z.boolean().optional() })).max(50)
        .optional().describe('Substitui a checklist inteira. Mantenha o id dos itens que continuam.'),
      checklistToggle: z.array(z.object({ id: z.string(), done: z.boolean() })).optional()
        .describe('Marca ou desmarca itens existentes, sem reescrever a checklist.'),
      links: z.array(LINK).max(20).optional().describe('Substitui a lista de links.'),
      blockedNote: z.string().min(1).max(2000).optional().describe('Só para tarefa em blocked: reescreve a nota de bloqueio.'),
    },
  }, guarded(client, async (a: {
    task: string; title?: string; body?: string; product?: string | null; priority?: string; labels?: string[];
    dueDate?: string | null; assigneeId?: string | null; checklist?: { id?: string; text: string; done?: boolean }[];
    checklistToggle?: { id: string; done: boolean }[]; links?: { label?: string; url: string }[]; blockedNote?: string;
  }) => {
    const { task, checklistToggle, ...fields } = a;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v;

    if (checklistToggle && checklistToggle.length > 0) {
      // Applied over the checklist as it is now (or as this call rewrites it), and sent back with
      // the version it was read at: a toggle never undoes someone else's edit made meanwhile.
      const current = await client.request<TaskDetail>('GET', path(task));
      const items: ChecklistItem[] = (a.checklist ?? current.checklist ?? []).map((c) => ({ id: c.id ?? '', text: c.text, done: c.done ?? false }));
      for (const toggle of checklistToggle) {
        const item = items.find((i) => i.id === toggle.id);
        if (!item) return fail(`O item ${toggle.id} não existe na checklist de ${current.code}. Rode get_task para ver os ids.`);
        item.done = toggle.done;
      }
      patch.checklist = items.map((i) => (i.id ? i : { text: i.text, done: i.done }));
      patch.ifUpdatedAt = current.updatedAt;
    }
    if (Object.keys(patch).length === 0) return fail('Nada para editar: envie ao menos um campo.');
    const t = await client.request<Task>('PATCH', path(task), patch);
    return ok(`Atualizada: ${taskLine(t)}`, t);
  }));

  server.registerTool('move_task', {
    title: 'Mover tarefa',
    description:
      'Muda a coluna da tarefa (vai para o topo dela). Mova para done só depois de verificar de fato que funcionou. ' +
      'blocked exige blockedNote com o erro ou o motivo. Se ainda falha, deixe em blocked e comente o que encontrou.',
    inputSchema: {
      task: TASK,
      status: STATUS,
      blockedNote: z.string().min(1).max(2000).optional().describe('Obrigatório para blocked: o que deu errado.'),
    },
  }, guarded(client, async (a: { task: string; status: string; blockedNote?: string }) => {
    const t = await client.request<Task>('POST', path(a.task, '/move'), { status: a.status, blockedNote: a.blockedNote });
    return ok(`Movida: ${taskLine(t)}`, t);
  }));

  server.registerTool('comment_task', {
    title: 'Comentar tarefa',
    description: 'Comenta numa tarefa. Registre o que você verificou, o resultado e o próximo passo.',
    inputSchema: { task: TASK, body: z.string().min(1).max(10000).describe('Markdown.') },
  }, guarded(client, async (a: { task: string; body: string }) => {
    const c = await client.request<{ id: string }>('POST', path(a.task, '/comments'), { body: a.body });
    return ok(`Comentário registrado em ${a.task.trim().toUpperCase()}.`, c);
  }));

  server.registerTool('board_summary', {
    title: 'Resumo do quadro',
    description:
      'Contagem por coluna, atrasadas, e as tarefas em blocked (com a nota) e em doing. Use no começo da sessão para saber o que retomar.',
    inputSchema: { product: z.string().optional().describe('Slug do sistema. Omita para o quadro inteiro.') },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { product?: string }) => {
    const board = await client.request<Board>('GET', `${TASKS}/board` + query({ product: a.product }));
    const { done: _done, ...open } = board.columns;
    return ok(boardSummary(board, a.product), { counts: board.counts, columns: open, serverTime: board.serverTime });
  }));
}
