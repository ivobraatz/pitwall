'use client';

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TeamTask } from '@/lib/api';
import { isOverdue } from '@/lib/tasks';
import { productColor, initials } from '@/components/product';
import { Icon, cn } from '@/components/ui';

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

/** One card: the system's stripe, code and title, and the facts that decide what to pick up next. */
export function TaskCard({ task, lifted, className }: { task: TeamTask; lifted?: boolean; className?: string }) {
  const overdue = isOverdue(task);
  const labels = task.labels.slice(0, 3);
  return (
    <div className={cn('flex min-h-16 items-stretch bg-surface text-left transition-colors duration-150', lifted && 'shadow-popover', className)}>
      <span aria-hidden className="w-1.5 shrink-0" style={{ background: task.product ? productColor(task.product) : 'var(--ds-border-strong)' }} />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[13px] text-fg-muted">
          <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums text-fg-secondary">{task.code}</span>
          {task.product && <span className="min-w-0 truncate">{task.product.name}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {task.priority === 'high' && <span className="bg-danger px-1.5 text-[13px] leading-5 font-bold text-on-status" title="Prioridade alta">Alta</span>}
            {task.priority === 'low' && <span className="text-fg-subtle" title="Prioridade baixa">baixa</span>}
            {task.source === 'claude' && <span className="text-accent-fg" title={`Criada por ${task.createdBy.name}`}><IconRobot /></span>}
          </span>
        </div>
        <p className="mt-1 text-[14px] leading-[1.35] font-semibold break-words text-fg">{task.title}</p>
        {task.status === 'blocked' && task.blockedNote && (
          <p className="mt-1.5 line-clamp-2 bg-danger/12 px-2 py-1 text-[13px] leading-[1.4] text-fg-secondary" title={task.blockedNote}>{firstLine(task.blockedNote)}</p>
        )}
        {(labels.length > 0 || task.dueDate || task.checklistTotal > 0 || task.commentCount > 0 || task.assignee) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-fg-muted">
            {labels.map((l) => <span key={l} className="bg-chip px-1.5 leading-5 text-fg-secondary">{l}</span>)}
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
              <span className="ml-auto grid size-6 place-items-center rounded-full bg-chip text-[13px] font-bold text-fg" title={task.assignee.name}>
                {initials(task.assignee.name)}
              </span>
            )}
          </div>
        )}
      </div>
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
      className={cn('cursor-grab touch-manipulation outline-offset-2 hover:[&>div]:bg-hover active:cursor-grabbing', isDragging && 'opacity-30', temp && 'cursor-default opacity-60')}
    >
      <TaskCard task={task} />
    </div>
  );
}
