'use client';

import * as React from 'react';
import { useGraph } from '@/lib/atlas-graph';
import { Dot, Pill, cn, useToast } from '@/components/ui';
import { useDetailT } from '../node-parts';
import type { DetailWord } from '../words';

// The pieces of the onboarding that every step uses: the stepper, a frame with its title, a notice,
// a copy button for commands, and the coverage badge of the chosen system.

export const STEP_COUNT = 8;
const STEP_LABEL: DetailWord[] = ['ob.s1', 'ob.s2', 'ob.s3', 'ob.s4', 'ob.s5', 'ob.s6', 'ob.s7', 'ob.s8'];

export function parseStep(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= STEP_COUNT ? n : 1;
}

export function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  const t = useDetailT();
  return (
    <nav aria-label={t('ob.title')} data-testid="onboarding-stepper">
      <ol className="flex flex-wrap gap-1.5">
        {STEP_LABEL.map((key, i) => {
          const n = i + 1;
          const current = n === step;
          return (
            <li key={key}>
              <button type="button" onClick={() => onStep(n)} aria-current={current ? 'step' : undefined}
                data-testid="onboarding-step" data-step={n}
                className={cn('inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-150',
                  current ? 'bg-btn text-btn-fg' : 'bg-well text-fg-secondary hover:bg-hover hover:text-fg')}>
                <span className="tabular-nums opacity-70">{n}</span>{t(key)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Frame({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  const t = useDetailT();
  return (
    <section data-testid="onboarding-current" data-step={step} className="flex flex-col gap-4">
      <div>
        <p className="text-[13px] text-fg-muted">{t('ob.step', { n: step, total: STEP_COUNT })}</p>
        <h2 className="mt-0.5 text-[20px] font-semibold tracking-[-0.015em] text-fg">{title}</h2>
        {hint && <p className="mt-1 max-w-3xl text-[14px] leading-[1.5] text-fg-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const NOTICE_TONE = { info: 'bg-well', warn: 'bg-warning/10', error: 'bg-danger/8' } as const;

export function Notice({ tone = 'info', children }: { tone?: keyof typeof NOTICE_TONE; children: React.ReactNode }) {
  return (
    <div role={tone === 'info' ? 'note' : 'status'} className={cn('flex items-start gap-3 rounded-tile px-4 py-3 text-[14px] leading-[1.5] text-fg', NOTICE_TONE[tone])}>
      <Dot tone={tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : 'idle'} className="mt-1.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Commands to copy: the text is shown whole, with its placeholders, so nothing real is ever in it. */
export function CopyBlock({ text }: { text: string }) {
  const t = useDetailT();
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('error', t('error'));
    }
  };
  return (
    <div className="relative rounded-tile bg-well">
      <pre className="overflow-x-auto px-4 py-3 pr-24 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-fg"><code>{text}</code></pre>
      <button type="button" onClick={copy}
        className="absolute top-2 right-2 inline-flex h-8 items-center rounded-full border border-border bg-surface px-3 text-[12px] font-semibold text-fg transition-colors hover:bg-hover">
        {copied ? t('agents.copied') : t('agents.copy')}
      </button>
    </div>
  );
}

/** The coverage of the chosen system, read from the same graph the map reads. */
export function CoverageBadge({ system }: { system: string }) {
  const t = useDetailT();
  const graph = useGraph(system, null);
  const percent = graph.data?.coverage?.percent;
  if (percent === undefined) return null;
  return (
    <Pill tone={percent >= 80 ? 'ok' : percent >= 40 ? 'warn' : 'idle'}>
      <span data-testid="onboarding-coverage" data-percent={percent}>{t('ob.coverage', { percent })}</span>
    </Pill>
  );
}

export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
