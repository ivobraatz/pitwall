'use client';

/**
 * The team board's data: one cached board per filter, kept fresh by polling a delta every 12 s
 * while the tab is visible (D10), and every write applied to the cache first and rolled back if
 * the API says no. A delta never lands in the middle of a drag: the poll that would bring it is
 * discarded, and since the board's serverTime did not move, the next one brings it again.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { api, TASK_STATUSES, type Board, type TaskComment, type TaskStatus, type TasksMeta, type TeamTask, type TeamTaskDetail } from './api';
import { useToast } from '@/components/ui';

export const POLL_MS = 12_000;
const FULL_EVERY_MS = 5 * 60_000;

export interface BoardFilters { product?: string; assignee?: string; label?: string; q?: string }

/** The board as the console keeps it: the API's, plus when it was last read whole. */
export interface BoardData extends Board { fullAt: number }

export const boardKey = (f: BoardFilters): QueryKey => ['tasks', 'board', f.product ?? '', f.assignee ?? '', f.label ?? '', f.q ?? ''];
export const taskKey = (code: string): QueryKey => ['tasks', 'task', code.toUpperCase()];
const metaKey: QueryKey = ['tasks', 'meta'];

// ── Pure cache edits ────────────────────────────────────────────────────────────────

function byPosition(a: TeamTask, b: TeamTask) { return a.position - b.position || a.createdAt.localeCompare(b.createdAt); }

/** Replaces what changed (by id), drops what left the board, keeps each column in position order. */
export function applyDelta(prev: BoardData, delta: Board): BoardData {
  const changed = new Map<string, TeamTask>();
  for (const s of TASK_STATUSES) for (const t of delta.columns[s]) changed.set(t.id, t);
  const removed = new Set(delta.removedIds ?? []);
  const columns = {} as Board['columns'];
  for (const s of TASK_STATUSES) {
    columns[s] = [...prev.columns[s].filter((t) => !changed.has(t.id) && !removed.has(t.id)), ...delta.columns[s]].sort(byPosition);
  }
  return { ...prev, columns, counts: delta.counts, serverTime: delta.serverTime };
}

/** Puts one card (already in its final shape) where it belongs, wherever it was. */
export function upsertCard(board: BoardData, task: TeamTask): BoardData {
  const columns = {} as Board['columns'];
  for (const s of TASK_STATUSES) columns[s] = board.columns[s].filter((t) => t.id !== task.id);
  if (!task.archivedAt) columns[task.status] = [...columns[task.status], task].sort(byPosition);
  return { ...board, columns, counts: recount(board, columns) };
}

export function removeCard(board: BoardData, id: string): BoardData {
  const columns = {} as Board['columns'];
  for (const s of TASK_STATUSES) columns[s] = board.columns[s].filter((t) => t.id !== id);
  return { ...board, columns, counts: recount(board, columns) };
}

/** Counts follow the cards the console moved; the next poll brings the server's again. */
function recount(board: BoardData, columns: Board['columns']): Board['counts'] {
  const delta = (s: TaskStatus) => columns[s].length - board.columns[s].length;
  return {
    todo: board.counts.todo + delta('todo'), doing: board.counts.doing + delta('doing'),
    blocked: board.counts.blocked + delta('blocked'), done: board.counts.done + delta('done'), overdue: board.counts.overdue,
  };
}

/** The position a card will get between two neighbours, as the server computes it (close enough to sort by). */
export function guessPosition(above?: TeamTask, below?: TeamTask): number {
  if (above && below) return above.position + (below.position - above.position) / 2;
  if (below) return below.position - 1024;
  if (above) return above.position + 1024;
  return 1024;
}

/** Overdue by the person's own calendar, not the server's. */
export function isOverdue(t: Pick<TeamTask, 'dueDate' | 'status'>): boolean {
  if (!t.dueDate || t.status === 'done') return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return t.dueDate < today;
}

