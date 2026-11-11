'use client';

import * as React from 'react';
import Link from 'next/link';
import { useT, useLocale, ago } from '@/lib/i18n';
import type { Atlas, Condition, Impact, LinkKind, NowItem, Owner, ServiceState, SystemRef } from '@/lib/atlas';
import { ProductStripe } from '@/components/product';
import { Dot, IconButton, IconClose, Pill, cn } from '@/components/ui';
import { WORDS, type AtlasWord } from './words';

export function useWords() { return useT(WORDS); }
export function useAgo() {
  const locale = useLocale();
  return React.useCallback((iso: string | null | undefined) => ago(iso, locale), [locale]);
}

/*
 * State is told by its colour dot and its word, always next to each other. Conditions (gap, warning,
 * planned, local) keep their shape too, because a missing thing must not read as a healthy one.
 */
const STATE_TONE: Record<ServiceState, string> = { up: 'ok', down: 'error', deploying: 'running', degraded: 'warn', unknown: 'idle' };
const STATE_SWATCH: Record<ServiceState, string> = { up: 'bg-success', down: 'bg-danger', deploying: 'bg-running', degraded: 'bg-warning', unknown: 'bg-border-loud' };
const STATES: ServiceState[] = ['up', 'down', 'deploying', 'degraded', 'unknown'];

