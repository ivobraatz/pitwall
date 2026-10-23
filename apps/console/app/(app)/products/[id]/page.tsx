'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Product, type ProductKey, type ProductSettings, type WebhookDelivery } from '@/lib/api';
import { Button, Card, Dialog, ErrorBox, Field, Input, PageHeader, Pill, Shimmer, Textarea, cn, dateTime, rel, useToast } from '@/components/ui';
import { useMe } from '@/components/shell';

const SCOPES = [
  { id: 'support', label: 'support', hint: 'a ponte de chamados (backend do sistema)' },
  { id: 'errors', label: 'errors', hint: 'reportar erros 5xx (backend do sistema)' },
  { id: 'releases', label: 'releases', hint: 'enviar commits para as novidades (CI)' },
];

function Secret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={label}>
      <p className="mb-2 text-[13px] text-fg-muted">Copie agora: este valor não aparece de novo. Guarde nos segredos do sistema (variável de ambiente), nunca no código nem no navegador.</p>
      <div className="flex gap-2"><Input readOnly value={value} className="font-mono" onFocus={(e) => e.target.select()} />
        <Button onClick={() => navigator.clipboard.writeText(value)}>Copiar</Button></div>
      <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onClose}>Já copiei</Button></div>
    </Dialog>
  );
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const admin = me?.role === 'admin';
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<{ product: Product; keys: ProductKey[] }>(`/staff/products/${id}`) });
  const deliveries = useQuery({ queryKey: ['deliveries', id], queryFn: () => api<WebhookDelivery[]>(`/staff/products/${id}/webhook/deliveries`), refetchInterval: 15_000 });
  const [form, setForm] = React.useState<{ name: string; description: string; webhookUrl: string; settings: ProductSettings } | null>(null);
  const [secret, setSecret] = React.useState<{ label: string; value: string } | null>(null);
  const [keyForm, setKeyForm] = React.useState<{ name: string; scopes: string[] } | null>(null);

  React.useEffect(() => {
    if (q.data) {
      const p = q.data.product;
      setForm({ name: p.name, description: p.description ?? '', webhookUrl: p.webhookUrl ?? '', settings: p.settings });
    }
  }, [q.data]);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['product', id] }); void queryClient.invalidateQueries({ queryKey: ['products'] }); };
  const fail = (e: unknown) => toast('error', e instanceof Error ? e.message : 'Erro.');
  const save = useMutation({ mutationFn: () => api(`/staff/products/${id}`, { method: 'PATCH', json: form }), onSuccess: () => { toast('ok', 'Salvo.'); refresh(); }, onError: fail });
  const createKey = useMutation({
    mutationFn: () => api<{ token: string }>(`/staff/products/${id}/keys`, { method: 'POST', json: keyForm }),
    onSuccess: (r) => { setKeyForm(null); setSecret({ label: 'Nova chave', value: r.token }); refresh(); }, onError: fail,
  });
  const revoke = useMutation({ mutationFn: (keyId: string) => api(`/staff/products/${id}/keys/${keyId}`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
  const rotate = useMutation({
    mutationFn: () => api<{ secret: string }>(`/staff/products/${id}/webhook/secret`, { method: 'POST' }),
    onSuccess: (r) => { setSecret({ label: 'Segredo do webhook', value: r.secret }); refresh(); }, onError: fail,
  });
  const ping = useMutation({ mutationFn: () => api(`/staff/products/${id}/webhook/ping`, { method: 'POST' }), onSuccess: () => { toast('ok', 'Ping na fila.'); setTimeout(() => deliveries.refetch(), 6000); }, onError: fail });
  const retry = useMutation({ mutationFn: (d: string) => api(`/staff/products/${id}/webhook/deliveries/${d}/retry`, { method: 'POST' }), onSuccess: () => deliveries.refetch(), onError: fail });
  const toggle = useMutation({ mutationFn: (disabled: boolean) => api(`/staff/products/${id}`, { method: 'PATCH', json: { disabled } }), onSuccess: refresh, onError: fail });

  if (q.isLoading || !form) return <Shimmer className="h-96" />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const p = q.data.product;
  const s = form.settings;
  const setS = (patch: Partial<ProductSettings>) => setForm({ ...form, settings: { ...s, ...patch } });

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={<span className="font-mono">{p.slug}{p.disabledAt && ' · desativado'}</span>}
        actions={admin && (
          <>
            <Button variant={p.disabledAt ? 'secondary' : 'danger'} onClick={() => toggle.mutate(!p.disabledAt)}>{p.disabledAt ? 'Reativar' : 'Desativar'}</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </>
        )}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Geral">
          <fieldset disabled={!admin} className="flex flex-col gap-3 p-4">
            <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="O que é" hint="Contexto para o redator das novidades."><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Nome da equipe para o cliente" hint="Quem assina as respostas. Padrão: o nome do sistema."><Input value={s.teamName ?? ''} onChange={(e) => setS({ teamName: e.target.value || null })} /></Field>
            <Field label="Tela do chamado no sistema" hint="Para o link “ver no sistema”. Use {id}."><Input className="font-mono" value={s.customerTicketUrl ?? ''} placeholder="https://app.exemplo.com/support/view?id={id}" onChange={(e) => setS({ customerTicketUrl: e.target.value || null })} /></Field>
            <Field label="Marcadores do código próprio (stack trace)" hint="Um por linha. Ex.: DataRunner. ou /apps/api/src/ — a assinatura do erro usa o primeiro frame que bate.">
              <Textarea rows={3} className="font-mono" value={s.ownFramePrefixes.join('\n')} onChange={(e) => setS({ ownFramePrefixes: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Idiomas das novidades"><Input value={s.locales.join(', ')} onChange={(e) => setS({ locales: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
              <div className="flex flex-col justify-end gap-2 text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={s.autoPublishReleases} onChange={(e) => setS({ autoPublishReleases: e.target.checked })} /> Publicar novidades sozinho</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={s.retroactiveRecording} onChange={(e) => setS({ retroactiveRecording: e.target.checked })} /> Gravação retroativa ligada por padrão</label>
              </div>
            </div>
          </fieldset>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Chaves" actions={admin && <Button size="sm" onClick={() => setKeyForm({ name: '', scopes: ['support', 'errors'] })}>Nova chave</Button>}>
            {q.data.keys.length === 0 ? <p className="p-4 text-[13px] text-fg-muted">Nenhuma chave. O backend precisa de uma com support + errors; o CI, de uma com releases.</p>
              : q.data.keys.map((k) => (
                <div key={k.id} className={cn('flex items-center gap-3 border-b border-border px-4 py-2.5 text-[13px] last:border-0', k.revokedAt && 'opacity-50')}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{k.name}</div>
                    <div className="font-mono text-[11px] text-fg-subtle">{k.prefix}… · {k.scopes.join(' + ')} · usada {rel(k.lastUsedAt)}</div>
                  </div>
                  {k.revokedAt ? <Pill>revogada</Pill> : admin && <Button size="sm" variant="danger" onClick={() => { if (confirm(`Revogar a chave “${k.name}”? O que usa ela para de funcionar em até um minuto.`)) revoke.mutate(k.id); }}>Revogar</Button>}
                </div>
              ))}
          </Card>

          <Card title="Webhook" actions={admin && (
            <>
              <Button size="sm" onClick={() => rotate.mutate()}>{p.hasWebhookSecret ? 'Trocar segredo' : 'Gerar segredo'}</Button>
              <Button size="sm" onClick={() => ping.mutate()} disabled={!p.webhookUrl || !p.hasWebhookSecret}>Testar</Button>
            </>
          )}>
            <div className="flex flex-col gap-3 p-4">
              <Field label="URL" hint="Para onde vão ticket.created, ticket.replied, ticket.status_changed e release.published, assinados com HMAC.">
                <Input disabled={!admin} className="font-mono" value={form.webhookUrl} placeholder="https://api.exemplo.com/api/v1/webhooks/pitwall" onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
              </Field>
              <div className="text-[12px] text-fg-muted">Segredo: {p.hasWebhookSecret ? 'configurado' : <span className="text-warning">não gerado</span>}</div>
            </div>
            <div className="border-t border-border">
              <p className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Entregas recentes</p>
              {(deliveries.data ?? []).length === 0 ? <p className="px-4 py-3 text-[13px] text-fg-muted">Nenhuma.</p> : deliveries.data!.slice(0, 15).map((d) => (
                <div key={d.id} className="flex items-center gap-2 px-4 py-1.5 text-[12px]">
                  <Pill tone={d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'error' : 'warn'}>{d.status === 'delivered' ? 'entregue' : d.status === 'failed' ? 'falhou' : 'pendente'}</Pill>
                  <span className="font-mono">{d.event}</span>
                  <span className="truncate text-fg-subtle" title={d.lastError ?? ''}>{d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '')}</span>
                  <span className="ml-auto shrink-0 text-fg-subtle">{d.attempts}× · {dateTime(d.createdAt)}</span>
                  {d.status === 'failed' && admin && <Button size="sm" variant="ghost" onClick={() => retry.mutate(d.id)}>reenviar</Button>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {keyForm && (
        <Dialog open onClose={() => setKeyForm(null)} title="Nova chave">
          <div className="flex flex-col gap-3">
            <Field label="Nome"><Input value={keyForm.name} placeholder="backend produção" onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} /></Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Escopos</span>
              {SCOPES.map((sc) => (
                <label key={sc.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={keyForm.scopes.includes(sc.id)} onChange={(e) => setKeyForm({ ...keyForm, scopes: e.target.checked ? [...keyForm.scopes, sc.id] : keyForm.scopes.filter((x) => x !== sc.id) })} />
                  <span className="font-mono">{sc.label}</span><span className="text-fg-muted">— {sc.hint}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setKeyForm(null)}>Cancelar</Button><Button variant="primary" loading={createKey.isPending} onClick={() => createKey.mutate()}>Criar chave</Button></div>
          </div>
        </Dialog>
      )}
      {secret && <Secret label={secret.label} value={secret.value} onClose={() => setSecret(null)} />}
    </>
  );
}