/** Every cached board, for writes that must show on whichever filter is open. */
function eachBoard(qc: QueryClient, edit: (b: BoardData) => BoardData) {
  for (const [key, data] of qc.getQueriesData<BoardData>({ queryKey: ['tasks', 'board'] })) {
    if (data) qc.setQueryData(key, edit(data));
  }
}

/**
 * Drops any read in flight so it cannot land on top of an optimistic edit. Not awaited, and
 * without reverting: offline, a paused poll never settles, and waiting on it would hold the write
 * (and its rollback) forever; a revert would put the pre-poll board back over the edit.
 */
function stopPolls(qc: QueryClient, queryKey: QueryKey) {
  void qc.cancelQueries({ queryKey }, { revert: false, silent: true });
}

function snapshotBoards(qc: QueryClient) { return qc.getQueriesData<BoardData>({ queryKey: ['tasks', 'board'] }); }
function restoreBoards(qc: QueryClient, snap: ReturnType<typeof snapshotBoards>) { for (const [key, data] of snap) qc.setQueryData(key, data); }

function message(e: unknown) {
  // fetch failing outright (no network, console down) is a TypeError with a browser-made message.
  if (e instanceof TypeError) return 'Sem conexão com o Pitwall. A mudança foi desfeita.';
  return e instanceof Error ? e.message : 'Algo deu errado.';
}

// ── Reads ───────────────────────────────────────────────────────────────────────────

/**
 * The board. `dragging` is read when a poll lands: while it is true, the result is dropped and
 * the board stays as the drag left it.
 */
