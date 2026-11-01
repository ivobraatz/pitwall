'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, type Paged, type Product, type ReleaseRow } from '@/lib/api';
import { ProductName, ProductStripe } from '@/components/product';
import { Card, Empty, ErrorBox, PageHeader, Pill, Select, Shimmer, dateTime } from '@/components/ui';

const STATUS: Record<string, { label: string; tone: string }> = {
  published: { label: 'Publicada', tone: 'ok' },
  draft: { label: 'Rascunho', tone: 'accent' },
  silent: { label: 'Sem nota', tone: 'idle' },
};

export default function ReleasesPage() {
  const [product, setProduct] = React.useState('');
  const [status, setStatus] = React.useState('');
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/staff/products') });
  const releases = useQuery({
    queryKey: ['releases', product, status],
    queryFn: () => api<Paged<ReleaseRow>>('/staff/releases', { params: { productId: product, status } }),
  });

  return (
    <>
      <PageHeader
        title="Novidades"
        subtitle="O boletim: notas de versão que o Haiku escreve a partir dos commits. Rascunhos esperam revisão; as publicadas vão para o changelog público e para o sino do produto."
        actions={(
          <>
            <Select value={product} onChange={(e) => setProduct(e.target.value)} options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Qualquer situação' }, { value: 'draft', label: 'Rascunhos' }, { value: 'published', label: 'Publicadas' }, { value: 'silent', label: 'Sem nota' }]} />
          </>
        )}
      />
      {releases.isLoading ? <div className="flex flex-col gap-1">{[1, 2, 3, 4].map((i) => <Shimmer key={i} className="h-20" />)}</div>
        : releases.isError ? <ErrorBox error={releases.error} />
        : releases.data && releases.data.items.length === 0
          ? <Card><Empty title="Nenhuma versão ainda.">Ligue a action “release-notes” no repositório de cada sistema (veja docs/operacao/integracao.md).</Empty></Card>
          : (
            <div className="flex flex-col gap-1">
              {releases.data?.items.map((r, i) => {
                const pt = r.notes.find((n) => n.locale === 'pt') ?? r.notes[0];
                return (
                  <Link key={r.id} href={`/releases/${r.id}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}
                    className="rise group grid min-h-20 grid-cols-[6px_110px_minmax(0,1fr)_auto] items-center gap-5 bg-surface pr-5 transition-colors duration-150 hover:bg-hover md:grid-cols-[6px_150px_minmax(0,1fr)_auto_170px]">
                    <ProductStripe product={r.product} className="h-full" />
                    <span className="display truncate text-[24px] tabular-nums text-fg md:text-[30px]">{r.version}</span>
                    <div className="min-w-0 py-3">
                      <div className="truncate text-[15px] font-semibold text-fg">{pt?.title ?? <span className="font-normal text-fg-subtle">Sem nota para clientes</span>}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted"><ProductName product={r.product} className="shrink-0 text-fg-secondary" /><span className="truncate">· {r.commits} commits{r.tickets.length > 0 && ` · resolveu ${r.tickets.join(', ')}`}</span></div>
                    </div>
                    <Pill tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Pill>
                    <span className="hidden text-right text-[13px] tabular-nums text-fg-muted md:block">{dateTime(r.publishedAt ?? r.createdAt)}</span>
                  </Link>
                );
              })}
            </div>
          )}
    </>
  );
}
