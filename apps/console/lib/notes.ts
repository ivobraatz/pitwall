'use client';

/**
 * The notes' data: folders, the list (cursor pages), one note, revisions and the conversion into a
 * task. Reads are plain react-query; writes wait for the server, then put what it answered into the
 * cache. The text of a note being edited is never read back from the cache while the editor is open
 * (see notes-autosave.ts); the cache only feeds an editor that is opened fresh.
 */

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { sessionFor } from './notes-autosave';
import {
  api, type NoteConversion, type NoteDetail, type NoteDto, type NoteFolder, type NoteFolders, type NotesMeta, type NotesPage,
  type NoteRevision, type NoteRevisionDetail, type EditableStage, type NoteStage, type TaskDraft,
} from './api';
import { useToast } from '@/components/ui';

// ── Keys and constants ───────────────────────────────────────────────────────────────

export const foldersKey: QueryKey = ['notes', 'folders'];
export const metaKey: QueryKey = ['notes', 'meta'];
export const listsKey: QueryKey = ['notes', 'list'];
export const noteKey = (code: string): QueryKey => ['notes', 'note', code.toUpperCase()];

/** What the list asks the server for. `folder` is a folder id or "inbox"; `deep` adds its subfolders. */
export interface NoteFilters { folder?: string; deep?: boolean; pinned?: boolean; archived?: boolean; q?: string; stage?: string }
const listKey = (f: NoteFilters): QueryKey => ['notes', 'list', f.folder ?? '', f.deep ? 1 : 0, f.pinned ? 1 : 0, f.archived ? 1 : 0, f.q ?? '', f.stage ?? ''];

/** Starting texts for a new note; the title is what the person renames first. */
export const NOTE_TEMPLATES = [
  { id: 'blank', label: 'Em branco', title: 'Nova anotação', body: '' },
  { id: 'idea', label: 'Ideia', title: 'Nova ideia', body: '## Contexto\n\n' },
  { id: 'research', label: 'Investigação', title: 'Nova investigação', body: '## Pergunta\n\n\n## Achados\n\n\n## Próximos passos\n\n- [ ] \n' },
  { id: 'procedure', label: 'Procedimento', title: 'Novo procedimento', body: '## Contexto\n\n\n## Passos\n\n- [ ] \n\n## Como verificar\n\n- [ ] \n' },
] as const;
export type NoteTemplate = (typeof NOTE_TEMPLATES)[number];

export const STAGE_LABEL: Record<NoteStage, string> = { idea: 'Ideia', shaping: 'Estruturando', ready: 'Pronta', converted: 'Virou tarefa' };
export const STAGE_TONE: Record<NoteStage, string> = { idea: 'idle', shaping: 'info', ready: 'ok', converted: 'idle' };

/** Labels as the board writes them: lower case, words joined by dashes, no repeats, at most 10. */
export function parseLabels(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(',')) {
    const label = piece.trim().toLowerCase().split(/[\s_]+/).filter(Boolean).join('-');
    if (label && !out.includes(label)) out.push(label);
  }
  return out.slice(0, 10);
}

// ── Folder tree (pure) ───────────────────────────────────────────────────────────────

export interface FolderNode extends NoteFolder { depth: number; path: string; children: FolderNode[] }

/** The folders as a tree in the order the pane shows them. Depth 1 is the top level. */
export function folderTree(items: NoteFolder[]): FolderNode[] {
  const byParent = new Map<string | null, NoteFolder[]>();
  const sorted = [...items].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
  for (const f of sorted) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]);
  const walk = (parent: string | null, depth: number, path: string[]): FolderNode[] =>
    (byParent.get(parent) ?? []).map((f) => {
      const trail = [...path, f.name];
      return { ...f, depth, path: trail.join(' / '), children: walk(f.id, depth + 1, trail) };
    });
  return walk(null, 1, []);
}

