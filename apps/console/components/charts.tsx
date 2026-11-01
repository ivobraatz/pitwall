'use client';

import * as React from 'react';
import { cn } from './ui';

/** Series colors, in the order the brand gives them (--viz-1…8 in globals.css; viz(0) is the signal yellow). */
export const viz = (i: number) => `var(--viz-${(i % 8) + 1})`;

function Legend({ items }: { items: Array<{ label: string; color: string; value?: React.ReactNode }> }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5" style={{ background: i.color }} />{i.label}
          {i.value !== undefined && <span className="font-semibold tabular-nums text-fg">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

/** Grouped daily bars: one column per day, one bar per series. Square bars that rise in on mount; grid in border-subtle. */
export function DailyBars({ days, series, height = 140 }: {
  days: string[]; // ISO dates
  series: Array<{ label: string; color: string; values: number[] }>;
  height?: number;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4; // four even gridlines
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(top * f));
  const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()}/${d.getMonth() + 1}`; };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-right text-[13px] tabular-nums text-fg-subtle" style={{ height }}>
          {ticks.map((t, i) => <span key={i} className="-my-1.5 leading-3">{t}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div className="absolute inset-0 flex items-end gap-1.5">
            {days.map((d, di) => (
              <div key={d} className="group relative flex h-full flex-1 items-end justify-center gap-px" title={`${dayLabel(d)} · ${series.map((s) => `${s.label}: ${s.values[di]}`).join(' · ')}`}>
                {series.map((s) => (
                  <div key={s.label} className="bar w-full max-w-4 opacity-85 transition-opacity group-hover:opacity-100"
                    style={{ height: `${(s.values[di] / top) * 100}%`, minHeight: s.values[di] > 0 ? 3 : 0, background: s.color, '--i': di } as React.CSSProperties} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="w-5 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-1.5 text-[13px] text-fg-subtle">
          {days.map((d, i) => <span key={d} className="flex-1 text-center tabular-nums">{i % 2 === 0 || days.length < 8 ? dayLabel(d) : ''}</span>)}
        </div>
      </div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, value: s.values.reduce((a, b) => a + b, 0) }))} />
    </div>
  );
}

/** One bar split into proportional parts, with a legend that carries the numbers. */
export function StackedBar({ parts }: { parts: Array<{ label: string; value: number; color: string }> }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-10 gap-1 bg-well">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} title={`${p.label}: ${p.value}`} className="grow-x" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-[14px]">
            <span className="size-2.5 shrink-0" style={{ background: p.color }} />
            <span className="truncate text-fg-secondary">{p.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-fg">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars, one row per item, scaled to the largest value. */
export function HBars({ rows, empty }: { rows: Array<{ label: React.ReactNode; value: number; color: string; hint?: React.ReactNode }>; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-[13px] text-fg-muted">{empty ?? 'Sem dados.'}</p>;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-[14px]">
            <span className="min-w-0 truncate text-fg">{r.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-fg">{r.value}</span>
          </div>
          <div className="h-2 bg-well">
            <div className="grow-x h-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color, '--i': i } as React.CSSProperties} />
          </div>
          {r.hint && <div className="text-[13px] text-fg-muted">{r.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * A number on the board: the label small, the figure in the display face at timing-tower size.
 * tone "accent" fills the tile with the signal yellow — use it for the one number that asks for action.
 */
export function Stat({ label, value, unit, hint, tone, style }: { label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode; tone?: 'warn' | 'danger' | 'accent'; style?: React.CSSProperties }) {
  const filled = tone === 'accent';
  return (
    <div className={cn('rise flex min-h-36 flex-col px-5 pt-4 pb-5', filled ? 'bg-accent text-on-accent' : 'bg-surface')} style={style}>
      <div className={cn('text-[14px] font-semibold', filled ? '' : 'text-fg-secondary')}>{label}</div>
      <div className={cn('display mt-auto pt-4 text-[52px] tabular-nums', filled ? '' : tone === 'warn' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg')}>
        {value}{unit && <span className={cn('ml-1.5 text-[20px] tracking-normal', filled ? 'opacity-70' : 'text-fg-muted')}>{unit}</span>}
      </div>
      {hint && <div className={cn('mt-2 text-[13px]', filled ? 'opacity-75' : 'text-fg-muted')}>{hint}</div>}
    </div>
  );
}
