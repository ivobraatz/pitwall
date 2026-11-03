'use client';

import * as React from 'react';
import { cn } from '@/components/ui';

/** The inline "+" of a column: type a title, Enter creates (and stays open for the next), Esc closes. */
export function QuickCreate({ onCreate, onClose, placeholder = 'Título da tarefa' }: {
  onCreate: (title: string) => void; onClose: () => void; placeholder?: string;
}) {
  const [title, setTitle] = React.useState('');
  return (
    <div className="bg-surface p-2">
      <input
        autoFocus
        value={title}
        maxLength={200}
        placeholder={placeholder}
        aria-label="Título da nova tarefa"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (!title.trim()) onClose(); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          if (e.key === 'Enter' && title.trim()) { e.preventDefault(); onCreate(title.trim()); setTitle(''); }
        }}
        className={cn('h-9 w-full border border-border bg-well px-2.5 text-[14px] text-fg outline-none placeholder:text-fg-subtle focus:border-focus')}
      />
      <p className="mt-1.5 px-0.5 text-[13px] text-fg-subtle">Enter cria · Esc fecha</p>
    </div>
  );
}
