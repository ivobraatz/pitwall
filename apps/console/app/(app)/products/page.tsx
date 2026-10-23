'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type Product } from '@/lib/api';
import { viz } from '@/components/charts';
import { Button, Card, Dialog, Empty, Field, Input, PageHeader, Pill, Shimmer, Textarea, useToast } from '@/components/ui';
import { useMe } from '@/components/shell';

export default function ProductsPage() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const q = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/staff/products') });
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', slug: '', description: '' });
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const p = await api<Product>('/staff/products', { method: 'POST', json: form });
      router.push(`/products/${p.id}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Erro ao criar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sistemas"
        subtitle="Cada sistema conectado ao Pitwall, com suas chaves, webhook e configurações."
        actions={me?.role === 'admin' && <Button variant="primary" onClick={() => setOpen(true)}>Novo sistema</Button>}
      />
      {q.isLoading ? <Shimmer className="h-40" /> : q.data && q.data.length === 0 ? (
        <Card><Empty title="Nenhum sistema ainda">Cadastre o primeiro (DataRunner, RH Flex, metrifree…) e gere a chave do backend dele.</Empty></Card>
      ) : (
        <Card>
          {q.data?.map((p, i) => (
            <Link key={p.id} href={`/products/${p.id}`} className="group flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0 hover:bg-hover">
              <span className="grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-semibold text-btn-fg" style={{ background: viz(i + 1) }}>{p.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-fg group-hover:text-accent-fg">{p.name}</span>
                  <span className="font-mono text-[12px] text-fg-muted">{p.slug}</span>
                  {p.disabledAt && <Pill tone="error">desativado</Pill>}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[12px] text-fg-muted">{p.description ?? 'Sem descrição.'}</p>
              </div>
              <div className="hidden shrink-0 gap-1.5 sm:flex">
                <Pill tone={p.webhookUrl && p.hasWebhookSecret ? 'ok' : 'idle'}>{p.webhookUrl && p.hasWebhookSecret ? 'webhook ligado' : 'sem webhook'}</Pill>
                <Pill tone={p.settings.autoPublishReleases ? 'info' : 'idle'}>{p.settings.autoPublishReleases ? 'publica sozinho' : 'novidades em rascunho'}</Pill>
              </div>
              <span className="text-fg-muted" aria-hidden>›</span>
            </Link>
          ))}
        </Card>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo sistema">
        <div className="flex flex-col gap-3">
          <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || '' })} placeholder="DataRunner" /></Field>
          <Field label="Identificador" hint="Minúsculas, números e hífen. Aparece nas chaves e no changelog público."><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="datarunner" /></Field>
          <Field label="O que é" hint="Uma ou duas frases. O redator das novidades lê isso para saber quem são os leitores."><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={busy} onClick={create}>Criar</Button></div>
        </div>
      </Dialog>
    </>
  );
}