export function StateGlyph({ state, size = 14, className }: { state: ServiceState; size?: number; className?: string }) {
  return (
    <span aria-hidden data-state={state} className={cn('inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <Dot tone={STATE_TONE[state]} className={state === 'deploying' ? 'atlas-pulse' : undefined} />
    </span>
  );
}

export function StateLabel({ state, className }: { state: ServiceState; className?: string }) {
  const t = useWords();
  return (
    <span className={cn('inline-flex items-center gap-2 text-[14px] whitespace-nowrap', className)}>
      <StateGlyph state={state} /><span>{t(`state.${state}` as AtlasWord)}</span>
    </span>
  );
}

/** A row of small swatches, each with its word, in muted 12px. */
export function Legend({ className }: { className?: string }) {
  const t = useWords();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-muted', className)} aria-label={t('legend')}>
      <span className="font-medium">{t('legend')}</span>
      {STATES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className={cn('size-3 rounded-[4px]', STATE_SWATCH[s])} />{t(`state.${s}` as AtlasWord)}
        </span>
      ))}
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

const NOW_TONE: Record<NowItem['kind'], string> = { activity: 'running', routine: 'info', deploy: 'running', down: 'error' };

/** The strip that never scrolls away: what is happening at this moment, the broken things first. */
export function NowStrip({ atlas, onSystem }: { atlas: Atlas; onSystem: (slug: string) => void }) {
  const t = useWords();
  const since = useAgo();
  const order = { down: 0, deploy: 1, activity: 2, routine: 3 } as const;
  const items = [...atlas.now].sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <section aria-label={t('now.title')} data-testid="atlas-now"
      className="sticky top-0 z-20 mb-3 flex items-center gap-1.5 overflow-x-auto rounded-panel bg-surface p-2">
      <h2 className="flex shrink-0 items-center gap-2 px-2 text-[14px] font-semibold text-fg">
        <Dot tone={items.length > 0 ? 'running' : 'idle'} className={items.length > 0 ? 'atlas-pulse' : undefined} />{t('now.title')}
      </h2>
      {items.length === 0 && <p className="shrink-0 px-2 text-[14px] text-fg-muted">{t('now.idle')}</p>}
      {items.map((n) => {
        const system = atlas.systems.find((s) => s.id === n.productId);
        return (
          <button key={`${n.kind}-${n.id}`} type="button" disabled={!system} onClick={() => system && onSystem(system.slug)}
            className="flex h-10 shrink-0 items-center gap-2.5 rounded-tile bg-well px-3.5 text-left text-[14px] transition-colors duration-150 enabled:hover:bg-hover">
            <Dot tone={NOW_TONE[n.kind]} className={n.kind !== 'down' ? 'atlas-pulse' : undefined} />
            <span className="text-[13px] font-medium whitespace-nowrap text-fg-muted">{t(`now.${n.kind}` as AtlasWord)}</span>
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

export function shortSha(sha: string | null | undefined) { return sha ? sha.slice(0, 7) : null; }

// ── What is declared: shape and colour, again both ─────────────────────────────────────

export type Mark = 'ok' | 'warn' | 'gap' | 'next' | 'idea' | 'local';
const MARK_COLOR: Record<Mark, string> = {
  ok: 'text-success', warn: 'text-warning', gap: 'text-danger', next: 'text-info', idea: 'text-fg-muted', local: 'text-fg-muted',
};
/** ok = solid square · warn = triangle · gap = cross in a frame · next = arrow · idea = dashed circle · local = diamond. */
export function MarkGlyph({ mark, size = 14, className }: { mark: Mark; size?: number; className?: string }) {
  const shape = {
    ok: <rect x="3" y="3" width="10" height="10" fill="currentColor" />,
    warn: <path d="M8 2.5 14 13.5H2Z" fill="currentColor" />,
    gap: <><rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="2" /></>,
    next: <path d="M2.5 8h9M8 3.5 12.5 8 8 12.5" stroke="currentColor" strokeWidth="2.2" fill="none" />,
    idea: <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 2" fill="none" />,
    local: <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" stroke="currentColor" strokeWidth="1.6" fill="none" />,
  }[mark];
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden data-mark={mark} className={cn('shrink-0', MARK_COLOR[mark], className)}>{shape}</svg>;
}

export const conditionMark = (c: Condition): Mark => (c === 'planned' ? 'idea' : c);

const IMPACT_TONE: Record<string, string> = { high: 'error', medium: 'warn', low: 'idle', none: 'idle' };
export function ImpactTag({ impact, className }: { impact: Impact | null; className?: string }) {
  const t = useWords();
  const key = impact ?? 'none';
  return <Pill tone={IMPACT_TONE[key] ?? 'idle'} className={className}>{t(`impact.${key}` as AtlasWord)}</Pill>;
}

export function OwnerTag({ owner }: { owner: Owner | null }) {
  const t = useWords();
  if (!owner) return null;
  return <Pill tone="idle">{t(`owner.${owner}` as AtlasWord)}</Pill>;
}

/** The task opens in the board's own drawer. */
export function TaskLink({ code }: { code: string | null }) {
  const t = useWords();
  if (!code) return null;
  return (
    <Link href={`/tasks?task=${encodeURIComponent(code)}`} aria-label={`${t('task.label')} ${code}`}
      className="inline-flex h-6 items-center rounded-full bg-chip px-2.5 text-[12px] font-semibold whitespace-nowrap text-fg tabular-nums transition-colors duration-150 hover:bg-active">{code}</Link>
  );
}

export function SystemChip({ system }: { system: SystemRef | null }) {
  const t = useWords();
  if (!system) return <span className="text-[13px] text-fg-subtle">{t('attention.noSystem')}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg">
      <ProductStripe product={system} className="size-2" /><span className="truncate">{system.name}</span>
    </span>
  );
}

/** One small palette for the kinds of link, readable on both grounds; the legend names each. */
export const LINK_COLOR: Record<LinkKind | 'none', string> = {
  host: 'var(--ds-info)', deploy: 'var(--ds-info)', dns: 'var(--ds-violet)', integration: 'var(--ds-violet)',
  storage: 'var(--ds-running)', payment: 'var(--ds-success)', business: 'var(--ds-success)',
  email: 'var(--ds-warning)', support: 'var(--ds-warning)', ai: 'var(--ds-accent-fg)', measure: 'var(--ds-accent-fg)',
  login: 'var(--ds-fg-secondary)', monitor: 'var(--ds-running)', none: 'var(--ds-border-loud)',
};

/** A panel from the right edge (the whole width on a phone). Escape and the scrim close it. */
export function Drawer({ open, onClose, title, subtitle, children, testId }: {
  open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; testId?: string;
}) {
  const t = useWords();
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} data-testid={testId}
        className="flex h-full w-full flex-col overflow-y-auto bg-overlay shadow-popover sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:w-[32rem] sm:rounded-panel">
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] break-words text-fg">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-fg-muted">{subtitle}</div>}
          </div>
          <IconButton size={36} onClick={onClose} aria-label={t('action.close')}><IconClose /></IconButton>
        </header>
        <div className="flex flex-col gap-3 px-5 pt-1 pb-8">{children}</div>
      </aside>
    </div>
  );
}

/** A label and its content, in a tile inside the drawer. */
export function DrawerSection({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-tile bg-well px-4 py-3">
      <h3 className="mb-1 text-[13px] font-medium text-fg-muted">{label}</h3>
      <div className="text-[14px] text-fg">{children}</div>
    </section>
  );
}
