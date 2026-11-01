'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type ErrorGroup, type Product, type ServerErrorRow } from '@/lib/api';
import { Stat } from '@/components/charts';
import { ProductName, ProductStripe } from '@/components/product';
import { Card, Empty, ErrorBox, IconChevron, PageHeader, Pill, Select, Shimmer, cn, dateTime, rel } from '@/components/ui';

function Occurrences({ signature, product }: { signature: string; product: string }) {
  const q = useQuery({
    queryKey: ['errors', signature, product],
    queryFn: () => api<{ items: ServerErrorRow[] }>('/staff/errors', { params: { signature, productId: product, days: 30, limit: 50 } }),
  });
  const [open, setOpen] = React.useState<string | null>(null);
  if (q.isLoading) return <Shimmer className="h-24 bg-well" />;
  if (!q.data) return null;
  return (
    <div className="fade-in bg-well py-1">
      {q.data.items.map((e) => (
        <div key={e.id}>
          <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-center gap-4 px-5 py-2 text-left text-[13px] transition-colors hover:bg-hover">
            <IconChevron open={open === e.id} />
            <span className="w-40 shrink-0 tabular-nums text-fg-muted">{dateTime(e.occurredAt)}</span>
            <span className="w-10 shrink-0 font-semibold tabular-nums text-danger">{e.statusCode}</span>
            <code className="truncate text-fg-secondary">{e.method} {e.path}</code>
            <span className="ml-auto shrink-0 text-fg-muted">cliente {e.customerRef ?? '—'}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-fg-subtle">{e.release ?? ''}</span>
          </button>
          {open === e.id && (
            <pre className="fade-in max-h-80 overflow-auto px-12 pb-4 leading-relaxed whitespace-pre-wrap break-all text-fg-secondary">
              trace {e.traceId}{'\n'}{e.stackTrace ?? e.message}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

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
  const peak = Math.max(1, ...(groups.data ?? []).map((g) => g.count));
  const orphan = (groups.data ?? []).filter((g) => g.tickets.total === 0).length;

  return (
    <>
      <PageHeader
        title="Erros"
        subtitle="A telemetria: exceções não tratadas que os sistemas reportaram, agrupadas pelo mesmo bug."
        actions={(
          <>
            <Select value={product} onChange={(e) => set('product', e.target.value)} options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            <Select value={days} onChange={(e) => set('days', e.target.value)} options={[{ value: '1', label: 'Últimas 24h' }, { value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }]} />
          </>
        )}
      />
      {groups.data && groups.data.length > 0 && (
        <div className="mb-10 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Sem chamado" value={orphan} tone={orphan > 0 ? 'accent' : undefined} hint="ninguém reclamou ainda" style={{ '--i': 0 } as React.CSSProperties} />
          <Stat label="Bugs distintos" value={groups.data.length} hint="agrupados por assinatura" style={{ '--i': 1 } as React.CSSProperties} />
          <Stat label="Ocorrências" value={total} hint={`últimos ${days} dia${days === '1' ? '' : 's'}`} style={{ '--i': 2 } as React.CSSProperties} />
          <Stat label="Mais frequente" value={groups.data[0].count} unit="vezes" hint={groups.data[0].sample?.exceptionType.split('.').pop()} style={{ '--i': 3 } as React.CSSProperties} />
        </div>
      )}
      {groups.isLoading ? <div className="flex flex-col gap-1">{[1, 2, 3, 4].map((i) => <Shimmer key={i} className="h-[72px]" />)}</div>
        : groups.isError ? <ErrorBox error={groups.error} onRetry={() => groups.refetch()} />
        : groups.data && groups.data.length === 0 ? <Card><Empty title="Sem erros no período.">Os sistemas reportam 5xx pelo pacote Pitwall, com uma chave de escopo “errors”.</Empty></Card>
        : (
          <div className="flex flex-col gap-1">
            {groups.data?.map((g, i) => {
              const open = expanded === g.signature;
              return (
                <div key={g.signature} className="rise" style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
                  <button onClick={() => setExpanded(open ? null : g.signature)} aria-expanded={open}
                    className={cn('grid min-h-[72px] w-full grid-cols-[6px_minmax(0,1fr)_auto] items-stretch gap-4 pr-5 text-left transition-colors duration-150 md:grid-cols-[6px_minmax(0,1fr)_150px_90px_140px_110px]', open ? 'bg-active' : 'bg-surface hover:bg-hover')}>
                    <ProductStripe product={g.product} />
                    <div className="min-w-0 py-3">
                      <div className="flex items-center gap-2.5">
                        <IconChevron open={open} />
                        <span className="truncate text-[15px] font-semibold text-fg">{g.sample?.exceptionType.split('.').pop()}: <span className="font-normal text-fg-secondary">{g.sample?.message}</span></span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 pl-6 text-[13px] text-fg-muted">
                        <ProductName product={g.product} className="shrink-0 text-fg-secondary" />
                        <code className="truncate">{g.sample?.method} {g.sample?.route} #{g.signature.slice(0, 12)}</code>{g.sample?.release && <span className="shrink-0 tabular-nums">{g.sample.release}</span>}
                      </div>
                    </div>
                    <div className="hidden flex-col justify-center gap-1.5 md:flex">
                      <span className="display text-[26px] tabular-nums text-fg">{g.count}</span>
                      <span className="h-1.5 bg-well"><span className="grow-x block h-full bg-danger" style={{ width: `${(g.count / peak) * 100}%` }} /></span>
                    </div>
                    <div className="hidden flex-col justify-center text-right md:flex"><span className="text-[15px] font-semibold tabular-nums text-fg">{g.customers}</span><span className="text-[13px] text-fg-muted">cliente{g.customers === 1 ? '' : 's'}</span></div>
                    <div className="flex items-center justify-end">
                      {g.tickets.total > 0
                        ? <Link onClick={(e) => e.stopPropagation()} href={`/?signature=${g.signature}&status=all`} className="transition-opacity hover:opacity-80"><Pill tone={g.tickets.open > 0 ? 'warn' : 'ok'}>{g.tickets.total} chamado{g.tickets.total > 1 ? 's' : ''}</Pill></Link>
                        : <Pill>sem chamado</Pill>}
                    </div>
                    <div className="hidden items-center justify-end text-[13px] text-fg-muted md:flex" title={`primeira vez ${dateTime(g.firstSeen)}`}>{rel(g.lastSeen)}</div>
                  </button>
                  {open && <Occurrences signature={g.signature} product={g.product?.id ?? ''} />}
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}

export default function ErrorsPage() {
  return <React.Suspense><Errors /></React.Suspense>;
}
