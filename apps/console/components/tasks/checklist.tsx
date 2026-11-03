'use client';

import * as React from 'react';
import type { TaskChecklistItem } from '@/lib/api';
import { IconClose, cn } from '@/components/ui';

type Item = { id?: string; text: string; done: boolean };

/** The task's steps: a progress bar, tick, add, remove. Each change saves the whole list at once. */
export function Checklist({ items, onChange, disabled }: { items: TaskChecklistItem[]; onChange: (next: Item[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = React.useState('');
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const save = (next: Item[]) => onChange(next.map((i) => (i.id?.startsWith('new-') ? { text: i.text, done: i.done } : i)));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    save([...items, { text, done: false }]);
    setDraft('');
  };

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 bg-chip" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Progresso da checklist">
            <div className={cn('h-full transition-[width] duration-300', pct === 100 ? 'bg-success' : 'bg-info')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[13px] font-semibold tabular-nums text-fg-muted">{done}/{items.length}</span>
        </div>
      )}
      <ul className="flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={item.id} className="group flex min-h-9 items-start gap-2.5 bg-well px-2.5 py-2">
            <input type="checkbox" className="mt-0.5 shrink-0" checked={item.done} disabled={disabled} aria-label={item.text}
              onChange={(e) => save(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
            <span className={cn('min-w-0 flex-1 text-[14px] leading-[1.4] break-words', item.done ? 'text-fg-muted line-through' : 'text-fg')}>{item.text}</span>
            <button type="button" disabled={disabled} aria-label={`Remover "${item.text}"`} onClick={() => save(items.filter((_, j) => j !== i))}
              className="grid size-6 shrink-0 place-items-center text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100">
              <IconClose />
            </button>
          </li>
        ))}
      </ul>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={disabled || items.length >= 50} maxLength={300}
        placeholder={items.length >= 50 ? 'Limite de 50 itens' : 'Adicionar item (Enter)'} aria-label="Novo item da checklist"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        className="mt-1 h-9 w-full border border-transparent bg-transparent px-2.5 text-[14px] text-fg outline-none placeholder:text-fg-subtle hover:border-border focus:border-focus" />
    </div>
  );
}
