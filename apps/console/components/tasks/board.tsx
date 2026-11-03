'use client';

import * as React from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, closestCorners, getFirstCollision,
  pointerWithin, rectIntersection, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TASK_STATUSES, type TaskStatus, type TasksMeta, type TeamTask } from '@/lib/api';
import { useArchiveDone, useCreateTask, useMoveTask, type BoardData } from '@/lib/tasks';
import { Button, Icon, cn } from '@/components/ui';
import { BlockedPrompt } from './blocked-prompt';
import { QuickCreate } from './quick-create';
import { STATUS_NAME, SortableCard, TaskCard } from './card';

type Items = Record<TaskStatus, string[]>;

const COLUMN_TONE: Record<TaskStatus, string> = { todo: 'bg-info', doing: 'bg-running', blocked: 'bg-danger', done: 'bg-success' };
const IconPlus = () => <Icon size={16} d={<path d="M12 5v14M5 12h14" />} />;

const isStatus = (id: UniqueIdentifier | undefined): id is TaskStatus => TASK_STATUSES.includes(id as TaskStatus);

function Column({ status, ids, tasks, count, onOpen, creating, onCreateOpen, onCreate, onCreateClose, onArchiveDone, archiving }: {
  status: TaskStatus; ids: string[]; tasks: Map<string, TeamTask>; count: number; onOpen: (t: TeamTask) => void;
  creating: boolean; onCreateOpen: () => void; onCreate: (title: string) => void; onCreateClose: () => void;
  onArchiveDone?: () => void; archiving?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={STATUS_NAME[status]} className="flex w-[84vw] shrink-0 snap-start flex-col bg-well sm:w-80 xl:w-auto xl:min-w-0 xl:flex-1">
      <header className="flex h-12 items-center gap-2.5 px-3">
        <span className={cn('size-2.5 shrink-0', COLUMN_TONE[status])} aria-hidden />
        <h2 className="text-[14px] font-semibold text-fg">{STATUS_NAME[status]}</h2>
        <span className="text-[13px] font-semibold tabular-nums text-fg-muted">{count}</span>
        <span className="ml-auto flex items-center gap-1">
          {onArchiveDone && ids.length > 0 && (
            <Button size="sm" variant="ghost" loading={archiving} onClick={onArchiveDone} title="Tira do quadro as concluídas (continuam na busca)">Arquivar concluídas</Button>
          )}
          <button type="button" onClick={onCreateOpen} aria-label={`Nova tarefa em ${STATUS_NAME[status]}`} title="Nova tarefa"
            className="grid size-8 place-items-center text-fg-muted transition-colors hover:bg-hover hover:text-fg"><IconPlus /></button>
        </span>
      </header>
      {creating && <div className="px-2 pb-1.5"><QuickCreate onCreate={onCreate} onClose={onCreateClose} /></div>}
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={cn('flex min-h-32 flex-1 flex-col gap-1.5 px-2 pb-2 transition-colors duration-150', isOver && 'bg-hover/60')}>
          {ids.map((id) => { const t = tasks.get(id); return t ? <SortableCard key={id} task={t} onOpen={onOpen} /> : null; })}
          {ids.length === 0 && (
            <div className={cn('grid min-h-24 flex-1 place-items-center border border-dashed text-[13px] text-fg-subtle', isOver ? 'border-focus text-fg' : 'border-border')}>
              Solte aqui
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

interface PendingMove { task: TeamTask; status: TaskStatus; above?: TeamTask; below?: TeamTask }

/**
 * The four columns. While a card is in the air, the board draws from its own copy of the order
 * (so the polling cannot shuffle it); on the drop the move goes to the cache and the API, and a
 * refusal puts the card back where it was.
 */
export function TaskBoard({ board, visible, product, creating, setCreating, onOpen, dragging, createdBy, meta }: {
  board: BoardData;
  /** The filters the API does not apply (overdue only, made by Claude). */
  visible: (t: TeamTask) => boolean;
  /** The product filter in force: new cards go to it. */
  product?: string;
  creating: TaskStatus | null;
  setCreating: (s: TaskStatus | null) => void;
  onOpen: (t: TeamTask) => void;
  dragging: React.RefObject<boolean>;
  createdBy: string;
  meta?: TasksMeta;
}) {
  const move = useMoveTask();
  const create = useCreateTask();
  const archiveDone = useArchiveDone();

  const tasks = React.useMemo(() => {
    const m = new Map<string, TeamTask>();
    for (const s of TASK_STATUSES) for (const t of board.columns[s]) m.set(t.id, t);
    return m;
  }, [board]);
  const derived = React.useMemo<Items>(() => {
    const out = {} as Items;
    for (const s of TASK_STATUSES) out[s] = board.columns[s].filter(visible).map((t) => t.id);
    return out;
  }, [board, visible]);

  const [dragItems, setDragItems] = React.useState<Items | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<PendingMove | null>(null);
  const [pendingCreate, setPendingCreate] = React.useState<string | null>(null);
  const items = dragItems ?? derived;
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const droppedAt = React.useRef(0);

  const containerOf = React.useCallback((id: UniqueIdentifier, from: Items = itemsRef.current): TaskStatus | undefined => {
    if (isStatus(id)) return id;
    return TASK_STATUSES.find((s) => from[s].includes(String(id)));
  }, []);

  // Left and right go to the neighbouring column, its top; up and down move inside the column.
  // (dnd-kit's own rule picks the closest target to that side, and a tall empty column can lose to
  // a short card two columns away.)
  const coordinateGetter = React.useCallback<KeyboardCoordinateGetter>((event, args) => {
    if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const { active, over, droppableRects } = args.context;
    if (!active) return undefined;
    const current = containerOf(over?.id ?? active.id);
    if (!current) return undefined;
    const next = TASK_STATUSES[TASK_STATUSES.indexOf(current) + (event.code === 'ArrowRight' ? 1 : -1)];
    const rect = next ? droppableRects.get(next) : undefined;
    return rect ? { x: rect.left, y: rect.top } : undefined;
  }, [containerOf]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    // Space picks up and drops; Enter is left to open the card.
    useSensor(KeyboardSensor, {
      coordinateGetter,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );


  // Columns stretch to the tallest one, so "closest corners" alone would let a tall empty column
  // lose to the card's own old slot. What is under the pointer (or overlaps the card, for the
  // keyboard) decides the column; inside a column with cards, the nearest card decides the spot.
  const collision = React.useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    const overId = getFirstCollision(hits, 'id');
    if (overId == null) return closestCorners(args);
    if (isStatus(overId)) {
      const ids = itemsRef.current[overId];
      if (ids.length > 0) {
        const inside = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))) });
        if (inside.length > 0) return inside;
      }
    }
    return hits;
  }, []);

  const reset = () => { setDragItems(null); setActiveId(null); dragging.current = false; };

  const commit = (m: PendingMove & { blockedNote?: string }) => {
    move.mutate({ ...m, onApplied: reset });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    dragging.current = true;
    setActiveId(String(active.id));
    setDragItems(derived);
  };

  // Across columns the card is moved as soon as it hovers the other one, so the gap opens where it will land.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    setDragItems((prev) => {
      const cur = prev ?? derived;
      const fromList = cur[from].filter((id) => id !== active.id);
      const toList = [...cur[to]];
      const overIndex = isStatus(over.id) ? toList.length : toList.indexOf(String(over.id));
      const below = over.rect && active.rect.current.translated ? active.rect.current.translated.top > over.rect.top + over.rect.height / 2 : false;
      const at = overIndex < 0 ? toList.length : overIndex + (below ? 1 : 0);
      toList.splice(at, 0, String(active.id));
      return { ...cur, [from]: fromList, [to]: toList };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    droppedAt.current = Date.now();
    const task = tasks.get(String(active.id));
    const cur = itemsRef.current;
    const to = containerOf(active.id, cur);
    if (!task || !to || !over) { reset(); return; }
    let list = cur[to];
    if (!isStatus(over.id) && containerOf(over.id, cur) === to && over.id !== active.id) {
      list = arrayMove(list, list.indexOf(String(active.id)), list.indexOf(String(over.id)));
    }
    const index = list.indexOf(String(active.id));
    const unchanged = to === task.status && derived[to].indexOf(task.id) === index;
    if (unchanged) { reset(); return; }
    setDragItems({ ...cur, [to]: list });
    const m: PendingMove = { task, status: to, above: tasks.get(list[index - 1]), below: tasks.get(list[index + 1]) };
    setActiveId(null);
    // Into "Bloqueado" only with the reason; until it is given the card waits where it was dropped.
    if (to === 'blocked' && task.status !== 'blocked') setPending(m);
    else commit(m);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tarefa ${tasks.get(String(active.id))?.code ?? ''} pega. Use as setas para mover e Espaço para soltar; Esc cancela.`,
    onDragOver: ({ active, over }) => {
      if (!over) return `Tarefa ${tasks.get(String(active.id))?.code ?? ''} fora das colunas.`;
      const to = containerOf(over.id);
      if (!to) return undefined;
      const pos = itemsRef.current[to].indexOf(String(active.id)) + 1 || itemsRef.current[to].length + 1;
      return `Tarefa ${tasks.get(String(active.id))?.code ?? ''} sobre ${STATUS_NAME[to]}, posição ${pos}.`;
    },
    onDragEnd: ({ active, over }) => {
      const to = over ? containerOf(active.id) : undefined;
      if (!to) return `Tarefa ${tasks.get(String(active.id))?.code ?? ''} voltou ao lugar.`;
      return `Tarefa ${tasks.get(String(active.id))?.code ?? ''} movida para ${STATUS_NAME[to]}, posição ${itemsRef.current[to].indexOf(String(active.id)) + 1}.`;
    },
    onDragCancel: ({ active }) => `Movimento cancelado. Tarefa ${tasks.get(String(active.id))?.code ?? ''} voltou ao lugar.`,
  };

  const open = (t: TeamTask) => {
    // The click that ends a drag is not an open.
    if (activeId || Date.now() - droppedAt.current < 250) return;
    onOpen(t);
  };

  const filtered = TASK_STATUSES.some((s) => derived[s].length !== board.columns[s].length);
  const active = activeId ? tasks.get(activeId) : undefined;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={reset}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: 'Para mover uma tarefa, pressione Espaço. Use as setas para escolher a coluna e a posição, Espaço para soltar e Esc para cancelar. Enter abre a tarefa.' },
        }}
      >
        <div className="-mx-4 flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0 xl:snap-none">
          {TASK_STATUSES.map((s) => (
            <Column
              key={s} status={s} ids={items[s]} tasks={tasks}
              count={filtered ? derived[s].length : board.counts[s]}
              onOpen={open}
              creating={creating === s}
              onCreateOpen={() => setCreating(s)}
              onCreateClose={() => setCreating(null)}
              onCreate={(title) => {
                // A card born blocked needs its reason too.
                if (s === 'blocked') { setCreating(null); setPendingCreate(title); return; }
                create.mutate({ title, status: s, product, createdBy, meta });
              }}
              onArchiveDone={s === 'done' ? () => archiveDone.mutate(product) : undefined}
              archiving={archiveDone.isPending}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {/* No rotation: a tilted overlay's box pokes out of its column, and the keyboard reads that as "to the side". */}
          {active ? <TaskCard task={active} lifted className="cursor-grabbing" /> : null}
        </DragOverlay>
      </DndContext>
      {pendingCreate !== null && (
        <BlockedPrompt
          code={`"${pendingCreate}"`}
          onCancel={() => setPendingCreate(null)}
          onConfirm={(note) => { create.mutate({ title: pendingCreate, status: 'blocked', product, createdBy, meta, blockedNote: note }); setPendingCreate(null); }}
        />
      )}
      {pending && (
        <BlockedPrompt
          code={pending.task.code}
          onCancel={() => { setPending(null); reset(); }}
          onConfirm={(note) => { const m = pending; setPending(null); commit({ ...m, blockedNote: note }); }}
        />
      )}
    </>
  );
}
