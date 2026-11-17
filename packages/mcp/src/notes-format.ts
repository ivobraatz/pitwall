/**
 * Short text for notes, as format.ts does for tasks: a line that lets the model find a note again
 * (code, stage, title, system, folder, labels), and the JSON after it for the details.
 */
import type { ProductRef } from './format.js';

export interface NoteFolder { id: string; parentId: string | null; name: string; position: number; noteCount: number; createdAt: string; updatedAt: string }
export interface FoldersResponse { items: NoteFolder[]; inbox: number; archived: number }
export interface NoteRef { code: string; title: string }
export interface NoteTaskRef { id: string; code: string; title: string; status: string }

export interface Note {
  id: string;
  code: string;
  folder: { id: string; name: string } | null;
  /** "Ideias / Pagamentos"; empty when the note is in the inbox (no folder). */
  folderPath: string;
  product: ProductRef | null;
  title: string;
  excerpt: string;
  stage: string;
  labels: string[];
  pinned: boolean;
  source: string;
  createdBy: { ref: string; name: string };
  updatedByName: string;
  task: NoteTaskRef | null;
  convertedAt: string | null;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface NoteDetail extends Note {
  body: string;
  backlinks: NoteRef[];
  linked: Array<NoteRef & { missing: boolean }>;
}

export interface TaskDraft {
  title: string;
  body: string;
  checklist: string[];
  checklistDone?: boolean[];
  links: Array<{ label: string; url: string }>;
  labels: string[];
  productSlug?: string | null;
  readiness: { score: number; ready: boolean; missing: string[] };
}

function when(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

/** `N-7K2QM [ready] Título (slug) · pasta: Ideias / Pagamentos · fixada · #label · virou T-7K2QM` */
export function noteLine(n: Note): string {
  const parts = [`${n.code} [${n.stage}] ${n.title}${n.product ? ` (${n.product.slug})` : ''}`];
  if (n.folderPath) parts.push(`pasta: ${n.folderPath}`);
  if (n.pinned) parts.push('fixada');
  if (n.labels.length > 0) parts.push(n.labels.map((l) => `#${l}`).join(' '));
  if (n.task) parts.push(`virou ${n.task.code}`);
  if (n.archivedAt) parts.push('arquivada');
  return parts.join(' · ');
}

export function noteList(notes: Note[]): string {
  return notes.length === 0 ? 'Nenhuma anotação encontrada.' : notes.map(noteLine).join('\n');
}

/**
 * The folder tree, indented two spaces per level, with the inbox and the archive around it.
 * Siblings keep the order the user gave them (position), then the name.
 */
export function folderTreeText(res: FoldersResponse): string {
  const children = new Map<string | null, NoteFolder[]>();
  for (const f of res.items) {
    const key = f.parentId ?? null;
    const list = children.get(key) ?? [];
    list.push(f);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));

  const out = [`Entrada (sem pasta) — ${res.inbox}`];
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      out.push(`${'  '.repeat(depth)}${f.id} — ${f.name} (${f.noteCount})`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  out.push(`Arquivadas — ${res.archived}`);
  return out.join('\n');
}

function refLine(r: NoteRef): string {
  return `- ${r.code} ${r.title}`;
}

/** The note in full: its line, who wrote it, the generated task, the body, and the links both ways. */
export function noteDetailText(n: NoteDetail): string {
  const out = [noteLine(n), `Criada por ${n.createdBy.name} em ${when(n.createdAt)}; última mudança ${when(n.updatedAt)} por ${n.updatedByName}.`];
  if (n.task) out.push(`Tarefa gerada: ${n.task.code} [${n.task.status}] ${n.task.title}`);
  out.push('', 'Corpo:', n.body || '(sem corpo)');
  if (n.backlinks.length > 0) out.push('', 'Citada por:', ...n.backlinks.map(refLine));
  if (n.linked.length > 0)
    out.push('', 'Cita:', ...n.linked.map((l) => `- ${l.code} ${l.title}${l.missing ? ' (não encontrada)' : ''}`));
  return out.join('\n');
}

/** The task the note would become, and what is still missing before it is ready to convert. */
export function taskDraftText(d: TaskDraft): string {
  const r = d.readiness;
  const out = [`Prontidão: ${r.score}/100${r.missing.length > 0 ? ` (falta: ${r.missing.join('; ')})` : ''}${r.ready ? ' — pronta.' : ''}`];
  out.push('', `Título: ${d.title}`, 'Checklist:');
  out.push(...(d.checklist.length > 0 ? d.checklist.map((c, i) => `- [${d.checklistDone?.[i] ? 'x' : ' '}] ${c}`) : ['(nenhum item)']));
  out.push('Links:');
  out.push(...(d.links.length > 0 ? d.links.map((l) => `- ${l.label}: ${l.url}`) : ['(nenhum)']));
  out.push('', `Sistema: ${d.productSlug ?? 'nenhum'}`, `Etiquetas: ${d.labels.length > 0 ? d.labels.map((l) => `#${l}`).join(' ') : 'nenhuma'}`);
  out.push(`Corpo: ${d.body.length} caracteres (completo no JSON).`);
  return out.join('\n');
}
