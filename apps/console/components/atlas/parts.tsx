'use client';

import * as React from 'react';
import { useT, useLocale, ago } from '@/lib/i18n';
import type { Atlas, NowItem, ServiceState } from '@/lib/atlas';
import { cn } from '@/components/ui';
import { WORDS, type AtlasWord } from './words';

export function useWords() { return useT(WORDS); }
export function useAgo() {
  const locale = useLocale();
  return React.useCallback((iso: string | null | undefined) => ago(iso, locale), [locale]);
}

/*
 * State is told twice, by colour and by shape, so it reads without colour too:
 * up = solid square · down = cross · deploying = hollow square (pulsing) · degraded = triangle · unknown = dashed square.
 */
const STATE_COLOR: Record<ServiceState, string> = {
  up: 'text-success', down: 'text-danger', deploying: 'text-running', degraded: 'text-warning', unknown: 'text-fg-subtle',
};

export function StateGlyph({ state, size = 14, className }: { state: ServiceState; size?: number; className?: string }) {
  const shape = {
    up: <rect x="3" y="3" width="10" height="10" fill="currentColor" />,
    down: <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="3" fill="none" />,
    deploying: <rect x="3.5" y="3.5" width="9" height="9" stroke="currentColor" strokeWidth="2.5" fill="none" />,
    degraded: <path d="M8 2.5 14 13.5H2Z" fill="currentColor" />,
    unknown: <rect x="3.5" y="3.5" width="9" height="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" fill="none" />,
  }[state];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden data-state={state}
      className={cn('shrink-0', STATE_COLOR[state], state === 'deploying' && 'atlas-pulse', className)}>{shape}</svg>
  );
}

export function StateLabel({ state, className }: { state: ServiceState; className?: string }) {
  const t = useWords();
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <StateGlyph state={state} /><span>{t(`state.${state}` as AtlasWord)}</span>
    </span>
  );
}

export function Legend({ className }: { className?: string }) {
  const t = useWords();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg-muted', className)} aria-label={t('legend')}>
      <span className="font-semibold">{t('legend')}</span>
      {(['up', 'down', 'deploying', 'degraded', 'unknown'] as const).map((s) => <StateLabel key={s} state={s} />)}
    </div>
  );
}

/**
 * What something is happening to right now. `services` and `systems` pulse (work in progress or
 * down); `flowing` are the services work is passing through, whose edges move.
 */
export function useLive(atlas: Atlas | undefined) {
  return React.useMemo(() => {
    const services = new Set<string>();
    const systems = new Set<string>();
    const flowing = new Set<string>();
    for (const n of atlas?.now ?? []) {
      if (n.serviceId) services.add(n.serviceId);
      if (n.productId) systems.add(n.productId);
      if (n.serviceId && n.kind !== 'down') flowing.add(n.serviceId);
    }
    return { services, systems, flowing };
  }, [atlas?.now]);
}

/** The outline of a node something is happening to: the work colour, or the alarm colour when it is down. */
export function liveClass(live: ReturnType<typeof useLive>, serviceId: string): string | false {
  if (live.flowing.has(serviceId)) return 'atlas-live';
  return live.services.has(serviceId) && 'atlas-live atlas-live-down';
}

const NOW_TONE: Record<NowItem['kind'], string> = {
  activity: 'bg-running text-on-status', routine: 'bg-info text-on-status', deploy: 'bg-running text-on-status', down: 'bg-danger text-on-status',
};

/** The strip that never scrolls away: what is happening at this moment, the broken things first. */
export function NowStrip({ atlas, onSystem }: { atlas: Atlas; onSystem: (slug: string) => void }) {
  const t = useWords();
  const since = useAgo();
  const order = { down: 0, deploy: 1, activity: 2, routine: 3 } as const;
  const items = [...atlas.now].sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <section aria-label={t('now.title')} data-testid="atlas-now"
      className="sticky top-0 z-20 -mx-4 mb-6 flex items-stretch gap-1 overflow-x-auto bg-bg px-4 py-2 md:-mx-8 md:px-8 lg:-mx-12 lg:px-12">
      <h2 className="flex shrink-0 items-center bg-surface px-4 text-[14px] font-semibold text-fg">
        <span className={cn('mr-2 size-2.5', items.length > 0 ? 'atlas-pulse bg-accent' : 'bg-fg-subtle')} />{t('now.title')}
      </h2>
      {items.length === 0 && <p className="flex h-11 items-center bg-surface px-4 text-[14px] text-fg-muted">{t('now.idle')}</p>}
      {items.map((n) => {
        const system = atlas.systems.find((s) => s.id === n.productId);
        return (
          <button key={`${n.kind}-${n.id}`} type="button" disabled={!system} onClick={() => system && onSystem(system.slug)}
            className="flex h-11 shrink-0 items-center gap-2.5 bg-surface pr-4 text-left text-[14px] enabled:hover:bg-hover">
            <span className={cn('flex h-full items-center px-2.5 text-[13px] font-semibold whitespace-nowrap', NOW_TONE[n.kind])}>{t(`now.${n.kind}` as AtlasWord)}</span>
            <span className="max-w-64 truncate font-semibold text-fg">{n.title}</span>
            <span className="whitespace-nowrap text-[13px] text-fg-muted">
              {[system?.name, n.actor, n.since ? since(n.since) : null].filter(Boolean).join(' · ')}
            </span>
          </button>
        );
      })}
    </section>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mt-10 mb-3 flex flex-wrap items-baseline gap-x-3">
      <h2 className="display text-[26px] text-fg">{children}</h2>
      {hint && <p className="text-[14px] text-fg-muted">{hint}</p>}
    </div>
  );
}

export function shortSha(sha: string | null | undefined) { return sha ? sha.slice(0, 7) : null; }
