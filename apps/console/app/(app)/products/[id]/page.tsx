'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Product, type ProductKey, type ProductSettings, type StaffMember, type WebhookDelivery } from '@/lib/api';
import { Button, Card, Dialog, ErrorBox, Field, Input, PageHeader, Pill, Select, Shimmer, Textarea, cn, dateTime, rel, useToast } from '@/components/ui';
import { useMe } from '@/components/shell';
import { ColorPicker, ProductMark } from '@/components/product';

const SCOPES = [
  { id: 'support', label: 'support', hint: 'a ponte de chamados (backend do sistema)' },
  { id: 'errors', label: 'errors', hint: 'reportar erros 5xx (backend do sistema)' },
  { id: 'releases', label: 'releases', hint: 'enviar commits para as novidades (CI)' },
];

function Secret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={label}>
      <p className="mb-4 text-[14px] leading-[1.5] text-fg-secondary">Copie agora: este valor não aparece de novo. Guarde nos segredos do sistema (variável de ambiente), nunca no código nem no navegador.</p>
      <div className="flex gap-2"><Input readOnly value={value} code onFocus={(e) => e.target.select()} />
        <Button onClick={() => navigator.clipboard.writeText(value)}>Copiar</Button></div>
      <div className="mt-6 flex justify-end"><Button variant="primary" onClick={onClose}>Já copiei</Button></div>
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
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<StaffMember[]>('/staff/team') });
  const [form, setForm] = React.useState<{ name: string; description: string; webhookUrl: string; websiteUrl: string; color: string | null; ownerId: string; settings: ProductSettings } | null>(null);
  const logoInput = React.useRef<HTMLInputElement>(null);
  const [secret, setSecret] = React.useState<{ label: string; value: string } | null>(null);
  const [keyForm, setKeyForm] = React.useState<{ name: string; scopes: string[] } | null>(null);

  React.useEffect(() => {
    if (q.data) {
      const p = q.data.product;
      setForm({ name: p.name, description: p.description ?? '', webhookUrl: p.webhookUrl ?? '', websiteUrl: p.websiteUrl ?? '', color: p.color, ownerId: p.owner?.id ?? '', settings: p.settings });
    }
  }, [q.data]);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['product', id] }); void queryClient.invalidateQueries({ queryKey: ['products'] }); };
  const fail = (e: unknown) => toast('error', e instanceof Error ? e.message : 'Erro.');
  const save = useMutation({ mutationFn: () => api(`/staff/products/${id}`, { method: 'PATCH', json: { ...form, color: form?.color ?? '' } }), onSuccess: () => { toast('ok', 'Salvo.'); refresh(); }, onError: fail });
  const uploadLogo = useMutation({
    mutationFn: (file: File) => { const body = new FormData(); body.append('file', file); return api(`/staff/products/${id}/logo`, { method: 'PUT', body }); },
    onSuccess: () => { toast('ok', 'Logo atualizada.'); refresh(); }, onError: fail,
  });
  const removeLogo = useMutation({ mutationFn: () => api(`/staff/products/${id}/logo`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
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
        title={<span className="flex items-center gap-4"><ProductMark product={{ ...p, color: form.color }} size={52} />{p.name}</span>}
        subtitle={<span><span className="text-fg-secondary">{p.slug}</span>{p.owner && <> · responsável {p.owner.name}</>}{p.disabledAt && ' · desativado'}</span>}
        actions={admin && (
          <>
            <Button variant={p.disabledAt ? 'secondary' : 'danger'} onClick={() => toggle.mutate(!p.disabledAt)}>{p.disabledAt ? 'Reativar' : 'Desativar'}</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </>
        )}
      />
      <div className="grid gap-2 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Card title="Identidade" className="rise">
            <fieldset disabled={!admin} className="flex flex-col gap-5 px-5 pt-2 pb-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-semibold text-fg-secondary">Logo</span>
                <div className="flex items-center gap-5">
                  <ProductMark product={{ ...p, color: form.color }} size={88} />
                  <div className="flex flex-col gap-2">
                    {admin && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" loading={uploadLogo.isPending} onClick={() => logoInput.current?.click()}>{p.logoUrl ? 'Trocar logo' : 'Enviar logo'}</Button>
                        {p.logoUrl && <Button size="sm" variant="ghost" loading={removeLogo.isPending} onClick={() => removeLogo.mutate()}>Remover</Button>}
                      </div>
                    )}
                    <p className="max-w-xs text-[13px] leading-[1.45] text-fg-muted">PNG, JPEG ou WebP, até 512 KB. Quadrada e com fundo próprio fica melhor. Sem logo, o sistema aparece com as iniciais na cor dele.</p>
                  </div>
                  <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f); e.target.value = ''; }} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-semibold text-fg-secondary">Cor</span>
                <ColorPicker value={form.color} slug={p.slug} onChange={(color) => setForm({ ...form, color })} disabled={!admin} />
                <span className="text-[13px] leading-[1.45] text-fg-muted">A faixa do sistema na fila, nos erros e nas novidades.</span>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Endereço do sistema"><Input code type="url" value={form.websiteUrl} placeholder="https://acme.example" onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} /></Field>
                <Field label="Responsável" hint="Quem a equipe procura primeiro.">
                  <Select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className="w-full"
                    options={[{ value: '', label: 'Ninguém' }, ...(team.data ?? []).filter((m) => !m.disabled || m.id === form.ownerId).map((m) => ({ value: m.id, label: m.name }))]} />
                </Field>
              </div>
            </fieldset>
          </Card>
          <Card title="Geral" className="rise" style={{ '--i': 1 } as React.CSSProperties}>
            <fieldset disabled={!admin} className="flex flex-col gap-5 px-5 pt-2 pb-6">
              <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="O que é" hint="Contexto para o redator das novidades."><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <Field label="Nome da equipe para o cliente" hint="Quem assina as respostas. Padrão: o nome do sistema."><Input value={s.teamName ?? ''} onChange={(e) => setS({ teamName: e.target.value || null })} /></Field>
              <Field label="Tela do chamado no sistema" hint="Para o link “ver no sistema”. Use {id}."><Input code value={s.customerTicketUrl ?? ''} placeholder="https://app.exemplo.com/support/view?id={id}" onChange={(e) => setS({ customerTicketUrl: e.target.value || null })} /></Field>
              <Field label="Marcadores do código próprio (stack trace)" hint="Um por linha. Ex.: Acme. ou /apps/api/src/ — a assinatura do erro usa o primeiro frame que bate.">
                <Textarea rows={3} code value={s.ownFramePrefixes.join('\n')} onChange={(e) => setS({ ownFramePrefixes: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Idiomas das novidades"><Input value={s.locales.join(', ')} onChange={(e) => setS({ locales: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
                <div className="flex flex-col justify-end gap-3 text-[14px]">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.autoPublishReleases} onChange={(e) => setS({ autoPublishReleases: e.target.checked })} /> Publicar novidades sozinho</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.retroactiveRecording} onChange={(e) => setS({ retroactiveRecording: e.target.checked })} /> Gravação retroativa ligada por padrão</label>
                </div>
              </div>
            </fieldset>
          </Card>
        </div>

        <div className="flex flex-col gap-2">
          <Card title="Chaves" className="rise" style={{ '--i': 1 } as React.CSSProperties} actions={admin && <Button size="sm" onClick={() => setKeyForm({ name: '', scopes: ['support', 'errors'] })}>Nova chave</Button>}>
            {q.data.keys.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted">Nenhuma chave. O backend precisa de uma com support + errors; o CI, de uma com releases.</p>
              : q.data.keys.map((k) => (
                <div key={k.id} className={cn('mx-2 mb-1 flex items-center gap-3 bg-well px-3 py-3 text-[14px] last:mb-2', k.revokedAt && 'opacity-50')}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-fg">{k.name}</div>
                    <div className="mt-0.5 text-[13px] text-fg-muted"><code>{k.prefix}…</code> · {k.scopes.join(' + ')} · usada {rel(k.lastUsedAt)}</div>
                  </div>
                  {k.revokedAt ? <Pill>revogada</Pill> : admin && <Button size="sm" variant="danger" onClick={() => { if (confirm(`Revogar a chave “${k.name}”? O que usa ela para de funcionar em até um minuto.`)) revoke.mutate(k.id); }}>Revogar</Button>}
                </div>
              ))}
          </Card>

          <Card title="Webhook" className="rise" style={{ '--i': 2 } as React.CSSProperties} actions={admin && (
            <>
              <Button size="sm" onClick={() => rotate.mutate()}>{p.hasWebhookSecret ? 'Trocar segredo' : 'Gerar segredo'}</Button>
              <Button size="sm" onClick={() => ping.mutate()} disabled={!p.webhookUrl || !p.hasWebhookSecret}>Testar</Button>
            </>
          )}>
            <div className="flex flex-col gap-3 px-5 pt-2 pb-4">
              <Field label="URL" hint="Para onde vão ticket.created, ticket.replied, ticket.status_changed e release.published, assinados com HMAC.">
                <Input disabled={!admin} code value={form.webhookUrl} placeholder="https://api.exemplo.com/api/v1/webhooks/pitwall" onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
              </Field>
              <div className="text-[13px] text-fg-muted">Segredo: {p.hasWebhookSecret ? 'configurado' : <span className="text-warning">não gerado</span>}</div>
            </div>
            <div className="pb-3">
              <p className="px-5 pt-2 pb-2 text-[14px] font-semibold text-fg-secondary">Entregas recentes</p>
              {(deliveries.data ?? []).length === 0 ? <p className="px-5 pb-3 text-[14px] text-fg-muted">Nenhuma ainda.</p> : deliveries.data!.slice(0, 15).map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-1.5 text-[13px]">
                  <Pill tone={d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'error' : 'warn'}>{d.status === 'delivered' ? 'entregue' : d.status === 'failed' ? 'falhou' : 'pendente'}</Pill>
                  <code className="text-fg">{d.event}</code>
                  <span className="truncate text-fg-subtle" title={d.lastError ?? ''}>{d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : '')}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-fg-subtle">{d.attempts}× · {dateTime(d.createdAt)}</span>
                  {d.status === 'failed' && admin && <Button size="sm" variant="ghost" onClick={() => retry.mutate(d.id)}>reenviar</Button>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {keyForm && (
        <Dialog open onClose={() => setKeyForm(null)} title="Nova chave">
          <div className="flex flex-col gap-4">
            <Field label="Nome"><Input value={keyForm.name} placeholder="backend produção" onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} /></Field>
            <div className="flex flex-col gap-1">
              <span className="mb-1 text-[13px] font-semibold text-fg-secondary">Escopos</span>
              {SCOPES.map((sc) => (
                <label key={sc.id} className="flex cursor-pointer items-center gap-3 bg-well px-3 py-2.5 text-[14px] hover:bg-hover">
                  <input type="checkbox" checked={keyForm.scopes.includes(sc.id)} onChange={(e) => setKeyForm({ ...keyForm, scopes: e.target.checked ? [...keyForm.scopes, sc.id] : keyForm.scopes.filter((x) => x !== sc.id) })} />
                  <code className="text-fg">{sc.label}</code><span className="text-fg-muted">{sc.hint}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setKeyForm(null)}>Cancelar</Button><Button variant="primary" loading={createKey.isPending} onClick={() => createKey.mutate()}>Criar chave</Button></div>
          </div>
        </Dialog>
      )}
      {secret && <Secret label={secret.label} value={secret.value} onClose={() => setSecret(null)} />}
    </>
  );
}
