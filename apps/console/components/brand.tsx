import * as React from 'react';

/*
 * The Pitwall mark: a pit board. A rounded ink board holding three yellow slots of falling length —
 * the lines the box holds out to the driver, and a queue sorted by what matters first. On the dark
 * theme the board turns yellow and the slots ink, so the mark always reads. The same drawing (light)
 * is app/icon.svg.
 */
export function Mark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <rect width="32" height="32" rx="9.5" fill="var(--ds-mark-board, #161616)" />
      <rect x="8" y="9" width="16" height="4" rx="2" fill="var(--ds-mark-slot, #f4df4f)" />
      <rect x="8" y="14" width="11" height="4" rx="2" fill="var(--ds-mark-slot, #f4df4f)" />
      <rect x="8" y="19" width="6" height="4" rx="2" fill="var(--ds-mark-slot, #f4df4f)" />
    </svg>
  );
}

/** The name, in the one family at its heading weight. Size it with the font size of the parent. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={`font-semibold tracking-[-0.025em] ${className ?? ''}`}>Pitwall</span>;
}

/** Mark + name, for bars and headers. */
export function Lockup({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <Mark size={size} />
      <Wordmark className="text-[18px] text-fg" />
    </span>
  );
}

/**
 * Team colour of a system: like a car on the timing tower, each system keeps one colour wherever it
 * appears (its badge, list, errors). Derived from the slug so it never depends on list order.
 */
const TEAM = [2, 4, 5, 6, 7, 3];
export function teamColor(key: string | null | undefined): string {
  if (!key) return 'var(--ds-border-strong)';
  let h = 5381; // djb2
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `var(--viz-${TEAM[h % TEAM.length]})`;
}
