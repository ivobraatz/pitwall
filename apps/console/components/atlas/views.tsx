'use client';

import * as React from 'react';
import { byUrgency, verdict, type Atlas, type AtlasService, type AtlasSystem, type SystemFlows, type Verdict } from '@/lib/atlas';
import { ProductMark, ProductStripe } from '@/components/product';
import { Button, cn } from '@/components/ui';
import { Legend, SectionTitle, StateGlyph, liveClass, shortSha, useAgo, useLive, useWords } from './parts';
import type { AtlasWord } from './words';

const VERDICT_BLOCK: Record<Verdict, string> = {
  down: 'bg-danger text-on-status', attention: 'bg-warning text-on-status', ok: 'bg-success/15 text-success', empty: 'bg-chip text-fg-muted',
};

// ── Overview: one strip per system ─────────────────────────────────────────────────────

function Count({ n, label, loud }: { n: number | null; label: string; loud?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn('figures font-semibold', n === null ? 'text-fg-subtle' : n > 0 && loud ? 'text-danger' : n > 0 ? 'text-fg' : 'text-fg-subtle')}>{n ?? '?'}</span>
      <span className="ml-1 text-fg-muted">{label}</span>
    </span>
  );
}

export function Overview({ atlas, onSystem }: { atlas: Atlas; onSystem: (slug: string) => void }) {
  const t = useWords();
  const systems = [...atlas.systems].sort(byUrgency);
  return (
    <div data-testid="atlas-overview">
      <div className="hidden px-4 pb-2 text-[13px] font-semibold text-fg-muted lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_9.5rem] lg:gap-4">
        <span className="pl-12">{t('col.system')}</span><span>{t('col.health')}</span><span>{t('col.pending')}</span><span>{t('col.now')}</span><span />
      </div>
      <ul className="flex flex-col gap-1">
        {systems.map((s) => <SystemRow key={s.id} system={s} atlas={atlas} onOpen={() => onSystem(s.slug)} />)}
      </ul>
    </div>
  );
}

function SystemRow({ system: s, atlas, onOpen }: { system: AtlasSystem; atlas: Atlas; onOpen: () => void }) {
  const t = useWords();
  const v = verdict(s);
  const now = atlas.now.filter((n) => n.productId === s.id && n.kind !== 'down');
  const health = s.health.total === 0 ? t('health.none')
    : s.health.down > 0 ? t('health.down', { n: s.health.down })
    : t('health.up', { up: s.health.up, total: s.health.total });
  const state = s.health.down > 0 ? 'down' : s.health.deploying > 0 ? 'deploying' : s.health.degraded > 0 ? 'degraded' : s.health.up > 0 ? 'up' : 'unknown';
  return (
    <li>
      <button type="button" onClick={onOpen} data-testid="atlas-system" data-verdict={v}
        className="group flex w-full items-stretch bg-surface text-left text-[14px] transition-colors duration-150 hover:bg-hover">
        <ProductStripe product={s} className="w-1.5" />
        <span className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.3fr)] lg:items-center">
          <span className="flex min-w-0 items-center gap-3">
            <ProductMark product={s} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-semibold text-fg">{s.name}</span>
              {s.description && <span className="block truncate text-[13px] text-fg-muted">{s.description}</span>}
            </span>
          </span>
          <span className={cn('flex items-center gap-2', s.health.down > 0 ? 'font-semibold text-danger' : 'text-fg-secondary')}>
            <StateGlyph state={state} />{health}
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Count n={s.pending.tasks} label={t('pending.tasks')} />
            <Count n={s.pending.tickets} label={t('pending.tickets')} />
            <Count n={s.pending.errors} label={t('pending.errors')} loud />
            <span title={s.pending.alerts === null ? t('pending.unknown') : undefined}><Count n={s.pending.alerts} label={t('pending.alerts')} loud /></span>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            {now.length === 0 ? <span className="text-fg-subtle">{t('idle')}</span> : (
              <>
                <span className="atlas-pulse size-2.5 shrink-0 bg-running" />
                <span className="truncate text-fg">{now[0].title}</span>
                {now.length > 1 && <span className="figures shrink-0 text-fg-muted">+{now.length - 1}</span>}
              </>
            )}
          </span>
        </span>
        <span className={cn('flex w-28 shrink-0 items-center justify-center px-2 text-center text-[13px] font-semibold lg:w-38', VERDICT_BLOCK[v])}>{t(`verdict.${v}` as AtlasWord)}</span>
      </button>
    </li>
  );
}