export function useBoard(filters: BoardFilters, dragging: React.RefObject<boolean>) {
  const qc = useQueryClient();
  const key = boardKey(filters);
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const prev = qc.getQueryData<BoardData>(key);
      const failed = (qc.getQueryState(key)?.fetchFailureCount ?? 0) > 0;
      const params = { product: filters.product, assignee: filters.assignee, label: filters.label, q: filters.q };
      if (!prev || failed || Date.now() - prev.fullAt > FULL_EVERY_MS) {
        const full = await api<Board>('/staff/tasks/board', { params, signal });
        return { ...full, fullAt: Date.now() } satisfies BoardData;
      }
      const delta = await api<Board>('/staff/tasks/board', { params: { ...params, updatedSince: prev.serverTime }, signal });
      if (dragging.current) return qc.getQueryData<BoardData>(key) ?? prev;
      // Read again: a write may have edited the cache while this request was out.
      return applyDelta(qc.getQueryData<BoardData>(key) ?? prev, delta);
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useTask(code: string | null) {
  return useQuery({
    queryKey: taskKey(code ?? ''),
    queryFn: () => api<TeamTaskDetail>(`/staff/tasks/${encodeURIComponent(code!)}`),
    enabled: !!code,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useTasksMeta() {
  return useQuery({ queryKey: metaKey, queryFn: () => api<TasksMeta>('/staff/tasks/meta'), staleTime: 60_000 });
}

// ── Writes (optimistic, rolled back on error) ─────────────────────────────────────────

/** After a write the drawer's copy is stale in its counters and history: read it again. */
function refreshDetail(qc: QueryClient, task: Pick<TeamTask, 'code'>) {
  void qc.invalidateQueries({ queryKey: taskKey(task.code) });
}

export interface MoveVars {
  task: TeamTask; status: TaskStatus;
  /** The neighbours it was dropped between, as the person saw them. */
  above?: TeamTask; below?: TeamTask;
  blockedNote?: string;
  /** Called once the cache shows the move: the board can drop its drag copy without a flicker. */
  onApplied?: () => void;
}

export function useMoveTask() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    // Offline is an error to roll back and say, not a write to queue for later.
    networkMode: 'always',
    mutationFn: (v: MoveVars) => api<TeamTask>(`/staff/tasks/${v.task.id}/move`, {
      method: 'POST', json: { status: v.status, beforeId: v.above?.id, afterId: v.below?.id, blockedNote: v.blockedNote },
    }),
    onMutate: async (v) => {
      stopPolls(qc, ['tasks', 'board']);
      const snap = snapshotBoards(qc);
      const moved: TeamTask = {
        ...v.task, status: v.status, position: guessPosition(v.above, v.below),
        blockedNote: v.status === 'blocked' ? (v.task.status === 'blocked' ? v.task.blockedNote : v.blockedNote ?? null) : null,
        doneAt: v.status === 'done' ? v.task.doneAt ?? new Date().toISOString() : null,
      };
      eachBoard(qc, (b) => upsertCard(b, moved));
      v.onApplied?.();
      return { snap };
    },
    onError: (e, v, ctx) => { if (ctx) restoreBoards(qc, ctx.snap); else v.onApplied?.(); toast('error', message(e)); },
    onSuccess: (task) => { eachBoard(qc, (b) => upsertCard(b, task)); refreshDetail(qc, task); },
  });
}

export type TaskPatch = Partial<{
  title: string; body: string; product: string | null; priority: TeamTask['priority']; labels: string[]; dueDate: string | null;
  assigneeId: string | null; checklist: Array<{ id?: string; text: string; done: boolean }>; links: Array<{ label: string; url: string }>;
  blockedNote: string;
}>;

export function usePatchTask() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    // Offline is an error to roll back and say, not a write to queue for later.
    networkMode: 'always',
    mutationFn: ({ task, patch }: { task: TeamTaskDetail; patch: TaskPatch }) =>
      api<TeamTaskDetail>(`/staff/tasks/${task.id}`, { method: 'PATCH', json: patch }),
    onMutate: async ({ task, patch }) => {
      stopPolls(qc, taskKey(task.code));
      const snap = snapshotBoards(qc);
      const detail = qc.getQueryData<TeamTaskDetail>(taskKey(task.code));
      // What can be shown without the server: the fields as typed. Product and assignee wait for the answer.
      const { product: _p, assigneeId: _a, checklist, ...plain } = patch;
      const local: Partial<TeamTaskDetail> = { ...plain };
      if (checklist) {
        local.checklist = checklist.map((c, i) => ({ id: c.id ?? `new-${i}`, text: c.text, done: c.done }));
        local.checklistDone = checklist.filter((c) => c.done).length;
        local.checklistTotal = checklist.length;
      }
      if (detail) qc.setQueryData(taskKey(task.code), { ...detail, ...local });
      eachBoard(qc, (b) => {
        const card = TASK_STATUSES.flatMap((s) => b.columns[s]).find((t) => t.id === task.id);
        return card ? upsertCard(b, { ...card, ...local, body: undefined, checklist: undefined, links: undefined }) : b;
      });
      return { snap, detail };
    },
    onError: (e, { task }, ctx) => {
      if (ctx) { restoreBoards(qc, ctx.snap); if (ctx.detail) qc.setQueryData(taskKey(task.code), ctx.detail); }
      toast('error', message(e));
    },
    onSuccess: (task, { patch }) => {
      eachBoard(qc, (b) => (TASK_STATUSES.some((s) => b.columns[s].some((t) => t.id === task.id))
        ? upsertCard(b, { ...task, body: undefined, checklist: undefined, links: undefined }) : b));
      refreshDetail(qc, task);
      if (patch.labels) void qc.invalidateQueries({ queryKey: metaKey });
    },
  });
}

let tempSeq = 0;

