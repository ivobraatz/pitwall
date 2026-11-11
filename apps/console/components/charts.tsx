'use client';

import * as React from 'react';
import { Dot, cn } from './ui';

/** Series colors (--viz-1…8 in globals.css; viz(0) is ink, the main series). */
export const viz = (i: number) => `var(--viz-${(i % 8) + 1})`;

function Legend({ items }: { items: Array<{ label: string; color: string; value?: React.ReactNode }> }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: i.color }} />{i.label}
          {i.value !== undefined && <span className="font-semibold tabular-nums text-fg">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

/** Grouped daily bars: one column per day, one bar per series; four faint gridlines, round even ticks. */
export function DailyBars({ days, series, height = 140 }: {
  days: string[]; // ISO dates
  series: Array<{ label: string; color: string; values: number[] }>;
  height?: number;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4; // four even gridlines, the top one above the maximum
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(top * f));
  const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()}/${d.getMonth() + 1}`; };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="flex flex-col justify-between text-right text-[12px] tabular-nums text-fg-subtle" style={{ height }}>
          {ticks.map((t, i) => <span key={i} className="-my-1.5 leading-3">{t}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            {ticks.map((_, i) => <span key={i} className={cn('h-px w-full', i === ticks.length - 1 ? 'bg-border-strong' : 'bg-border-subtle')} />)}
          </div>
          <div className="absolute inset-0 flex items-end gap-1.5">
            {days.map((d, di) => (
              <div key={d} className="group relative flex h-full flex-1 items-end justify-center gap-[3px]" title={`${dayLabel(d)} · ${series.map((s) => `${s.label}: ${s.values[di]}`).join(' · ')}`}>
                {series.map((s) => (
                  <div key={s.label} className="w-full max-w-3 rounded-t-[4px] opacity-90 transition-opacity group-hover:opacity-100"
                    style={{ height: `${(s.values[di] / top) * 100}%`, minHeight: s.values[di] > 0 ? 3 : 0, background: s.color }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="w-4 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-1.5 text-[12px] text-fg-subtle">
          {days.map((d, i) => <span key={d} className="flex-1 text-center tabular-nums">{i % 2 === 0 || days.length < 8 ? dayLabel(d) : ''}</span>)}
        </div>
      </div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, value: s.values.reduce((a, b) => a + b, 0) }))} />
    </div>
  );
}

/** Horizontal bars, one row per item, scaled to the largest value; thin rounded tracks. */
export function HBars({ rows, empty }: { rows: Array<{ label: React.ReactNode; value: number; color: string; hint?: React.ReactNode }>; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-[13px] text-fg-muted">{empty ?? 'Sem dados.'}</p>;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2 text-[14px]">
            <span className="min-w-0 truncate text-fg">{r.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-fg">{r.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-well">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          {r.hint && <div className="text-[12px] text-fg-muted">{r.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * A number with its label: a white panel, the label over the figure. tone "accent" fills the panel
 * with the signal yellow — only for the one number that asks the team to act.
 */
export function Stat({ label, value, unit, hint, tone, style, className }: { label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode; tone?: 'warn' | 'danger' | 'accent'; style?: React.CSSProperties; className?: string }) {
  const filled = tone === 'accent';
  return (
    <div className={cn('flex min-h-[112px] flex-col rounded-panel px-5 pt-4 pb-4', filled ? 'bg-accent text-on-accent' : 'bg-surface', className)} style={style}>
      <div className={cn('text-[13px] font-medium', filled ? '' : 'text-fg-muted')}>{label}</div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <div className={cn('text-[30px] leading-none font-medium tracking-[-0.03em] tabular-nums', filled ? '' : tone === 'warn' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg')}>
          {value}{unit && <span className={cn('ml-1 text-[15px] font-normal tracking-normal', filled ? 'opacity-70' : 'text-fg-muted')}>{unit}</span>}
        </div>
        {hint && <div className={cn('pb-0.5 text-right text-[12px] leading-4', filled ? 'opacity-75' : 'text-fg-muted')}>{hint}</div>}
      </div>
    </div>
  );
}

/**
 * The pipeline: one tile per stage, left to right, each with its count and a bar at its true share
 * of the largest stage. Unchosen stages draw their volume hatched; the chosen one is ink with a
 * yellow bar. A tile is a button: choosing it filters what is below.
 */
export function StageTiles({ stages, selected, onSelect, unit = 'chamados' }: {
  stages: Array<{ key: string; label: string; value: number; dot: string }>;
  selected?: string | null; onSelect?: (key: string) => void; unit?: string;
}) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const total = stages.reduce((a, s) => a + s.value, 0);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {stages.map((s) => {
        const on = selected === s.key;
        const share = total > 0 ? Math.round((s.value / total) * 100) : 0;
        return (
          <button key={s.key} type="button" onClick={() => onSelect?.(s.key)} aria-pressed={on}
            className={cn('group flex min-h-[176px] flex-col rounded-tile p-3 text-left transition-colors duration-150',
              on ? 'bg-well ring-[1.5px] ring-fg' : 'bg-well hover:bg-active')}>
            <span className={cn('inline-flex h-6 max-w-full items-center gap-1.5 self-start rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap',
              on ? 'bg-btn text-btn-fg' : 'bg-surface text-fg')}>
              {!on && <Dot tone={s.dot} />}<span className="truncate">{s.label}</span>
            </span>
            <span className="relative mt-3 flex h-[64px] items-end">
              {s.value > 0 ? (
                <span className={cn('relative block w-full overflow-hidden rounded-[10px]', on ? 'bg-accent' : 'border border-border-strong bg-surface')}
                  style={{ height: `${Math.max(10, (s.value / max) * 100)}%` }}>
                  {!on && <span className="hatch absolute inset-0 opacity-60" />}
                </span>
              ) : (
                <span className="block h-px w-full bg-border-strong" />
              )}
            </span>
            <span className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[30px] leading-none font-medium tracking-[-0.03em] tabular-nums text-fg">{s.value}</span>
              <span className="text-[13px] text-fg-muted">{unit}</span>
              <span className="ml-auto text-[12px] tabular-nums text-fg-muted" title="parte do total">{share}%</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
