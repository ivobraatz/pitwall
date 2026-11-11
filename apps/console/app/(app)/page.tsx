'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, SEVERITIES, STATUSES, type Paged, type Product, type QueueRow, type Summary } from '@/lib/api';
import {
  Avatar, Button, Card, Check, Empty, ErrorBox, IconArrow, PageHeader, Pill, SearchInput, Segmented, Select, SeverityPill, Shimmer,
  StatusPill, SEVERITY_LABEL, STATUS_DOT, STATUS_LABEL, cn, rel,
} from '@/components/ui';
import { DailyBars, HBars, Stat, StageTiles, viz } from '@/components/charts';
import { ProductMark } from '@/components/product';

function minutes(m: number | null): { value: string; unit?: string } {
  if (m == null) return { value: '—' };
  if (m < 60) return { value: String(Math.round(m)), unit: 'min' };
  if (m < 60 * 24) return { value: (m / 60).toFixed(1).replace('.', ','), unit: 'h' };
  return { value: (m / 1440).toFixed(1).replace('.', ','), unit: 'd' };
}

/**
 * One ticket: the system's badge, the title over its facts, then fixed slots that line up as columns
 * (who has it, urgency only above normal, the state, the last move). Rows are split by a faint rule.
 */
function Row({ t }: { t: QueueRow }) {
  const loud = t.severity === 'high' || t.severity === 'critical';
  return (
    <Link href={`/tickets/${t.id}`}
      className="group -mx-2 flex min-h-[68px] items-center gap-4 rounded-tile px-2 py-3 transition-colors duration-150 hover:bg-hover">
      <ProductMark product={t.product} size={36} className="hidden sm:inline-flex" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {t.awaitingUs && <span className="size-2 shrink-0 rounded-full bg-accent ring-1 ring-fg/25" title="Aguardando a equipe" />}
          <span className={cn('truncate text-[14px] text-fg', t.awaitingUs ? 'font-semibold' : 'font-medium')}>{t.title}</span>
          {t.hasRecording && <Pill tone="info" className="h-5 px-2 text-[11px]">gravação</Pill>}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
          <span className="shrink-0 font-medium tabular-nums text-fg-secondary">{t.code}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 text-fg-secondary">{t.product.name}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{t.customer.name ?? t.customer.id}{t.openedBy ? ` · ${t.openedBy}` : ''}{t.messageCount > 0 ? ` · ${t.messageCount} msg` : ''}</span>
        </div>
      </div>
      <span className="hidden w-40 shrink-0 items-center gap-2 truncate text-[13px] lg:flex">
        {t.assignee ? <><Avatar name={t.assignee} size={24} /><span className="truncate text-fg-secondary">{t.assignee}</span></> : <span className="text-fg-subtle">Sem responsável</span>}
      </span>
      <span className="hidden w-20 shrink-0 md:block">{loud && <SeverityPill severity={t.severity} />}</span>
      <span className="shrink-0"><StatusPill status={t.status} wide /></span>
      <span className="hidden w-24 shrink-0 text-right text-[13px] text-fg-muted sm:block" title={t.updatedAt}>{rel(t.updatedAt)}</span>
    </Link>
  );
}

