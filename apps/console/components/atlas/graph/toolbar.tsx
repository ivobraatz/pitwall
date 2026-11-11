'use client';

import * as React from 'react';
import type { EdgeCategory, Verification } from '@/lib/atlas-graph';
import type { ServiceState } from '@/lib/atlas';
import { EDGE_CATEGORIES } from '@/lib/atlas-graph';
import { Check, SearchInput, Select, cn } from '@/components/ui';
import type { AtlasEnvironment } from '@/lib/atlas';
import { CATEGORY_COLOR, type Filters } from './model';
import { useGraphWords, type GraphWord } from './words';

/*
 * The map's toolbar: search, environment, the filters that hide, and which kinds of link to draw.
 * It only reports changes; the map owns the state, so the toolbar can be read on its own.
 */

const STATES: ServiceState[] = ['up', 'down', 'deploying', 'degraded', 'unknown'];
const VERIFICATIONS: Verification[] = ['verified', 'stale', 'found_in_code', 'not_found', 'reported', 'declared'];
const VERIFICATION_WORD: Record<Verification, GraphWord> = {
  verified: 'ver.verified', stale: 'ver.stale', found_in_code: 'ver.found_in_code', not_found: 'ver.not_found', reported: 'ver.reported', declared: 'ver.declared',
};
const STATE_WORD: Record<ServiceState, GraphWord> = {
  up: 'state.up', down: 'state.down', deploying: 'state.deploying', degraded: 'state.degraded', unknown: 'state.unknown',
};

export function MapToolbar({ filters, onFilters, kinds, environments, environment, onEnvironment, searchRef, hidden, matches, query }: {
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
}) {
  const t = useGraphWords();
  const toggleCategory = (c: EdgeCategory, on: boolean) => {
    const set = new Set(filters.categories);
    if (on) set.add(c); else set.delete(c);
    onFilters({ categories: EDGE_CATEGORIES.filter((x) => set.has(x)) });
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="atlas-graph-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput ref={searchRef} aria-label={t('toolbar.search')} placeholder={t('toolbar.search')} value={filters.query}
          onChange={(e) => onFilters({ query: e.target.value })} className="w-full sm:w-72" />
        {query.trim() !== '' && (
          <span className="text-[13px] text-fg-muted" data-testid="atlas-graph-results" aria-live="polite">
            {matches > 0 ? t('toolbar.results', { n: matches }) : t('toolbar.noResults')}
          </span>
        )}
        {hidden > 0 && <span className="text-[13px] text-fg-subtle">{t('toolbar.hidden', { n: hidden })}</span>}
        <span className="ml-auto hidden text-[12px] text-fg-subtle sm:inline">{t('toolbar.searchHint')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('toolbar.environment')} value={environment ?? ''} onChange={(e) => onEnvironment(e.target.value || null)}
          options={[{ value: '', label: t('toolbar.allEnvironments') }, ...environments.map((e) => ({ value: e.slug, label: e.name }))]} />
        <Select aria-label={t('toolbar.type')} value={filters.kind} onChange={(e) => onFilters({ kind: e.target.value })}
          options={[{ value: 'all', label: t('toolbar.allTypes') }, ...kinds.map((k) => ({ value: k, label: k }))]} />
        <Select aria-label={t('toolbar.state')} value={filters.state} onChange={(e) => onFilters({ state: e.target.value as Filters['state'] })}
          options={[{ value: 'all', label: t('toolbar.allStates') }, ...STATES.map((s) => ({ value: s, label: t(STATE_WORD[s]) }))]} />
        <Select aria-label={t('toolbar.verification')} value={filters.verification} onChange={(e) => onFilters({ verification: e.target.value as Filters['verification'] })}
          options={[{ value: 'all', label: t('toolbar.allVerifications') }, ...VERIFICATIONS.map((v) => ({ value: v, label: t(VERIFICATION_WORD[v]) }))]} />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('toolbar.categories')}>
        {EDGE_CATEGORIES.map((c) => (
          <Check key={c} checked={filters.categories.includes(c)} onChange={(on) => toggleCategory(c, on)}>
            <span className={cn('inline-block h-0 w-4 border-t-[3px]')} style={{ borderColor: CATEGORY_COLOR[c] }} aria-hidden />
            {t(`cat.${c}` as GraphWord)}
          </Check>
        ))}
        <Check checked={filters.minimap} onChange={(on) => onFilters({ minimap: on })}>{t('toolbar.minimap')}</Check>
      </div>
    </div>
  );
}

