'use client';

import * as React from 'react';
import { TASK_STATUSES, type TaskStatus, type TasksMeta, type TeamTaskDetail } from '@/lib/api';
import { isOverdue, useArchive, useComment, useMoveTask, usePatchTask, useTask, type TaskPatch } from '@/lib/tasks';
import { productColor } from '@/components/product';
import { Button, ErrorBox, IconClose, Input, Pill, Select, Shimmer, Textarea, cn, dateTime, rel } from '@/components/ui';
import { BlockedPrompt } from './blocked-prompt';
import { IconRobot, STATUS_NAME } from './card';
import { Checklist } from './checklist';
import { Markdown } from './markdown';
import { Timeline } from './timeline';

/**
 * A text field saved as it is typed, 600 ms after the last key. What the server sends meanwhile
 * (the board polls) replaces it only while nobody is typing in it.
 */
function useDraft(server: string, save: (v: string) => void, delay = 600) {
  const [value, setValue] = React.useState(server);
  const dirty = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = React.useRef({ value, save });
  latest.current = { value, save };
  React.useEffect(() => { if (!dirty.current) setValue(server); }, [server]);
  const flush = React.useCallback(() => {
    clearTimeout(timer.current);
    if (dirty.current) { dirty.current = false; latest.current.save(latest.current.value); }
  }, []);
  React.useEffect(() => flush, [flush]);
  const change = (v: string) => {
    setValue(v);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return { value, change, flush };
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex items-center gap-2"><h3 className="text-[13px] font-semibold text-fg-muted">{title}</h3><span className="ml-auto">{aside}</span></div>
      {children}
    </section>
  );
}

