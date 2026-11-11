'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CATEGORIES, SEVERITIES, STATUSES, type Diagnostics, type Dossier, type ServerErrorRow, type StaffMember, type TicketStatus } from '@/lib/api';
import {
  Avatar, Button, Card, ErrorBox, IconChevron, IconClip, IconClose, Input, PageHeader, Pill, Segmented, Select, SideLabel, Shimmer, StatusPill, Textarea,
  CATEGORY_LABEL, SEVERITY_LABEL, STATUS_LABEL, cn, dateTime, rel, useToast,
} from '@/components/ui';
import { AttachmentList } from '@/components/recording';
import { useMe } from '@/components/shell';
import { ProductMark, ProductName, useProduct } from '@/components/product';

/** The tone of an HTTP status: 5xx (or no answer) is an error, 4xx a warning, 2xx ok. */
function statusTone(code: number): string {
  if (code >= 500 || code === 0) return 'error';
  if (code >= 400) return 'warn';
  if (code >= 200 && code < 300) return 'ok';
  return 'idle';
}

/** One fact of a details card: a muted label, the value on the right. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-[14px]">
      <span className="shrink-0 text-fg-muted">{label}</span>
      <div className="min-w-0 text-right break-words text-fg">{children}</div>
    </div>
  );
}

/** The system the ticket came from: who answers for it and where it lives. */
function ProductFacts({ product, ticketId }: { product: Dossier['product']; ticketId: string }) {
  const p = useProduct(product);
  const site = p?.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <Fact label="Sistema">
      <span className="flex items-center justify-end gap-2.5">
        <ProductMark product={product} size={24} />
        <Link href={`/products/${product.id}`} className="font-semibold text-fg hover:underline">{product.name}</Link>
      </span>
      {p?.owner && <div className="text-[13px] text-fg-muted">Responsável: {p.owner.name}</div>}
      <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-1 text-[13px] font-semibold">
        {product.customerTicketUrl && <a className="text-fg hover:underline" target="_blank" rel="noopener" href={product.customerTicketUrl.replace('{id}', ticketId)}>ver no sistema ↗</a>}
        {site && <a className="max-w-full truncate text-fg hover:underline" target="_blank" rel="noopener" href={p!.websiteUrl!}>{site} ↗</a>}
      </div>
    </Fact>
  );
}

function ServerErrorCard({ e }: { e: ServerErrorRow }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="py-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 rounded-tile text-left transition-colors duration-150 hover:bg-hover">
        <span className="mt-1 text-fg-muted"><IconChevron open={open} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Pill tone={statusTone(Number(e.statusCode))}>{e.statusCode}</Pill>
            <code className="min-w-0 break-all text-fg-muted">{e.method} {e.routeTemplate ?? e.path}</code>
          </div>
          <div className="mt-1 truncate text-[14px] font-semibold text-fg">{e.exceptionType.split('.').pop()}: <span className="font-normal text-fg-secondary">{e.message}</span></div>
          <div className="mt-0.5 text-[13px] text-fg-subtle">{dateTime(e.occurredAt)} · <code>{e.traceId}</code>{e.release ? ` · ${e.release}` : ''}</div>
        </div>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-7">
          <div className="flex items-center justify-between gap-3 text-[13px] text-fg-muted">
            <code className="min-w-0 break-all">{e.path}</code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(e.stackTrace ?? '')}>Copiar</Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-tile bg-well p-4 text-[12.5px] leading-relaxed whitespace-pre-wrap break-all text-fg-secondary">{e.stackTrace ?? '(sem stack trace)'}</pre>
        </div>
      )}
    </div>
  );
}

