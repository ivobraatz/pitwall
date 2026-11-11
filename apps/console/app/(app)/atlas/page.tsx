'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { setLocale, useLocale } from '@/lib/i18n';
import { useAtlas, useAttention, useFlows, useProcesses, useRoutines, type Atlas, type AtlasProcess, type AtlasService, type AttentionItem, type ProcessStep, type Routine } from '@/lib/atlas';
import { useMe } from '@/components/shell';
import { Button, Card, Empty, ErrorBox, PageHeader, Shimmer, cn, useToast } from '@/components/ui';
import { AtlasForm, type FormKind, type FormState } from '@/components/atlas/forms';
import { NowStrip, StateGlyph, useAgo, useWords } from '@/components/atlas/parts';
import { Routines } from '@/components/atlas/routines';
import { DiscoveryList, Engine, Flows, Overview } from '@/components/atlas/views';
import { AttentionList, Processes, ServiceDrawer, StepDrawer, Suppliers } from '@/components/atlas/insight';
import type { AtlasWord } from '@/components/atlas/words';
import { CompanyMap } from '@/components/atlas/graph/company-map';
import { ProductMap } from '@/components/atlas/graph/product-map';
import { ChangesList } from '@/components/atlas/graph/changes';
import { useGraphWords, type GraphWord } from '@/components/atlas/graph/words';

// Company level: the map of systems, its list, and the views that cut across systems.
const COMPANY_VIEWS = ['map', 'overview', 'attention', 'processes', 'suppliers', 'routines', 'discovery'] as const;
// Product level: one system's environments, flows, routines and changes.
const PRODUCT_VIEWS = ['engine', 'flows', 'routines', 'changes'] as const;

