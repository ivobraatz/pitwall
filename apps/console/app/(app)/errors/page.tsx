'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type ErrorGroup, type Product, type ServerErrorRow } from '@/lib/api';
import { Stat, viz } from '@/components/charts';
import { Card, Empty, ErrorBox, PageHeader, Pill, Select, Shimmer, cn, dateTime, rel } from '@/components/ui';

function Occurrences({ signature, product }: { signature: string; product: string }) {
  const q = useQuery({
    queryKey: ['errors', signature, product],
    queryFn: () => api<{ items: ServerErrorRow[] }>('/staff/errors', { params: { signature, productId: product, days: 30, limit: 50 } }),
  });
  const [open, setOpen] = React.useState<string | null>(null);
  if (q.isLoading) return <Shimmer className="m-3 h-24" />;
  if (!q.data) return null;
  return (
    <div className="border-t border-border bg-bg">
      {q.data.items.map((e) => (
        <div key={e.id} className="border-b border-border last:border-0">
          <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-center gap-3 px-4 py-1.5 text-left font-mono text-[11px] hover:bg-hover">
            <span className="text-fg-subtle">{dateTime(e.occurredAt)}</span>
            <span className="text-danger">{e.statusCode}</span>
            <span className="truncate text-fg-muted">{e.method} {e.path}</span>
            <span className="ml-auto text-fg-subtle">cliente {e.customerRef ?? '—'}</span>
            <span className="text-fg-subtle">{e.release ?? ''}</span>
          </button>
          {open === e.id && (
            <pre className="max-h-80 overflow-auto px-4 pb-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-fg-muted">
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

  return (
    <>
      <PageHeader title="Erros" subtitle="Exceções não tratadas que os sistemas reportaram, agrupadas pelo mesmo bug." />
      <div className="mb-3 flex gap-2">
        <Select value={product} onChange={(e) => set('product', e.target.value)} options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Select value={days} onChange={(e) => set('days', e.target.value)} options={[{ value: '1', label: 'Últimas 24h' }, { value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }]} />
      </div>
      {groups.data && groups.data.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Bugs distintos" value={groups.data.length} hint="agrupados por assinatura" />
          <Stat label="Ocorrências" value={total} hint={`últimos ${days} dia${days === '1' ? '' : 's'}`} />
          <Stat label="Sem chamado" value={groups.data.filter((g) => g.tickets.total === 0).length} tone={groups.data.some((g) => g.tickets.total === 0) ? 'warn' : undefined} hint="ninguém reclamou ainda" />
          <Stat label="Mais frequente" value={groups.data[0].count} unit="vezes" hint={groups.data[0].sample?.exceptionType.split('.').pop()} />
        </div>
      )}
      {groups.isLoading ? <Shimmer className="h-64" /> : groups.isError ? <ErrorBox error={groups.error} onRetry={() => groups.refetch()} />
        : groups.data && groups.data.length === 0 ? <Card><Empty title="Nenhum erro no período">Os sistemas reportam 5xx pelo pacote Pitwall (escopo “errors”).</Empty></Card>
        : (
          <Card>
            {groups.data?.map((g) => (
              <div key={g.signature} className="border-b border-border-subtle last:border-0">
                <button onClick={() => setExpanded(expanded === g.signature ? null : g.signature)} className={cn('grid w-full grid-cols-[minmax(0,1fr)_110px_80px_110px_110px] items-center gap-3 px-4 py-3 text-left hover:bg-hover', expanded === g.signature && 'bg-hover')}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {g.product && <span className="rounded bg-chip px-1.5 text-[12px] font-medium">{g.product.name}</span>}
                      <span className="truncate font-medium">{g.sample?.exceptionType.split('.').pop()}: {g.sample?.message}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">{g.sample?.method} {g.sample?.route} · #{g.signature.slice(0, 12)}{g.sample?.release ? ` · ${g.sample.release}` : ''}</div>
                  </div>
                  <div className="text-right"><div className="font-semibold tabular-nums text-fg">{g.count}</div><div className="mt-1 h-1 overflow-hidden rounded-full bg-chip"><div className="h-full rounded-full" style={{ width: `${(g.count / peak) * 100}%`, background: viz(3) }} /></div></div>
                  <div className="text-right"><div className="font-semibold tabular-nums text-fg">{g.customers}</div><div className="text-[11px] text-fg-muted">cliente{g.customers === 1 ? '' : 's'}</div></div>
                  <div className="text-right">
                    {g.tickets.total > 0
                      ? <Link onClick={(e) => e.stopPropagation()} href={`/?signature=${g.signature}&status=all`}><Pill tone={g.tickets.open > 0 ? 'warn' : 'ok'}>{g.tickets.total} chamado{g.tickets.total > 1 ? 's' : ''}</Pill></Link>
                      : <Pill>sem chamado</Pill>}
                  </div>
                  <div className="text-right text-[12px] text-fg-muted" title={`primeira vez ${dateTime(g.firstSeen)}`}>{rel(g.lastSeen)}</div>
                </button>
                {expanded === g.signature && <Occurrences signature={g.signature} product={g.product?.id ?? ''} />}
              </div>
            ))}
          </Card>
        )}
    </>
  );
}

export default function ErrorsPage() {
  return <React.Suspense><Errors /></React.Suspense>;
}