// ── Engine: systems down, environments across ──────────────────────────────────────────

function ServiceLine({ service: s, live, onRemove }: { service: AtlasService; live: string | false; onRemove?: (s: AtlasService) => void }) {
  const t = useWords();
  const since = useAgo();
  return (
    <li data-testid="atlas-service" data-state={s.state} className={cn('group/s flex items-start gap-2.5 bg-well px-3 py-2', live)}>
      <StateGlyph state={s.state} className="mt-[3px]" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-fg underline-offset-2 hover:underline">{s.name}</a>
            : <span className="font-semibold text-fg">{s.name}</span>}
          {s.provider && <span className="text-[13px] text-fg-muted">{s.provider}</span>}
        </span>
        <span className="block text-[13px] text-fg-muted">
          <span className="sr-only">{t(`state.${s.state}` as AtlasWord)} · </span>
          {s.lastDeployAt ? <>{t('engine.deploy')} {since(s.lastDeployAt)}{shortSha(s.commitSha) && <> · <code>{shortSha(s.commitSha)}</code></>}</>
            : s.monitorStatus ? t(`state.${s.state}` as AtlasWord) : t('engine.never')}
        </span>
      </span>
      {onRemove && (
        <button type="button" onClick={() => onRemove(s)} aria-label={`${t('action.remove')}: ${s.name}`}
          className="px-1 text-[13px] text-fg-subtle opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/s:opacity-100">×</button>
      )}
    </li>
  );
}

