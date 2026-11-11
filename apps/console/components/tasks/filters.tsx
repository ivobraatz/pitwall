'use client';

import * as React from 'react';
import type { TasksMeta } from '@/lib/api';
import { ProductStripe } from '@/components/product';
import { Check, SearchInput, Segmented, Select } from '@/components/ui';

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

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Segmented
        label="Sistema"
        value={value.product}
        // Choosing the system already in force clears it, as the chips always did.
        onChange={(v) => onChange({ product: v === value.product ? '' : v })}
        options={[
          { value: '', label: 'Todos' },
          ...(meta?.products ?? []).map((p) => ({
            value: p.slug,
            label: <span className="inline-flex items-center gap-1.5"><ProductStripe product={p} className="size-2" />{p.name}</span>,
          })),
        ]}
      />
      <SearchInput ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, código ou corpo  ( / )"
        aria-label="Buscar tarefas" className="w-full sm:w-80" />
      <Select aria-label="Responsável" value={value.assignee} onChange={(e) => onChange({ assignee: e.target.value })}
        options={[{ value: '', label: 'Qualquer responsável' }, { value: 'me', label: 'Comigo' }, { value: 'none', label: 'Sem responsável' }]} />
      <Select aria-label="Etiqueta" value={value.label} onChange={(e) => onChange({ label: e.target.value })}
        options={[{ value: '', label: 'Todas as etiquetas' }, ...(meta?.labels ?? []).map((l) => ({ value: l.name, label: `${l.name} (${l.count})` }))]} />
      <Check checked={value.overdue} onChange={(v) => onChange({ overdue: v })}>Só atrasadas</Check>
      <Check checked={value.claude} onChange={(v) => onChange({ claude: v })}>Criadas pelo Claude</Check>
    </div>
  );
}
