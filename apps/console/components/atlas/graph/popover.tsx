'use client';

import * as React from 'react';
import { cn } from '@/components/ui';

/*
 * A small popover for the map's toolbar: one pill that opens a panel under it. The panel is fixed to
 * the window and kept inside its edges, so a pill at the right of a narrow screen does not push the page
 * sideways. It closes on a click outside, on Escape and on a scroll; Escape is taken in the capture phase
 * so that it closes only the popover and not the selection or the drawer behind it.
 */

export function Popover({ label, badge, testId, width = 288, children }: {
  label: string; badge?: string | null; testId?: string; /** the panel's width in pixels */ width?: number; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState<{ top: number; left: number } | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && button.current) {
      const r = button.current.getBoundingClientRect();
      setAt({ top: r.bottom + 6, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) });
    }
    setOpen((v) => !v);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button ref={button} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}
        className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
          open ? 'border-border-strong bg-hover text-fg' : 'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg')}>
        {label}
        {badge && <span className="rounded-full bg-chip px-1.5 text-[12px] font-semibold text-fg-secondary tabular-nums">{badge}</span>}
      </button>
      {open && at && (
        <div role="dialog" aria-label={label} style={{ top: at.top, left: at.left, width }}
          className="fixed z-40 rounded-tile bg-overlay p-3 shadow-popover">
          {children}
        </div>
      )}
    </div>
  );
}
