'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, SEVERITIES, STATUSES, type Paged, type Product, type QueueRow, type Summary } from '@/lib/api';
import {
  Button, Card, Check, Empty, ErrorBox, Input, PageHeader, Pill, Select, SeverityPill, Shimmer, StatusPill,
  SEVERITY_LABEL, STATUS_LABEL, rel,
} from '@/components/ui';
import { DailyBars, HBars, Stat, StackedBar, viz } from '@/components/charts';
import { ProductName, ProductStripe } from '@/components/product';

function minutes(m: number | null): { value: string; unit?: string } {
  if (m == null) return { value: '—' };
  if (m < 60) return { value: String(Math.round(m)), unit: 'min' };
  if (m < 60 * 24) return { value: (m / 60).toFixed(1), unit: 'h' };
  return { value: (m / 1440).toFixed(1), unit: 'd' };
}

/** One car on the board: team stripe, title, the facts, the status block. Rows are filled bands with gaps, never lines. */
function Row({ t, i }: { t: QueueRow; i: number }) {
  return (
    <Link href={`/tickets/${t.id}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
      className="rise group flex min-h-16 items-stretch gap-4 bg-surface pr-4 transition-colors duration-150 hover:bg-hover">
      <ProductStripe product={t.product} className="w-1.5" />
      <div className="min-w-0 flex-1 py-3">
        <div className="flex items-center gap-2.5">
          {t.awaitingUs && <span className="size-2.5 shrink-0 bg-accent" title="Aguardando a equipe" />}
          <span className="truncate text-[15px] font-semibold text-fg">{t.title}</span>
          {t.hasRecording && <Pill tone="info" className="h-5 shrink-0 px-1.5">gravação</Pill>}
          {t.errorSignature && <code className="hidden shrink-0 text-fg-subtle sm:inline" title={`Assinatura ${t.errorSignature}`}>#{t.errorSignature.slice(0, 7)}</code>}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px] text-fg-muted">
          <span className="shrink-0 font-semibold tabular-nums text-fg-secondary">{t.code}</span>
          <ProductName product={t.product} className="shrink-0 text-fg-secondary" />
          <span className="truncate">{t.customer.name ?? t.customer.id} · {t.openedBy ?? '—'}{t.messageCount > 0 ? ` · ${t.messageCount} msg` : ''}</span>
        </div>
      </div>
      <span className="hidden w-32 shrink-0 self-center truncate text-[13px] text-fg-secondary lg:block">{t.assignee ?? <span className="text-fg-subtle">sem responsável</span>}</span>
      <span className="hidden w-20 shrink-0 self-center md:block"><SeverityPill severity={t.severity} /></span>
      <span className="shrink-0 self-center"><StatusPill status={t.status} wide /></span>
      <span className="hidden w-24 shrink-0 self-center text-right text-[13px] text-fg-muted sm:block" title={t.updatedAt}>{rel(t.updatedAt)}</span>
    </Link>
  );
}

/** Status colours in STATUSES order: the live ones solid, resolved and closed quiet. */
const STATUS_COLOR = ['var(--ds-info)', 'var(--ds-running)', 'var(--ds-warning)', 'var(--ds-success)', 'color-mix(in srgb, var(--ds-success) 40%, var(--ds-bg-well))', 'var(--ds-border-strong)'];

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
      <PageHeader title="Chamados" subtitle="Todos os sistemas numa fila só. O que espera a equipe vem primeiro, em amarelo." />
      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Aguardando a equipe" value={s?.unanswered ?? '—'} tone={s && s.unanswered > 0 ? 'accent' : undefined} hint="sem resposta ou com resposta nova" style={{ '--i': 0 } as React.CSSProperties} />
        <Stat label="Abertos" value={s?.open ?? '—'} hint="chamados em andamento" style={{ '--i': 1 } as React.CSSProperties} />
        <Stat label="Abertos nesta semana" value={s?.openedThisWeek ?? '—'} hint="últimos 7 dias" style={{ '--i': 2 } as React.CSSProperties} />
        <Stat label="1ª resposta" value={firstResponse.value} unit={firstResponse.unit} hint="mediana, 7 dias" style={{ '--i': 3 } as React.CSSProperties} />
      </div>

      {s && (
        <div className="mb-10 grid gap-2 lg:grid-cols-3">
          <Card className="rise lg:col-span-2" title="Últimos 14 dias" actions={<span className="text-[13px] text-fg-muted">chamados e erros por dia</span>} style={{ '--i': 4 } as React.CSSProperties}>
            <div className="px-5 pt-2 pb-5">
              <DailyBars days={s.series.map((d) => d.date)} series={[
                { label: 'Chamados', color: viz(0), values: s.series.map((d) => d.tickets) },
                { label: 'Erros', color: viz(2), values: s.series.map((d) => d.errors) },
              ]} />
            </div>
          </Card>
          <Card className="rise" title="Chamados por situação" style={{ '--i': 5 } as React.CSSProperties}>
            <div className="px-5 pt-2 pb-5">
              <StackedBar parts={STATUSES.map((st, i) => ({ label: STATUS_LABEL[st], value: s.byStatus[st] ?? 0, color: STATUS_COLOR[i] }))} />
            </div>
          </Card>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select value={product} onChange={(e) => set({ product: e.target.value })}
          options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Select value={scope} onChange={(e) => set({ status: e.target.value === 'active' ? '' : e.target.value })}
          options={[{ value: 'active', label: 'Em aberto' }, { value: 'done', label: 'Concluídos' }, { value: 'all', label: 'Todos' }, ...STATUSES.map((x) => ({ value: x, label: STATUS_LABEL[x] }))]} />
        <Select value={get('severity')} onChange={(e) => set({ severity: e.target.value })}
          options={[{ value: '', label: 'Qualquer urgência' }, ...SEVERITIES.map((x) => ({ value: x, label: SEVERITY_LABEL[x] }))]} />
        <Check checked={get('unanswered') === '1'} onChange={(v) => set({ unanswered: v ? '1' : '' })}>Aguardando a equipe</Check>
        <Check checked={get('recording') === '1'} onChange={(v) => set({ recording: v ? '1' : '' })}>Com gravação</Check>
        <Input className="w-full sm:w-auto sm:min-w-56 sm:flex-1" placeholder="Buscar título, código, cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {get('signature') && (
        <div className="mb-2 flex items-center gap-3 bg-surface px-4 py-2 text-[14px] text-fg-secondary">
          Mesma assinatura de erro <code className="text-fg">{get('signature').slice(0, 12)}</code>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set({ signature: '' })}>Limpar filtro</Button>
        </div>
      )}

      {tickets.isLoading ? (
        <div className="flex flex-col gap-1">{[1, 2, 3, 4, 5].map((i) => <Shimmer key={i} className="h-16" />)}</div>
      ) : tickets.isError ? (
        <ErrorBox error={tickets.error} onRetry={() => tickets.refetch()} />
      ) : tickets.data && tickets.data.items.length === 0 ? (
        <Card><Empty title={scope === 'active' ? 'Pista livre.' : 'Nenhum chamado.'}>Quando um cliente abrir um chamado em qualquer sistema, ele aparece aqui.</Empty></Card>
      ) : tickets.data ? (
        <>
          <div className="flex flex-col gap-1">{tickets.data.items.map((t, i) => <Row key={t.id} t={t} i={i} />)}</div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-3 text-[13px] text-fg-muted">
              <Button size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Anterior</Button>
              <span className="tabular-nums">Página {page} de {pages} · {tickets.data.total} chamados</span>
              <Button size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Próxima</Button>
            </div>
          )}
        </>
      ) : null}

      {s && s.topSignatures.length > 0 && (
        <Card className="mt-10" title="Bugs com mais chamados abertos">
          <div className="px-5 pt-2 pb-5">
            <HBars rows={s.topSignatures.map((g, i) => ({
              label: <Link href={`/?signature=${g.signature}`} className="hover:text-accent-fg"><code>#{g.signature.slice(0, 12)}</code> <span className="text-fg-muted">{products.data?.find((p) => p.id === g.productId)?.name}</span></Link>,
              value: g.tickets, color: i === 0 ? viz(2) : 'var(--ds-border-strong)',
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