const SCOPES = [{ value: 'active', label: 'Em aberto' }, { value: 'done', label: 'Concluídos' }, { value: 'all', label: 'Todos' }] as const;
const ACTIVE = ['open', 'in_progress', 'waiting_customer', 'fixed_pending_deploy'];

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
  const scoped = products.data?.find((p) => p.id === product);
  const systems = s?.products ?? [];
  const errors24h = systems.reduce((a, p) => a + p.errors24h, 0);
  const open = s ? ACTIVE.reduce((a, st) => a + (s.byStatus[st] ?? 0), 0) : 0;
  const next = tickets.data?.items.find((t) => t.awaitingUs);
  const scopeLabel = scoped ? scoped.name : 'todos os sistemas';
  const segment = SCOPES.some((x) => x.value === scope) ? scope : '';

  // The finding, first: who is waiting on the team, then the rest of what is open.
  const finding = !s ? 'Carregando a fila…'
    : s.unanswered > 0
      ? `${s.unanswered} ${s.unanswered === 1 ? 'chamado espera' : 'chamados esperam'} a equipe · ${open} em aberto em ${scopeLabel}`
      : open > 0 ? `Ninguém esperando a equipe · ${open} em aberto em ${scopeLabel}` : `Pista livre em ${scopeLabel}.`;

  return (
    <>
      <PageHeader
        title={scoped ? <span className="inline-flex items-center gap-3"><ProductMark product={scoped} size={32} />{scoped.name}</span> : 'Chamados'}
        subtitle={finding}
        actions={<>
          <SearchInput className="w-full sm:w-64" placeholder="Buscar título, código, cliente…" aria-label="Buscar chamados" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label="Sistema" value={product} onChange={(e) => set({ product: e.target.value })}
            options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          {next && (
            <Link href={`/tickets/${next.id}`} className="inline-flex h-10 items-center gap-2 rounded-full bg-btn px-5 text-[14px] font-semibold text-btn-fg transition-colors hover:bg-btn-hover">
              Responder o próximo <IconArrow />
            </Link>
          )}
        </>}
      />

      {/* The numbers that are not in the pipeline below: what waits on us, this week, how fast, what broke. */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aguardando a equipe" value={s?.unanswered ?? '—'} tone={s && s.unanswered > 0 ? 'accent' : undefined} hint="sem resposta ou com resposta nova" />
        <Stat label="Abertos nesta semana" value={s?.openedThisWeek ?? '—'} hint="últimos 7 dias" />
        <Stat label="Primeira resposta" value={firstResponse.value} unit={firstResponse.unit} hint="mediana, 7 dias" />
        <Stat label="Erros nas últimas 24h" value={s ? errors24h : '—'} tone={errors24h > 0 ? 'danger' : undefined}
          hint={s ? (errors24h > 0 ? <Link href="/errors" className="underline-offset-2 hover:underline">ver erros</Link> : 'nenhum 5xx') : undefined} />
      </div>

      {/* The pipeline: each state with its count; choosing one filters the queue. */}
      <Card className="mb-3" title="Situação dos chamados" subtitle={`do aberto ao fechado · ${scopeLabel}`}
        actions={<Segmented label="Escopo da fila" value={segment as 'active' | 'done' | 'all'} onChange={(v) => set({ status: v === 'active' ? '' : v })}
          options={SCOPES.map((x) => ({ value: x.value, label: x.label }))} />}>
        <div className="px-3 pb-3">
          {s ? (
            <StageTiles selected={STATUSES.includes(scope as never) ? scope : null}
              onSelect={(k) => set({ status: scope === k ? '' : k })}
              stages={STATUSES.map((st) => ({ key: st, label: STATUS_LABEL[st], value: s.byStatus[st] ?? 0, dot: STATUS_DOT[st] }))} />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{STATUSES.map((st) => <Shimmer key={st} className="h-[176px]" />)}</div>
          )}
        </div>
      </Card>

      {/* The queue itself. */}
      <Card className="mb-3"
        title={STATUSES.includes(scope as never) ? STATUS_LABEL[scope] : scope === 'done' ? 'Concluídos' : scope === 'all' ? 'Todos os chamados' : 'Fila'}
        subtitle={tickets.data ? `${tickets.data.total} ${tickets.data.total === 1 ? 'chamado' : 'chamados'} · o que espera a equipe vem primeiro` : undefined}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Check checked={get('unanswered') === '1'} onChange={(v) => set({ unanswered: v ? '1' : '' })}>Aguardando a equipe</Check>
          <Check checked={get('recording') === '1'} onChange={(v) => set({ recording: v ? '1' : '' })}>Com gravação</Check>
          <Select aria-label="Urgência" value={get('severity')} onChange={(e) => set({ severity: e.target.value })}
            options={[{ value: '', label: 'Qualquer urgência' }, ...SEVERITIES.map((x) => ({ value: x, label: SEVERITY_LABEL[x] }))]} />
        </div>}>
        <div className="px-5 pb-3">
          {get('signature') && (
            <div className="mb-2 flex items-center gap-3 rounded-tile bg-well px-4 py-2 text-[14px] text-fg-secondary">
              Mesma assinatura de erro <code className="text-fg">{get('signature').slice(0, 12)}</code>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set({ signature: '' })}>Limpar filtro</Button>
            </div>
          )}
          {tickets.isLoading ? (
            <div className="flex flex-col gap-2 pb-2">{[1, 2, 3, 4, 5].map((i) => <Shimmer key={i} className="h-[60px]" />)}</div>
          ) : tickets.isError ? (
            <div className="pb-2"><ErrorBox error={tickets.error} onRetry={() => tickets.refetch()} /></div>
          ) : tickets.data && tickets.data.items.length === 0 ? (
            <Empty title={scope === 'active' ? 'Pista livre.' : 'Nenhum chamado.'}>Quando um cliente abrir um chamado em qualquer sistema, ele aparece aqui.</Empty>
          ) : tickets.data ? (
            <>
              <div className="hidden items-center gap-4 pb-1 text-[12px] text-fg-subtle lg:flex">
                <span className="w-9 shrink-0" /><span className="flex-1">Chamado</span>
                <span className="w-40 shrink-0">Responsável</span><span className="w-20 shrink-0">Urgência</span>
                <span className="w-[168px] shrink-0">Situação</span><span className="w-24 shrink-0 text-right">Atualizado</span>
              </div>
              <div className="flex flex-col divide-y divide-border-subtle">{tickets.data.items.map((t) => <Row key={t.id} t={t} />)}</div>
              {pages > 1 && (
                <div className="mt-2 flex items-center justify-end gap-3 border-t border-border-subtle pt-3 text-[13px] text-fg-muted">
                  <span className="tabular-nums">Página {page} de {pages}</span>
                  <Button size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Anterior</Button>
                  <Button size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Próxima</Button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </Card>

      {s && (
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Últimos 14 dias" subtitle="chamados abertos e erros 5xx por dia">
            <div className="px-5 pt-1 pb-5">
              <DailyBars days={s.series.map((d) => d.date)} series={[
                { label: 'Chamados', color: viz(0), values: s.series.map((d) => d.tickets) },
                { label: 'Erros', color: viz(2), values: s.series.map((d) => d.errors) },
              ]} />
            </div>
          </Card>
          {s.topSignatures.length > 0 ? (
            <Card title="Bugs com mais chamados" subtitle="mesma assinatura de erro, chamados abertos">
              <div className="px-5 pt-1 pb-5">
                <HBars rows={s.topSignatures.slice(0, 5).map((g, i) => ({
                  label: <Link href={`/?signature=${g.signature}`} className="hover:underline"><code>#{g.signature.slice(0, 10)}</code> <span className="text-fg-muted">{products.data?.find((p) => p.id === g.productId)?.name}</span></Link>,
                  value: g.tickets, color: i === 0 ? 'var(--ds-danger)' : 'var(--ds-border-loud)',
                  hint: `${g.customers} cliente${g.customers === 1 ? '' : 's'} afetado${g.customers === 1 ? '' : 's'}`,
                }))} />
              </div>
            </Card>
          ) : (
            <Card title="Na pista" subtitle="abertos e erros nas últimas 24h, por sistema">
              <div className="flex flex-col px-3 pb-3">
                {systems.slice(0, 6).map((p) => (
                  <Link key={p.id} href={`/?product=${p.id}`} className="flex h-11 items-center gap-3 rounded-xl px-2 text-[14px] hover:bg-hover">
                    <ProductMark product={p} size={28} />
                    <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                    {p.awaitingUs > 0 && <span className="size-2 rounded-full bg-accent ring-1 ring-fg/25" title="Aguardando a equipe" />}
                    <span className="w-8 text-right tabular-nums text-fg">{p.open}</span>
                    <span className={cn('w-8 text-right tabular-nums', p.errors24h > 0 ? 'font-semibold text-danger' : 'text-fg-subtle')}>{p.errors24h}</span>
                  </Link>
                ))}
                {systems.length > 6 && <Link href="/products" className="mt-1 px-2 text-[13px] font-medium text-fg-muted hover:text-fg">Ver os {systems.length} sistemas</Link>}
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

export default function QueuePage() {
  return <React.Suspense><Queue /></React.Suspense>;
}
