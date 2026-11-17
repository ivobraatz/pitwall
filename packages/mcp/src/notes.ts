import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PitwallError, type PitwallClient } from './client.js';
import { guarded, ok, query } from './tools.js';
import {
  folderTreeText, noteDetailText, noteLine, noteList, taskDraftText,
  type FoldersResponse, type Note, type NoteDetail, type NoteFolder, type NoteTaskRef, type TaskDraft,
} from './notes-format.js';

/*
 * Notes: the team's working drafts (ideas, findings, investigations), kept in folders until they
 * are structured enough to become a task on the board. They need a personal token with the `notes`
 * scope; converting into a task also needs `tasks`.
 */

const NOTES = '/v1/staff/notes';
const NOTE = z.string().min(1).describe('Código da anotação (N-7K2QM) ou o id.');
const NOTE_STAGE = z.enum(['idea', 'shaping', 'ready']).describe('idea, shaping (estruturando) ou ready (pronta). "converted" só pela conversão.');
const STAGE_FILTER = z.enum(['idea', 'shaping', 'ready', 'converted']);
const PRODUCT = z.string().min(1).describe('Slug do sistema (veja list_products).');
const LABELS = z.array(z.string().max(32)).max(10).describe('Etiquetas em minúsculas, sem acento: [a-z0-9-].');
const PRIORITY = z.enum(['low', 'normal', 'high']);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');
const notePath = (note: string, rest = '') => `${NOTES}/${encodeURIComponent(note.trim())}${rest}`;

