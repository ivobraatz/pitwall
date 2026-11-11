'use client';

import * as React from 'react';
import { Dialog } from '@/components/ui';

/** Typing somewhere: the board's single-key shortcuts stay out of the way. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * N new task in "A fazer", / search, Esc close, ? this list. Off while the focus is in a field
 * (Esc there belongs to the field) and while a dialog or a drag holds the keyboard.
 */
export function useShortcuts(handlers: { onNew: () => void; onSearch: () => void; onEscape: () => void; onHelp: () => void }, enabled = true) {
  const ref = React.useRef(handlers);
  ref.current = handlers;
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { if (!typing(e.target)) ref.current.onEscape(); return; }
      if (typing(e.target)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); ref.current.onNew(); }
      else if (e.key === '/') { e.preventDefault(); ref.current.onSearch(); }
      else if (e.key === '?') { e.preventDefault(); ref.current.onHelp(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

const KEYS: Array<[string, string]> = [
  ['N', 'Nova tarefa em "A fazer"'],
  ['/', 'Buscar'],
  ['Esc', 'Fechar a tarefa aberta ou o aviso'],
  ['?', 'Esta lista'],
  ['Tab', 'Ir de cartão em cartão'],
  ['Enter', 'Abrir o cartão em foco'],
  ['Espaço', 'Pegar o cartão; setas movem; Espaço solta'],
  ['Ctrl+Enter', 'Enviar o comentário'],
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Atalhos">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-[14px]">
        {KEYS.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt><kbd className="rounded-md bg-well px-1.5 py-0.5 text-[12px]">{k}</kbd></dt>
            <dd className="text-fg-secondary">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="mt-5 text-[13px] text-fg-muted">As teclas de uma letra ficam desligadas enquanto você digita num campo.</p>
    </Dialog>
  );
}
