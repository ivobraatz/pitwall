'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, type Paged, type Product, type ReleaseRow } from '@/lib/api';
import { ProductMark, ProductName } from '@/components/product';
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
      {releases.isLoading ? (
        <Card className="px-5 pb-5"><div className="flex flex-col gap-2">{[1, 2, 3, 4].map((i) => <Shimmer key={i} className="h-[64px]" />)}</div></Card>
      ) : releases.isError ? <ErrorBox error={releases.error} />
        : releases.data && releases.data.items.length === 0
          ? <Card><Empty title="Nenhuma versão ainda.">Ligue a action “release-notes” no repositório de cada sistema (veja docs/operacao/integracao.md).</Empty></Card>
          : (
            <Card>
              <div className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
                {releases.data?.items.map((r) => {
                  const pt = r.notes.find((n) => n.locale === 'pt') ?? r.notes[0];
                  return (
                    <Link key={r.id} href={`/releases/${r.id}`}
                      className="group -mx-2 flex min-h-[64px] items-center gap-4 rounded-tile px-2 py-3 transition-colors duration-150 hover:bg-hover">
                      <ProductMark product={r.product} size={32} className="hidden sm:inline-flex" />
                      <code className="w-24 shrink-0 truncate text-[13px] font-semibold text-fg">{r.version}</code>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-fg">{pt?.title ?? <span className="font-normal text-fg-subtle">Sem nota para clientes</span>}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
                          <ProductName product={r.product} className="shrink-0 text-fg-secondary" />
                          <span className="truncate">· {r.commits} commits{r.tickets.length > 0 && ` · resolveu ${r.tickets.join(', ')}`}</span>
                        </div>
                      </div>
                      <Pill tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Pill>
                      <span className="hidden w-36 shrink-0 text-right text-[13px] tabular-nums text-fg-muted md:block">{dateTime(r.publishedAt ?? r.createdAt)}</span>
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}
    </>
  );
}
