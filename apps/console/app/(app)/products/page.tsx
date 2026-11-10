'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, type Product } from '@/lib/api';
import { ColorPicker, ProductMark, ProductStripe } from '@/components/product';
import { Button, Card, Dialog, Empty, Field, IconChevron, Input, PageHeader, Pill, Shimmer, Textarea, useToast } from '@/components/ui';
import { useMe } from '@/components/shell';

export default function ProductsPage() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const q = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/staff/products') });
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<{ name: string; slug: string; description: string; websiteUrl: string; color: string | null }>({ name: '', slug: '', description: '', websiteUrl: '', color: null });
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const p = await api<Product>('/staff/products', { method: 'POST', json: { ...form, color: form.color ?? '' } });
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
        subtitle="Os carros na pista: cada sistema ligado ao Pitwall, com a sua cor, as chaves, o webhook e as configurações."
        actions={me?.role === 'admin' && <Button variant="primary" onClick={() => setOpen(true)}>Novo sistema</Button>}
      />
      {q.isLoading ? <div className="flex flex-col gap-1">{[1, 2, 3].map((i) => <Shimmer key={i} className="h-24" />)}</div> : q.data && q.data.length === 0 ? (
        <Card><Empty title="Nenhum carro na pista.">Cadastre o primeiro sistema (Acme, Globex…) e gere a chave do backend dele.</Empty></Card>
      ) : (
        <div className="flex flex-col gap-1">
          {q.data?.map((p, i) => (
            <Link key={p.id} href={`/products/${p.id}`} style={{ '--i': i } as React.CSSProperties}
              className="rise group flex min-h-24 items-stretch gap-5 bg-surface pr-5 transition-colors duration-150 hover:bg-hover">
              <ProductStripe product={p} className="w-1.5" />
              <ProductMark product={p} size={56} className="self-center" />
              <div className="min-w-0 flex-1 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="display text-[30px] text-fg">{p.name}</span>
                  <span className="text-[14px] text-fg-muted">{p.slug}</span>
                  {p.disabledAt && <Pill tone="error">desativado</Pill>}
                </div>
                <p className="mt-1.5 line-clamp-1 max-w-3xl text-[14px] text-fg-muted">{p.description ?? 'Sem descrição.'}</p>
                {(p.owner || p.websiteUrl) && (
                  <p className="mt-1 truncate text-[13px] text-fg-muted">
                    {p.owner && <>Responsável: <span className="text-fg-secondary">{p.owner.name}</span></>}
                    {p.owner && p.websiteUrl && ' · '}
                    {p.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </p>
                )}
              </div>
              <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                <Pill tone={p.webhookUrl && p.hasWebhookSecret ? 'ok' : 'idle'}>{p.webhookUrl && p.hasWebhookSecret ? 'Webhook ligado' : 'Sem webhook'}</Pill>
                <Pill tone={p.settings.autoPublishReleases ? 'info' : 'idle'}>{p.settings.autoPublishReleases ? 'Publica sozinho' : 'Novidades em rascunho'}</Pill>
              </div>
              <span className="self-center text-fg-muted transition-transform duration-200 group-hover:translate-x-1" aria-hidden><IconChevron /></span>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo sistema">
        <div className="flex flex-col gap-4">
          <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || '' })} placeholder="Acme" /></Field>
          <Field label="Identificador" hint="Minúsculas, números e hífen. Aparece nas chaves e no changelog público."><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="acme" /></Field>
          <Field label="O que é" hint="Uma ou duas frases. O redator das novidades lê isso para saber quem são os leitores."><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Endereço do sistema" hint="Opcional. Vira um link no chamado."><Input code type="url" value={form.websiteUrl} placeholder="https://acme.example" onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold text-fg-secondary">Cor</span>
            <div className="flex items-center gap-4">
              <ProductMark product={{ id: '', slug: form.slug, name: form.name || 'Novo sistema', color: form.color, logoUrl: null }} size={44} />
              <ColorPicker value={form.color} slug={form.slug} onChange={(color) => setForm({ ...form, color })} />
            </div>
            <span className="text-[13px] leading-[1.45] text-fg-muted">A logo você envia depois, na página do sistema.</span>
          </div>
          <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={busy} onClick={create}>Criar</Button></div>
        </div>
      </Dialog>
    </>
  );
}
