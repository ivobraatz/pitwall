'use client';

import * as React from 'react';
import { Button, Textarea } from '@/components/ui';

/**
 * Asked when a card lands in "Bloqueado": what went wrong. It is what the next Claude session
 * reads to check the task, so it wants the error as seen ("erro 400 ao salvar"), not "não deu".
 * Cancelling undoes the drop.
 */
export function BlockedPrompt({ code, onConfirm, onCancel, initial = '' }: {
  code: string; onConfirm: (note: string) => void; onCancel: () => void; initial?: string;
}) {
  const [note, setNote] = React.useState(initial);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  const ok = note.trim().length > 0 && note.length <= 2000;
  const submit = () => { if (ok) onConfirm(note.trim()); };
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-[18vh]" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="blocked-title" className="pop w-full max-w-md rounded-3xl bg-overlay p-6 shadow-popover">
        <h2 id="blocked-title" className="text-[19px] font-semibold tracking-[-0.015em] text-fg">Por que {code} está bloqueada?</h2>
        <p className="mt-1 text-[13px] leading-[1.45] text-fg-muted">Escreva o erro que você viu. O Claude lê esta nota para conferir a tarefa.</p>
        <Textarea autoFocus rows={4} className="mt-4" value={note} maxLength={2000} placeholder="Ex.: o painel recusa a URL com 'domínio não verificado'"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto text-[13px] text-fg-subtle">Ctrl+Enter confirma</span>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!ok}>Bloquear</Button>
        </div>
      </div>
    </div>
  );
}