function Labels({ value, onChange, suggestions }: { value: string[]; onChange: (labels: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = React.useState('');
  const id = React.useId();
  const add = () => {
    const label = draft.trim().toLowerCase().split(/[\s_]+/).filter(Boolean).join('-');
    setDraft('');
    if (!label || value.includes(label) || value.length >= 10) return;
    onChange([...value, label]);
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1 border border-border bg-well px-1.5 py-1 focus-within:border-focus">
      {value.map((l) => (
        <span key={l} className="inline-flex h-7 items-center gap-1 bg-chip pl-2 text-[13px] text-fg-secondary">
          {l}
          <button type="button" aria-label={`Remover etiqueta ${l}`} onClick={() => onChange(value.filter((x) => x !== l))}
            className="grid size-7 place-items-center text-fg-subtle hover:text-danger"><IconClose /></button>
        </span>
      ))}
      <input list={id} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={32} aria-label="Nova etiqueta"
        placeholder={value.length >= 10 ? '' : 'etiqueta + Enter'} disabled={value.length >= 10}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => { if (draft.trim()) add(); }}
        className="h-7 min-w-28 flex-1 bg-transparent px-1 text-[14px] text-fg outline-none placeholder:text-fg-subtle" />
      <datalist id={id}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

function Links({ links, onChange }: { links: TeamTaskDetail['links']; onChange: (l: TeamTaskDetail['links']) => void }) {
  const [label, setLabel] = React.useState('');
  const [url, setUrl] = React.useState('');
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  const add = () => {
    if (!valid) return;
    onChange([...links, { label: label.trim() || new URL(url.trim()).host, url: url.trim() }]);
    setLabel(''); setUrl('');
  };
  return (
    <div>
      {links.length > 0 && (
        <ul className="mb-2 flex flex-col gap-0.5">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="group flex h-9 items-center gap-2 bg-well px-2.5 text-[14px]">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="truncate font-semibold text-accent-fg hover:underline">{l.label}</a>
              <span className="truncate text-[13px] text-fg-subtle">{l.url}</span>
              <button type="button" aria-label={`Remover link ${l.label}`} onClick={() => onChange(links.filter((_, j) => j !== i))}
                className="ml-auto grid size-6 shrink-0 place-items-center text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"><IconClose /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rótulo" aria-label="Rótulo do link" className="h-9 w-32 shrink-0" maxLength={80} />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Endereço do link" className="h-9" code maxLength={500}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button size="sm" className="h-9" onClick={add} disabled={!valid}>Adicionar</Button>
      </div>
    </div>
  );
}

function Detail({ task, meta }: { task: TeamTaskDetail; meta?: TasksMeta }) {
  const patch = usePatchTask();
  const move = useMoveTask();
  const comment = useComment();
  const archive = useArchive();
  const [askBlocked, setAskBlocked] = React.useState(false);
  const [tab, setTab] = React.useState<'view' | 'edit'>(task.body ? 'view' : 'edit');
  const save = (p: TaskPatch) => patch.mutate({ task, patch: p });

  const title = useDraft(task.title, (v) => { const t = v.trim(); if (t && t !== task.title) save({ title: t }); });
  const body = useDraft(task.body, (v) => { if (v !== task.body) save({ body: v }); });
  const note = useDraft(task.blockedNote ?? '', (v) => { const n = v.trim(); if (n && n !== task.blockedNote) save({ blockedNote: n }); });

  const setStatus = (status: TaskStatus) => {
    if (status === task.status) return;
    if (status === 'blocked') setAskBlocked(true);
    else move.mutate({ task, status });
  };
  const overdue = isOverdue(task);

  return (
    <>
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <span className="font-semibold tabular-nums text-fg-secondary">{task.code}</span>
        {task.product && <span className="inline-flex items-center gap-1.5"><span className="size-2.5" style={{ background: productColor(task.product) }} />{task.product.name}</span>}
        {task.source === 'claude' && <span className="inline-flex items-center gap-1 text-accent-fg"><IconRobot />Claude</span>}
        {task.archivedAt && <Pill tone="idle">Arquivada</Pill>}
      </div>
      <textarea value={title.value} onChange={(e) => title.change(e.target.value.replace(/\n/g, ' '))} onBlur={title.flush} rows={1} maxLength={200}
        aria-label="Título" className="display mt-2 w-full resize-none bg-transparent text-[28px] text-fg outline-none [field-sizing:content] hover:bg-hover/50 focus:bg-hover/50" />
      <p className="mt-1 text-[13px] text-fg-muted">
        Criada por {task.createdBy.name} {rel(task.createdAt)} · mudou {rel(task.updatedAt)}
      </p>

      {task.status === 'blocked' && (
        <div className="mt-5 bg-danger/12 p-3">
          <p className="mb-1.5 text-[13px] font-semibold text-danger">Bloqueada: o que deu errado</p>
          <Textarea rows={3} value={note.value} onChange={(e) => note.change(e.target.value)} onBlur={note.flush} maxLength={2000}
            aria-label="Nota de bloqueio" className="bg-surface" />
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-fg-muted">Status
          <Select value={task.status} onChange={(e) => setStatus(e.target.value as TaskStatus)} disabled={!!task.archivedAt}
            options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_NAME[s] }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-fg-muted">Prioridade
          <Select value={task.priority} onChange={(e) => save({ priority: e.target.value as TeamTaskDetail['priority'] })}
            options={[{ value: 'low', label: 'Baixa' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Alta' }]} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-fg-muted">
          <span>Prazo {overdue && <span className="text-danger">· atrasada</span>}</span>
          <Input type="date" value={task.dueDate ?? ''} onChange={(e) => save({ dueDate: e.target.value || null })} className={cn(overdue && 'border-danger text-danger')} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-fg-muted">Responsável
          <Select value={task.assignee?.id ?? ''} onChange={(e) => save({ assigneeId: e.target.value || null })}
            options={[{ value: '', label: 'Ninguém' }, ...(meta?.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-[13px] font-semibold text-fg-muted">Sistema
          <Select value={task.product?.slug ?? ''} onChange={(e) => save({ product: e.target.value || null })}
            options={[{ value: '', label: 'Geral da equipe' }, ...(meta?.products ?? []).map((p) => ({ value: p.slug, label: p.name }))]} />
        </label>
        <div className="col-span-2 flex flex-col gap-1 text-[13px] font-semibold text-fg-muted sm:col-span-3">Etiquetas
          <Labels value={task.labels} onChange={(labels) => save({ labels })} suggestions={(meta?.labels ?? []).map((l) => l.name)} />
        </div>
      </div>

      <Section title="Descrição" aside={
        <span className="flex" role="tablist" aria-label="Modo da descrição">
          {(['view', 'edit'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { body.flush(); setTab(t); }}
              className={cn('h-7 px-2.5 text-[13px] font-semibold', tab === t ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>
              {t === 'view' ? 'Ver' : 'Editar'}
            </button>
          ))}
        </span>
      }>
        {tab === 'edit' ? (
          <Textarea rows={10} value={body.value} onChange={(e) => body.change(e.target.value)} onBlur={body.flush} maxLength={20000}
            placeholder={'Por que, os passos exatos e como saber se deu certo.\n\nMarkdown: **negrito**, listas, `código`, [link](https://…)'}
            aria-label="Descrição em markdown" className="text-[14px]" />
        ) : body.value.trim() ? (
          <div className="bg-well px-3 py-2.5"><Markdown>{body.value}</Markdown></div>
        ) : (
          <button type="button" onClick={() => setTab('edit')} className="w-full bg-well px-3 py-4 text-left text-[14px] text-fg-subtle hover:bg-hover">Sem descrição. Clique para escrever.</button>
        )}
      </Section>

      <Section title="Checklist">
        <Checklist items={task.checklist} onChange={(checklist) => save({ checklist })} />
      </Section>

      <Section title="Links">
        <Links links={task.links} onChange={(links) => save({ links })} />
      </Section>

      <Section title="Atividade">
        <Timeline comments={task.comments} events={task.events} sending={comment.isPending}
          onComment={(text) => comment.mutateAsync({ task, body: text })} />
      </Section>

      <div className="mt-8 flex items-center gap-2 border-t border-border-subtle pt-4 text-[13px] text-fg-muted">
        <span title={dateTime(task.updatedAt)}>{task.doneAt ? `Concluída ${rel(task.doneAt)}` : ''}</span>
        <span className="ml-auto">
          {task.archivedAt
            ? <Button size="sm" onClick={() => archive.mutate({ task, archived: false })} loading={archive.isPending}>Desarquivar</Button>
            : <Button size="sm" variant="danger" onClick={() => archive.mutate({ task, archived: true })} loading={archive.isPending}>Arquivar</Button>}
        </span>
      </div>

      {askBlocked && (
        <BlockedPrompt code={task.code} onCancel={() => setAskBlocked(false)}
          onConfirm={(n) => { setAskBlocked(false); move.mutate({ task, status: 'blocked', blockedNote: n }); }} />
      )}
    </>
  );
}

/** The card opened: everything about it, editable in place. Lives at `?task=T-XXXXX`, so it can be linked. */
export function TaskDrawer({ code, meta, onClose }: { code: string; meta?: TasksMeta; onClose: () => void }) {
  const task = useTask(code);
  const panel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { panel.current?.focus(); }, [code]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="fade-in absolute inset-0 bg-scrim" onClick={onClose} aria-hidden />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={task.data ? `${task.data.code}: ${task.data.title}` : 'Tarefa'}
        className="relative h-full w-full max-w-[680px] overflow-x-hidden overflow-y-auto bg-overlay px-6 pt-5 pb-10 shadow-popover outline-none focus-visible:outline-none sm:px-8">
        <button type="button" onClick={onClose} aria-label="Fechar (Esc)" title="Fechar (Esc)"
          className="absolute top-4 right-4 grid size-9 place-items-center text-fg-muted transition-colors hover:bg-hover hover:text-fg"><IconClose /></button>
        {task.data ? <Detail key={task.data.id} task={task.data} meta={meta} />
          : task.error ? <div className="pt-10"><ErrorBox error={task.error} onRetry={() => void task.refetch()} /></div>
          : <div className="flex flex-col gap-3 pt-2"><Shimmer className="h-5 w-40" /><Shimmer className="h-10 w-4/5" /><Shimmer className="h-40" /></div>}
      </div>
    </div>
  );
}
