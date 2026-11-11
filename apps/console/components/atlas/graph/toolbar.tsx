'use client';

import * as React from 'react';
import type { EdgeCategory, Verification } from '@/lib/atlas-graph';
import type { ServiceState } from '@/lib/atlas';
import { EDGE_CATEGORIES } from '@/lib/atlas-graph';
import { SearchInput, Select, cn } from '@/components/ui';
import type { AtlasEnvironment } from '@/lib/atlas';
import { CATEGORY_COLOR, type Filters } from './model';
import { Popover } from './popover';
import { GraphLegend } from './legend';
import { useGraphWords, type GraphWord } from './words';

/*
 * The map's toolbar, in one line: search, environment, and three popovers (filters that hide, the link
 * kinds drawn, the legend). It only reports changes; the map owns the state.
 */

const STATES: ServiceState[] = ['up', 'down', 'deploying', 'degraded', 'unknown'];
const VERIFICATIONS: Verification[] = ['verified', 'stale', 'found_in_code', 'not_found', 'reported', 'declared'];
const VERIFICATION_WORD: Record<Verification, GraphWord> = {
  verified: 'ver.verified', stale: 'ver.stale', found_in_code: 'ver.found_in_code', not_found: 'ver.not_found', reported: 'ver.reported', declared: 'ver.declared',
};
const STATE_WORD: Record<ServiceState, GraphWord> = {
  up: 'state.up', down: 'state.down', deploying: 'state.deploying', degraded: 'state.degraded', unknown: 'state.unknown',
};

export function MapToolbar({ filters, onFilters, kinds, environments, environment, onEnvironment, searchRef, hidden, matches, query, selected, onClear }: {
  filters: Filters;
  onFilters: (patch: Partial<Filters>) => void;
  kinds: string[];
  environments: AtlasEnvironment[];
  environment: string | null;
  onEnvironment: (slug: string | null) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  hidden: number;
  matches: number;
  query: string;
  selected: boolean;
  onClear: () => void;
}) {
  const t = useGraphWords();
  const activeFilters = [filters.kind !== 'all', filters.state !== 'all', filters.verification !== 'all'].filter(Boolean).length;
  const linksOn = filters.categories.length;

  const toggleCategory = (c: EdgeCategory, on: boolean) => {
    const set = new Set(filters.categories);
    if (on) set.add(c); else set.delete(c);
    onFilters({ categories: EDGE_CATEGORIES.filter((x) => set.has(x)) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="atlas-graph-toolbar">
      <div className="relative w-full sm:w-72">
        <SearchInput ref={searchRef} aria-label={t('toolbar.search')} placeholder={t('toolbar.search')} title={t('toolbar.searchHint')} value={filters.query}
          onChange={(e) => onFilters({ query: e.target.value })} className="w-full" />
        <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-md bg-chip px-1.5 text-[12px] font-semibold text-fg-muted">/</kbd>
      </div>
      {query.trim() !== '' && (
        <span className="text-[13px] text-fg-muted" data-testid="atlas-graph-results" aria-live="polite">
          {matches > 0 ? t('toolbar.results', { n: matches }) : t('toolbar.noResults')}
        </span>
      )}
      <Select aria-label={t('toolbar.environment')} value={environment ?? ''} onChange={(e) => onEnvironment(e.target.value || null)}
        options={[{ value: '', label: t('toolbar.allEnvironments') }, ...environments.map((e) => ({ value: e.slug, label: e.name }))]} />

      <Popover label={t('toolbar.filters')} badge={activeFilters > 0 ? String(activeFilters) : null} testId="atlas-graph-filters" width={288}>
        <div className="flex flex-col gap-3">
          <Select aria-label={t('toolbar.type')} value={filters.kind} onChange={(e) => onFilters({ kind: e.target.value })}
            options={[{ value: 'all', label: t('toolbar.allTypes') }, ...kinds.map((k) => ({ value: k, label: k }))]} />
          <Select aria-label={t('toolbar.state')} value={filters.state} onChange={(e) => onFilters({ state: e.target.value as Filters['state'] })}
            options={[{ value: 'all', label: t('toolbar.allStates') }, ...STATES.map((s) => ({ value: s, label: t(STATE_WORD[s]) }))]} />
          <Select aria-label={t('toolbar.verification')} value={filters.verification} onChange={(e) => onFilters({ verification: e.target.value as Filters['verification'] })}
            options={[{ value: 'all', label: t('toolbar.allVerifications') }, ...VERIFICATIONS.map((v) => ({ value: v, label: t(VERIFICATION_WORD[v]) }))]} />
          <div className="flex items-center justify-between gap-2 text-[13px] text-fg-muted">
            <span>{hidden > 0 ? t('toolbar.hidden', { n: hidden }) : ''}</span>
            <button type="button" disabled={activeFilters === 0} onClick={() => onFilters({ kind: 'all', state: 'all', verification: 'all' })}
              className="h-8 rounded-full px-3 font-medium text-fg-secondary hover:bg-well hover:text-fg disabled:opacity-40">{t('toolbar.clearFilters')}</button>
          </div>
        </div>
      </Popover>

      <Popover label={t('toolbar.categories')} badge={`${linksOn}/${EDGE_CATEGORIES.length}`} testId="atlas-graph-links" width={256}>
        <ul className="flex flex-col gap-0.5" aria-label={t('toolbar.categories')}>
          {EDGE_CATEGORIES.map((c) => {
            const on = filters.categories.includes(c);
            return (
              <li key={c}>
                <label className="flex cursor-pointer items-center gap-3 rounded-tile px-2 py-2 text-[14px] text-fg-secondary hover:bg-well">
                  <input type="checkbox" className="size-4 accent-[var(--ds-fg)]" checked={on} onChange={(e) => toggleCategory(c, e.target.checked)} />
                  <span aria-hidden className={cn('inline-block h-0 w-5 border-t-[3px]')} style={{ borderColor: CATEGORY_COLOR[c] }} />
                  <span className="flex-1">{t(`cat.${c}` as GraphWord)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </Popover>

      <Popover label={t('legend.title')} testId="atlas-graph-legend-popover" width={384}>
        <GraphLegend className="gap-y-2.5" />
      </Popover>

      {selected && (
        <button type="button" onClick={onClear} className="h-10 rounded-full bg-well px-4 text-[14px] font-medium text-fg-secondary hover:text-fg">
          {t('toolbar.clearSelection')}
        </button>
      )}
    </div>
  );
}