function DiagnosticsPanel({ d }: { d: Diagnostics }) {
  const [tab, setTab] = React.useState<'requests' | 'logs' | 'errors' | 'events' | 'context'>('requests');
  const t0 = d.requests[0]?.t ?? d.logs[0]?.t ?? new Date(d.capturedAt).getTime();
  const at = (t: number) => `+${((t - t0) / 1000).toFixed(1)}s`;
  const tabs = [
    ['requests', 'Requisições', d.requests.length], ['logs', 'Log', d.logs.length], ['errors', 'Erros', d.errors.length],
    ['events', 'Eventos', d.events.length], ['context', 'Contexto', 0],
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      <Segmented size="sm" value={tab} onChange={setTab}
        options={tabs.map(([id, label, n]) => ({ value: id, label, count: n > 0 ? n : undefined }))} />
      <div className="max-h-96 divide-y divide-border-subtle overflow-auto">
        {tab === 'requests' && d.requests.map((r, i) => (
          <div key={i} className="flex items-center gap-3 py-2 text-[13px]">
            <span className="w-14 shrink-0 tabular-nums text-fg-subtle">{at(r.t)}</span>
            <Pill tone={statusTone(r.status)}>{r.status || r.code}</Pill>
            <span className="w-12 shrink-0 font-semibold text-fg-secondary">{r.method}</span>
            <code className="min-w-0 flex-1 truncate">{r.path}</code>
            <span className="w-14 shrink-0 text-right tabular-nums text-fg-muted">{r.ms}ms</span>
            {r.traceId && <code className="w-28 shrink-0 truncate text-fg-subtle" title={r.traceId}>{r.traceId}</code>}
          </div>
        ))}
        {tab === 'logs' && d.logs.map((l, i) => (
          <div key={i} className="flex gap-3 py-2 text-[13px]">
            <span className="w-14 shrink-0 tabular-nums text-fg-subtle">{at(l.t)}</span>
            <span className={cn('w-12 shrink-0', l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-fg-muted')}>{l.level}</span>
            <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-fg-secondary">{l.msg}</span>
          </div>
        ))}
        {tab === 'errors' && (d.errors.length === 0 ? <p className="py-3 text-[14px] text-fg-muted">Nenhum erro não tratado.</p> : d.errors.map((e, i) => (
          <div key={i} className="py-2 text-[13px] text-danger">
            <div><span className="tabular-nums text-fg-subtle">{at(e.t)}</span> {e.kind}: {e.msg}</div>
            {e.stack && <pre className="mt-2 max-h-48 overflow-auto rounded-tile bg-well p-4 text-[12.5px] break-all whitespace-pre-wrap text-fg-muted">{e.stack}</pre>}
          </div>
        )))}
        {tab === 'events' && d.events.map((e, i) => (
          <div key={i} className="flex gap-3 py-2 text-[13px] text-fg-muted">
            <span className="w-14 shrink-0 tabular-nums text-fg-subtle">{at(e.t)}</span>
            <span className="w-16 shrink-0">{e.kind}</span>
            <span className="min-w-0 flex-1 truncate">{e.detail}</span>
          </div>
        ))}
        {tab === 'context' && (
          <dl className="divide-y divide-border-subtle text-[13px]">
            {Object.entries(d.context).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 py-2">
                <dt className="text-fg-subtle">{k}</dt>
                <dd className="break-all text-fg-secondary">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function Thread({ d, onSent }: { d: Dossier; onSent: () => void }) {
  const toast = useToast();
  const [body, setBody] = React.useState('');
  const t = d.ticket;
  // A contact from a public form has no screen to read answers on: the answer goes by e-mail,
  // and the thread holds only the team's notes.
  const contact = t.category === 'contact';
  const [internal, setInternal] = React.useState(contact);
  React.useEffect(() => { if (contact) setInternal(true); }, [contact]);
  const [status, setStatus] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [sending, setSending] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const replyByMail = d.opener.email
    ? `mailto:${d.opener.email}?subject=${encodeURIComponent(`Re: ${t.title} (${t.code})`)}`
    : null;
  const mode: 'reply' | 'internal' = internal ? 'internal' : 'reply';

  React.useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [t.messages.length]);

  const items = [
    { id: 'opening', fromTeam: false, internal: false, author: t.openedBy, body: t.body, at: t.createdAt, atts: t.attachments.filter((a) => !a.messageId), opening: true },
    ...t.messages.map((m) => ({ id: m.id, fromTeam: m.fromTeam, internal: m.internal, author: m.author, body: m.body, at: m.createdAt, atts: t.attachments.filter((a) => a.messageId === m.id), opening: false })),
  ];

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const res = await api<{ id: string }>(`/staff/tickets/${t.id}/messages`, { method: 'POST', json: { body: body.trim(), internal, status: internal ? undefined : status || undefined } });
      for (const f of files) {
        const form = new FormData();
        form.append('file', f);
        form.append('messageId', res.id);
        await api(`/staff/tickets/${t.id}/attachments`, { method: 'POST', body: form });
      }
      setBody(''); setFiles([]); setStatus('');
      onSent();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Card title="Conversa">
        <div ref={listRef} className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto px-5 pb-5">
          {items.map((m) => (
            <div key={m.id} className={cn('rounded-tile p-4',
              m.internal ? 'bg-accent-bg' : m.fromTeam ? 'border border-border bg-surface' : 'bg-well')}>
              <div className="flex items-center gap-2.5">
                <Avatar name={m.author?.name} size={28} />
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[13px] font-semibold text-fg">{m.author?.name ?? '—'}</span>
                  {m.fromTeam && !m.internal && <Pill tone="idle" className="h-5 px-2 text-[11px]">equipe</Pill>}
                  {m.internal && <Pill tone="warn" className="h-5 px-2 text-[11px]">nota interna</Pill>}
                  {m.opening && <span className="text-[12px] text-fg-muted">abriu o chamado</span>}
                  <span className="text-[12px] text-fg-muted">· {dateTime(m.at)}</span>
                </div>
              </div>
              <div className="mt-2 sm:pl-[38px]">
                <div className="text-[14px] leading-[1.55] break-words whitespace-pre-wrap text-fg">{m.body}</div>
                <AttachmentList ticketId={t.id} list={m.atts} fallback={t.diagnostics} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {contact ? (
              <>
                {replyByMail && <a href={replyByMail} className="inline-flex h-8 items-center rounded-full bg-btn px-3.5 font-semibold text-btn-fg transition-colors hover:bg-btn-hover">Responder por e-mail</a>}
                <span className="text-fg-muted">Veio de um formulário: quem escreveu não vê esta conversa. Aqui ficam as notas da equipe.</span>
              </>
            ) : (
              <>
                <Segmented size="sm" value={mode} onChange={(v) => setInternal(v === 'internal')}
                  options={[{ value: 'reply', label: 'Responder ao cliente' }, { value: 'internal', label: 'Nota interna' }]} />
                {!internal && (
                  <>
                    <span className="text-fg-muted">e mudar para</span>
                    <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8"
                      options={[{ value: '', label: 'manter situação' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
                  </>
                )}
                {internal && <span className="font-semibold text-warning">O cliente não vê notas internas.</span>}
              </>
            )}
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">{files.map((f, i) => (
              <span key={i} className="inline-flex h-8 items-center gap-1 rounded-full bg-well pl-3 text-[13px]">{f.name}
                <button onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-full text-fg-muted hover:text-fg" aria-label={`Remover ${f.name}`}><IconClose /></button></span>
            ))}</div>
          )}
          <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <label className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg" title="Anexar arquivo" aria-label="Anexar arquivo"><IconClip />
              <input type="file" multiple className="sr-only" accept="image/*,video/mp4,video/webm,video/quicktime,.txt,.csv,.pdf,.json" onChange={(e) => { if (e.target.files) setFiles((c) => [...c, ...Array.from(e.target.files!)].slice(0, 6)); e.target.value = ''; }} />
            </label>
            <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'Anotação para a equipe…' : 'Resposta ao cliente (assinada como a equipe)…'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} className="order-first min-h-[64px] basis-full sm:order-none sm:basis-auto" />
            <Button variant="primary" className="ml-auto sm:ml-0" loading={sending} disabled={!body.trim()} onClick={send}>{internal ? 'Salvar nota' : 'Enviar'}</Button>
          </div>
          <div className="text-right text-[13px] text-fg-subtle">Ctrl+Enter envia</div>
        </div>
      </Card>
    </>
  );
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api<Dossier>(`/staff/tickets/${id}`), refetchInterval: 30_000 });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<StaffMember[]>('/staff/team') });
  const [view, setView] = React.useState<'chat' | 'evidence' | 'related'>('chat');
  const [fixedIn, setFixedIn] = React.useState('');
  const [note, setNote] = React.useState('');
  React.useEffect(() => { if (q.data) { setFixedIn(q.data.ticket.fixedIn ?? ''); setNote(q.data.resolutionNote ?? ''); } }, [q.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
  };
  const update = useMutation({
    mutationFn: (data: Record<string, unknown>) => api(`/staff/tickets/${id}`, { method: 'PATCH', json: data }),
    onSuccess: refresh,
    onError: (e) => toast('error', e instanceof Error ? e.message : 'Não foi possível salvar.'),
  });

  if (q.isLoading) return <div className="flex flex-col gap-2"><Shimmer className="mb-5 h-12 w-96 max-w-full" /><Shimmer className="h-96" /></div>;
  if (q.isError || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const t = d.ticket;
  const recordings = t.attachments.filter((a) => a.kind === 'recording');
  const mine = !!me && d.assigneeId === me.id;
  const ctx = t.diagnostics?.context;

  return (
    <>
      <PageHeader
        back={<Link href="/" className="hover:text-fg">← Chamados</Link>}
        title={t.title}
        subtitle={<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold tabular-nums text-fg-secondary">{t.code}</span><span aria-hidden>·</span><ProductName product={d.product} size={20} className="gap-2" /><span aria-hidden>·</span><span>{d.customer.name ?? d.customer.id}</span></span>}
        actions={<>
          <StatusPill status={t.status} />
          <Button variant={mine ? 'secondary' : 'primary'} onClick={() => update.mutate({ assigneeId: mine ? null : me?.id })}>{mine ? 'Comigo' : 'Assumir'}</Button>
        </>}
      />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Segmented value={view} onChange={setView}
            options={[
              { value: 'chat', label: `Conversa (${t.messages.length})` },
              { value: 'evidence', label: `Evidências (${d.serverErrors.length + (t.diagnostics ? 1 : 0) + recordings.length})` },
              { value: 'related', label: `Relacionados (${d.related.length + d.sameCustomer.length})` },
            ]} />

          {view === 'chat' && <Thread d={d} onSent={refresh} />}

          {view === 'evidence' && (
            <>
              <Card title={`Erros do servidor (${d.serverErrors.length})`}>
                <div className="px-5 pb-5">
                  {d.errorSignature && (
                    <p className="mb-3 text-[13px] leading-[1.5] text-fg-muted">
                      Assinatura <code>{d.errorSignature}</code> · vista {d.signatureOccurrences}× nos últimos 30 dias ·{' '}
                      <Link href={`/?signature=${d.errorSignature}`} className="font-semibold text-fg underline-offset-2 hover:underline">chamados com o mesmo bug</Link> ·{' '}
                      <Link href={`/errors?signature=${d.errorSignature}&product=${d.product.id}`} className="font-semibold text-fg underline-offset-2 hover:underline">ocorrências</Link>
                    </p>
                  )}
                  {d.serverErrors.length === 0
                    ? <p className="text-[14px] text-fg-muted">Nenhum erro do servidor bateu com os trace ids deste chamado{t.traceIds.length ? '' : ' (o navegador não informou nenhum)'}.</p>
                    : <div className="divide-y divide-border-subtle">{d.serverErrors.map((e) => <ServerErrorCard key={e.id} e={e} />)}</div>}
                </div>
              </Card>
              {recordings.length > 0 && (
                <Card title="Gravações"><div className="px-5 pb-5"><AttachmentList ticketId={t.id} list={recordings} fallback={t.diagnostics} /></div></Card>
              )}
              <Card title="Diagnóstico do navegador">
                <div className="px-5 pb-5">{t.diagnostics ? <DiagnosticsPanel d={t.diagnostics} /> : <p className="text-[14px] text-fg-muted">O cliente não anexou diagnóstico.</p>}</div>
              </Card>
            </>
          )}

          {view === 'related' && (
            <div className="grid gap-3 md:grid-cols-2">
              <Card title="Mesmo erro (outros clientes)">
                <div className="px-5 pb-5">
                  {d.related.length === 0 ? <p className="text-[14px] text-fg-muted">Nenhum.</p> : (
                    <div className="flex flex-col divide-y divide-border-subtle">{d.related.map((r) => (
                      <Link key={r.id} href={`/tickets/${r.id}`} className="-mx-2 flex min-h-[56px] items-center gap-3 rounded-tile px-2 py-3 text-[14px] transition-colors duration-150 hover:bg-hover">
                        <span className="shrink-0 text-[13px] tabular-nums text-fg-muted">{r.code}</span><span className="min-w-0 truncate text-fg">{r.title}</span>
                        <span className="ml-auto shrink-0 text-[13px] text-fg-muted">{r.customer}</span><StatusPill status={r.status} />
                      </Link>
                    ))}</div>
                  )}
                </div>
              </Card>
              <Card title="Mesmo cliente">
                <div className="px-5 pb-5">
                  {d.sameCustomer.length === 0 ? <p className="text-[14px] text-fg-muted">Nenhum.</p> : (
                    <div className="flex flex-col divide-y divide-border-subtle">{d.sameCustomer.map((r) => (
                      <Link key={r.id} href={`/tickets/${r.id}`} className="-mx-2 flex min-h-[56px] items-center gap-3 rounded-tile px-2 py-3 text-[14px] transition-colors duration-150 hover:bg-hover">
                        <span className="shrink-0 text-[13px] tabular-nums text-fg-muted">{r.code}</span><span className="min-w-0 truncate text-fg">{r.title}</span>
                        <span className="ml-auto" /><StatusPill status={r.status} />
                      </Link>
                    ))}</div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Card>
            <div className="flex flex-col gap-5 p-5">
              <div><SideLabel>Situação</SideLabel>
                <Select className="w-full" value={t.status} onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><SideLabel>Urgência</SideLabel><Select className="w-full" value={t.severity} onChange={(e) => update.mutate({ severity: e.target.value })} options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} /></div>
                <div><SideLabel>Tipo</SideLabel><Select className="w-full" value={t.category} onChange={(e) => update.mutate({ category: e.target.value })} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} /></div>
              </div>
              <div><SideLabel>Responsável</SideLabel>
                <Select className="w-full" value={d.assigneeId ?? ''} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
                  options={[{ value: '', label: 'Ninguém' }, ...(team.data ?? []).filter((m) => !m.disabled).map((m) => ({ value: m.id, label: m.name }))]} /></div>
              <div><SideLabel>Corrigido em</SideLabel>
                <Input className="tabular-nums" value={fixedIn} placeholder="versão ou commit" onChange={(e) => setFixedIn(e.target.value)}
                  onBlur={() => { if (fixedIn !== (t.fixedIn ?? '')) update.mutate({ fixedIn }); }} />
                <p className="mt-1.5 text-[13px] leading-[1.45] text-fg-muted">Uma release com esse commit (ou versão) resolve o chamado sozinha. Citar o código {t.code} no commit também.</p></div>
              <div><SideLabel>Causa (interno)</SideLabel>
                <Textarea rows={3} value={note} placeholder="Causa e o que mudou." onChange={(e) => setNote(e.target.value)}
                  onBlur={() => { if (note !== (d.resolutionNote ?? '')) update.mutate({ resolutionNote: note }); }} /></div>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col divide-y divide-border-subtle px-5 py-1">
              <ProductFacts product={d.product} ticketId={t.id} />
              <Fact label="Cliente">
                {d.customer.name ?? '—'} <span className="text-[13px] text-fg-muted">{d.customer.id}</span>
                <div><Link href={`/?product=${d.product.id}&q=${encodeURIComponent(d.customer.name ?? d.customer.id)}&status=all`} className="text-[13px] font-semibold text-fg hover:underline">Outros chamados</Link></div>
              </Fact>
              <Fact label="Aberto por">
                {d.opener.name ?? '—'}
                {d.opener.email && <div className="text-[13px] text-fg-muted">{d.opener.email}</div>}
                <div className="text-[13px] text-fg-muted">{rel(t.createdAt)} · {dateTime(t.createdAt)}</div>
              </Fact>
              {t.route && <Fact label="Tela"><code className="break-all text-fg-secondary">{t.route}</code></Fact>}
            </div>
          </Card>

          {(ctx || t.traceIds.length > 0) && (
            <Card>
              <div className="flex flex-col divide-y divide-border-subtle px-5 py-1">
                {ctx && (
                  <Fact label="Navegador">
                    <div className="tabular-nums">v{String(ctx.appVersion ?? '')}{ctx.appCommit ? ` (${String(ctx.appCommit).slice(0, 7)})` : ''}{ctx.channel ? ` · ${String(ctx.channel)}` : ''}</div>
                    <div className="mt-0.5 text-[13px] break-words text-fg-muted">{String(ctx.userAgent ?? '')}</div>
                    {ctx.viewport && <div className="text-[13px] text-fg-muted">{ctx.viewport.width}×{ctx.viewport.height} @{ctx.viewport.dpr}x · {String(ctx.language ?? '')} · {String(ctx.timezone ?? '')}</div>}
                  </Fact>
                )}
                {t.traceIds.length > 0 && (
                  <Fact label="Trace ids">
                    <div className="flex flex-col items-end gap-0.5 break-all text-fg-muted">{t.traceIds.map((x) => <code key={x}>{x}</code>)}</div>
                  </Fact>
                )}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
