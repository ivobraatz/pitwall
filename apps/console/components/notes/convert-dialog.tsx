'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { STATUS_NAME } from '@/components/tasks/card';
import { Button, Dialog, ErrorBox, Field, Input, Select, Shimmer, cn } from '@/components/ui';
import { useConvertNote, useTaskPreview } from '@/lib/notes';

/**
 * Turns the note into a task. The draft is the server's, read from the saved text (the button is only
 * there once the text is saved). Below 50 points the server refuses unless the person insists.
 * Mount it only while it is open: its fields start from the draft each time.
 */
export function ConvertDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const draft = useTaskPreview(code, true);
  const convert = useConvertNote(code);
  const qc = useQueryClient();
  const [title, setTitle] = React.useState<string | null>(null);
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'high'>('normal');
  const [dueDate, setDueDate] = React.useState('');
  const [status, setStatus] = React.useState<'todo' | 'doing'>('todo');
  const [made, setMade] = React.useState<string | null>(null);

  const d = draft.data;
  const score = d?.readiness.score ?? 0;
  const force = score < 50;

  const submit = () => {
    convert.mutate({
      title: (title ?? d?.title ?? '').trim() || undefined,
      priority, dueDate: dueDate || undefined, status, force: force || undefined,
    }, {
      onSuccess: (r) => setMade(r.task.code),
      // Already converted by someone else: the note's cache is fresh now, the dialog says so.
      onError: () => void qc.invalidateQueries({ queryKey: ['notes'] }),
    });
  };

  return (
    <Dialog open onClose={onClose} title={made ? 'Tarefa criada' : 'Virar tarefa'}>
      {made ? (
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-[1.5] text-fg-secondary">
            A anotação agora é a tarefa <strong className="font-semibold text-fg">{made}</strong>, no quadro.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
            <Link href={`/tasks?task=${made}`} className="inline-flex h-10 items-center rounded-full bg-btn px-5 text-[14px] font-semibold text-btn-fg transition-colors duration-150 hover:bg-btn-hover">
              Abrir no quadro
            </Link>
          </div>
        </div>
      ) : draft.isPending ? (
        <div className="flex flex-col gap-3"><Shimmer className="h-5 w-40" /><Shimmer className="h-2" /><Shimmer className="h-24" /></div>
      ) : draft.error || !d ? (
        <ErrorBox error={draft.error ?? new Error('Não foi possível montar a tarefa.')} onRetry={() => void draft.refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
              <span className="font-semibold text-fg">{score}/100</span>
              <span className="text-fg-muted">{d.readiness.ready ? 'Pronta para virar tarefa.' : 'Ainda não está estruturada.'}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-well" role="meter" aria-label="Prontidão" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
              <div className="h-full rounded-full bg-btn" style={{ width: `${score}%` }} />
            </div>
            {d.readiness.missing.length > 0 && (
              <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-[14px] text-fg-secondary">
                {d.readiness.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </div>

          <Field label="Título da tarefa">
            <Input value={title ?? d.title} maxLength={200} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))} />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Prioridade">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}
                options={[{ value: 'low', label: 'Baixa' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Alta' }]} />
            </Field>
            <Field label="Prazo">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
                options={[{ value: 'todo', label: STATUS_NAME.todo }, { value: 'doing', label: STATUS_NAME.doing }]} />
            </Field>
          </div>

          {d.checklist.length > 0 && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-fg-muted">Checklist ({d.checklist.length})</p>
              <ul className="flex flex-col gap-1.5 text-[14px] text-fg-secondary">
                {d.checklist.map((c, i) => (
                  <li key={`${i}-${c}`} className="flex items-start gap-2.5">
                    <span aria-hidden className={cn('mt-1 size-3 shrink-0 rounded-[4px] border', d.checklistDone?.[i] ? 'border-fg bg-fg' : 'border-border-strong')} />
                    <span className="min-w-0 break-words">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.links.length > 0 && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-fg-muted">Links ({d.links.length})</p>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {d.links.map((l) => (
                  <li key={l.url} className={cn('flex min-w-0 items-baseline gap-2')}>
                    <span className="shrink-0 font-medium text-fg">{l.label}</span>
                    <span className="min-w-0 truncate text-fg-muted">{l.url}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {convert.error && <ErrorBox error={convert.error} />}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={convert.isPending} onClick={submit}>{force ? 'Criar mesmo assim' : 'Criar tarefa'}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