export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** The ids above a folder, so a folder opened from the URL is never hidden inside a closed branch. */
export function ancestorIds(id: string, items: NoteFolder[]): string[] {
  const out: string[] = [];
  let cur = items.find((f) => f.id === id);
  while (cur?.parentId) { out.push(cur.parentId); cur = items.find((f) => f.id === cur!.parentId); }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────

export function errorText(e: unknown): string {
  // fetch failing outright (no network, console down) is a TypeError with a browser-made message.
  if (e instanceof TypeError) return 'Sem conexão com o Pitwall.';
  return e instanceof Error ? e.message : 'Algo deu errado.';
}

/** Fields that the editor sends. Any change to them can move a note in the lists or the counters. */
export interface NotePatch {
  title?: string; body?: string; folderId?: string | null; product?: string | null;
  stage?: EditableStage; labels?: string[]; pinned?: boolean;
}
const TEXT_FIELDS = new Set(['title', 'body']);

export function fetchNote(code: string): Promise<NoteDetail> {
  return api<NoteDetail>(`/staff/notes/${code}`);
}

/** Only the title and the body are text; a save that changed nothing else leaves the lists alone. */
export function changesOnlyText(sent: NotePatch): boolean {
  return Object.keys(sent).every((k) => TEXT_FIELDS.has(k));
}

export function refreshNotes(qc: QueryClient, parts: Array<'lists' | 'folders' | 'meta'> = ['lists', 'folders', 'meta']) {
  if (parts.includes('lists')) void qc.invalidateQueries({ queryKey: listsKey });
  if (parts.includes('folders')) void qc.invalidateQueries({ queryKey: foldersKey });
  if (parts.includes('meta')) void qc.invalidateQueries({ queryKey: metaKey });
}

/** A list item from a detail: the same fields without the body and the links. */
function asListItem(n: NoteDetail): NoteDto {
  const { body: _b, backlinks: _k, linked: _l, ...dto } = n;
  return dto;
}

function patchListPages(data: InfiniteData<NotesPage>, n: NoteDetail): InfiniteData<NotesPage> {
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.code === n.code ? asListItem(n) : i)) })) };
}

/** The server answered a save of the editor: the note's cache and the list items take the saved state. */
export function applySaved(qc: QueryClient, n: NoteDetail, sent: NotePatch) {
  // A read that started before this save must not land after it with the older text.
  void qc.cancelQueries({ queryKey: noteKey(n.code), exact: true });
  qc.setQueryData(noteKey(n.code), n);
  qc.setQueriesData<InfiniteData<NotesPage>>({ queryKey: listsKey }, (d) => (d ? patchListPages(d, n) : d));
  if (!changesOnlyText(sent)) refreshNotes(qc, ['folders', 'meta']);
}

/** A write that answers with the whole note (archive, restore, convert...) puts it in the cache. */
export function setNoteCache(qc: QueryClient, n: NoteDetail) {
  qc.setQueryData(noteKey(n.code), n);
  // The editor's next save must carry this updatedAt, or the server would answer 409 to our own write.
  sessionFor(n.code)?.rebase(n.updatedAt);
  qc.setQueriesData<InfiniteData<NotesPage>>({ queryKey: listsKey }, (d) => (d ? patchListPages(d, n) : d));
}

function useOnError() {
  const toast = useToast();
  return React.useCallback((e: unknown) => toast('error', errorText(e)), [toast]);
}

// ── Reads ────────────────────────────────────────────────────────────────────────────

export function useFolders() {
  return useQuery({ queryKey: foldersKey, queryFn: () => api<NoteFolders>('/staff/notes/folders') });
}

export function useNotesMeta() {
  return useQuery({ queryKey: metaKey, queryFn: () => api<NotesMeta>('/staff/notes/meta'), staleTime: 60_000 });
}

