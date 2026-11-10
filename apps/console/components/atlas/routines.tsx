'use client';

import * as React from 'react';
import { useRoutineRuns, type Routine, type RoutineRun } from '@/lib/atlas';
import { ProductMark } from '@/components/product';
import { Button, cn } from '@/components/ui';
import { useAgo, useWords } from './parts';
import type { AtlasWord } from './words';

const RUN_BLOCK: Record<string, string> = {
  ok: 'bg-success/15 text-success', failed: 'bg-danger text-on-status', running: 'bg-running text-on-status',
  stale: 'bg-warning text-on-status', never: 'bg-chip text-fg-muted',
};
const runKey = (r: RoutineRun | null) => (!r ? 'never' : r.stale ? 'stale' : r.status);

function Produced({ run }: { run: RoutineRun }) {
  const t = useWords();
  if (run.links.length === 0) return <span className="text-fg-subtle">{t('routine.nothing')}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-fg-muted">{t('routine.produced')}:</span>
      {run.links.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="bg-chip px-1.5 text-[13px] font-semibold text-fg-secondary">{l.kind}</span>
          {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="text-fg underline underline-offset-2">{l.label}</a> : <span className="text-fg">{l.label}</span>}
        </span>
      ))}
    </span>
  );
}

function History({ slug }: { slug: string }) {
  const t = useWords();
  const since = useAgo();
  const runs = useRoutineRuns(slug);
  if (!runs.data) return null;
  if (runs.data.length === 0) return <p className="px-4 py-3 text-[13px] text-fg-muted">{t('routine.noruns')}</p>;
  return (
    <ol className="flex flex-col gap-1 p-1.5">
      {runs.data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 bg-well px-3 py-2 text-[13px]">
          <span className={cn('px-2 py-0.5 font-semibold whitespace-nowrap', RUN_BLOCK[runKey(r)])}>{t(`runstatus.${runKey(r)}` as AtlasWord)}</span>
          <span className="whitespace-nowrap text-fg-muted" title={new Date(r.startedAt).toLocaleString()}>{since(r.startedAt)}</span>
          <span className="min-w-0 flex-1 basis-64">
            {r.summary && <span className="block whitespace-pre-wrap text-fg-secondary">{r.summary}</span>}
            <Produced run={r} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Routines({ routines, systemId, onEdit, onRemove }: {
  routines: Routine[]; systemId?: string; onEdit: (r: Routine) => void; onRemove: (r: Routine) => void;
}) {
  const t = useWords();
  const since = useAgo();
  const [open, setOpen] = React.useState<string | null>(null);
  const shown = routines.filter((r) => !systemId || r.system?.id === systemId);
  if (shown.length === 0) {
    return (
      <div className="bg-surface px-5 py-6" data-testid="atlas-routines-empty">
        <p className="text-[15px] font-semibold text-fg">{t('routines.none')}</p>
        <p className="mt-1 max-w-xl text-[14px] leading-[1.5] text-fg-muted">{t('routines.noneHint')}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6" data-testid="atlas-routines">
      {(['daily', 'weekly', 'monthly'] as const).map((frequency) => {
        const group = shown.filter((r) => r.frequency === frequency);
        if (group.length === 0) return null;
        return (
          <section key={frequency}>
            <h3 className="mb-2 text-[14px] font-semibold text-fg-muted">{t(`freq.${frequency}` as AtlasWord)}</h3>
            <ul className="flex flex-col gap-1">
              {group.map((r) => {
                const key = runKey(r.lastRun);
                return (
                  <li key={r.id} data-testid="atlas-routine" className={cn('bg-surface', !r.enabled && 'opacity-60')}>
                    <div className="flex items-stretch">
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 text-[14px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)] lg:items-center">
                        <div className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold text-fg">{r.name}</span>
                          <span className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                            {r.system ? <><ProductMark product={r.system} size={16} />{r.system.name}</> : t('routine.all')}
                            {!r.enabled && <span> · {t('routine.off')}</span>}
                          </span>
                        </div>
                        <div className="min-w-0 text-[13px]">
                          {r.description && <span className="block text-fg-secondary">{r.description}</span>}
                          {r.lastRun && <Produced run={r.lastRun} />}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 px-2">
                        <Button size="sm" variant="ghost" aria-expanded={open === r.slug} onClick={() => setOpen(open === r.slug ? null : r.slug)}>{t('action.history')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>{t('action.edit')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => onRemove(r)} aria-label={`${t('action.remove')}: ${r.name}`}>×</Button>
                      </div>
                      <span className={cn('flex w-28 shrink-0 flex-col items-center justify-center px-2 text-center text-[13px] font-semibold', RUN_BLOCK[key])}>
                        {key === 'never' ? t('routine.never') : t(`runstatus.${key}` as AtlasWord)}
                        {r.lastRun && <span className="font-normal">{since(r.lastRun.startedAt)}</span>}
                      </span>
                    </div>
                    {open === r.slug && <History slug={r.slug} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
