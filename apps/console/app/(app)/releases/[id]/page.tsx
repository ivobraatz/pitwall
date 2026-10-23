'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ReleaseDetail } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Pill, Shimmer, Textarea, dateTime, useToast } from '@/components/ui';

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
        title={<>Versão <span className="font-mono">{r.version}</span></>}
        subtitle={<>{r.product.name} · {r.commitShas.length} commits · criada {dateTime(r.createdAt)}{r.publishedAt && ` · publicada ${dateTime(r.publishedAt)}`}</>}
        actions={r.notes.length > 0 && (
          <>
            <Pill tone={r.status === 'published' ? 'ok' : 'warn'}>{r.status === 'published' ? 'Publicada' : 'Rascunho'}</Pill>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
            {r.status === 'published'
              ? <Button variant="danger" loading={unpublish.isPending} onClick={() => unpublish.mutate()}>Despublicar</Button>
              : <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publicar</Button>}
          </>
        )}
      />
      {r.ticketCodes.length > 0 && (
        <div className="mb-4 rounded-md border border-success/30 bg-success/5 px-4 py-2 text-[13px]">
          Os commits citaram {r.ticketCodes.join(', ')}: esses chamados foram resolvidos com a versão {r.version}.
        </div>
      )}
      {r.notes.length === 0 ? (
        <Card><p className="p-4 text-[13px] text-fg-muted">Nada nesta versão era visível para clientes, então não há nota. Os chamados citados nos commits foram resolvidos mesmo assim.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {r.notes.map((n) => {
            const e = edits[n.locale];
            if (!e) return null;
            return (
              <Card key={n.locale} title={LOCALE[n.locale] ?? n.locale} actions={<span className="font-mono text-[11px] text-fg-subtle">/{n.slug}</span>}>
                <div className="flex flex-col gap-3 p-4">
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
      <Card className="mt-4" title="Commits">
        <div className="flex flex-wrap gap-1.5 p-4 font-mono text-[11px] text-fg-muted">{r.commitShas.map((s) => <span key={s} className="rounded bg-chip px-1.5">{s.slice(0, 10)}</span>)}</div>
      </Card>
    </>
  );
}
