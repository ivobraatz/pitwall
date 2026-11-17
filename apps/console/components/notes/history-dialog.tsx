'use client';

import * as React from 'react';
import { Markdown } from '@/components/tasks/markdown';
import { Button, Dialog, ErrorBox, Shimmer, cn, rel } from '@/components/ui';
import { useRestoreRevision, useRevision, useRevisions } from '@/lib/notes';

/**
 * The note's earlier bodies, newest first. Restoring puts the chosen body back and first keeps the
 * current one as a revision; the editor is reloaded by the caller.
 */
export function HistoryDialog({ code, canRestore, onRestored, onClose }: {
  code: string; canRestore: boolean; onRestored: () => void; onClose: () => void;
}) {
  const revs = useRevisions(code, true);
  const [picked, setPicked] = React.useState<string | null>(null);
  const detail = useRevision(code, picked);
  const restore = useRestoreRevision();

  return (
    <Dialog open onClose={onClose} title="Histórico" wide>
      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-w-0">
          {revs.isPending ? (
            <div className="flex flex-col gap-2"><Shimmer className="h-12" /><Shimmer className="h-12" /></div>
          ) : revs.error ? (
            <ErrorBox error={revs.error} onRetry={() => void revs.refetch()} />
          ) : (revs.data?.items.length ?? 0) === 0 ? (
            <p className="text-[14px] text-fg-muted">Ainda não há versões anteriores.</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
              {revs.data!.items.map((r) => (
                <li key={r.id}>
                  <button type="button" aria-pressed={picked === r.id} onClick={() => setPicked(r.id)}
                    className={cn('flex w-full flex-col gap-0.5 rounded-tile px-3 py-2.5 text-left transition-colors duration-150',
                      picked === r.id ? 'bg-sel text-sel-fg' : 'hover:bg-hover')}>
                    <span className="truncate text-[14px] font-medium text-fg">{r.title}</span>
                    <span className="truncate text-[12px] text-fg-muted">
                      {rel(r.createdAt)} · {r.source === 'claude' ? 'Claude' : r.authorName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="max-h-[52vh] min-h-40 overflow-y-auto rounded-tile bg-well px-4 py-3">
            {!picked ? (
              <p className="text-[14px] text-fg-muted">Escolha uma versão para ver o texto.</p>
            ) : detail.isPending ? (
              <Shimmer className="h-40" />
            ) : detail.error ? (
              <ErrorBox error={detail.error} />
            ) : detail.data ? (
              detail.data.body.trim() ? <Markdown>{detail.data.body}</Markdown> : <p className="text-[14px] text-fg-muted">Sem texto nessa versão.</p>
            ) : null}
          </div>
          {restore.error ? <ErrorBox error={restore.error} /> : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Fechar</Button>
            <Button variant="primary" disabled={!picked || !detail.data || !canRestore} loading={restore.isPending}
              title={canRestore ? undefined : 'Espere o texto salvar'}
              onClick={() => restore.mutate({ code, id: picked! }, { onSuccess: onRestored })}>
              Restaurar esta versão
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
