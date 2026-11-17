'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { NoteStage } from '@/lib/api';
import { NOTE_TEMPLATES, STAGE_LABEL, STAGE_TONE, type NoteTemplate } from '@/lib/notes';
import { Button, Icon, Pill, cn } from '@/components/ui';

/** The screen's state lives in the URL (?folder ?note ?q ?stage): links and reloads keep the view. */
export interface UrlState {
  get(key: string): string;
  /** A link to this screen with some params changed (empty value removes one). */
  href(patch: Record<string, string>): string;
  /** Changes params in place, without a new history entry. */
  set(patch: Record<string, string>): void;
}

export function useUrlState(): UrlState {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const href = React.useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [params, pathname]);
  const set = React.useCallback((patch: Record<string, string>) => router.replace(href(patch), { scroll: false }), [href, router]);
  return { get: (k) => params.get(k) ?? '', href, set };
}

/** Closes a popover on Escape or a click outside it. */
export function useMenuDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open, close, ref]);
}

export const IconPencil = () => <Icon size={14} d={<path d="M4.5 19.5l1-4L16 5.5l2.5 2.5L8 18l-3.5 1.5zM14 7.5l2.5 2.5" />} />;
export const IconTrash = () => <Icon size={14} d={<path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7" />} />;
export const IconPin = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<path d="M9 4h6l-1 5 3 3v1H7v-1l3-3-1-5zM12 13v7" />} />;

export function StagePill({ stage }: { stage: NoteStage }) {
  return <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>;
}

/** The "Nova anotação" button: a menu of the starting texts (Em branco, Ideia, Investigação, Procedimento). */
export function NewNoteMenu({ onPick, disabled }: { onPick: (t: NoteTemplate) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, ref);
  return (
    <div ref={ref} className="relative">
      <Button variant="primary" size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        Nova anotação
      </Button>
      {open && (
        <div role="menu" className="pop absolute top-full right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl bg-overlay p-1.5 shadow-popover">
          {NOTE_TEMPLATES.map((t) => (
            <button key={t.id} role="menuitem" type="button" onClick={() => { close(); onPick(t); }}
              className={cn('flex h-10 w-full items-center rounded-xl px-3 text-left text-[14px] text-fg hover:bg-well')}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
