'use client';

import * as React from 'react';
import { byUrgency, verdict, type Atlas, type AtlasService, type AtlasSystem, type SystemFlows, type Verdict } from '@/lib/atlas';
import { ProductMark } from '@/components/product';
import { Button, Card, Dot, Pill, cn } from '@/components/ui';
import { Legend, MarkGlyph, StateGlyph, conditionMark, liveClass, shortSha, useAgo, useLive, useWords } from './parts';
import type { AtlasWord } from './words';

const VERDICT_TONE: Record<Verdict, string> = { down: 'error', attention: 'warn', ok: 'ok', empty: 'idle' };

// The columns of the overview; the header and every row share them.
const OVERVIEW_COLS = 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.3fr)]';

// ── Overview: one row per system, in one panel ─────────────────────────────────────────

function Count({ n, label, loud }: { n: number | null; label: string; loud?: boolean }) {
  return (
    <span className="whitespace-nowrap text-fg-muted">
      <span className={cn('tabular-nums', n === null ? 'text-fg-subtle' : n > 0 && loud ? 'font-semibold text-danger' : n > 0 ? 'font-semibold text-fg' : 'text-fg-subtle')}>{n ?? '?'}</span>
      <span className="ml-1">{label}</span>
    </span>
  );
}

export function Overview({ atlas, onSystem }: { atlas: Atlas; onSystem: (slug: string) => void }) {
  const t = useWords();
  const systems = [...atlas.systems].sort(byUrgency);
  return (
    <div data-testid="atlas-overview">
      <Card>
        <div className="px-5 pb-3">
          <div className={cn('hidden items-center gap-4 pb-2 text-[12px] text-fg-subtle lg:flex')}>
            <span className="w-9 shrink-0" />
            <span className={cn('grid flex-1 gap-4', OVERVIEW_COLS)}>
              <span>{t('col.system')}</span><span>{t('col.health')}</span><span>{t('col.pending')}</span><span>{t('col.now')}</span>
            </span>
            <span className="w-[120px] shrink-0" />
          </div>
          <div className="flex flex-col divide-y divide-border-subtle">
            {systems.map((s) => <SystemRow key={s.id} system={s} atlas={atlas} onOpen={() => onSystem(s.slug)} />)}
          </div>
        </div>
      </Card>
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
    <button type="button" onClick={onOpen} data-testid="atlas-system" data-verdict={v}
      className="-mx-2 flex min-h-[64px] w-full items-start gap-3 rounded-tile px-2 py-3 text-left text-[14px] transition-colors duration-150 hover:bg-hover sm:items-center sm:gap-4">
      <ProductMark product={s} size={36} />
      <span className={cn('grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-2 lg:items-center', OVERVIEW_COLS)}>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium text-fg">{s.name}</span>
          {s.description && <span className="block truncate text-[13px] text-fg-muted">{s.description}</span>}
          <span className="mt-1.5 flex sm:hidden"><Pill tone={VERDICT_TONE[v]}>{t(`verdict.${v}` as AtlasWord)}</Pill></span>
        </span>
        <span className={cn('flex min-w-0 items-center gap-2 text-[13px]', s.health.down > 0 ? 'font-semibold text-fg' : 'text-fg-secondary')}>
          <StateGlyph state={state} />{health}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] lg:gap-x-4">
          <Count n={s.pending.tasks} label={t('pending.tasks')} />
          <Count n={s.pending.tickets} label={t('pending.tickets')} />
          <Count n={s.pending.errors} label={t('pending.errors')} loud />
          <span title={s.pending.alerts === null ? t('pending.unknown') : undefined}><Count n={s.pending.alerts} label={t('pending.alerts')} loud /></span>
          {s.attention.gaps > 0 && (
            <span data-testid="atlas-gaps"><Pill tone="error"><MarkGlyph mark="gap" size={12} />{t('attention.gaps', { n: s.attention.gaps })}</Pill></span>
          )}
          {s.attention.warnings > 0 && (
            <span data-testid="atlas-warnings"><Pill tone="warn"><MarkGlyph mark="warn" size={12} />{t('attention.warnings', { n: s.attention.warnings })}</Pill></span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-[13px]">
          {now.length === 0 ? <span className="text-fg-subtle">{t('idle')}</span> : (
            <>
              <Dot tone="running" className="atlas-pulse" />
              <span className="truncate text-fg">{now[0].title}</span>
              {now.length > 1 && <span className="shrink-0 tabular-nums text-fg-muted">+{now.length - 1}</span>}
            </>
          )}
        </span>
      </span>
      <span className="hidden w-[120px] shrink-0 justify-end sm:flex"><Pill tone={VERDICT_TONE[v]}>{t(`verdict.${v}` as AtlasWord)}</Pill></span>
    </button>
  );
}

// ── Engine: systems down, environments across ──────────────────────────────────────────

function ServiceLine({ service: s, live, onRemove, onOpen }: { service: AtlasService; live: string | false; onRemove?: (s: AtlasService) => void; onOpen?: (s: AtlasService) => void }) {
  const t = useWords();
  const since = useAgo();
  const gap = s.condition === 'gap';
  const planned = s.condition === 'planned';
  return (
    <li data-testid="atlas-service" data-state={s.state} data-condition={s.condition}
      className={cn('group/s flex items-start gap-2.5 rounded-tile bg-well px-3 py-2.5', gap && 'atlas-hatch-loud', planned && 'atlas-dashed', live)}>
      {gap || planned ? <MarkGlyph mark={conditionMark(s.condition)} className="mt-1" /> : <StateGlyph state={s.state} className="mt-1" />}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button type="button" onClick={() => onOpen?.(s)} aria-label={`${t('service.details')}: ${s.name}`} className="text-left text-[14px] font-medium text-fg underline-offset-2 hover:underline">{s.name}</button>
          {s.provider && <span className="text-[13px] text-fg-muted">{s.provider}</span>}
          {gap && <span className="text-[13px] font-semibold text-danger">{t('cond.gap')}</span>}
          {s.condition === 'warn' && <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warning"><MarkGlyph mark="warn" size={12} />{t('cond.warn')}</span>}
          {planned && <span className="text-[13px] text-fg-muted">{t('cond.planned')}</span>}
          {s.condition === 'local' && <span title={t('cond.localHint')} className="inline-flex items-center gap-1 text-[13px] text-fg-muted"><MarkGlyph mark="local" size={12} />{t('cond.local')}</span>}
        </span>
        <span className="block text-[13px] text-fg-muted">
          <span className="sr-only">{t(`state.${s.state}` as AtlasWord)} · </span>
          {gap ? t('cond.gap') : s.lastDeployAt ? <>{t('engine.deploy')} {since(s.lastDeployAt)}{shortSha(s.commitSha) && <> · <code>{shortSha(s.commitSha)}</code></>}</>
            : s.monitorStatus ? t(`state.${s.state}` as AtlasWord) : t('engine.never')}
        </span>
      </span>
      {onRemove && (
        <button type="button" onClick={() => onRemove(s)} aria-label={`${t('action.remove')}: ${s.name}`}
          className="rounded-full px-1.5 text-[13px] text-fg-subtle opacity-0 transition-colors hover:text-danger focus-visible:opacity-100 group-hover/s:opacity-100">×</button>
      )}
    </li>
  );
}

/** Services of one cell, under the block (group) each declares; the ungrouped come first, without a heading. */
function GroupedServices({ services, render }: { services: AtlasService[]; render: (s: AtlasService) => React.ReactNode }) {
  const groups = [...new Set(services.map((s) => s.group).filter((g): g is string => !!g))];
  const plain = services.filter((s) => !s.group);
  return (
    <div className="flex flex-col gap-1.5">
      {plain.length > 0 && <ul className="flex flex-col gap-1.5">{plain.map(render)}</ul>}
      {groups.map((g) => (
        <div key={g} data-testid="atlas-group" data-group={g}>
          <h4 className="mb-1.5 px-1 text-[12px] font-medium text-fg-muted">{g}</h4>
          <ul className="flex flex-col gap-1.5">{services.filter((s) => s.group === g).map(render)}</ul>
        </div>
      ))}
    </div>
  );
}

export function Engine({ atlas, systemId, onRemoveService, onService }: { atlas: Atlas; systemId?: string; onRemoveService?: (s: AtlasService) => void; onService?: (s: AtlasService) => void }) {
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
    <div data-testid="atlas-engine" className="flex flex-col gap-3">
      <Card title={t('view.engine')}>
        <div className="flex flex-col gap-4 px-5 pb-5">
          <Legend />
          {atlas.environments.length === 0 ? <p className="text-[14px] text-fg-muted">{t('engine.noenv')}</p> : (
            // relative: what is positioned inside (screen-reader text) scrolls with the grid instead of widening the page
            <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={t('view.engine')}>
              <div role="table" className="grid min-w-max gap-1.5 text-[14px]" style={{ gridTemplateColumns: cols }}>
                <div role="row" className="contents">
                  <span role="columnheader" className="px-3 py-1 text-[12px] font-normal text-fg-subtle">{t('col.system')}</span>
                  {atlas.environments.map((e) => <span key={e.id} role="columnheader" className="px-3 py-1 text-[12px] font-normal text-fg-subtle">{e.name}</span>)}
                </div>
                {systems.map((s) => (
                  <div role="row" className="contents" key={s.id}>
                    <div role="rowheader" className="sticky left-0 z-10 flex items-start gap-2.5 bg-surface px-3 py-2">
                      <ProductMark product={s} size={24} /><span className="font-medium text-fg">{s.name}</span>
                    </div>
                    {atlas.environments.map((e) => {
                      const here = atlas.services.filter((x) => x.productId === s.id && x.environmentId === e.id);
                      return (
                        <div role="cell" key={e.id} data-testid="atlas-cell" data-empty={here.length === 0 || undefined}
                          className={cn('rounded-tile p-1.5', here.length === 0 ? 'atlas-hatch flex items-center justify-center text-[13px] text-fg-subtle' : 'bg-surface')}>
                          {here.length === 0 ? <span className="rounded-full bg-surface px-2.5 py-0.5">{t('engine.none')}</span>
                            : <GroupedServices services={here} render={(x) => <ServiceLine key={x.id} service={x} live={liveClass(live, x.id)} onRemove={onRemoveService} onOpen={onService} />} />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title={t('engine.pipeline')} subtitle={t('engine.pipelineHint')}>
        {repos.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted">{t('repo.none')}</p> : (
          <ul className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
            {repos.map((r) => {
              const state = r.lastRunStatus === 'success' ? 'up' : r.lastRunStatus === 'failure' ? 'down' : r.lastRunStatus === 'running' ? 'deploying' : 'unknown';
              return (
                <li key={r.id} data-testid="atlas-repo" className="-mx-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-tile px-2 py-3 text-[14px] transition-colors duration-150 hover:bg-hover">
                  <StateGlyph state={state} />
                  <span className="font-medium text-fg">{r.fullName}</span>
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
                    {r.commits7d !== null && <span className="tabular-nums">{t('repo.week', { commits: r.commits7d, runs: r.runs7d ?? 0 })}</span>}
                    {(r.failedRuns7d ?? 0) > 0 && <span className="font-semibold text-danger">{t('repo.failed', { n: r.failedRuns7d! })}</span>}
                    {(r.openAlerts ?? 0) > 0 && <span className="font-semibold text-warning">{t('repo.alerts', { n: r.openAlerts! })}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {external.length > 0 && (
        <Card title={t('engine.external')}>
          <ul className="grid gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
            {external.map((x) => {
              const users = atlas.links.filter((l) => l.to === x.id).map((l) => byId.get(l.from)).filter((u): u is AtlasService => !!u)
                .filter((u) => !systemId || u.productId === systemId);
              return (
                <li key={x.id} data-testid="atlas-external" className="group/s rounded-tile bg-well px-4 py-3 text-[14px]">
                  <span className="flex items-center gap-2">
                    <StateGlyph state={x.state} />
                    <button type="button" onClick={() => onService?.(x)} aria-label={`${t('service.details')}: ${x.name}`} className="text-left font-medium text-fg underline-offset-2 hover:underline">{x.name}</button>
                    {x.provider && <span className="text-[13px] text-fg-muted">{x.provider}</span>}
                    {onRemoveService && <button type="button" onClick={() => onRemoveService(x)} aria-label={`${t('action.remove')}: ${x.name}`}
                      className="ml-auto rounded-full px-1.5 text-[13px] text-fg-subtle opacity-0 transition-colors hover:text-danger focus-visible:opacity-100 group-hover/s:opacity-100">×</button>}
                  </span>
                  <span className="mt-1 block text-[13px] text-fg-muted">
                    {users.length === 0 ? t('engine.unused')
                      : <>{t('engine.usedBy')}: {users.map((u) => `${u.productId ? `${name.get(u.productId)} · ` : ''}${u.name}`).join(', ')}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!systemId && (
        <Card title={t('engine.collectors')}>
          <ul className="flex flex-wrap gap-2 px-5 pb-5 text-[14px]">
            {atlas.collectors.map((c) => (
              <li key={c.name} data-testid="atlas-collector" data-connected={c.connected} className="flex items-center gap-2 rounded-tile bg-well px-3.5 py-2.5" title={c.error ?? undefined}>
                <StateGlyph state={!c.connected ? 'unknown' : c.error ? 'down' : c.lastRunAt ? 'up' : 'unknown'} />
                <span className="font-medium text-fg">{c.name}</span>
                <span className="text-[13px] text-fg-muted">
                  {!c.connected ? t('collector.off') : c.error ? `${t('collector.error')} · ${since(c.lastRunAt)}` : c.lastRunAt ? `${t('collector.ok')} ${since(c.lastRunAt)}` : t('collector.never')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Flows: left to right, a number at each step, a gap where there is none ─────────────

export function Flows({ flows, systemId }: { flows: SystemFlows[]; systemId?: string }) {
  const t = useWords();
  const shown = flows.filter((f) => !systemId || f.system.id === systemId);
  return (
    <div className="flex flex-col gap-3" data-testid="atlas-flows">
      {shown.map((f) => (
        <Card key={f.system.id}
          title={systemId ? t('view.flows') : <span className="inline-flex items-center gap-2.5"><ProductMark product={f.system} size={24} />{f.system.name}</span>}>
          <div className="flex flex-col gap-2 px-5 pb-5">
            {f.flows.map((flow) => (
              <div key={flow.key} className="grid grid-cols-1 gap-2 md:grid-cols-[10rem_minmax(0,1fr)]">
                <div className="flex items-baseline gap-2 rounded-tile bg-well px-4 py-3 md:flex-col md:gap-0.5">
                  <span className="font-medium text-fg">{t(`flows.${flow.key}` as AtlasWord)}</span>
                  <span className="text-[12px] text-fg-muted">{t(flow.key === 'content' ? 'flows.window30' : 'flows.window7')}</span>
                </div>
                <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {flow.steps.map((step, i) => {
                    const gap = step.value === null;
                    const detail = step.detail === null ? null
                      : step.key === 'ci' ? t('detail.failed', { n: step.detail }) : t('detail.of', { n: step.detail });
                    return (
                      <li key={step.key} data-testid="atlas-step" data-gap={gap || undefined} title={gap ? t('flows.gapHint') : undefined}
                        className={cn('relative min-w-0 rounded-tile px-3.5 py-3', gap ? 'atlas-hatch' : 'bg-well')}>
                        {i > 0 && <span aria-hidden className="absolute top-1/2 -left-2 z-10 hidden -translate-y-1/2 text-[13px] text-fg-subtle sm:block">→</span>}
                        <span className={cn('block truncate text-[13px]', gap ? 'w-fit rounded-full bg-surface px-2 text-fg-subtle' : 'text-fg-muted')}>{t(`step.${step.key}` as AtlasWord)}</span>
                        {gap ? <span className="mt-1.5 block w-fit rounded-full bg-surface px-2 text-[14px] font-medium text-fg-muted">{t('flows.gap')}</span>
                          : <span className="mt-1 block text-[28px] leading-none font-medium tracking-[-0.03em] tabular-nums text-fg">{step.value}</span>}
                        {detail && <span className={cn('mt-1 block truncate text-[13px]', step.key === 'ci' ? 'font-semibold text-danger' : 'text-fg-muted')}>{detail}</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </Card>
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
  if (atlas.discoveries.length === 0) {
    return (
      <Card>
        <p className="px-5 py-6 text-[14px] text-fg-muted" data-testid="atlas-discovery-empty">{t('discovery.none')}</p>
      </Card>
    );
  }
  return (
    <div data-testid="atlas-discovery">
      <Card>
        <p className="px-5 pt-5 pb-1 text-[14px] text-fg-muted">{t('discovery.hint')}</p>
        <ul className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
          {atlas.discoveries.map((d) => (
            <li key={d.id} className="-mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-tile px-2 py-3 text-[14px] transition-colors duration-150 hover:bg-hover">
              <Pill tone="idle">{d.source}</Pill>
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium text-fg">{d.name}</span>
                <span className="block text-[13px] text-fg-muted">
                  {[t(`discovery.${d.kind}` as AtlasWord), d.environment, since(d.firstSeenAt)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => onRegister(d)}>{t('action.register')}</Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(d)}>{t('action.dismiss')}</Button>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
