/**
 * Short, readable text for the model. Every tool result leads with this; the raw JSON follows in
 * a second block for when the details matter. A whole response pasted as text would spend the
 * model's context on fields it rarely needs.
 */

export interface ProductRef { id: string; slug: string; name: string; color?: string | null }
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface Link { label: string; url: string }

export interface Task {
  id: string;
  code: string;
  product: ProductRef | null;
  title: string;
  body?: string;
  status: string;
  priority: string;
  labels: string[];
  dueDate: string | null;
  assignee: { id: string; name: string } | null;
  source: string;
  createdBy: { ref: string; name: string };
  blockedNote: string | null;
  checklist?: ChecklistItem[];
  checklistDone: number;
  checklistTotal: number;
  links?: Link[];
  commentCount: number;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  archivedAt: string | null;
}

export interface Comment { id: string; authorName: string; source: string; body: string; createdAt: string }
export interface TaskEvent { id: string; actorName: string; source: string; kind: string; data: Record<string, unknown> | null; createdAt: string }
export interface TaskDetail extends Task { comments: Comment[]; events: TaskEvent[] }

export interface Board {
  columns: Record<'todo' | 'doing' | 'blocked' | 'done', Task[]>;
  counts: { todo: number; doing: number; blocked: number; done: number; overdue: number };
  serverTime: string;
}

const STATUS_NAMES: Record<string, string> = { todo: 'A fazer', doing: 'Fazendo', blocked: 'Bloqueado', done: 'Concluído' };

function firstLine(text: string | null | undefined, max = 160): string {
  const line = (text ?? '').split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

function when(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

/** `T-7K2QM [blocked] Configurar callback (demo) · alta · ✓1/3 — nota: …` */
export function taskLine(t: Task): string {
  const parts = [`${t.code} [${t.status}] ${t.title}${t.product ? ` (${t.product.slug})` : ''}`];
  if (t.priority === 'high') parts.push('alta');
  if (t.dueDate) parts.push(`prazo ${t.dueDate}${t.overdue ? ' (atrasada)' : ''}`);
  if (t.checklistTotal > 0) parts.push(`✓${t.checklistDone}/${t.checklistTotal}`);
  if (t.commentCount > 0) parts.push(`${t.commentCount} coment.`);
  if (t.assignee) parts.push(`@${t.assignee.name}`);
  if (t.labels.length > 0) parts.push(t.labels.map((l) => `#${l}`).join(' '));
  if (t.archivedAt) parts.push('arquivada');
  let line = parts.join(' · ');
  if (t.status === 'blocked' && t.blockedNote) line += ` — nota: ${firstLine(t.blockedNote)}`;
  return line;
}

export function taskList(tasks: Task[], empty = 'Nenhuma tarefa encontrada.'): string {
  return tasks.length === 0 ? empty : tasks.map(taskLine).join('\n');
}

function eventText(e: TaskEvent): string {
  const d = e.data ?? {};
  switch (e.kind) {
    case 'created': return 'criou';
    case 'moved': return `moveu de ${String(d.from)} para ${String(d.to)}`;
    case 'updated': return `editou ${Array.isArray(d.fields) ? d.fields.join(', ') : ''}`.trim();
    case 'blocked': return `bloqueou: ${firstLine(String(d.note ?? ''), 300)}`;
    case 'archived': return 'arquivou';
    case 'unarchived': return 'desarquivou';
    case 'commented': return 'comentou';
    default: return e.kind;
  }
}

/** Everything a session needs to check a task: body, note, checklist, links, and what happened. */
export function taskDetail(t: TaskDetail): string {
  const out = [taskLine(t), `Criada por ${t.createdBy.name} em ${when(t.createdAt)}; última mudança ${when(t.updatedAt)}.`];
  if (t.status === 'blocked' && t.blockedNote) out.push('', 'Nota de bloqueio:', t.blockedNote);
  if (t.body) out.push('', 'Corpo:', t.body);
  if (t.checklist && t.checklist.length > 0)
    out.push('', 'Checklist:', ...t.checklist.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text} (id ${c.id})`));
  if (t.links && t.links.length > 0) out.push('', 'Links:', ...t.links.map((l) => `- ${l.label}: ${l.url}`));
  if (t.comments.length > 0)
    out.push('', 'Comentários:', ...t.comments.map((c) => `- ${when(c.createdAt)} ${c.authorName}: ${c.body}`));
  const history = t.events.filter((e) => e.kind !== 'commented');
  if (history.length > 0) out.push('', 'Histórico:', ...history.map((e) => `- ${when(e.createdAt)} ${e.actorName} ${eventText(e)}`));
  return out.join('\n');
}

export function boardSummary(b: Board, product?: string): string {
  const c = b.counts;
  const out = [
    `Quadro${product ? ` de ${product}` : ''}: ${c.todo} a fazer, ${c.doing} fazendo, ${c.blocked} bloqueadas, ${c.done} concluídas` +
      (c.overdue > 0 ? `; ${c.overdue} atrasada(s).` : '.'),
  ];
  for (const status of ['blocked', 'doing'] as const) {
    const tasks = b.columns[status];
    if (tasks.length > 0) out.push('', `${STATUS_NAMES[status]}:`, ...tasks.map(taskLine));
  }
  const overdueTodo = b.columns.todo.filter((t) => t.overdue);
  if (overdueTodo.length > 0) out.push('', 'Atrasadas em A fazer:', ...overdueTodo.map(taskLine));
  return out.join('\n');
}