export function registerNoteTools(server: McpServer, client: PitwallClient): void {
  server.registerTool('list_note_folders', {
    title: 'Ver pastas de anotações',
    description:
      'Árvore de pastas de anotações, com o id e a quantidade de notas de cada uma. Mostra também a Entrada (sem pasta) e as arquivadas. ' +
      'Use o id em folder (list_notes) ou folderId (create_note, update_note).',
    annotations: { readOnlyHint: true },
  }, guarded(client, async () => {
    const res = await client.request<FoldersResponse>('GET', `${NOTES}/folders`);
    return ok(folderTreeText(res), res);
  }));

  server.registerTool('create_note_folder', {
    title: 'Criar pasta de anotações',
    description: 'Cria uma pasta de anotações, na raiz ou dentro de parentId (até 4 níveis). O nome é único entre as irmãs.',
    inputSchema: {
      name: z.string().min(1).max(80),
      parentId: z.string().optional().describe('Id da pasta-mãe. Omita para a raiz.'),
    },
  }, guarded(client, async (a: { name: string; parentId?: string }) => {
    const f = await client.request<NoteFolder>('POST', `${NOTES}/folders`, a);
    return ok(`Pasta criada: ${f.id} — ${f.name}`, f);
  }));

  server.registerTool('list_notes', {
    title: 'Buscar anotações',
    description:
      'Busca anotações, da mudança mais recente para a mais antiga. Busque antes de criar, para não duplicar. ' +
      'folder aceita o id de uma pasta ou "inbox" (sem pasta); deep inclui as subpastas. pinned=true lista só as fixadas.',
    inputSchema: {
      folder: z.string().optional().describe('Id de uma pasta, ou "inbox" para as notas sem pasta.'),
      deep: z.boolean().optional().describe('Inclui as subpastas.'),
      q: z.string().optional().describe('Texto no título, no código ou no corpo.'),
      stage: z.array(STAGE_FILTER).optional().describe('Estágios: idea, shaping, ready, converted.'),
      label: z.string().optional(),
      product: PRODUCT.optional(),
      pinned: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Padrão 30.'),
    },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: {
    folder?: string; deep?: boolean; q?: string; stage?: string[]; label?: string; product?: string;
    pinned?: boolean; includeArchived?: boolean; limit?: number;
  }) => {
    const res = await client.request<{ items: Note[]; nextCursor: string | null }>('GET', NOTES + query({
      folder: a.folder, deep: a.deep, q: a.q, stage: a.stage?.join(','), label: a.label, product: a.product,
      pinned: a.pinned, includeArchived: a.includeArchived, limit: a.limit ?? 30,
    }));
    const more = res.nextCursor ? '\n(há mais resultados: refine o filtro ou aumente limit)' : '';
    return ok(noteList(res.items) + more, res.items);
  }));

  server.registerTool('get_note', {
    title: 'Ler anotação',
    description:
      'Traz a anotação inteira: corpo, quem a cita e quem ela cita ([[N-XXXXX]] no corpo), e a tarefa gerada, se houver. ' +
      'Leia antes de editar.',
    inputSchema: { note: NOTE },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { note: string }) => {
    const n = await client.request<NoteDetail>('GET', notePath(a.note));
    return ok(noteDetailText(n), n);
  }));

  server.registerTool('create_note', {
    title: 'Criar anotação',
    description:
      'Registre ideias, achados e investigações que ainda não são uma ação manual clara. Busque com list_notes antes para não duplicar; ' +
      'prefira update_note com append numa nota existente.',
    inputSchema: {
      title: z.string().min(1).max(200),
      body: z.string().max(100000).optional().describe('Markdown.'),
      folderId: z.string().optional().describe('Id da pasta. Omita para a Entrada.'),
      product: PRODUCT.optional(),
      stage: NOTE_STAGE.optional(),
      labels: LABELS.optional(),
      pinned: z.boolean().optional(),
    },
  }, guarded(client, async (a: {
    title: string; body?: string; folderId?: string; product?: string; stage?: string; labels?: string[]; pinned?: boolean;
  }) => {
    const n = await client.request<NoteDetail>('POST', NOTES, a);
    return ok(`Criada: ${noteLine(n)}`, n);
  }));

  server.registerTool('update_note', {
    title: 'Editar anotação',
    description:
      'Edita uma anotação; só os campos enviados mudam. append acrescenta texto ao fim do corpo, sem reescrever: use para registrar um achado. ' +
      'folderId null leva à Entrada; product null tira o sistema. stage aceita idea, shaping ou ready.',
    inputSchema: {
      note: NOTE,
      title: z.string().min(1).max(200).optional(),
      body: z.string().max(100000).optional().describe('Substitui o corpo inteiro. Para acrescentar, use append.'),
      append: z.string().min(1).max(20000).optional().describe('Texto acrescentado ao fim do corpo, depois de uma linha em branco.'),
      folderId: z.string().nullable().optional().describe('Id da pasta; null para a Entrada.'),
      product: PRODUCT.nullable().optional().describe('Slug do sistema; null para nenhum.'),
      stage: NOTE_STAGE.optional(),
      labels: LABELS.optional(),
      pinned: z.boolean().optional(),
    },
  }, guarded(client, async (a: {
    note: string; title?: string; body?: string; append?: string; folderId?: string | null; product?: string | null;
    stage?: string; labels?: string[]; pinned?: boolean;
  }) => {
    const { note, ...fields } = a;
    // null means "clear it" for folderId and product, so only undefined is left out of the patch.
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v;
    if (Object.keys(patch).length === 0) throw new PitwallError('Nada para editar: envie ao menos um campo.');
    const n = await client.request<NoteDetail>('PATCH', notePath(note), patch);
    return ok(`Atualizada: ${noteLine(n)}`, n);
  }));

  server.registerTool('note_task_preview', {
    title: 'Prévia da tarefa da anotação',
    description:
      'Mostra o rascunho da tarefa que a anotação geraria (título, checklist, links, sistema) e o que falta para ela ficar pronta, ' +
      'com a prontidão de 0 a 100. Rode antes de convert_note_to_task.',
    inputSchema: { note: NOTE },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { note: string }) => {
    const d = await client.request<TaskDraft>('GET', notePath(a.note, '/task-preview'));
    return ok(taskDraftText(d), d);
  }));

  server.registerTool('convert_note_to_task', {
    title: 'Virar tarefa',
    description:
      'Cria uma tarefa do quadro a partir da anotação e marca a anotação como convertida. Só quando ela descreve uma ação manual que a pessoa precisa fazer. ' +
      'Rode note_task_preview antes. Cada anotação vira tarefa uma vez. Com token, exige também o escopo tasks.',
    inputSchema: {
      note: NOTE,
      title: z.string().min(1).max(200).optional().describe('Título da tarefa, se diferente do da anotação.'),
      priority: PRIORITY.optional(),
      dueDate: DATE.optional().describe('Prazo, AAAA-MM-DD.'),
      status: z.enum(['todo', 'doing']).optional().describe('Padrão todo.'),
      force: z.boolean().optional().describe('Converte mesmo com prontidão abaixo de 50.'),
    },
  }, guarded(client, async (a: {
    note: string; title?: string; priority?: string; dueDate?: string; status?: string; force?: boolean;
  }) => {
    const { note, ...fields } = a;
    const r = await client.request<{ note: NoteDetail; task: NoteTaskRef }>('POST', notePath(note, '/convert'), fields);
    const t = r.task;
    return ok(`Tarefa criada: ${t.code} [${t.status}] ${t.title}. A anotação ${r.note.code} virou essa tarefa.`, r);
  }));

  server.registerTool('archive_note', {
    title: 'Arquivar anotação',
    description: 'Arquiva a anotação: ela sai das listas, mas segue acessível com includeArchived. Não apaga.',
    inputSchema: { note: NOTE },
  }, guarded(client, async (a: { note: string }) => {
    await client.request('POST', notePath(a.note, '/archive'));
    return ok(`Arquivada: ${a.note.trim().toUpperCase()}.`);
  }));
}