/** The list, one cursor page at a time (50 each). */
export function useNotes(f: NoteFilters) {
  return useInfiniteQuery({
    queryKey: listKey(f),
    queryFn: ({ pageParam, signal }) => api<NotesPage>('/staff/notes', {
      params: {
        folder: f.folder, deep: f.deep ? true : undefined, pinned: f.pinned ? true : undefined,
        archived: f.archived ? true : undefined, q: f.q, stage: f.stage, cursor: pageParam, limit: 50,
      },
      signal,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useNote(code: string | null) {
  return useQuery({
    queryKey: noteKey(code ?? ''),
    queryFn: () => fetchNote(code!),
    enabled: !!code,
  });
}

export function useRevisions(code: string, enabled: boolean) {
  return useQuery({
    queryKey: ['notes', 'revisions', code.toUpperCase()],
    queryFn: () => api<{ items: NoteRevision[] }>(`/staff/notes/${code}/revisions`),
    enabled,
  });
}

export function useRevision(code: string, id: string | null) {
  return useQuery({
    queryKey: ['notes', 'revision', code.toUpperCase(), id ?? ''],
    queryFn: () => api<NoteRevisionDetail>(`/staff/notes/${code}/revisions/${id}`),
    enabled: !!id,
  });
}

/** What the task would be from the saved text. Read again every time the dialog opens. */
export function useTaskPreview(code: string, enabled: boolean) {
  return useQuery({
    queryKey: ['notes', 'draft', code.toUpperCase()],
    queryFn: () => api<TaskDraft>(`/staff/notes/${code}/task-preview`),
    enabled,
    staleTime: 0,
  });
}

// ── Folder writes ────────────────────────────────────────────────────────────────────

export function useCreateFolder() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (v: { name: string; parentId: string | null }) => api<NoteFolder>('/staff/notes/folders', { method: 'POST', json: v }),
    onSuccess: () => refreshNotes(qc, ['folders']),
    onError,
  });
}

export function usePatchFolder() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) => api<NoteFolder>(`/staff/notes/folders/${v.id}`, { method: 'PATCH', json: { name: v.name } }),
    onSuccess: () => refreshNotes(qc, ['folders', 'lists']),
    onError,
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/staff/notes/folders/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshNotes(qc),
    onError,
  });
}

// ── Note writes ──────────────────────────────────────────────────────────────────────

export function useCreateNote() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (v: { title: string; body?: string; folderId?: string | null; pinned?: boolean }) =>
      api<NoteDetail>('/staff/notes', { method: 'POST', json: v }),
    onSuccess: (n) => { setNoteCache(qc, n); refreshNotes(qc); },
    onError,
  });
}

export function useArchiveNote() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    // The archive answers with no body: read the note again to take its new updatedAt.
    mutationFn: (code: string) => api<void>(`/staff/notes/${code}/archive`, { method: 'POST' }).then(() => fetchNote(code)),
    onSuccess: (n) => { setNoteCache(qc, n); refreshNotes(qc, ['lists', 'meta']); },
    onError,
  });
}

export function useUnarchiveNote() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (code: string) => api<NoteDetail>(`/staff/notes/${code}/unarchive`, { method: 'POST' }),
    onSuccess: (n) => { setNoteCache(qc, n); refreshNotes(qc, ['lists', 'meta']); },
    onError,
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (code: string) => api<void>(`/staff/notes/${code}`, { method: 'DELETE' }),
    onSuccess: (_v, code) => { qc.removeQueries({ queryKey: noteKey(code), exact: true }); refreshNotes(qc); },
    onError,
  });
}

export function useDuplicateNote() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (code: string) => api<NoteDetail>(`/staff/notes/${code}/duplicate`, { method: 'POST' }),
    onSuccess: (n) => { setNoteCache(qc, n); refreshNotes(qc, ['lists', 'folders', 'meta']); },
    onError,
  });
}

export function useRestoreRevision() {
  const qc = useQueryClient();
  const onError = useOnError();
  return useMutation({
    mutationFn: (v: { code: string; id: string }) => api<NoteDetail>(`/staff/notes/${v.code}/revisions/${v.id}/restore`, { method: 'POST' }),
    onSuccess: (n) => { setNoteCache(qc, n); refreshNotes(qc, ['lists', 'folders', 'meta']); },
    onError,
  });
}

export interface ConvertVars { title?: string; priority?: 'low' | 'normal' | 'high'; dueDate?: string; status?: 'todo' | 'doing'; force?: boolean }

/** Turns the note into a board task. Errors stay in the dialog (they say what is missing), so no toast. */
export function useConvertNote(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ConvertVars) => api<NoteConversion>(`/staff/notes/${code}/convert`, { method: 'POST', json: v }),
    onSuccess: (r) => {
      setNoteCache(qc, r.note);
      refreshNotes(qc, ['lists', 'meta']);
      void qc.invalidateQueries({ queryKey: ['tasks', 'board'] });
    },
  });
}