function Atlas() {
  const t = useWords();
  const g = useGraphWords();
  const locale = useLocale();
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const atlas = useAtlas();
  const routines = useRoutines();
  const flows = useFlows();
  const processes = useProcesses();
  const attention = useAttention();
  const [serviceId, setServiceId] = React.useState<string | null>(null);
  const [stepOpen, setStepOpen] = React.useState<{ step: ProcessStep; process: AtlasProcess } | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [menu, setMenu] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);

  const systemSlug = params.get('system');
  const environment = params.get('environment');
  const go = React.useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  const openSystem = React.useCallback((slug: string) => go({ system: slug, view: null, environment: null, node: null }), [go]);
  // The selected component is in the URL, so a link opens the same picture. Selecting replaces the entry
  // rather than adding one to the history: the back button leaves the map, not each click on it.
  const selectNode = React.useCallback((id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('node', id); else next.delete('node');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  const nodeParam = params.get('node');

  if (atlas.error && !atlas.data) return <ErrorBox error={atlas.error} onRetry={() => atlas.refetch()} />;
  if (!atlas.data) return <div className="flex flex-col gap-3"><Shimmer className="h-24" /><Shimmer className="h-16" /><Shimmer className="h-16" /></div>;
  const data = atlas.data;
  const system = systemSlug ? data.systems.find((s) => s.slug === systemSlug) : undefined;
  const empty = data.systems.length === 0 && data.services.length === 0;

  const companyView = (COMPANY_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view') as (typeof COMPANY_VIEWS)[number] : 'map';
  const productView = (PRODUCT_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? params.get('view') as (typeof PRODUCT_VIEWS)[number] : 'engine';

  const openService = (s: AtlasService) => { setStepOpen(null); setServiceId(s.id); };
  const openAttention = (i: AttentionItem) => {
    if (i.source === 'service') { const s = data.services.find((x) => x.id === i.serviceId); if (s) openService(s); return; }
    for (const p of processes.data ?? []) {
      const step = p.steps.find((x) => x.id === i.id);
      if (step) { setServiceId(null); setStepOpen({ step, process: p }); return; }
    }
  };
  const openedService = data.services.find((s) => s.id === serviceId) ?? null;

  const act = async (run: () => Promise<unknown>, done: AtlasWord) => {
    try { await run(); await queryClient.invalidateQueries({ queryKey: ['atlas'] }); toast('ok', t(done)); }
    catch (e) { toast('error', e instanceof ApiError ? e.message : t('error')); }
  };
  const removeService = (s: AtlasService) => {
    if (window.confirm(`${t('confirm.remove')} ${s.name}`)) void act(() => api(`/staff/atlas/services/${s.id}`, { method: 'DELETE' }), 'removed');
  };
  const removeRoutine = (r: Routine) => {
    if (window.confirm(`${t('confirm.remove')} ${r.name}`)) void act(() => api(`/staff/atlas/routines/${r.id}`, { method: 'DELETE' }), 'removed');
  };
  const collect = async () => {
    setCollecting(true);
    await act(() => api('/staff/atlas/collect', { method: 'POST' }), 'collected');
    setCollecting(false);
  };

  const kinds: FormKind[] = ['system', 'service', 'repo', 'link', 'routine', ...(me?.role === 'admin' ? ['import' as const] : [])];
  const actions = (
    <>
      <div className="inline-flex items-center gap-0.5 rounded-full bg-well p-1" role="group" aria-label={t('lang.label')}>
        {(['pt', 'en'] as const).map((l) => (
          <button key={l} type="button" onClick={() => setLocale(l)} aria-pressed={locale === l}
            className={cn('h-7 rounded-full px-3 text-[13px] font-medium transition-colors duration-150', locale === l ? 'bg-btn text-btn-fg' : 'text-fg-muted hover:text-fg')}>{l}</button>
        ))}
      </div>
      {!empty && <Button loading={collecting} onClick={collect}>{t('action.refresh')}</Button>}
      {!empty && <Link href="/atlas/onboarding" className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-surface px-5 text-[14px] font-semibold whitespace-nowrap text-fg transition-colors duration-150 hover:border-border-strong hover:bg-hover">{g('product.integration')}</Link>}
      <div className="relative">
        <Button variant="primary" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>{t('action.register')}</Button>
        {menu && (
          <div className="absolute right-0 z-30 mt-1.5 w-52 rounded-tile bg-overlay p-1.5 shadow-popover" onMouseLeave={() => setMenu(false)}>
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => { setMenu(false); setForm({ kind: k } as FormState); }}
                className="flex h-9 w-full items-center rounded-full px-3.5 text-left text-[14px] text-fg-secondary transition-colors duration-150 hover:bg-hover hover:text-fg">
                {t(k === 'import' ? 'action.import' : (`action.${k}` as AtlasWord))}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={actions} />
      {empty ? (
        <div data-testid="atlas-empty">
          <Card>
            <Empty title={t('empty.title')}>
              <p>{t('empty.body')}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setForm({ kind: 'system' })}>{t('empty.first')}</Button>
                {me?.role === 'admin' && <Button onClick={() => setForm({ kind: 'import' })}>{t('action.import')}</Button>}
              </div>
            </Empty>
          </Card>
        </div>
      ) : (
        <>
          <NowStrip atlas={data} onSystem={openSystem} />
          {system ? (
            <ProductLevel atlas={data} system={system} view={productView} environment={environment} node={nodeParam} onNode={selectNode}
              onBack={() => go({ system: null, view: null, environment: null, node: null })}
              onEnvironment={(slug) => go({ environment: slug })}
              onTab={(v) => go({ view: v === 'engine' ? null : v })}
              onService={openService} onRemoveService={removeService}
              flows={flows.data} routines={routines.data}
              onEditRoutine={(routine) => setForm({ kind: 'routine', routine })} onRemoveRoutine={removeRoutine} />
          ) : (
            <>
              <nav className="mb-3 flex max-w-full" aria-label={g('tab.label')}>
                <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-well p-1">
                  {COMPANY_VIEWS.map((v) => {
                    const on = companyView === v;
                    const count = v === 'attention' ? (attention.data?.length ?? 0) : v === 'discovery' ? data.discoveries.length : 0;
                    return (
                      <button key={v} type="button" onClick={() => go({ view: v === 'map' ? null : v })} aria-current={on ? 'page' : undefined}
                        className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
                          on ? 'bg-btn text-btn-fg' : 'text-fg-muted hover:text-fg')}>
                        {g(`tab.${v}` as GraphWord)}
                        {count > 0 && (
                          <span className={cn('rounded-full px-1.5 text-[12px] font-semibold tabular-nums', on ? 'bg-accent text-on-accent' : 'bg-accent-bg text-accent-fg')}>{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </nav>
              {companyView === 'map' && <CompanyMap onSystem={openSystem} />}
              {companyView === 'overview' && (
                <div className="flex flex-col gap-3">
                  <Overview atlas={data} onSystem={openSystem} />
                  <CollectorsCard atlas={data} />
                </div>
              )}
              {companyView === 'attention' && (attention.data ? <AttentionList items={attention.data} onOpen={openAttention} /> : <Shimmer className="h-40" />)}
              {companyView === 'processes' && (processes.data ? <Processes processes={processes.data} atlas={data} onStep={(step, process) => { setServiceId(null); setStepOpen({ step, process }); }} /> : <Shimmer className="h-40" />)}
              {companyView === 'suppliers' && <Suppliers atlas={data} onService={openService} />}
              {companyView === 'routines' && (routines.data ? <Routines routines={routines.data} onEdit={(routine) => setForm({ kind: 'routine', routine })} onRemove={removeRoutine} /> : <Shimmer className="h-20" />)}
              {companyView === 'discovery' && (
                <DiscoveryList atlas={data}
                  onRegister={(d) => (d.kind === 'repo'
                    ? void act(() => api(`/staff/atlas/discoveries/${d.id}/register`, { method: 'POST', json: {} }), 'saved')
                    : setForm({ kind: 'service', discovery: d }))}
                  onDismiss={(d) => void act(() => api(`/staff/atlas/discoveries/${d.id}/dismiss`, { method: 'POST' }), 'removed')} />
              )}
            </>
          )}
        </>
      )}
      <ServiceDrawer service={openedService} atlas={data} onClose={() => setServiceId(null)} onService={openService} />
      <StepDrawer step={stepOpen?.step ?? null} process={stepOpen?.process ?? null} atlas={data} onClose={() => setStepOpen(null)} onService={openService} />
      <AtlasForm state={form} atlas={data} onClose={() => { setForm(null); void routines.refetch(); }} />
    </>
  );
}

/** One system: its map on top, and below it the tabs that read the same system another way. */
function ProductLevel({ atlas, system, view, environment, node, onNode, onBack, onEnvironment, onTab, onService, onRemoveService, flows, routines, onEditRoutine, onRemoveRoutine }: {
  atlas: Atlas;
  system: Atlas['systems'][number];
  view: (typeof PRODUCT_VIEWS)[number];
  environment: string | null;
  node: string | null;
  onNode: (id: string | null) => void;
  onBack: () => void;
  onEnvironment: (slug: string | null) => void;
  onTab: (v: (typeof PRODUCT_VIEWS)[number]) => void;
  onService: (s: AtlasService) => void;
  onRemoveService: (s: AtlasService) => void;
  flows: ReturnType<typeof useFlows>['data'];
  routines: ReturnType<typeof useRoutines>['data'];
  onEditRoutine: (r: Routine) => void;
  onRemoveRoutine: (r: Routine) => void;
}) {
  const g = useGraphWords();
  return (
    <div data-testid="atlas-system-detail" className="flex flex-col gap-3">
      <ProductMap system={system} environments={atlas.environments} environment={environment} onEnvironment={onEnvironment}
        node={node} onNode={onNode} onBack={onBack} />
      <nav className="flex max-w-full" aria-label={g('tab.label')}>
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-well p-1">
          {PRODUCT_VIEWS.map((v) => {
            const on = view === v;
            return (
              <button key={v} type="button" onClick={() => onTab(v)} aria-current={on ? 'page' : undefined}
                className={cn('inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
                  on ? 'bg-btn text-btn-fg' : 'text-fg-muted hover:text-fg')}>
                {g(`tab.${v}` as GraphWord)}
              </button>
            );
          })}
        </div>
      </nav>
      {view === 'engine' && <Engine atlas={atlas} systemId={system.id} onRemoveService={onRemoveService} onService={onService} />}
      {view === 'flows' && (flows ? <Flows flows={flows} systemId={system.id} /> : <Shimmer className="h-40" />)}
      {view === 'routines' && (routines ? <Routines routines={routines} systemId={system.id} onEdit={onEditRoutine} onRemove={onRemoveRoutine} /> : <Shimmer className="h-20" />)}
      {view === 'changes' && <ChangesList system={system.slug} />}
    </div>
  );
}

/** The collectors, as the Engine listed them before the map took over the company view. */
function CollectorsCard({ atlas }: { atlas: Atlas }) {
  const t = useWords();
  const since = useAgo();
  return (
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
  );
}

export default function AtlasPage() {
  return <React.Suspense><Atlas /></React.Suspense>;
}
