'use client';

import * as React from 'react';
import type { AttentionClass, EdgeCategory } from '@/lib/atlas-graph';
import { EDGE_CATEGORIES } from '@/lib/atlas-graph';
import type { ServiceState } from '@/lib/atlas';
import { cn } from '@/components/ui';
import { StateGlyph } from '@/components/atlas/parts';
import { CATEGORY_COLOR } from './model';
import { useGraphWords, type GraphWord } from './words';

/*
 * Shapes and colours that the map uses, each with its word. A missing thing is hatched and a planned
 * one dashed, so neither reads as a healthy node. Red is only for failure.
 */

const STATES: ServiceState[] = ['up', 'down', 'deploying', 'degraded', 'unknown'];
const STATE_WORD: Record<ServiceState, GraphWord> = {
  up: 'state.up', down: 'state.down', deploying: 'state.deploying', degraded: 'state.degraded', unknown: 'state.unknown',
};

export function StateChip({ state, className }: { state: ServiceState; className?: string }) {
  const t = useGraphWords();
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap text-fg-secondary', className)}>
      <StateGlyph state={state} size={12} />{t(STATE_WORD[state])}
    </span>
  );
}

const ATTENTION_WORD: Record<AttentionClass, GraphWord> = {
  failure: 'attn.failure', security: 'attn.security', task: 'attn.task', improvement: 'attn.improvement', config: 'attn.config', unverified: 'attn.unverified',
};

/** One distinct shape per attention class, so the classes read apart without colour. */
export function AttentionIcon({ kind, size = 12 }: { kind: AttentionClass; size?: number }) {
  const shape = {
    failure: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />,
    security: <path d="M8 2.5 13 4.5v3.5c0 3-2.2 4.9-5 5.5-2.8-.6-5-2.5-5-5.5V4.5Z" stroke="currentColor" strokeWidth="1.5" fill="none" />,
    task: <><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M5 8.2l2 2 4-4.2" stroke="currentColor" strokeWidth="1.5" fill="none" /></>,
    improvement: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    config: <><circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></>,
    unverified: <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2" fill="none" />,
  }[kind];
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className="shrink-0">{shape}</svg>;
}

export function attentionLabel(kind: AttentionClass, t: (k: GraphWord) => string) { return t(ATTENTION_WORD[kind]); }

/** The link types, each with the colour of its category. */
export function CategorySwatch({ category, label }: { category: EdgeCategory; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="inline-block h-0 w-5 border-t-[3px]" style={{ borderColor: CATEGORY_COLOR[category] }} />{label}
    </span>
  );
}

export function GraphLegend({ className }: { className?: string }) {
  const t = useGraphWords();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-muted', className)} aria-label={t('legend.title')} data-testid="atlas-graph-legend">
      <span className="font-medium">{t('legend.title')}</span>
      {STATES.map((s) => <StateChip key={s} state={s} />)}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="inline-block h-0 w-5 border-t-[3px] border-dashed" style={{ borderColor: 'var(--ds-fg-secondary)' }} />{t('legend.planned')}
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="atlas-hatch-loud inline-block h-3.5 w-5" />{t('legend.missing')}
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className="atlas-pulse inline-block size-2 rounded-full bg-running" />{t('legend.activity')}
      </span>
      <span className="font-medium">{t('legend.categories')}</span>
      {EDGE_CATEGORIES.map((c) => <CategorySwatch key={c} category={c} label={t(`cat.${c}` as GraphWord)} />)}
    </div>
  );
}
