'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, type Paged, type Product, type ReleaseRow } from '@/lib/api';
import { Card, Empty, ErrorBox, PageHeader, Pill, Select, Shimmer, dateTime } from '@/components/ui';

const STATUS: Record<string, { label: string; tone: string }> = {
  published: { label: 'Publicada', tone: 'ok' },
  draft: { label: 'Rascunho', tone: 'warn' },
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
      <PageHeader title="Novidades" subtitle="As notas de versão que o Haiku escreve a partir dos commits de cada sistema. Rascunhos esperam revisão; publicadas vão para o changelog público e o sino do produto." />
      <div className="mb-3 flex gap-2">
        <Select value={product} onChange={(e) => setProduct(e.target.value)} options={[{ value: '', label: 'Todos os sistemas' }, ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Qualquer situação' }, { value: 'draft', label: 'Rascunhos' }, { value: 'published', label: 'Publicadas' }, { value: 'silent', label: 'Sem nota' }]} />
      </div>
      {releases.isLoading ? <Shimmer className="h-64" /> : releases.isError ? <ErrorBox error={releases.error} />
        : releases.data && releases.data.items.length === 0
          ? <Card><Empty title="Nenhuma release ainda">Ligue a action “release-notes” no repositório de cada sistema (veja docs/integracao.md).</Empty></Card>
          : (
            <Card>
              {releases.data?.items.map((r) => {
                const pt = r.notes.find((n) => n.locale === 'pt') ?? r.notes[0];
                return (
                  <Link key={r.id} href={`/releases/${r.id}`} className="group flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0 hover:bg-hover">
                    <span className="w-24 shrink-0 rounded-sm bg-chip px-2 py-1 text-center font-mono text-[12px] text-fg">{r.version}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-fg group-hover:text-accent-fg">{pt?.title ?? <span className="text-fg-subtle">sem nota para clientes</span>}</div>
                      <div className="truncate text-[12px] text-fg-muted">{r.product.name} · {r.commits} commits{r.tickets.length > 0 && ` · resolveu ${r.tickets.join(', ')}`}</div>
                    </div>
                    <Pill tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Pill>
                    <span className="w-36 shrink-0 text-right text-[12px] text-fg-subtle">{dateTime(r.publishedAt ?? r.createdAt)}</span>
                  </Link>
                );
              })}
            </Card>
          )}
    </>
  );
}
