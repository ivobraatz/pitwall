'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CATEGORIES, SEVERITIES, STATUSES, type Diagnostics, type Dossier, type ServerErrorRow, type StaffMember, type TicketStatus } from '@/lib/api';
import {
  Button, Card, ErrorBox, IconChevron, IconClip, IconClose, Input, PageHeader, Pill, Select, SideLabel, Shimmer, StatusPill, Textarea,
  CATEGORY_LABEL, SEVERITY_LABEL, STATUS_LABEL, cn, dateTime, rel, useToast,
} from '@/components/ui';
import { AttachmentList } from '@/components/recording';
import { useMe } from '@/components/shell';
import { ProductMark, ProductName, useProduct } from '@/components/product';

/** The system the ticket came from: who answers for it and where it lives. */
function ProductFacts({ product, ticketId }: { product: Dossier['product']; ticketId: string }) {
  const p = useProduct(product);
  const site = p?.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <div><SideLabel>Sistema</SideLabel>
      <div className="flex items-center gap-3">
        <ProductMark product={product} size={36} />
        <div className="min-w-0">
          <Link href={`/products/${product.id}`} className="font-semibold text-fg hover:underline">{product.name}</Link>
          {p?.owner && <div className="truncate text-[13px] text-fg-muted">Responsável: {p.owner.name}</div>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-semibold">
        {product.customerTicketUrl && <a className="text-accent-fg hover:underline" target="_blank" rel="noopener" href={product.customerTicketUrl.replace('{id}', ticketId)}>ver no sistema ↗</a>}
        {site && <a className="truncate text-accent-fg hover:underline" target="_blank" rel="noopener" href={p!.websiteUrl!}>{site} ↗</a>}
      </div>
    </div>
  );
}

