'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TeamTask } from '@/lib/api';
import { isOverdue } from '@/lib/tasks';
import { ProductMark } from '@/components/product';
import { Avatar, Icon, Pill, cn } from '@/components/ui';

export const IconRobot = ({ size = 14 }: { size?: number }) => (
  <Icon size={size} d={<><path d="M6 8h12v10H6Z" /><path d="M12 4v4M9.5 12.5h.01M14.5 12.5h.01M9.5 15.5h5M3 12v3M21 12v3" /></>} />
);
export const IconComment = () => <Icon size={13} d={<path d="M5 6h14v9H10l-5 4Z" />} />;
const IconCheck = () => <Icon size={13} d={<path d="m5 12.5 4.5 4.5L19 7.5" />} />;

export const STATUS_NAME: Record<TeamTask['status'], string> = { todo: 'A fazer', doing: 'Fazendo', blocked: 'Bloqueado', done: 'Concluído' };

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

function firstLine(text: string | null) { return (text ?? '').split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''; }

/** One card: the system's mark, code and title, and the facts that decide what to pick up next. */
export function TaskCard({ task, lifted, className }: { task: TeamTask; lifted?: boolean; className?: string }) {
  const overdue = isOverdue(task);
  const labels = task.labels.slice(0, 3);
  return (
    <div className={cn('flex flex-col gap-2 rounded-tile p-3 text-left transition-colors duration-150',
      lifted ? 'bg-surface shadow-popover' : 'bg-well hover:bg-active', className)}>
      <div className="flex items-center gap-2 text-[12px] text-fg-muted">
        {task.product && <ProductMark product={task.product} size={20} />}
        <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums text-fg-secondary">{task.code}</span>
        {task.product && <span className="min-w-0 truncate">{task.product.name}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {task.priority === 'high' && <Pill tone="warn"><span title="Prioridade alta">Alta</span></Pill>}
          {task.priority === 'low' && <Pill tone="idle"><span title="Prioridade baixa">baixa</span></Pill>}
          {task.source === 'claude' && <span className="text-accent-fg" title={`Criada por ${task.createdBy.name}`}><IconRobot /></span>}
        </span>
      </div>
      <p className="text-[14px] font-medium leading-5 break-words text-fg">{task.title}</p>
      {task.status === 'blocked' && task.blockedNote && (
        <p className="line-clamp-2 rounded-lg bg-danger/10 px-2 py-1 text-[12px] leading-[1.4] text-fg-secondary" title={task.blockedNote}>{firstLine(task.blockedNote)}</p>
      )}
      {(labels.length > 0 || task.dueDate || task.checklistTotal > 0 || task.commentCount > 0 || task.assignee) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-fg-muted">
          {labels.map((l) => <Pill key={l} tone="idle">{l}</Pill>)}
          {task.labels.length > 3 && <span className="text-fg-subtle">+{task.labels.length - 3}</span>}
          {task.dueDate && (
            <span className={cn('tabular-nums', overdue ? 'font-semibold text-danger' : 'text-fg-secondary')} title={overdue ? 'Atrasada' : 'Prazo'}>
              {shortDate(task.dueDate)}
            </span>
          )}
          {task.checklistTotal > 0 && (
            <span className={cn('inline-flex items-center gap-0.5 tabular-nums', task.checklistDone === task.checklistTotal && 'text-success')}>
              <IconCheck />{task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.commentCount > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums"><IconComment />{task.commentCount}</span>}
          {task.assignee && (
            <span className="ml-auto inline-flex" title={task.assignee.name}>
              <Avatar name={task.assignee.name} size={24} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The card on the board: draggable by pointer, touch and keyboard (Space picks up, arrows move,
 * Space drops), and opened by a click or Enter.
 */
export function SortableCard({ task, onOpen, disabled }: { task: TeamTask; onOpen: (t: TeamTask) => void; disabled?: boolean }) {
  const temp = task.id.startsWith('tmp-');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id, data: { task }, disabled: disabled || temp,
  });
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-roledescription="tarefa arrastável"
      aria-label={`${task.code}: ${task.title}. ${STATUS_NAME[task.status]}.`}
      onClick={() => { if (!temp) onOpen(task); }}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented && !temp) { e.preventDefault(); onOpen(task); }
      }}
      className={cn('cursor-grab touch-manipulation outline-offset-2 active:cursor-grabbing', isDragging && 'opacity-30', temp && 'cursor-default opacity-60')}
    >
      <TaskCard task={task} />
    </div>
  );
}
