'use client';

import * as React from 'react';
import type { AtlasProcess, ProcessStep } from '@/lib/atlas';
import { useEvents, useInsights } from '@/lib/atlas-graph';
import { Segmented, Select, Input, cn } from '@/components/ui';
import { useAgo, useWords, TaskLink } from '@/components/atlas/parts';
import type { AtlasWord } from '@/components/atlas/words';
import { MODES, type Mode } from './model';
import { useGraphWords, type GraphWord } from './words';

/*
 * The modes read the same graph in other projections: what a process touches, what is active and when
 * it was last seen, what needs attention, and what changed since a date. Each mode only adds to the
 * picture; none of them invents a state the data does not carry.
 */

export function ModeBar({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const t = useGraphWords();
  return (
    <Segmented<Mode> label={t('mode.label')} value={mode} onChange={onMode}
      options={MODES.map((m) => ({ value: m, label: t(`mode.${m}` as GraphWord) }))} />
  );
}

/** The processes that touch this system (or whose steps do): the ones a flow can be read from here. */
export function processesOf(processes: AtlasProcess[], systemId: string): AtlasProcess[] {
  return processes.filter((p) => p.system?.id === systemId || p.steps.some((s) => s.system?.id === systemId));
}

/** Each service's place in the chosen process: the number of its first step, counted from one. */
export function stepNumbers(process: AtlasProcess | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!process) return out;
  const steps = [...process.steps].sort((a, b) => a.position - b.position);
  steps.forEach((s, i) => { for (const id of s.services) if (!out.has(id)) out.set(id, i + 1); });
  return out;
}

export function FlowsPanel({ processes, flowId, onFlow, onStep }: {
  processes: AtlasProcess[]; flowId: string | null; onFlow: (id: string | null) => void; onStep: (step: ProcessStep) => void;
}) {
  const t = useGraphWords();
  const w = useWords();
  const current = processes.find((p) => p.id === flowId) ?? null;
  if (processes.length === 0) return <p className="text-[14px] text-fg-muted">{t('flow.none')}</p>;
  const steps = current ? [...current.steps].sort((a, b) => a.position - b.position) : [];
  return (
    <div className="flex flex-col gap-3" data-testid="atlas-graph-flows">
      <Select aria-label={t('flow.pick')} value={flowId ?? ''} onChange={(e) => onFlow(e.target.value || null)}
        options={[{ value: '', label: t('flow.pick') }, ...processes.map((p) => ({ value: p.id, label: p.name }))]} />
      {current && (
        <ol className="flex flex-col gap-1.5 text-[14px]" aria-label={t('flow.steps')}>
          {steps.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-tile bg-well px-3 py-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-chip text-[12px] font-semibold tabular-nums">{i + 1}</span>
              <button type="button" onClick={() => onStep(s)} className="min-w-0 flex-1 text-left font-medium text-fg underline-offset-2 hover:underline">{s.name}</button>
              <span className="text-[12px] text-fg-muted">{w(`status.${s.status}` as AtlasWord)}</span>
              <TaskLink code={s.task} />
              {s.services.length === 0 && <span className="text-[12px] text-fg-subtle">{t('flow.noNodes')}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function OperationPanel({ slug, systemId }: { slug: string; systemId: string }) {
  const t = useGraphWords();
  const since = useAgo();
  const events = useEvents({ system: slug });
  const list = (events.data ?? []).filter((e) => !e.productId || e.productId === systemId).slice(0, 40);
  return (
    <div className="flex flex-col gap-2" data-testid="atlas-graph-operation">
      <h3 className="text-[14px] font-semibold text-fg">{t('op.events')}</h3>
      {list.length === 0 ? <p className="text-[14px] text-fg-muted">{t('op.noEvents')}</p> : (
        <ul className="flex flex-col gap-1.5">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 rounded-tile bg-well px-3 py-2 text-[13px]">
              <span className="tabular-nums text-fg-muted">{since(e.at)}</span>
              <span className="font-medium text-fg">{e.title}</span>
              <span className="text-fg-subtle">{t('op.source')}: {e.source}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AttentionPanel({ slug, onNode }: { slug: string; onNode: (id: string) => void }) {
  const t = useGraphWords();
  const insights = useInsights(slug);
  if (insights.data === undefined) return null;
  if (insights.data.length === 0) return <p className="text-[14px] text-fg-muted" data-testid="atlas-graph-insights-none">{t('insight.none')}</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="atlas-graph-insights">
      {insights.data.map((i) => (
        <li key={i.id} className="rounded-tile bg-well px-3.5 py-3 text-[14px]">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[12px] font-semibold', i.severity === 'check' ? 'text-warning' : 'text-fg-muted')}>
              {i.severity === 'check' ? t('insight.check') : t('insight.suggestion')}
            </span>
            <span className="font-medium text-fg">{i.title}</span>
          </span>
          <span className="mt-1 block text-[13px] text-fg-muted">{i.detail}</span>
          {i.nodeIds.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {i.nodeIds.map((id) => (
                <button key={id} type="button" onClick={() => onNode(id)} className="h-6 rounded-full bg-chip px-2.5 font-mono text-[12px] text-fg-secondary hover:bg-active">{id.slice(0, 8)}</button>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const DAY = 86_400_000;

/** The "since" choices of Evolução, as an ISO instant (a date from its picker is taken at the start of the day). */
export function sinceValue(choice: 'day' | 'week' | 'month' | 'date', date: string): string {
  const now = Date.now();
  if (choice === 'date') return date ? new Date(`${date}T00:00:00`).toISOString() : new Date(now - 7 * DAY).toISOString();
  const days = choice === 'day' ? 1 : choice === 'week' ? 7 : 30;
  return new Date(now - days * DAY).toISOString();
}

export function SincePicker({ choice, date, onChoice, onDate }: {
  choice: 'day' | 'week' | 'month' | 'date'; date: string; onChoice: (c: 'day' | 'week' | 'month' | 'date') => void; onDate: (d: string) => void;
}) {
  const t = useGraphWords();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="atlas-graph-since">
      <Segmented<'day' | 'week' | 'month' | 'date'> size="sm" label={t('evo.since')} value={choice} onChange={onChoice}
        options={[
          { value: 'day', label: t('evo.1d') }, { value: 'week', label: t('evo.7d') },
          { value: 'month', label: t('evo.30d') }, { value: 'date', label: t('evo.date') },
        ]} />
      {choice === 'date' && (
        <Input type="date" aria-label={t('evo.date')} value={date} onChange={(e) => onDate(e.target.value)} className="w-44" />
      )}
    </div>
  );
}

