'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { setLocale, useLocale } from '@/lib/i18n';
import { useAtlas, useFlows, useRoutines, type AtlasService, type Routine } from '@/lib/atlas';
import { useMe } from '@/components/shell';
import { ProductMark } from '@/components/product';
import { Button, Empty, ErrorBox, PageHeader, Shimmer, cn, useToast } from '@/components/ui';
import { AtlasForm, type FormKind, type FormState } from '@/components/atlas/forms';
import { NowStrip, SectionTitle, useWords } from '@/components/atlas/parts';
import { Routines } from '@/components/atlas/routines';
import { DiscoveryList, Engine, Flows, Overview } from '@/components/atlas/views';
import type { AtlasWord } from '@/components/atlas/words';

// The map measures the screen and draws on it: there is nothing to render on the server.
const AtlasMap = dynamic(() => import('@/components/atlas/map').then((m) => m.AtlasMap), { ssr: false, loading: () => <Shimmer className="h-[62vh]" /> });

const VIEWS = ['overview', 'engine', 'map', 'flows', 'routines', 'discovery'] as const;
type View = (typeof VIEWS)[number];

function Atlas() {
  const t = useWords();
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
  const [form, setForm] = React.useState<FormState | null>(null);
  const [menu, setMenu] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);

  const view = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'overview';
  const systemSlug = params.get('system');
  const go = React.useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  const openSystem = React.useCallback((slug: string) => go({ system: slug, view: null }), [go]);

  if (atlas.error && !atlas.data) return <ErrorBox error={atlas.error} onRetry={() => atlas.refetch()} />;
  if (!atlas.data) return <div className="flex flex-col gap-1"><Shimmer className="h-24" /><Shimmer className="h-16" /><Shimmer className="h-16" /></div>;
  const data = atlas.data;
  const system = systemSlug ? data.systems.find((s) => s.slug === systemSlug) : undefined;
  const empty = data.systems.length === 0 && data.services.length === 0;

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
      <div className="flex" role="group" aria-label={t('lang.label')}>
        {(['pt', 'en'] as const).map((l) => (
          <button key={l} type="button" onClick={() => setLocale(l)} aria-pressed={locale === l}
            className={cn('h-10 px-3 text-[13px] font-semibold uppercase', locale === l ? 'bg-active text-fg' : 'bg-chip text-fg-muted hover:text-fg')}>{l}</button>
        ))}
      </div>
      {!empty && <Button loading={collecting} onClick={collect}>{t('action.refresh')}</Button>}
      <div className="relative">
        <Button variant={empty ? 'secondary' : 'primary'} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>{t('action.register')}</Button>
        {menu && (
          <div className="absolute right-0 z-30 mt-1 w-52 bg-overlay p-1.5 shadow-popover" onMouseLeave={() => setMenu(false)}>
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => { setMenu(false); setForm({ kind: k } as FormState); }}
                className="flex h-10 w-full items-center px-3 text-left text-[14px] text-fg-secondary hover:bg-hover hover:text-fg">
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
        <div className="bg-surface" data-testid="atlas-empty">
          <Empty title={t('empty.title')}>
            <p>{t('empty.body')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setForm({ kind: 'system' })}>{t('empty.first')}</Button>
              {me?.role === 'admin' && <Button onClick={() => setForm({ kind: 'import' })}>{t('action.import')}</Button>}
            </div>
          </Empty>
        </div>
      ) : (
        <>
          <NowStrip atlas={data} onSystem={openSystem} />
          {system ? (
            <div data-testid="atlas-system-detail">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="ghost" onClick={() => go({ system: null })}>← {t('action.back')}</Button>
                <ProductMark product={system} size={32} />
                <h2 className="display text-[30px] text-fg">{system.name}</h2>
                {system.description && <p className="text-[14px] text-fg-muted">{system.description}</p>}
              </div>
              <Engine atlas={data} systemId={system.id} onRemoveService={removeService} />
              <SectionTitle>{t('view.flows')}</SectionTitle>
              {flows.data ? <Flows flows={flows.data} systemId={system.id} /> : <Shimmer className="h-40" />}
              <SectionTitle>{t('view.routines')}</SectionTitle>
              {routines.data ? <Routines routines={routines.data} systemId={system.id} onEdit={(routine) => setForm({ kind: 'routine', routine })} onRemove={removeRoutine} /> : <Shimmer className="h-20" />}
            </div>
          ) : (
            <>
              <nav className="mb-5 flex gap-1 overflow-x-auto" aria-label={t('title')}>
                {VIEWS.map((v) => (
                  <button key={v} type="button" onClick={() => go({ view: v === 'overview' ? null : v })} aria-current={view === v ? 'page' : undefined}
                    className={cn('flex h-10 shrink-0 items-center gap-2 px-4 text-[14px] whitespace-nowrap transition-colors duration-150',
                      view === v ? 'bg-active font-semibold text-fg' : 'bg-surface text-fg-muted hover:bg-hover hover:text-fg')}>
                    {t(`view.${v}` as AtlasWord)}
                    {v === 'discovery' && data.discoveries.length > 0 && <span className="figures bg-warning px-1.5 text-[13px] font-bold text-on-status">{data.discoveries.length}</span>}
                  </button>
                ))}
              </nav>
              {view === 'overview' && <Overview atlas={data} onSystem={openSystem} />}
              {view === 'engine' && <Engine atlas={data} onRemoveService={removeService} />}
              {view === 'map' && <AtlasMap atlas={data} onSystem={openSystem} />}
              {view === 'flows' && (flows.data ? <Flows flows={flows.data} /> : <Shimmer className="h-40" />)}
              {view === 'routines' && (routines.data ? <Routines routines={routines.data} onEdit={(routine) => setForm({ kind: 'routine', routine })} onRemove={removeRoutine} /> : <Shimmer className="h-20" />)}
              {view === 'discovery' && (
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
      <AtlasForm state={form} atlas={data} onClose={() => { setForm(null); void routines.refetch(); }} />
    </>
  );
}

export default function AtlasPage() {
  return <React.Suspense><Atlas /></React.Suspense>;
}