function ServerErrorCard({ e }: { e: ServerErrorRow }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="bg-danger/8">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-danger/12">
        <span className="mt-1 text-fg-muted"><IconChevron open={open} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px]"><span className="font-semibold tabular-nums text-danger">{e.statusCode}</span><code className="text-fg-muted">{e.method} {e.routeTemplate ?? e.path}</code></div>
          <div className="mt-0.5 truncate text-[14px] font-semibold text-fg">{e.exceptionType.split('.').pop()}: <span className="font-normal text-fg-secondary">{e.message}</span></div>
          <div className="mt-0.5 text-[13px] text-fg-subtle">{dateTime(e.occurredAt)} · <code>{e.traceId}</code>{e.release ? ` · ${e.release}` : ''}</div>
        </div>
      </button>
      {open && (
        <div className="fade-in bg-well px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-fg-muted">
            <code>{e.path}</code>
            <button onClick={() => navigator.clipboard.writeText(e.stackTrace ?? '')} className="font-sans text-[13px] font-semibold hover:text-fg">Copiar</button>
          </div>
          <pre className="max-h-80 overflow-auto leading-relaxed whitespace-pre-wrap break-all text-fg-secondary">{e.stackTrace ?? '(sem stack trace)'}</pre>
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
    <div className="overflow-hidden bg-well">
      <div className="flex flex-wrap gap-1 p-1.5">
        {tabs.map(([id, label, n]) => (
          <button key={id} onClick={() => setTab(id)} className={cn('h-8 px-3 text-[13px] font-semibold transition-colors', tab === id ? 'bg-fg text-bg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>
            {label}{n > 0 && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
          </button>
        ))}
      </div>
      <div className="code-block max-h-96 overflow-auto">
        {tab === 'requests' && d.requests.map((r, i) => (
          <div key={i} className={cn('flex gap-2 px-3 py-1.5 even:bg-surface/60', r.status >= 500 || r.status === 0 ? 'text-danger' : r.status >= 400 ? 'text-warning' : 'text-fg-muted')}>
            <span className="w-14 shrink-0 text-fg-subtle">{at(r.t)}</span><span className="w-12 shrink-0">{r.status || r.code}</span>
            <span className="w-12 shrink-0">{r.method}</span><span className="min-w-0 flex-1 truncate">{r.path}</span>
            <span className="w-14 shrink-0 text-right text-fg-subtle">{r.ms}ms</span>
            {r.traceId && <span className="w-28 shrink-0 truncate text-fg-subtle" title={r.traceId}>{r.traceId}</span>}
          </div>
        ))}
        {tab === 'logs' && d.logs.map((l, i) => (
          <div key={i} className={cn('flex gap-2 px-3 py-1.5 even:bg-surface/60', l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-fg-muted')}>
            <span className="w-14 shrink-0 text-fg-subtle">{at(l.t)}</span><span className="w-12 shrink-0">{l.level}</span><span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{l.msg}</span>
          </div>
        ))}
        {tab === 'errors' && (d.errors.length === 0 ? <p className="px-3 py-3 text-fg-subtle">Nenhum erro não tratado.</p> : d.errors.map((e, i) => (
          <div key={i} className="px-3 py-2 text-danger even:bg-surface/60">
            <div><span className="text-fg-subtle">{at(e.t)}</span> {e.kind}: {e.msg}</div>
            {e.stack && <pre className="mt-1 break-all whitespace-pre-wrap text-fg-muted">{e.stack}</pre>}
          </div>
        )))}
        {tab === 'events' && d.events.map((e, i) => (
          <div key={i} className="flex gap-2 px-3 py-1.5 text-fg-muted even:bg-surface/60">
            <span className="w-14 shrink-0 text-fg-subtle">{at(e.t)}</span><span className="w-16 shrink-0">{e.kind}</span><span className="min-w-0 flex-1 truncate">{e.detail}</span>
          </div>
        ))}
        {tab === 'context' && (
          <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-fg-muted">
            {Object.entries(d.context).map(([k, v]) => (
              <React.Fragment key={k}><dt className="text-fg-subtle">{k}</dt><dd className="break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></React.Fragment>
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
  const [internal, setInternal] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [sending, setSending] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const t = d.ticket;

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
    <div className="flex min-h-[520px] flex-col overflow-hidden bg-surface xl:h-[calc(100vh-240px)]">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {items.map((m) => (
          <div key={m.id} className={cn('fade-in mt-5 flex max-w-[82%] flex-col first:mt-0', m.fromTeam ? 'ml-auto items-end' : 'items-start')}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
              <span className="font-semibold text-fg">{m.author?.name ?? '—'}</span>
              {m.fromTeam && !m.internal && <Pill tone="accent" className="h-5 px-1.5">equipe</Pill>}
              {m.internal && <Pill tone="warn" className="h-5 px-1.5">nota interna</Pill>}
              {m.opening && <span className="text-fg-subtle">abriu o chamado</span>}
              <span className="text-fg-subtle">· {dateTime(m.at)}</span>
            </div>
            <div className={cn('px-4 py-3 text-[14px] leading-[1.55] text-fg',
              m.internal ? 'bg-warning/12' : m.fromTeam ? 'bg-active' : 'bg-well')}>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <AttachmentList ticketId={t.id} list={m.atts} fallback={t.diagnostics} />
            </div>
          </div>
        ))}
      </div>
      <div className={cn('transition-colors duration-200', internal ? 'bg-warning/10' : 'bg-well')}>
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 text-[13px]">
          <div className="flex gap-1">
            <button onClick={() => setInternal(false)} className={cn('h-8 px-3 font-semibold transition-colors', !internal ? 'bg-fg text-bg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>Responder ao cliente</button>
            <button onClick={() => setInternal(true)} className={cn('h-8 px-3 font-semibold transition-colors', internal ? 'bg-warning text-on-status' : 'text-fg-muted hover:bg-hover hover:text-fg')}>Nota interna</button>
          </div>
          {!internal && (
            <>
              <span className="text-fg-muted">e mudar para</span>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8"
                options={[{ value: '', label: 'manter situação' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
            </>
          )}
          {internal && <span className="font-semibold text-warning">O cliente não vê notas internas.</span>}
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">{files.map((f, i) => (
            <span key={i} className="inline-flex h-8 items-center gap-1 bg-chip pl-2.5 text-[13px]">{f.name}
              <button onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} className="grid size-8 place-items-center text-fg-muted hover:text-fg" aria-label={`Remover ${f.name}`}><IconClose /></button></span>
          ))}</div>
        )}
        <div className="flex items-end gap-2 p-2">
          <label className="grid size-10 shrink-0 cursor-pointer place-items-center text-fg-muted transition-colors hover:bg-hover hover:text-fg" title="Anexar arquivo" aria-label="Anexar arquivo"><IconClip />
            <input type="file" multiple className="sr-only" accept="image/*,video/mp4,video/webm,video/quicktime,.txt,.csv,.pdf,.json" onChange={(e) => { if (e.target.files) setFiles((c) => [...c, ...Array.from(e.target.files!)].slice(0, 6)); e.target.value = ''; }} />
          </label>
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'Anotação para a equipe…' : 'Resposta ao cliente (assinada como a equipe)…'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} className="min-h-[64px] bg-surface" />
          <Button variant="primary" loading={sending} disabled={!body.trim()} onClick={send}>{internal ? 'Salvar nota' : 'Enviar'}</Button>
        </div>
        <div className="px-3 pb-2 text-right text-[13px] text-fg-subtle">Ctrl+Enter envia</div>
      </div>
    </div>
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

  if (q.isLoading) return <div className="flex flex-col gap-2"><Shimmer className="mb-6 h-12 w-96" /><Shimmer className="h-96" /></div>;
  if (q.isError || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const t = d.ticket;
  const recordings = t.attachments.filter((a) => a.kind === 'recording');
  const mine = !!me && d.assigneeId === me.id;
  const ctx = t.diagnostics?.context;

  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold tabular-nums text-fg-secondary">{t.code}</span><ProductName product={d.product} size={20} className="gap-2" /><span>{d.customer.name ?? d.customer.id}</span><StatusPill status={t.status} /></span>}
        actions={<Button variant={mine ? 'secondary' : 'primary'} onClick={() => update.mutate({ assigneeId: mine ? null : me?.id })}>{mine ? 'Comigo' : 'Assumir'}</Button>}
      />
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="mb-2 flex w-fit flex-wrap gap-1 text-[14px]">
            {([['chat', `Conversa (${t.messages.length})`], ['evidence', `Evidências (${d.serverErrors.length + (t.diagnostics ? 1 : 0) + recordings.length})`], ['related', `Relacionados (${d.related.length + d.sameCustomer.length})`]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className={cn('h-10 px-4 font-semibold transition-colors duration-150', view === v ? 'bg-fg text-bg' : 'bg-surface text-fg-muted hover:bg-hover hover:text-fg')}>{label}</button>
            ))}
          </div>

          {view === 'chat' && <Thread d={d} onSent={refresh} />}

          {view === 'evidence' && (
            <div className="flex flex-col gap-2">
              <Card title={`Erros do servidor (${d.serverErrors.length})`}>
                <div className="flex flex-col gap-1 px-5 pt-1 pb-5">
                  {d.errorSignature && (
                    <p className="mb-2 text-[13px] leading-[1.5] text-fg-muted">
                      Assinatura <code>{d.errorSignature}</code> · vista {d.signatureOccurrences}× nos últimos 30 dias ·{' '}
                      <Link href={`/?signature=${d.errorSignature}`} className="text-accent-fg hover:underline">chamados com o mesmo bug</Link> ·{' '}
                      <Link href={`/errors?signature=${d.errorSignature}&product=${d.product.id}`} className="text-accent-fg hover:underline">ocorrências</Link>
                    </p>
                  )}
                  {d.serverErrors.length === 0
                    ? <p className="text-[14px] text-fg-muted">Nenhum erro do servidor bateu com os trace ids deste chamado{t.traceIds.length ? '' : ' (o navegador não informou nenhum)'}.</p>
                    : d.serverErrors.map((e) => <ServerErrorCard key={e.id} e={e} />)}
                </div>
              </Card>
              {recordings.length > 0 && (
                <Card title="Gravações"><div className="px-5 pt-1 pb-5"><AttachmentList ticketId={t.id} list={recordings} fallback={t.diagnostics} /></div></Card>
              )}
              <Card title="Diagnóstico do navegador">
                <div className="px-5 pt-1 pb-5">{t.diagnostics ? <DiagnosticsPanel d={t.diagnostics} /> : <p className="text-[14px] text-fg-muted">O cliente não anexou diagnóstico.</p>}</div>
              </Card>
            </div>
          )}

          {view === 'related' && (
            <div className="grid gap-2 md:grid-cols-2">
              <Card title="Mesmo erro (outros clientes)">
                {d.related.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted">Nenhum.</p> : d.related.map((r) => (
                  <Link key={r.id} href={`/tickets/${r.id}`} className="mx-2 mb-1 flex items-center gap-3 bg-well px-3 py-2.5 text-[14px] transition-colors last:mb-2 hover:bg-hover">
                    <span className="text-[13px] tabular-nums text-fg-muted">{r.code}</span><span className="truncate">{r.title}</span>
                    <span className="ml-auto shrink-0 text-[13px] text-fg-muted">{r.customer}</span><StatusPill status={r.status} />
                  </Link>
                ))}
              </Card>
              <Card title="Mesmo cliente">
                {d.sameCustomer.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted">Nenhum.</p> : d.sameCustomer.map((r) => (
                  <Link key={r.id} href={`/tickets/${r.id}`} className="mx-2 mb-1 flex items-center gap-3 bg-well px-3 py-2.5 text-[14px] transition-colors last:mb-2 hover:bg-hover">
                    <span className="text-[13px] tabular-nums text-fg-muted">{r.code}</span><span className="truncate">{r.title}</span>
                    <span className="ml-auto" /><StatusPill status={r.status} />
                  </Link>
                ))}
              </Card>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-2">
          <Card className="rise" style={{ '--i': 1 } as React.CSSProperties}>
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
          <Card className="rise" style={{ '--i': 2 } as React.CSSProperties}>
            <div className="flex flex-col gap-5 p-5 text-[14px] text-fg">
              <ProductFacts product={d.product} ticketId={t.id} />
              <div><SideLabel>Cliente</SideLabel>{d.customer.name ?? '—'} <span className="text-[13px] text-fg-muted">{d.customer.id}</span>
                <div><Link href={`/?product=${d.product.id}&q=${encodeURIComponent(d.customer.name ?? d.customer.id)}&status=all`} className="text-[13px] font-semibold text-accent-fg hover:underline">Outros chamados</Link></div></div>
              <div><SideLabel>Aberto por</SideLabel>{d.opener.name ?? '—'}{d.opener.email && <div className="text-[13px] text-fg-muted">{d.opener.email}</div>}
                <div className="text-[13px] text-fg-muted">{rel(t.createdAt)} · {dateTime(t.createdAt)}</div></div>
              {t.route && <div><SideLabel>Tela</SideLabel><code className="break-all text-fg-secondary">{t.route}</code></div>}
              {ctx && (
                <div><SideLabel>Navegador</SideLabel>
                  <div className="tabular-nums">v{String(ctx.appVersion ?? '')}{ctx.appCommit ? ` (${String(ctx.appCommit).slice(0, 7)})` : ''}{ctx.channel ? ` · ${String(ctx.channel)}` : ''}</div>
                  <div className="mt-0.5 text-[13px] break-words text-fg-muted">{String(ctx.userAgent ?? '')}</div>
                  {ctx.viewport && <div className="text-[13px] text-fg-muted">{ctx.viewport.width}×{ctx.viewport.height} @{ctx.viewport.dpr}x · {String(ctx.language ?? '')} · {String(ctx.timezone ?? '')}</div>}
                </div>
              )}
              {t.traceIds.length > 0 && <div><SideLabel>Trace ids</SideLabel><div className="flex flex-col break-all text-fg-muted">{t.traceIds.map((x) => <code key={x}>{x}</code>)}</div></div>}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
