'use client';

import * as React from 'react';
import { useChanges } from '@/lib/atlas-graph';
import { Card, Shimmer } from '@/components/ui';
import { useAgo } from '@/components/atlas/parts';
import { useGraphWords, type GraphWord } from './words';

/** The structural history of one system: what was created, changed, retired or renamed, and by whom. */
export function ChangesList({ system }: { system: string }) {
  const t = useGraphWords();
  const since = useAgo();
  const changes = useChanges({ system, limit: 100 });
  if (changes.isLoading) return <Shimmer className="h-40" />;
  const list = changes.data ?? [];
  return (
    <Card title={t('tab.changes')}>
      {list.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted" data-testid="atlas-changes-empty">{t('changes.none')}</p> : (
        <ul className="flex flex-col divide-y divide-border-subtle px-5 pb-3" data-testid="atlas-changes">
          {list.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5 py-3 text-[14px]">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-nums text-[13px] text-fg-muted">{since(c.at)}</span>
                <span className="font-medium text-fg">{c.summary ?? t(`change.${c.op}` as GraphWord)}</span>
                <span className="text-[13px] text-fg-muted">{c.actor}</span>
              </span>
              {c.fields.length > 0 && (
                <span className="text-[13px] text-fg-muted">
                  {c.fields.map((f) => `${f.field}: ${f.before ?? '—'} → ${f.after ?? '—'}`).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
