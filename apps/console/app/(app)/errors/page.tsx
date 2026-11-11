'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type ErrorGroup, type Product, type ServerErrorRow } from '@/lib/api';
import { Stat } from '@/components/charts';
import { ProductMark, ProductName } from '@/components/product';
import { Card, Empty, ErrorBox, IconChevron, PageHeader, Pill, Segmented, Select, Shimmer, cn, dateTime, rel } from '@/components/ui';

function Occurrences({ signature, product }: { signature: string; product: string }) {
  const q = useQuery({
    queryKey: ['errors', signature, product],
    queryFn: () => api<{ items: ServerErrorRow[] }>('/staff/errors', { params: { signature, productId: product, days: 30, limit: 50 } }),
  });
  const [open, setOpen] = React.useState<string | null>(null);
  if (q.isLoading) return <Shimmer className="my-3 h-24" />;
  if (!q.data) return null;
  return (
    <div className="fade-in mb-3 rounded-tile bg-well py-1">
      {q.data.items.map((e) => (
        <div key={e.id}>
          <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-center gap-4 rounded-tile px-4 py-2 text-left text-[13px] transition-colors hover:bg-hover">
            <IconChevron open={open === e.id} />
            <span className="w-40 shrink-0 tabular-nums text-fg-muted">{dateTime(e.occurredAt)}</span>
            <span className="w-10 shrink-0 font-semibold tabular-nums text-danger">{e.statusCode}</span>
            <code className="truncate text-fg-secondary">{e.method} {e.path}</code>
            <span className="ml-auto shrink-0 text-fg-muted">cliente {e.customerRef ?? '—'}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-fg-subtle">{e.release ?? ''}</span>
          </button>
          {open === e.id && (
            <pre className="fade-in mx-4 mb-3 max-h-80 overflow-auto rounded-tile bg-surface p-4 text-[12.5px] leading-relaxed whitespace-pre-wrap break-all text-fg-secondary">
              trace {e.traceId}{'\n'}{e.stackTrace ?? e.message}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

const DAYS = [{ value: '1', label: 'Últimas 24h' }, { value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }];
const DAY = 24 * 60 * 60 * 1000;

function Errors() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const product = params.get('product') ?? '';
  const days = params.get('days') ?? '7';
  const [expanded, setExpanded] = React.useState<string | null>(params.get('signature'));
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); router.replace(`${pathname}?${n}`); };

  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/staff/products') });
  const groups = useQuery({
    queryKey: ['error-groups', product, days],
    queryFn: () => api<ErrorGroup[]>('/staff/errors/groups', { params: { productId: product, days } }),
    refetchInterval: 60_000,
  });

  const total = (groups.data ?? []).reduce((a, g) => a + g.count, 0);
  const orphan = (groups.data ?? []).filter((g) => g.tickets.total === 0).length;

  return (
    <>
      <PageHeader
        title="Erros"
        subtitle="A telemetria: exceções não tratadas que os sistemas reportaram, agrupadas pelo mesmo bug."
        actions={(
          <>
            <Select value={product} onChange={(e) => set('product', e.target.value)} options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            <Segmented value={days} onChange={(v) => set('days', v)} options={DAYS} />
          </>
        )}
      />
      {groups.data && groups.data.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sem chamado" value={orphan} tone={orphan > 0 ? 'accent' : undefined} hint="ninguém reclamou ainda" />
          <Stat label="Bugs distintos" value={groups.data.length} hint="agrupados por assinatura" />
          <Stat label="Ocorrências" value={total} tone={total > 0 ? 'danger' : undefined} hint={`últimos ${days} dia${days === '1' ? '' : 's'}`} />
          <Stat label="Mais frequente" value={groups.data[0].count} unit="vezes" hint={groups.data[0].sample?.exceptionType.split('.').pop()} />
        </div>
      )}
      {groups.isLoading ? (
        <Card className="px-5 pb-5"><div className="flex flex-col gap-2">{[1, 2, 3, 4].map((i) => <Shimmer key={i} className="h-[64px]" />)}</div></Card>
      ) : groups.isError ? <ErrorBox error={groups.error} onRetry={() => groups.refetch()} />
        : groups.data && groups.data.length === 0 ? <Card><Empty title="Sem erros no período.">Os sistemas reportam 5xx pelo pacote Pitwall, com uma chave de escopo “errors”.</Empty></Card>
        : (
          <Card>
            <div className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
              {groups.data?.map((g) => {
                const open = expanded === g.signature;
                const hot = Date.now() - new Date(g.lastSeen).getTime() < DAY;
                return (
                  <div key={g.signature}>
                    <button onClick={() => setExpanded(open ? null : g.signature)} aria-expanded={open}
                      className="-mx-2 flex min-h-[64px] w-[calc(100%+1rem)] items-center gap-4 rounded-tile px-2 py-3 text-left transition-colors duration-150 hover:bg-hover">
                      <ProductMark product={g.product} size={32} className="hidden sm:inline-flex" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <IconChevron open={open} />
                          <span className="truncate text-[14px] font-medium text-fg">{g.sample?.exceptionType.split('.').pop()}: <span className="font-normal text-fg-secondary">{g.sample?.message}</span></span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-6 text-[13px] text-fg-muted">
                          <code className="shrink-0 text-fg-secondary">{g.sample?.method} {g.sample?.route} #{g.signature.slice(0, 12)}</code>
                          <span aria-hidden>·</span>
                          <ProductName product={g.product} className="shrink-0 text-fg-secondary" />
                          <span aria-hidden>·</span>
                          <span className="truncate" title={`primeira vez ${dateTime(g.firstSeen)}`}>{rel(g.lastSeen)}</span>
                        </div>
                      </div>
                      <span className={cn('w-12 shrink-0 text-right text-[14px] tabular-nums', hot ? 'font-semibold text-danger' : 'text-fg')}>{g.count}</span>
                      <span className="hidden w-20 shrink-0 text-right text-[14px] tabular-nums text-fg md:block">
                        {g.customers}<span className="ml-1 text-[13px] text-fg-muted">cliente{g.customers === 1 ? '' : 's'}</span>
                      </span>
                      <span className="flex w-28 shrink-0 items-center justify-end">
                        {g.tickets.total > 0
                          ? <Link onClick={(e) => e.stopPropagation()} href={`/?signature=${g.signature}&status=all`} className="transition-opacity hover:opacity-80"><Pill tone={g.tickets.open > 0 ? 'warn' : 'ok'}>{g.tickets.total} chamado{g.tickets.total > 1 ? 's' : ''}</Pill></Link>
                          : <Pill>sem chamado</Pill>}
                      </span>
                      <span className="hidden w-24 shrink-0 text-right text-[13px] text-fg-muted lg:block" title={`primeira vez ${dateTime(g.firstSeen)}`}>{rel(g.lastSeen)}</span>
                    </button>
                    {open && <Occurrences signature={g.signature} product={g.product?.id ?? ''} />}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
    </>
  );
}

export default function ErrorsPage() {
  return <React.Suspense><Errors /></React.Suspense>;
}
