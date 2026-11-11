'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ReleaseDetail } from '@/lib/api';
import { Button, Card, Dot, ErrorBox, Field, Input, PageHeader, Pill, Shimmer, Textarea, dateTime, useToast } from '@/components/ui';
import { ProductMark, ProductName } from '@/components/product';

type Edit = { title: string; summary: string; new: string; improvements: string };
const LOCALE: Record<string, string> = { pt: 'Português', en: 'English', es: 'Español' };

export default function ReleasePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['release', id], queryFn: () => api<ReleaseDetail>(`/staff/releases/${id}`) });
  const [edits, setEdits] = React.useState<Record<string, Edit>>({});
  React.useEffect(() => {
    if (!q.data) return;
    setEdits(Object.fromEntries(q.data.notes.map((n) => [n.locale, { title: n.title, summary: n.summary, new: n.new.join('\n'), improvements: n.improvements.join('\n') }])));
  }, [q.data]);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['release', id] }); void queryClient.invalidateQueries({ queryKey: ['releases'] }); };
  const save = useMutation({
    mutationFn: () => api(`/staff/releases/${id}`, {
      method: 'PATCH',
      json: { notes: Object.fromEntries(Object.entries(edits).map(([l, e]) => [l, { title: e.title, summary: e.summary, new: e.new.split('\n'), improvements: e.improvements.split('\n') }])) },
    }),
    onSuccess: () => { toast('ok', 'Nota salva.'); refresh(); },
    onError: (e) => toast('error', e instanceof Error ? e.message : 'Erro ao salvar.'),
  });
  const publish = useMutation({
    mutationFn: async () => { await save.mutateAsync(); await api(`/staff/releases/${id}/publish`, { method: 'POST' }); },
    onSuccess: () => { toast('ok', 'Publicada. Os sistemas recebem o aviso.'); refresh(); },
    onError: (e) => toast('error', e instanceof Error ? e.message : 'Erro ao publicar.'),
  });
  const unpublish = useMutation({
    mutationFn: () => api(`/staff/releases/${id}/unpublish`, { method: 'POST' }),
    onSuccess: () => { toast('ok', 'Voltou para rascunho.'); refresh(); },
  });

  if (q.isLoading) return <Shimmer className="h-96" />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  const patch = (locale: string, p: Partial<Edit>) => setEdits((cur) => ({ ...cur, [locale]: { ...cur[locale], ...p } }));

  return (
    <>
      <PageHeader
        back={<Link href="/releases" className="hover:text-fg">← Novidades</Link>}
        title={<span className="flex items-center gap-4"><ProductMark product={r.product} size={44} label /><span className="tabular-nums">{r.version}</span></span>}
        subtitle={<><ProductName product={r.product} size={18} className="align-[-0.2em] font-semibold text-fg-secondary" /> · {r.commitShas.length} commits · criada {dateTime(r.createdAt)}{r.publishedAt && ` · publicada ${dateTime(r.publishedAt)}`}</>}
        actions={r.notes.length > 0 && (
          <>
            <Pill tone={r.status === 'published' ? 'ok' : 'accent'}>{r.status === 'published' ? 'Publicada' : 'Rascunho'}</Pill>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
            {r.status === 'published'
              ? <Button variant="danger" loading={unpublish.isPending} onClick={() => unpublish.mutate()}>Despublicar</Button>
              : <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publicar</Button>}
          </>
        )}
      />
      {r.ticketCodes.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-tile bg-success/10 px-5 py-3.5 text-[14px] text-fg">
          <Dot tone="ok" />
          Os commits citaram {r.ticketCodes.join(', ')}: esses chamados foram resolvidos com a versão {r.version}.
        </div>
      )}
      {r.notes.length === 0 ? (
        <Card><p className="px-5 py-6 text-[15px] leading-[1.5] text-fg-muted">Nada nesta versão era visível para clientes, então não há nota. Os chamados citados nos commits foram resolvidos mesmo assim.</p></Card>
      ) : (
        <div className="mb-3 grid gap-3 lg:grid-cols-2">
          {r.notes.map((n) => {
            const e = edits[n.locale];
            if (!e) return null;
            return (
              <Card key={n.locale} title={LOCALE[n.locale] ?? n.locale} actions={<code className="text-fg-muted">/{n.slug}</code>}>
                <div className="flex flex-col gap-5 px-5 pt-2 pb-5">
                  <Field label="Título"><Input value={e.title} maxLength={80} onChange={(ev) => patch(n.locale, { title: ev.target.value })} /></Field>
                  <Field label="Resumo"><Input value={e.summary} maxLength={240} onChange={(ev) => patch(n.locale, { summary: ev.target.value })} /></Field>
                  <Field label="Novo" hint="Um item por linha. **negrito** no nome do recurso."><Textarea rows={5} value={e.new} onChange={(ev) => patch(n.locale, { new: ev.target.value })} /></Field>
                  <Field label="Melhorias" hint="Um item por linha."><Textarea rows={5} value={e.improvements} onChange={(ev) => patch(n.locale, { improvements: ev.target.value })} /></Field>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Card title="Commits">
        <div className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
          {r.commitShas.map((s) => (
            <div key={s} className="-mx-2 flex min-h-[44px] items-center rounded-tile px-2 py-2 transition-colors hover:bg-hover">
              <code className="text-fg-secondary">{s.slice(0, 10)}</code>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