export function useCreateTask() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    // Offline is an error to roll back and say, not a write to queue for later.
    networkMode: 'always',
    mutationFn: (v: { title: string; status: TaskStatus; product?: string; blockedNote?: string; meta?: TasksMeta; createdBy: string }) =>
      api<TeamTask>('/staff/tasks', { method: 'POST', json: { title: v.title, status: v.status, product: v.product || undefined, blockedNote: v.blockedNote } }),
    onMutate: async (v) => {
      stopPolls(qc, ['tasks', 'board']);
      const snap = snapshotBoards(qc);
      const now = new Date().toISOString();
      const product = v.meta?.products.find((p) => p.slug === v.product) ?? null;
      const temp: TeamTask = {
        id: `tmp-${++tempSeq}`, code: '…', product, title: v.title, status: v.status, position: -Infinity, priority: 'normal',
        labels: [], dueDate: null, assignee: null, source: 'manual', createdBy: { ref: '', name: v.createdBy }, blockedNote: v.blockedNote ?? null,
        checklistDone: 0, checklistTotal: 0, commentCount: 0, overdue: false, createdAt: now, updatedAt: now, doneAt: null, archivedAt: null,
      };
      eachBoard(qc, (b) => upsertCard(b, temp));
      return { snap, tempId: temp.id };
    },
    onError: (e, _v, ctx) => { if (ctx) restoreBoards(qc, ctx.snap); toast('error', message(e)); },
    onSuccess: (task, _v, ctx) => { eachBoard(qc, (b) => upsertCard(ctx ? removeCard(b, ctx.tempId) : b, task)); },
  });
}

export function useComment() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    // Offline is an error to roll back and say, not a write to queue for later.
    networkMode: 'always',
    mutationFn: ({ task, body }: { task: TeamTaskDetail; body: string }) =>
      api<TaskComment>(`/staff/tasks/${task.id}/comments`, { method: 'POST', json: { body } }),
    onSuccess: (comment, { task }) => {
      const detail = qc.getQueryData<TeamTaskDetail>(taskKey(task.code));
      if (detail) qc.setQueryData(taskKey(task.code), { ...detail, comments: [...detail.comments, comment], commentCount: detail.commentCount + 1 });
      eachBoard(qc, (b) => {
        const card = TASK_STATUSES.flatMap((s) => b.columns[s]).find((t) => t.id === task.id);
        return card ? upsertCard(b, { ...card, commentCount: card.commentCount + 1 }) : b;
      });
      refreshDetail(qc, task);
    },
    onError: (e) => toast('error', message(e)),
  });
}

export function useArchive() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    // Offline is an error to roll back and say, not a write to queue for later.
    networkMode: 'always',
    mutationFn: ({ task, archived }: { task: TeamTask; archived: boolean }) =>
      archived ? api<void>(`/staff/tasks/${task.id}/archive`, { method: 'POST' }).then(() => null)
        : api<TeamTask>(`/staff/tasks/${task.id}/unarchive`, { method: 'POST' }),
    onMutate: async ({ task, archived }) => {
      stopPolls(qc, ['tasks', 'board']);
      const snap = snapshotBoards(qc);
      if (archived) eachBoard(qc, (b) => removeCard(b, task.id));
      return { snap };
    },
    onError: (e, _v, ctx) => { if (ctx) restoreBoards(qc, ctx.snap); toast('error', message(e)); },
    onSuccess: (task, v) => {
      if (task) eachBoard(qc, (b) => upsertCard(b, task));
      refreshDetail(qc, v.task);
    },
  });
}

export function useArchiveDone() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    // Offline is an error to roll back and say, not a write to queue for later.
    networkMode: 'always',
    mutationFn: (product?: string) => api<{ archived: number }>('/staff/tasks/archive-done', { method: 'POST', json: { product: product || undefined } }),
    onMutate: async () => {
      stopPolls(qc, ['tasks', 'board']);
      const snap = snapshotBoards(qc);
      eachBoard(qc, (b) => ({ ...b, columns: { ...b.columns, done: [] }, counts: { ...b.counts, done: 0 } }));
      return { snap };
    },
    onError: (e, _v, ctx) => { if (ctx) restoreBoards(qc, ctx.snap); toast('error', message(e)); },
    onSuccess: (r) => {
      toast('ok', r.archived === 1 ? '1 tarefa arquivada.' : `${r.archived} tarefas arquivadas.`);
      // Another filter's done column may still hold some: read every board whole again.
      for (const [key, data] of qc.getQueriesData<BoardData>({ queryKey: ['tasks', 'board'] })) if (data) qc.setQueryData(key, { ...data, fullAt: 0 });
      void qc.invalidateQueries({ queryKey: ['tasks', 'board'] });
    },
  });
}