export function Engine({ atlas, systemId, onRemoveService }: { atlas: Atlas; systemId?: string; onRemoveService?: (s: AtlasService) => void }) {
  const t = useWords();
  const since = useAgo();
  const live = useLive(atlas);
  const systems = atlas.systems.filter((s) => !systemId || s.id === systemId);
  const name = new Map(atlas.systems.map((s) => [s.id, s.name]));
  const byId = new Map(atlas.services.map((s) => [s.id, s]));
  const external = atlas.services.filter((s) => s.productId === null)
    .filter((s) => !systemId || atlas.links.some((l) => l.to === s.id && byId.get(l.from)?.productId === systemId));
  const repos = atlas.repos.filter((r) => !systemId || r.productId === systemId);
  const cols = `minmax(9rem, 12rem) repeat(${Math.max(atlas.environments.length, 1)}, minmax(15rem, 1fr))`;

  return (
    <div data-testid="atlas-engine">
      <Legend className="mb-4" />
      {atlas.environments.length === 0 ? <p className="bg-surface px-5 py-6 text-[14px] text-fg-muted">{t('engine.noenv')}</p> : (
        // relative: what is positioned inside (screen-reader text) scrolls with the grid instead of widening the page
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={t('view.engine')}>
          <div role="table" className="grid min-w-max gap-1 text-[14px]" style={{ gridTemplateColumns: cols }}>
            <div role="row" className="contents">
              <span role="columnheader" className="px-3 py-2 text-[13px] font-semibold text-fg-muted">{t('col.system')}</span>
              {atlas.environments.map((e) => <span key={e.id} role="columnheader" className="px-3 py-2 text-[13px] font-semibold text-fg-muted">{e.name}</span>)}
            </div>
            {systems.map((s) => (
              <div role="row" className="contents" key={s.id}>
                <div role="rowheader" className="sticky left-0 z-10 flex items-start gap-2.5 bg-surface px-3 py-3">
                  <ProductMark product={s} size={24} /><span className="font-semibold text-fg">{s.name}</span>
                </div>
                {atlas.environments.map((e) => {
                  const here = atlas.services.filter((x) => x.productId === s.id && x.environmentId === e.id);
                  return (
                    <div role="cell" key={e.id} data-testid="atlas-cell" data-empty={here.length === 0 || undefined}
                      className={cn('p-1.5', here.length === 0 ? 'atlas-hatch flex items-center justify-center text-[13px] text-fg-subtle' : 'bg-surface')}>
                      {here.length === 0 ? <span className="bg-bg px-2 py-0.5">{t('engine.none')}</span>
                        : <ul className="flex flex-col gap-1">{here.map((x) => <ServiceLine key={x.id} service={x} live={liveClass(live, x.id)} onRemove={onRemoveService} />)}</ul>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <SectionTitle hint={t('engine.pipelineHint')}>{t('engine.pipeline')}</SectionTitle>
      {repos.length === 0 ? <p className="bg-surface px-5 py-4 text-[14px] text-fg-muted">{t('repo.none')}</p> : (
        <ul className="flex flex-col gap-1">
          {repos.map((r) => {
            const state = r.lastRunStatus === 'success' ? 'up' : r.lastRunStatus === 'failure' ? 'down' : r.lastRunStatus === 'running' ? 'deploying' : 'unknown';
            return (
              <li key={r.id} data-testid="atlas-repo" className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-surface px-4 py-3 text-[14px]">
                <StateGlyph state={state} />
                <span className="font-semibold text-fg">{r.fullName}</span>
                {r.productId && <span className="text-[13px] text-fg-muted">{name.get(r.productId)}</span>}
                <span className="text-[13px] text-fg-secondary">
                  {r.lastRunStatus ? (
                    <>
                      {r.lastRunUrl ? <a className="underline-offset-2 hover:underline" href={r.lastRunUrl} target="_blank" rel="noreferrer">{r.lastRunName ?? 'CI'}</a> : (r.lastRunName ?? 'CI')}
                      {': '}{t(`run.${r.lastRunStatus}` as AtlasWord)} · {since(r.lastRunAt)}{shortSha(r.lastRunSha) && <> · <code>{shortSha(r.lastRunSha)}</code></>}
                    </>
                  ) : t('repo.norun')}
                </span>
                <span className="ml-auto flex flex-wrap gap-x-3 text-[13px] text-fg-muted">
                  {r.commits7d !== null && <span>{t('repo.week', { commits: r.commits7d, runs: r.runs7d ?? 0 })}</span>}
                  {(r.failedRuns7d ?? 0) > 0 && <span className="font-semibold text-danger">{t('repo.failed', { n: r.failedRuns7d! })}</span>}
                  {(r.openAlerts ?? 0) > 0 && <span className="font-semibold text-warning">{t('repo.alerts', { n: r.openAlerts! })}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {external.length > 0 && (
        <>
          <SectionTitle>{t('engine.external')}</SectionTitle>
          <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
            {external.map((x) => {
              const users = atlas.links.filter((l) => l.to === x.id).map((l) => byId.get(l.from)).filter((u): u is AtlasService => !!u)
                .filter((u) => !systemId || u.productId === systemId);
              return (
                <li key={x.id} data-testid="atlas-external" className="group/s bg-surface px-4 py-3 text-[14px]">
                  <span className="flex items-center gap-2">
                    <StateGlyph state={x.state} />
                    <span className="font-semibold text-fg">{x.name}</span>
                    {x.provider && <span className="text-[13px] text-fg-muted">{x.provider}</span>}
                    {onRemoveService && <button type="button" onClick={() => onRemoveService(x)} aria-label={`${t('action.remove')}: ${x.name}`}
                      className="ml-auto px-1 text-[13px] text-fg-subtle opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/s:opacity-100">×</button>}
                  </span>
                  <span className="mt-1 block text-[13px] text-fg-muted">
                    {users.length === 0 ? t('engine.unused')
                      : <>{t('engine.usedBy')}: {users.map((u) => `${u.productId ? `${name.get(u.productId)} · ` : ''}${u.name}`).join(', ')}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!systemId && (
        <>
          <SectionTitle>{t('engine.collectors')}</SectionTitle>
          <ul className="flex flex-wrap gap-1 text-[14px]">
            {atlas.collectors.map((c) => (
              <li key={c.name} data-testid="atlas-collector" data-connected={c.connected} className="flex items-center gap-2 bg-surface px-4 py-2.5" title={c.error ?? undefined}>
                <StateGlyph state={!c.connected ? 'unknown' : c.error ? 'down' : c.lastRunAt ? 'up' : 'unknown'} />
                <span className="font-semibold text-fg">{c.name}</span>
                <span className="text-[13px] text-fg-muted">
                  {!c.connected ? t('collector.off') : c.error ? `${t('collector.error')} · ${since(c.lastRunAt)}` : c.lastRunAt ? `${t('collector.ok')} ${since(c.lastRunAt)}` : t('collector.never')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Flows: left to right, a number at each step, a gap where there is none ─────────────

export function Flows({ flows, systemId }: { flows: SystemFlows[]; systemId?: string }) {
  const t = useWords();
  const shown = flows.filter((f) => !systemId || f.system.id === systemId);
  return (
    <div className="flex flex-col gap-8" data-testid="atlas-flows">
      {shown.map((f) => (
        <section key={f.system.id}>
          {!systemId && (
            <h3 className="mb-2 flex items-center gap-2.5 text-[16px] font-semibold text-fg"><ProductMark product={f.system} size={24} />{f.system.name}</h3>
          )}
          <div className="flex flex-col gap-1">
            {f.flows.map((flow) => (
              <div key={flow.key} className="grid grid-cols-1 gap-1 md:grid-cols-[10rem_1fr]">
                <div className="flex items-baseline gap-2 bg-surface px-4 py-3 md:flex-col md:gap-0.5">
                  <span className="font-semibold text-fg">{t(`flows.${flow.key}` as AtlasWord)}</span>
                  <span className="text-[13px] text-fg-muted">{t(flow.key === 'content' ? 'flows.window30' : 'flows.window7')}</span>
                </div>
                <ol className="grid grid-cols-4 gap-1">
                  {flow.steps.map((step, i) => {
                    const gap = step.value === null;
                    const detail = step.detail === null ? null
                      : step.key === 'ci' ? t('detail.failed', { n: step.detail }) : t('detail.of', { n: step.detail });
                    return (
                      <li key={step.key} data-testid="atlas-step" data-gap={gap || undefined} title={gap ? t('flows.gapHint') : undefined}
                        className={cn('relative min-w-0 px-3 py-3', gap ? 'atlas-hatch' : 'bg-surface')}>
                        {i > 0 && <span aria-hidden className="absolute top-1/2 -left-2.5 z-10 -translate-y-1/2 bg-bg px-0.5 text-[13px] text-fg-subtle">→</span>}
                        <span className={cn('block truncate text-[13px]', gap ? 'w-fit bg-bg px-1 text-fg-subtle' : 'text-fg-muted')}>{t(`step.${step.key}` as AtlasWord)}</span>
                        {gap ? <span className="mt-1 block w-fit bg-bg px-1 text-[14px] font-semibold text-fg-muted">{t('flows.gap')}</span>
                          : <span className="display figures mt-1 block text-[28px] text-fg">{step.value}</span>}
                        {detail && <span className={cn('block truncate text-[13px]', step.key === 'ci' ? 'font-semibold text-danger' : 'text-fg-muted')}>{detail}</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Discovery: found by a collector, registered by nobody ──────────────────────────────

export function DiscoveryList({ atlas, onRegister, onDismiss }: {
  atlas: Atlas; onRegister: (d: Atlas['discoveries'][number]) => void; onDismiss: (d: Atlas['discoveries'][number]) => void;
}) {
  const t = useWords();
  const since = useAgo();
  if (atlas.discoveries.length === 0) return <p className="bg-surface px-5 py-6 text-[14px] text-fg-muted" data-testid="atlas-discovery-empty">{t('discovery.none')}</p>;
  return (
    <div data-testid="atlas-discovery">
      <p className="mb-3 text-[14px] text-fg-muted">{t('discovery.hint')}</p>
      <ul className="flex flex-col gap-1">
        {atlas.discoveries.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-4 py-3 text-[14px]">
            <span className="bg-chip px-2 py-0.5 text-[13px] font-semibold text-fg-secondary">{d.source}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg">{d.name}</span>
              <span className="block text-[13px] text-fg-muted">
                {[t(`discovery.${d.kind}` as AtlasWord), d.environment, since(d.firstSeenAt)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" onClick={() => onRegister(d)}>{t('action.register')}</Button>
              <Button size="sm" variant="ghost" onClick={() => onDismiss(d)}>{t('action.dismiss')}</Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
