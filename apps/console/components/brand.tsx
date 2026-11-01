import * as React from 'react';

/*
 * The Pitwall mark: a pit board. Yellow board, three slots of falling length — the lines the box
 * holds out to the driver, and a queue sorted by what matters first. Square, flat, one colour.
 * The same drawing is app/icon.svg.
 */
export function Mark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <rect width="32" height="32" fill="var(--ds-accent)" />
      <rect x="6" y="7" width="20" height="4.5" fill="var(--ds-on-accent)" />
      <rect x="6" y="14" width="13" height="4.5" fill="var(--ds-on-accent)" />
      <rect x="6" y="21" width="7" height="4.5" fill="var(--ds-on-accent)" />
    </svg>
  );
}

/** The name, always lowercase, in the display face. Size it with the font size of the parent. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={`display lowercase ${className ?? ''}`}>pitwall</span>;
}

/** Mark + name, for bars and headers. */
export function Lockup({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <Mark size={size} />
      <Wordmark className="text-fg" />
    </span>
  );
}

/**
 * Team colour of a system: like a car on the timing tower, each system keeps one colour wherever it
 * appears (queue stripe, list, errors). Derived from the slug so it never depends on list order.
 */
const TEAM = [2, 4, 5, 6, 7, 8];
export function teamColor(key: string | null | undefined): string {
  if (!key) return 'var(--ds-border-strong)';
  let h = 5381; // djb2
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `var(--viz-${TEAM[h % TEAM.length]})`;
}
