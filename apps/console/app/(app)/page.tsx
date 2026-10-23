'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, SEVERITIES, STATUSES, type Paged, type Product, type QueueRow, type Summary } from '@/lib/api';
import {
  Button, Card, Empty, ErrorBox, Input, PageHeader, Pill, Select, SeverityPill, Shimmer, StatusPill,
  SEVERITY_LABEL, STATUS_LABEL, cn, rel,
} from '@/components/ui';
import { DailyBars, HBars, Stat, StackedBar, viz } from '@/components/charts';

function minutes(m: number | null): { value: string; unit?: string } {
  if (m == null) return { value: '—' };
  if (m < 60) return { value: String(Math.round(m)), unit: 'min' };
  if (m < 60 * 24) return { value: (m / 60).toFixed(1), unit: 'h' };
  return { value: (m / 1440).toFixed(1), unit: 'd' };
}

const SEV_BOX: Record<string, string> = {
  low: 'bg-chip text-fg-muted', normal: 'bg-accent-bg text-accent-fg', high: 'bg-warning/15 text-warning', critical: 'bg-danger/15 text-danger',
};

function Row({ t }: { t: QueueRow }) {
  return (
    <Link href={`/tickets/${t.id}`} className={cn('group flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 hover:bg-hover', t.awaitingUs && 'bg-warning/5')}>
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-semibold', SEV_BOX[t.severity] ?? SEV_BOX.normal)} title={SEVERITY_LABEL[t.severity]}>{t.title.slice(0, 1).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {t.awaitingUs && <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Aguardando a equipe" />}
          <span className="truncate font-medium text-fg group-hover:text-accent-fg">{t.title}</span>
          {t.hasRecording && <Pill tone="info" className="h-4 shrink-0 px-1.5 text-[10px]">gravação</Pill>}
          {t.errorSignature && <span className="hidden shrink-0 font-mono text-[10px] text-fg-subtle sm:inline" title={`Assinatura ${t.errorSignature}`}>#{t.errorSignature.slice(0, 7)}</span>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-muted">
          <span className="font-mono text-[11px] text-fg-subtle">{t.code}</span>
          <span className="shrink-0 rounded bg-chip px-1.5 font-medium text-fg">{t.product.name}</span>
          <span className="truncate">{t.customer.name ?? t.customer.id} · {t.openedBy ?? '—'}{t.messageCount > 0 ? ` · ${t.messageCount} msg` : ''}</span>
        </div>
      </div>
      <span className="hidden w-28 shrink-0 truncate text-[12px] text-fg-muted lg:block">{t.assignee ?? <span className="text-fg-subtle">sem responsável</span>}</span>
      <span className="hidden shrink-0 md:block"><SeverityPill severity={t.severity} /></span>
      <span className="shrink-0"><StatusPill status={t.status} /></span>
      <span className="hidden w-16 shrink-0 text-right text-[11px] text-fg-subtle sm:block" title={t.updatedAt}>{rel(t.updatedAt)}</span>
    </Link>
  );
}

function Queue() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => params.get(k) ?? '';
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in patch)) next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  };
  const product = get('product');
  const scope = get('status') || 'active';
  const page = Number(get('page') || 1);
  const [search, setSearch] = React.useState(get('q'));
  React.useEffect(() => {
    const id = setTimeout(() => { if (search !== get('q')) set({ q: search }); }, 300);
    return () => clearTimeout(id);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/staff/products') });
  const summary = useQuery({ queryKey: ['summary', product], queryFn: () => api<Summary>('/staff/summary', { params: { productId: product } }), refetchInterval: 60_000 });
  const tickets = useQuery({
    queryKey: ['queue', product, scope, get('severity'), get('signature'), get('q'), get('unanswered'), get('recording'), page],
    queryFn: () => api<Paged<QueueRow>>('/staff/tickets', {
      params: {
        productId: product, status: scope, severity: get('severity'), signature: get('signature'), search: get('q'),
        unanswered: get('unanswered') === '1' ? true : undefined, hasRecording: get('recording') === '1' ? true : undefined, page, pageSize: 30,
      },
    }),
    refetchInterval: 30_000,
  });

  const s = summary.data;
  const firstResponse = minutes(s?.medianFirstResponseMinutes ?? null);
  const pages = tickets.data ? Math.max(1, Math.ceil(tickets.data.total / tickets.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Chamados" subtitle="Todos os sistemas, o que espera a equipe primeiro." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Abertos" value={s?.open ?? '—'} hint="chamados em andamento" />
        <Stat label="Aguardando a equipe" value={s?.unanswered ?? '—'} tone={s && s.unanswered > 0 ? 'warn' : undefined} hint="sem resposta ou com resposta nova" />
        <Stat label="Abertos nesta semana" value={s?.openedThisWeek ?? '—'} hint="últimos 7 dias" />
        <Stat label="1ª resposta" value={firstResponse.value} unit={firstResponse.unit} hint="mediana, 7 dias" />
      </div>

      {s && (
        <div className="mb-6 grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Últimos 14 dias" actions={<span className="text-[12px] text-fg-muted">chamados e erros por dia</span>}>
            <div className="p-4">
              <DailyBars days={s.series.map((d) => d.date)} series={[
                { label: 'Chamados', color: viz(1), values: s.series.map((d) => d.tickets) },
                { label: 'Erros', color: viz(3), values: s.series.map((d) => d.errors) },
              ]} />
            </div>
          </Card>
          <Card title="Chamados por situação">
            <div className="p-4">
              <StackedBar parts={STATUSES.map((st, i) => ({ label: STATUS_LABEL[st], value: s.byStatus[st] ?? 0, color: viz([1, 0, 5, 7, 6, 2][i]) }))} />
            </div>
          </Card>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={product} onChange={(e) => set({ product: e.target.value })}
          options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Select value={scope} onChange={(e) => set({ status: e.target.value === 'active' ? '' : e.target.value })}
          options={[{ value: 'active', label: 'Em aberto' }, { value: 'done', label: 'Concluídos' }, { value: 'all', label: 'Todos' }, ...STATUSES.map((x) => ({ value: x, label: STATUS_LABEL[x] }))]} />
        <Select value={get('severity')} onChange={(e) => set({ severity: e.target.value })}
          options={[{ value: '', label: 'Qualquer urgência' }, ...SEVERITIES.map((x) => ({ value: x, label: SEVERITY_LABEL[x] }))]} />
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted"><input type="checkbox" checked={get('unanswered') === '1'} onChange={(e) => set({ unanswered: e.target.checked ? '1' : '' })} /> Aguardando a equipe</label>
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted"><input type="checkbox" checked={get('recording') === '1'} onChange={(e) => set({ recording: e.target.checked ? '1' : '' })} /> Com gravação</label>
        <Input className="ml-auto w-64" placeholder="Buscar título, código, cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {get('signature') && (
        <div className="mb-3 flex items-center gap-2 text-[13px] text-fg-muted">
          Mesma assinatura de erro <span className="font-mono">{get('signature').slice(0, 12)}</span>
          <Button size="sm" variant="ghost" onClick={() => set({ signature: '' })}>limpar</Button>
        </div>
      )}

      {tickets.isLoading ? (
        <Card><div className="flex flex-col gap-2 p-3">{[1, 2, 3, 4, 5].map((i) => <Shimmer key={i} className="h-11" />)}</div></Card>
      ) : tickets.isError ? (
        <ErrorBox error={tickets.error} onRetry={() => tickets.refetch()} />
      ) : tickets.data && tickets.data.items.length === 0 ? (
        <Card><Empty title={scope === 'active' ? 'Nada em aberto' : 'Nenhum chamado'}>Quando um cliente abrir um chamado em qualquer sistema, ele aparece aqui.</Empty></Card>
      ) : tickets.data ? (
        <>
          <Card>{tickets.data.items.map((t) => <Row key={t.id} t={t} />)}</Card>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-fg-muted">
              <Button size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Anterior</Button>
              <span>Página {page} de {pages} · {tickets.data.total} chamados</span>
              <Button size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Próxima</Button>
            </div>
          )}
        </>
      ) : null}

      {s && s.topSignatures.length > 0 && (
        <Card className="mt-6" title="Bugs com mais chamados abertos">
          <div className="p-4">
            <HBars rows={s.topSignatures.map((g, i) => ({
              label: <Link href={`/?signature=${g.signature}`} className="hover:text-accent-fg"><span className="font-mono text-[12px]">#{g.signature.slice(0, 12)}</span> <span className="text-fg-muted">{products.data?.find((p) => p.id === g.productId)?.name}</span></Link>,
              value: g.tickets, color: viz(i + 3),
              hint: `${g.customers} cliente${g.customers === 1 ? '' : 's'} afetado${g.customers === 1 ? '' : 's'}`,
            }))} />
          </div>
        </Card>
      )}
    </>
  );
}

export default function QueuePage() {
  return <React.Suspense><Queue /></React.Suspense>;
}
