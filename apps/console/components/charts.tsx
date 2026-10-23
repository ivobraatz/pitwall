'use client';

import * as React from 'react';
import { cn } from './ui';

/** Series colors, in the order the design system gives them (--viz-1…8 in globals.css). */
export const viz = (i: number) => `var(--viz-${(i % 8) + 1})`;

function Legend({ items }: { items: Array<{ label: string; color: string; value?: React.ReactNode }> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: i.color }} />{i.label}
          {i.value !== undefined && <span className="tabular-nums text-fg">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

/** Grouped daily bars: one column per day, one bar per series. Grid in border-subtle, no shadow or gradient. */
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
        <div className="flex flex-col justify-between text-right text-[11px] tabular-nums text-fg-muted" style={{ height }}>
          {ticks.map((t, i) => <span key={i} className="-my-1.5 leading-3">{t}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((_, i) => <div key={i} className="border-t border-border-subtle" />)}
          </div>
          <div className="absolute inset-0 flex items-end gap-1">
            {days.map((d, di) => (
              <div key={d} className="group relative flex h-full flex-1 items-end justify-center gap-px" title={`${dayLabel(d)} · ${series.map((s) => `${s.label}: ${s.values[di]}`).join(' · ')}`}>
                {series.map((s) => (
                  <div key={s.label} className="w-full max-w-3 rounded-t-[2px] opacity-90 transition-opacity group-hover:opacity-100"
                    style={{ height: `${(s.values[di] / top) * 100}%`, minHeight: s.values[di] > 0 ? 2 : 0, background: s.color }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="w-5 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-1 text-[11px] text-fg-muted">
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
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-chip">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-[13px]">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: p.color }} />
            <span className="truncate text-fg-secondary">{p.label}</span>
            <span className="ml-auto tabular-nums text-fg">{p.value}</span>
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
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-[13px]">
            <span className="min-w-0 truncate text-fg">{r.label}</span>
            <span className="ml-auto tabular-nums text-fg">{r.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-chip">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          {r.hint && <div className="text-[12px] text-fg-muted">{r.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Compact statistic card (§6.5): label 13/500, number 24/300 with a dim unit, context 12 dim. */
export function Stat({ label, value, unit, hint, tone }: { label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode; tone?: 'warn' | 'danger' }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className="text-[13px] text-fg-secondary">{label}</div>
      <div className={cn('mt-1 text-2xl/8 font-light tabular-nums', tone === 'warn' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg')}>
        {value}{unit && <span className="ml-1 text-[13px] font-medium text-fg-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-fg-muted">{hint}</div>}
    </div>
  );
}
