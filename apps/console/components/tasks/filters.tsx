'use client';

import * as React from 'react';
import type { TasksMeta } from '@/lib/api';
import { productColor } from '@/components/product';
import { Check, Input, Select, cn } from '@/components/ui';

export interface TaskFilterValues {
  product: string; assignee: string; label: string; q: string; overdue: boolean; claude: boolean;
}

/** The board's filters. They live in the URL, so a filtered board can be sent to someone. */
export function TaskFilters({ value, onChange, meta, searchRef }: {
  value: TaskFilterValues;
  onChange: (patch: Partial<TaskFilterValues>) => void;
  meta?: TasksMeta;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [q, setQ] = React.useState(value.q);
  React.useEffect(() => { setQ(value.q); }, [value.q]);
  React.useEffect(() => {
    const id = setTimeout(() => { if (q !== value.q) onChange({ q }); }, 300);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (active: boolean) => cn('flex h-9 shrink-0 items-center gap-2 pr-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150',
    active ? 'bg-sel text-fg' : 'bg-surface text-fg-secondary hover:bg-hover hover:text-fg');

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex gap-1 overflow-x-auto pb-0.5" role="radiogroup" aria-label="Sistema">
        <button type="button" role="radio" aria-checked={!value.product} className={chip(!value.product)} onClick={() => onChange({ product: '' })}>
          <span className="h-full w-1 bg-fg-subtle" />Todos
        </button>
        {meta?.products.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={value.product === p.slug} className={chip(value.product === p.slug)}
            onClick={() => onChange({ product: value.product === p.slug ? '' : p.slug })}>
            <span className="h-full w-1" style={{ background: productColor(p) }} />{p.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, código ou corpo  ( / )"
          aria-label="Buscar tarefas" className="h-10 min-w-56 flex-1 md:max-w-sm" type="search" />
        <Select aria-label="Responsável" value={value.assignee} onChange={(e) => onChange({ assignee: e.target.value })}
          options={[{ value: '', label: 'Qualquer responsável' }, { value: 'me', label: 'Comigo' }, { value: 'none', label: 'Sem responsável' }]} />
        <Select aria-label="Etiqueta" value={value.label} onChange={(e) => onChange({ label: e.target.value })}
          options={[{ value: '', label: 'Todas as etiquetas' }, ...(meta?.labels ?? []).map((l) => ({ value: l.name, label: `${l.name} (${l.count})` }))]} />
        <Check checked={value.overdue} onChange={(v) => onChange({ overdue: v })}>Só atrasadas</Check>
        <Check checked={value.claude} onChange={(v) => onChange({ claude: v })}>Criadas pelo Claude</Check>
      </div>
    </div>
  );
}
