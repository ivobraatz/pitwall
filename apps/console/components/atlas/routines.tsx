'use client';

import * as React from 'react';
import { useRoutineRuns, type Routine, type RoutineRun } from '@/lib/atlas';
import { ProductMark } from '@/components/product';
import { Button, Card, Pill, cn } from '@/components/ui';
import { useAgo, useWords } from './parts';
import type { AtlasWord } from './words';

const RUN_TONE: Record<string, string> = { ok: 'ok', failed: 'error', running: 'running', stale: 'warn', never: 'idle' };
const runKey = (r: RoutineRun | null) => (!r ? 'never' : r.stale ? 'stale' : r.status);

function Produced({ run }: { run: RoutineRun }) {
  const t = useWords();
  if (run.links.length === 0) return <span className="text-fg-subtle">{t('routine.nothing')}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-fg-muted">{t('routine.produced')}:</span>
      {run.links.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <Pill tone="idle">{l.kind}</Pill>
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
  if (runs.data.length === 0) return <p className="px-1 pt-2 pb-1 text-[13px] text-fg-muted">{t('routine.noruns')}</p>;
  return (
    <ol className="flex flex-col gap-1.5 pt-2 pb-1">
      {runs.data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 rounded-tile bg-well px-3.5 py-2.5 text-[13px]">
          <Pill tone={RUN_TONE[runKey(r)] ?? 'idle'}>{t(`runstatus.${runKey(r)}` as AtlasWord)}</Pill>
          <span className="whitespace-nowrap text-fg-muted tabular-nums" title={new Date(r.startedAt).toLocaleString()}>{since(r.startedAt)}</span>
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
      <div data-testid="atlas-routines-empty">
        <Card>
          <div className="px-5 py-6">
            <p className="text-[15px] font-semibold text-fg">{t('routines.none')}</p>
            <p className="mt-1 max-w-xl text-[14px] leading-[1.5] text-fg-muted">{t('routines.noneHint')}</p>
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="atlas-routines">
      {(['daily', 'weekly', 'monthly'] as const).map((frequency) => {
        const group = shown.filter((r) => r.frequency === frequency);
        if (group.length === 0) return null;
        return (
          <Card key={frequency} title={t(`freq.${frequency}` as AtlasWord)}>
            <ul className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
              {group.map((r) => {
                const key = runKey(r.lastRun);
                return (
                  <li key={r.id} data-testid="atlas-routine" className={cn('-mx-2 rounded-tile px-2 py-3 transition-colors duration-150 hover:bg-hover', !r.enabled && 'opacity-60')}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1 basis-64">
                        <span className="block truncate text-[14px] font-medium text-fg">{r.name}</span>
                        <span className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                          {r.system ? <><ProductMark product={r.system} size={16} />{r.system.name}</> : t('routine.all')}
                          {!r.enabled && <span> · {t('routine.off')}</span>}
                        </span>
                        <span className="mt-1 block text-[13px]">
                          {r.description && <span className="block text-fg-secondary">{r.description}</span>}
                          {r.lastRun && <Produced run={r.lastRun} />}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="ghost" aria-expanded={open === r.slug} onClick={() => setOpen(open === r.slug ? null : r.slug)}>{t('action.history')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>{t('action.edit')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => onRemove(r)} aria-label={`${t('action.remove')}: ${r.name}`}>×</Button>
                      </div>
                      <span className="flex w-32 shrink-0 flex-col items-end gap-1 text-right">
                        <Pill tone={RUN_TONE[key] ?? 'idle'}>{key === 'never' ? t('routine.never') : t(`runstatus.${key}` as AtlasWord)}</Pill>
                        {r.lastRun && <span className="text-[12px] text-fg-muted tabular-nums">{since(r.lastRun.startedAt)}</span>}
                      </span>
                    </div>
                    {open === r.slug && <History slug={r.slug} />}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
