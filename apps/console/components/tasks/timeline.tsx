'use client';

import * as React from 'react';
import type { TaskComment, TaskEvent } from '@/lib/api';
import { Button, Textarea, dateTime, rel, cn } from '@/components/ui';
import { IconRobot, STATUS_NAME } from './card';
import { Markdown } from './markdown';

const FIELD_NAME: Record<string, string> = {
  title: 'título', body: 'corpo', priority: 'prioridade', labels: 'etiquetas', product: 'sistema',
  dueDate: 'prazo', assignee: 'responsável', checklist: 'checklist', links: 'links',
};

function eventText(e: TaskEvent): string {
  const d = e.data ?? {};
  const col = (s?: string) => (s && s in STATUS_NAME ? STATUS_NAME[s as keyof typeof STATUS_NAME] : s ?? '');
  switch (e.kind) {
    case 'created': return 'criou a tarefa';
    case 'moved': return `moveu de ${col(d.from)} para ${col(d.to)}`;
    case 'updated': return `editou ${(d.fields ?? []).map((f) => FIELD_NAME[f] ?? f).join(', ')}`;
    case 'blocked': return 'bloqueou';
    case 'archived': return 'arquivou';
    case 'unarchived': return 'desarquivou';
    default: return e.kind;
  }
}

function Who({ name, source }: { name: string; source: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-fg">
      {source === 'claude' && <span className="text-accent-fg" title="Pelo Claude (MCP)"><IconRobot size={13} /></span>}{name}
    </span>
  );
}

/** Comments and what happened, in one line of time, with the comment box at the end. */
export function Timeline({ comments, events, onComment, sending }: {
  comments: TaskComment[]; events: TaskEvent[]; onComment: (body: string) => Promise<unknown>; sending: boolean;
}) {
  const [body, setBody] = React.useState('');
  const rows = React.useMemo(() => [
    ...comments.map((c) => ({ at: c.createdAt, key: `c-${c.id}`, comment: c, event: undefined as TaskEvent | undefined })),
    ...events.filter((e) => e.kind !== 'commented').map((e) => ({ at: e.createdAt, key: `e-${e.id}`, comment: undefined as TaskComment | undefined, event: e })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [comments, events]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    try { await onComment(text); setBody(''); } catch { /* the toast already said it; the text stays */ }
  };

  return (
    <div>
      <ol className="flex flex-col gap-1">
        {rows.map((r) => r.comment ? (
          <li key={r.key} className={cn('px-3 py-2.5', r.comment.source === 'claude' ? 'bg-accent-bg' : 'bg-well')}>
            <div className="mb-1 flex items-center gap-2 text-[13px] text-fg-muted">
              <Who name={r.comment.authorName} source={r.comment.source} />
              <span title={dateTime(r.at)}>{rel(r.at)}</span>
            </div>
            <Markdown>{r.comment.body}</Markdown>
          </li>
        ) : (
          <li key={r.key} className="flex flex-col gap-1 px-3 py-1.5 text-[13px] text-fg-muted">
            <span><Who name={r.event!.actorName} source={r.event!.source} /> {eventText(r.event!)} · <span title={dateTime(r.at)}>{rel(r.at)}</span></span>
            {r.event!.kind === 'blocked' && r.event!.data?.note && (
              <span className="bg-danger/12 px-2 py-1 whitespace-pre-wrap text-fg-secondary">{r.event!.data.note}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3">
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000}
          placeholder="Comentar: o que você viu, o que testou (markdown)" aria-label="Comentário"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="text-[13px] text-fg-subtle">Ctrl+Enter envia</span>
          <Button size="sm" variant="primary" loading={sending} disabled={!body.trim()} onClick={() => void send()}>Comentar</Button>
        </div>
      </div>
    </div>
  );
}
