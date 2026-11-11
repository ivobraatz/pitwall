'use client';

import * as React from 'react';
import type { Atlas, AtlasProcess, AtlasService, AttentionItem, Impact, ProcessStep, StepStatus, SystemRef } from '@/lib/atlas';
import { ProductMark } from '@/components/product';
import { Card, Pill, Select, cn } from '@/components/ui';
import {
  Drawer, DrawerSection, ImpactTag, MarkGlyph, OwnerTag, StateLabel, SystemChip, TaskLink, conditionMark, useWords, LINK_COLOR,
} from './parts';
import type { AtlasWord } from './words';

// ── Pede atenção: what was declared as missing or working badly, the heaviest first ────

const IMPACTS: Array<Impact | 'none'> = ['high', 'medium', 'low', 'none'];

export function AttentionList({ items, onOpen }: { items: AttentionItem[]; onOpen: (i: AttentionItem) => void }) {
  const t = useWords();
  if (items.length === 0) {
    return (
      <Card>
        <p className="px-5 py-6 text-[14px] text-fg-muted" data-testid="atlas-attention-empty">{t('attention.none')}</p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="atlas-attention">
      {IMPACTS.map((impact) => {
        const group = items.filter((i) => (i.impact ?? 'none') === impact);
        if (group.length === 0) return null;
        return (
          <section key={impact} data-impact={impact} aria-label={t(`impact.${impact}` as AtlasWord)}>
            <Card title={<span className="inline-flex items-center gap-2.5"><ImpactTag impact={impact === 'none' ? null : impact} /><span className="tabular-nums text-fg-muted">{group.length}</span></span>}>
              <ul className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
                {group.map((i) => <AttentionRow key={`${i.source}-${i.id}`} item={i} onOpen={() => onOpen(i)} />)}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

function AttentionRow({ item: i, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const t = useWords();
  const gap = i.status === 'gap';
  return (
    <li data-testid="atlas-attention-item" data-status={i.status} data-source={i.source}
      className="-mx-2 grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 rounded-tile px-2 py-3 text-[14px] transition-colors duration-150 hover:bg-hover lg:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
      <span className="self-start">
        <Pill tone={gap ? 'error' : 'warn'}><MarkGlyph mark={i.status} size={12} />{t(`status.${i.status}` as AtlasWord)}</Pill>
      </span>
      <div className="min-w-0">
        <button type="button" onClick={onOpen} className="text-left text-[14px] font-medium text-fg underline-offset-2 hover:underline">{i.title}</button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SystemChip system={i.system} />
          {i.where && <span className="text-[13px] text-fg-muted">{t(`attention.${i.source}` as AtlasWord)} · {i.where}</span>}
        </div>
        {i.detail && <p className="mt-1.5 text-[13px] text-fg-secondary">{i.detail}</p>}
        {i.next && <p className="mt-1 text-[13px] text-fg-secondary"><span className="font-medium text-fg">{t('attention.next')}:</span> {i.next}</p>}
      </div>
      <div className="flex flex-wrap items-start gap-1.5 lg:justify-end">
        <OwnerTag owner={i.owner} /><TaskLink code={i.task} />
      </div>
    </li>
  );
}

// ── Processes: a row of steps, or a system × stage matrix ──────────────────────────────

const STATUS_TONE: Partial<Record<StepStatus, string>> = { ok: 'ok', warn: 'warn', gap: 'error', next: 'info', idea: 'idle' };

function StepCard({ step, onOpen, compact }: { step: ProcessStep; onOpen: (s: ProcessStep) => void; compact?: boolean }) {
  const t = useWords();
  return (
    <button type="button" onClick={() => onOpen(step)} data-testid="atlas-process-step" data-status={step.status}
      className={cn('flex w-full flex-col items-start gap-2 rounded-tile bg-well px-3.5 py-3 text-left text-[14px] transition-colors duration-150 hover:bg-hover',
        step.status === 'gap' && 'atlas-hatch', step.status === 'idea' && 'atlas-dashed', !compact && 'min-w-44')}>
      <span className="font-medium text-fg">{step.name}</span>
      <Pill tone={STATUS_TONE[step.status] ?? 'idle'}><MarkGlyph mark={step.status} size={12} />{t(`status.${step.status}` as AtlasWord)}</Pill>
    </button>
  );
}

function ProcessBlock({ process, steps, onStep }: { process: AtlasProcess; steps: ProcessStep[]; onStep: (s: ProcessStep) => void }) {
  const t = useWords();
  const matrix = process.stages.length > 0;
  return (
    <section data-testid="atlas-process" data-layout={matrix ? 'matrix' : 'row'} className="min-w-0">
      <Card title={process.name} subtitle={process.description ?? undefined} actions={process.system ? <SystemChip system={process.system} /> : undefined}>
        {steps.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted">{t('processes.nothing')}</p>
          : matrix ? <Matrix process={process} steps={steps} onStep={onStep} />
          : (
            <div className="relative overflow-x-auto px-5 pb-5" tabIndex={0} role="region" aria-label={process.name}>
              <ol className="flex min-w-max items-stretch gap-2">
                {steps.map((s, i) => (
                  <li key={s.id} className="relative flex">
                    {i > 0 && <span aria-hidden className="absolute top-1/2 -left-[13px] z-10 -translate-y-1/2 text-[13px] text-fg-subtle">→</span>}
                    <StepCard step={s} onOpen={onStep} />
                  </li>
                ))}
              </ol>
            </div>
          )}
      </Card>
    </section>
  );
}

function Matrix({ process, steps, onStep }: { process: AtlasProcess; steps: ProcessStep[]; onStep: (s: ProcessStep) => void }) {
  const t = useWords();
  const systemOf = (s: ProcessStep) => s.system ?? process.system;
  const rows: Array<SystemRef | null> = [];
  for (const s of steps) { const sys = systemOf(s); if (!rows.some((r) => r?.id === sys?.id)) rows.push(sys); }
  const known = new Set(process.stages.map((s) => s.key));
  const stages = [...process.stages.map((s) => ({ key: s.key, name: s.name })),
    ...(steps.some((s) => !s.stage || !known.has(s.stage)) ? [{ key: '', name: t('step.nostage') }] : [])];
  const cols = `minmax(8rem, 11rem) repeat(${stages.length}, minmax(12rem, 1fr))`;
  return (
    <div className="relative overflow-x-auto px-5 pb-5" tabIndex={0} role="region" aria-label={process.name}>
      <div role="table" className="grid min-w-max gap-1.5 text-[14px]" style={{ gridTemplateColumns: cols }}>
        <div role="row" className="contents">
          <span role="columnheader" className="px-1.5 py-1 text-[12px] font-normal text-fg-subtle">{t('col.system')}</span>
          {stages.map((c) => <span key={c.key} role="columnheader" className="px-1.5 py-1 text-[12px] font-normal text-fg-subtle">{c.name}</span>)}
        </div>
        {rows.map((sys) => (
          <div role="row" className="contents" key={sys?.id ?? 'none'}>
            <div role="rowheader" className="sticky left-0 z-10 flex items-start gap-2 bg-surface px-1.5 py-2">
              {sys ? <><ProductMark product={sys} size={22} /><span className="font-medium text-fg">{sys.name}</span></> : <span className="font-medium text-fg-muted">{t('processes.shared')}</span>}
            </div>
            {stages.map((c) => {
              const here = steps.filter((s) => systemOf(s)?.id === sys?.id && (c.key === '' ? !s.stage || !known.has(s.stage) : s.stage === c.key));
              return (
                <div role="cell" key={c.key} data-testid="atlas-process-cell" data-empty={here.length === 0 || undefined}
                  className={cn('rounded-tile p-1.5', here.length === 0 ? 'atlas-hatch min-h-14' : 'bg-surface')}>
                  <ul className="flex flex-col gap-1.5">{here.map((s) => <li key={s.id}><StepCard step={s} onOpen={onStep} compact /></li>)}</ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Processes({ processes, atlas, onStep }: { processes: AtlasProcess[]; atlas: Atlas; onStep: (s: ProcessStep, p: AtlasProcess) => void }) {
  const t = useWords();
  const [system, setSystem] = React.useState('');
  if (processes.length === 0) {
    return (
      <Card>
        <div className="px-5 py-6 text-[14px] text-fg-muted" data-testid="atlas-processes-empty">
          <p className="font-medium text-fg">{t('processes.none')}</p><p className="mt-1">{t('processes.noneHint')}</p>
        </div>
      </Card>
    );
  }
  const shown = processes.map((p) => ({
    process: p,
    steps: !system ? p.steps : p.steps.filter((s) => (s.system ?? p.system)?.slug === system),
  })).filter((x) => !system || x.steps.length > 0);
  return (
    <div data-testid="atlas-processes" className="flex flex-col gap-3">
      <div className="max-w-xs">
        <Select aria-label={t('processes.filter')} value={system} onChange={(e) => setSystem(e.target.value)}
          options={[{ value: '', label: t('processes.all') }, ...atlas.systems.map((s) => ({ value: s.slug, label: s.name }))]} />
      </div>
      {shown.length === 0 && <Card><p className="px-5 py-4 text-[14px] text-fg-muted">{t('processes.nothing')}</p></Card>}
      {shown.map(({ process, steps }) => <ProcessBlock key={process.id} process={process} steps={steps} onStep={(s) => onStep(s, process)} />)}
    </div>
  );
}

export function StepDrawer({ step, process, atlas, onClose, onService }: {
  step: ProcessStep | null; process: AtlasProcess | null; atlas: Atlas; onClose: () => void; onService: (s: AtlasService) => void;
}) {
  const t = useWords();
  if (!step) return null;
  const sys = step.system ?? process?.system ?? null;
  const services = step.services.map((id) => atlas.services.find((s) => s.id === id)).filter((s): s is AtlasService => !!s);
  const text = (v: string | null) => v ? <p className="whitespace-pre-wrap">{v}</p> : <p className="text-fg-subtle">{t('step.empty')}</p>;
  const stage = process?.stages.find((s) => s.key === step.stage);
  return (
    <Drawer open onClose={onClose} testId="atlas-step-drawer" title={step.name}
      subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium text-fg"><MarkGlyph mark={step.status} />{t(`status.${step.status}` as AtlasWord)}</span>
        {process && <span>{process.name}</span>}{stage && <span>{stage.name}</span>}
      </span>}>
      <div className="flex flex-wrap items-center gap-2">
        <SystemChip system={sys} />
      </div>
      <DrawerSection label={t('step.today')}>{text(step.today)}</DrawerSection>
      <DrawerSection label={t('step.ideal')}>{text(step.ideal)}</DrawerSection>
      <DrawerSection label={t('step.nextStep')}>{text(step.next)}</DrawerSection>
      <div className="grid gap-3 sm:grid-cols-3">
        <DrawerSection label={t('owner.label')}>{step.owner ? <OwnerTag owner={step.owner} /> : <span className="text-fg-subtle">—</span>}</DrawerSection>
        <DrawerSection label={t('impact.label')}>{step.impact ? <ImpactTag impact={step.impact} /> : <span className="text-fg-subtle">—</span>}</DrawerSection>
        <DrawerSection label={t('task.label')}>{step.task ? <TaskLink code={step.task} /> : <span className="text-fg-subtle">—</span>}</DrawerSection>
      </div>
      <DrawerSection label={t('step.services')}>
        {services.length === 0 ? <span className="text-fg-subtle">—</span> : (
          <ul className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <li key={s.id}><button type="button" onClick={() => onService(s)} className="inline-flex items-center rounded-full bg-surface px-3 py-1 text-[14px] font-medium text-fg transition-colors hover:bg-hover">
                {s.name}{s.provider && <span className="ml-1.5 font-normal text-fg-muted">{s.provider}</span>}
              </button></li>
            ))}
          </ul>
        )}
      </DrawerSection>
    </Drawer>
  );
}

// ── The service, opened ────────────────────────────────────────────────────────────────

function LinkRow({ id, kind, planned, byId, onService }: { id: string; kind: string | null; planned: boolean; byId: Map<string, AtlasService>; onService: (s: AtlasService) => void }) {
  const t = useWords();
  const other = byId.get(id);
  if (!other) return null;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span aria-hidden className="h-0 w-5 shrink-0 border-t-[3px]" style={{ borderColor: LINK_COLOR[(kind ?? 'none') as keyof typeof LINK_COLOR], borderTopStyle: planned ? 'dashed' : 'solid' }} />
      <button type="button" onClick={() => onService(other)} className="font-medium text-fg underline-offset-2 hover:underline">{other.name}</button>
      <span className="text-[13px] text-fg-muted">{t(`link.${kind ?? 'none'}` as AtlasWord)}{planned && ` · ${t('service.planned')}`}</span>
    </li>
  );
}

export function ServiceDrawer({ service, atlas, onClose, onService }: {
  service: AtlasService | null; atlas: Atlas; onClose: () => void; onService: (s: AtlasService) => void;
}) {
  const t = useWords();
  if (!service) return null;
  const byId = new Map(atlas.services.map((s) => [s.id, s]));
  const system = atlas.systems.find((s) => s.id === service.productId) ?? null;
  const env = atlas.environments.find((e) => e.id === service.environmentId);
  const out = atlas.links.filter((l) => l.from === service.id);
  const inn = atlas.links.filter((l) => l.to === service.id);
  return (
    <Drawer open onClose={onClose} testId="atlas-service-drawer" title={service.name}
      subtitle={[system?.name ?? t('service.shared'), env?.name, service.provider].filter(Boolean).join(' · ')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StateLabel state={service.state} />
        {service.condition !== 'ok' && (
          <Pill tone={service.condition === 'gap' ? 'error' : service.condition === 'warn' ? 'warn' : 'idle'}>
            <MarkGlyph mark={conditionMark(service.condition)} size={12} />{t(`cond.${service.condition}` as AtlasWord)}
          </Pill>
        )}
        <Pill tone="idle">{t(`kind.${service.kind}` as AtlasWord) === `kind.${service.kind}` ? service.kind : t(`kind.${service.kind}` as AtlasWord)}</Pill>
      </div>
      {service.condition !== 'ok' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <DrawerSection label={t('impact.label')}>{service.impact ? <ImpactTag impact={service.impact} /> : <span className="text-fg-subtle">—</span>}</DrawerSection>
          <DrawerSection label={t('owner.label')}>{service.owner ? <OwnerTag owner={service.owner} /> : <span className="text-fg-subtle">—</span>}</DrawerSection>
          <DrawerSection label={t('task.label')}>{service.task ? <TaskLink code={service.task} /> : <span className="text-fg-subtle">—</span>}</DrawerSection>
        </div>
      )}
      {service.condition === 'ok' && service.task && <DrawerSection label={t('task.label')}><TaskLink code={service.task} /></DrawerSection>}
      {service.group && <DrawerSection label={t('service.group')}>{service.group}</DrawerSection>}
      {service.url && <DrawerSection label={t('field.url')}><a className="break-all underline-offset-2 hover:underline" href={service.url} target="_blank" rel="noreferrer">{service.url}</a></DrawerSection>}
      {service.notes && <DrawerSection label={t('service.notes')}><p className="whitespace-pre-wrap">{service.notes}</p></DrawerSection>}
      {service.facts.length > 0 && (
        <DrawerSection label={t('service.facts')}>
          <dl data-testid="atlas-facts" className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            {service.facts.map((f) => (
              <React.Fragment key={f.key}><dt className="text-fg-muted">{f.key}</dt><dd className="break-words text-fg">{f.value}</dd></React.Fragment>
            ))}
          </dl>
        </DrawerSection>
      )}
      {service.items.length > 0 && (
        <DrawerSection label={t('service.items')}>
          <ul data-testid="atlas-items" className="flex flex-wrap gap-1.5">
            {service.items.map((i) => <li key={i} className="rounded-full bg-surface px-3 py-1 text-[14px] text-fg-secondary">{i}</li>)}
          </ul>
        </DrawerSection>
      )}
      <DrawerSection label={t('service.incoming')}>
        {inn.length === 0 ? <span className="text-fg-subtle">{t('service.nolinks')}</span> : <ul data-testid="atlas-links-in" className="flex flex-col gap-1.5">{inn.map((l) => <LinkRow key={l.id} id={l.from} kind={l.kind} planned={l.planned} byId={byId} onService={onService} />)}</ul>}
      </DrawerSection>
      <DrawerSection label={t('service.outgoing')}>
        {out.length === 0 ? <span className="text-fg-subtle">{t('service.nolinks')}</span> : <ul data-testid="atlas-links-out" className="flex flex-col gap-1.5">{out.map((l) => <LinkRow key={l.id} id={l.to} kind={l.kind} planned={l.planned} byId={byId} onService={onService} />)}</ul>}
      </DrawerSection>
    </Drawer>
  );
}

// ── Fornecedores: provider × system ────────────────────────────────────────────────────

export function Suppliers({ atlas, onService }: { atlas: Atlas; onService: (s: AtlasService) => void }) {
  const t = useWords();
  const withProvider = atlas.services.filter((s) => s.provider);
  if (withProvider.length === 0) {
    return (
      <Card>
        <p className="px-5 py-6 text-[14px] text-fg-muted" data-testid="atlas-suppliers-empty">{t('suppliers.none')}</p>
      </Card>
    );
  }
  const providers = [...new Set(withProvider.map((s) => s.provider!))].sort((a, b) => a.localeCompare(b));
  const usedSystems = atlas.systems.filter((sys) => withProvider.some((s) => s.productId === sys.id));
  const hasShared = withProvider.some((s) => s.productId === null);
  const cols: Array<{ id: string | null; label: React.ReactNode }> = [
    ...usedSystems.map((s) => ({ id: s.id as string | null, label: <span className="inline-flex items-center gap-2"><ProductMark product={s} size={20} />{s.name}</span> })),
    ...(hasShared ? [{ id: null, label: <span>{t('suppliers.shared')}</span> }] : []),
  ];
  const grid = `minmax(8rem, 11rem) repeat(${cols.length}, minmax(12rem, 1fr))`;
  return (
    <div data-testid="atlas-suppliers" className="flex flex-col gap-3">
      <p className="px-1 text-[14px] text-fg-muted">{t('suppliers.hint')}</p>
      <Card>
        <div className="relative overflow-x-auto px-5 pb-5" tabIndex={0} role="region" aria-label={t('view.suppliers')}>
          <div role="table" className="grid min-w-max gap-1.5 text-[14px]" style={{ gridTemplateColumns: grid }}>
            <div role="row" className="contents">
              <span role="columnheader" className="px-1.5 py-1 text-[12px] font-normal text-fg-subtle">{t('suppliers.provider')}</span>
              {cols.map((c) => <span key={c.id ?? 'shared'} role="columnheader" className="px-1.5 py-1 text-[12px] font-normal text-fg-subtle">{c.label}</span>)}
            </div>
            {providers.map((p) => (
              <div role="row" className="contents" key={p} data-provider={p}>
                <div role="rowheader" className="sticky left-0 z-10 flex items-center bg-surface px-1.5 py-2 font-medium text-fg">{p}</div>
                {cols.map((c) => {
                  const here = withProvider.filter((s) => s.provider === p && s.productId === c.id);
                  return (
                    <div role="cell" key={c.id ?? 'shared'} data-testid="atlas-supplier-cell" data-count={here.length} data-empty={here.length === 0 || undefined}
                      className={cn('rounded-tile p-2', here.length === 0 ? 'atlas-hatch min-h-14' : 'bg-well')}>
                      {here.length > 0 && (
                        <>
                          <span className="block text-[13px] font-medium tabular-nums text-fg-muted">{here.length === 1 ? t('suppliers.count1') : t('suppliers.count', { n: here.length })}</span>
                          <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {here.map((s) => (
                              <li key={s.id}><button type="button" onClick={() => onService(s)}
                                className={cn('inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[13px] font-medium text-fg transition-colors hover:bg-hover',
                                  s.condition === 'gap' && 'atlas-hatch-loud', s.condition === 'planned' && 'atlas-dashed')}>
                                {s.condition !== 'ok' && <MarkGlyph mark={conditionMark(s.condition)} size={12} />}{s.name}
                              </button></li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
