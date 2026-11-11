'use client';

import * as React from 'react';
import { useChanges, useDiff, useGraph, type AtlasChangeDto, type NodeRef } from '@/lib/atlas-graph';
import { Card, ErrorBox, Pill, Shimmer, cn } from '@/components/ui';
import { useDetailT, useStamp, useWhen, relationLabel, FieldChanges } from './node-parts';
import type { DetailWord } from './words';

// What changed since a moment: the diff of two readings of the graph, and the changes behind it.
// Every name opens its node in the drawer.

export interface EvolutionPanelProps {
  system: string | null;
  since: string;
  onNode: (id: string) => void;
}

export function EvolutionPanel({ system, since, onNode }: EvolutionPanelProps) {
  const t = useDetailT();
  const stamp = useStamp();
  const diff = useDiff(since, 'now', system);
  const changes = useChanges({ since, system, limit: 200 });
  // Names for the ends of the links that changed: the graph of the same system, read once.
  const graph = useGraph(system, null);

  const names = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graph.data?.nodes ?? []) map.set(n.id, n.name);
    const d = diff.data;
    for (const n of [...(d?.nodes.added ?? []), ...(d?.nodes.removed ?? []), ...(d?.nodes.changed.map((c) => c.node) ?? [])]) map.set(n.id, n.name);
    return map;
  }, [graph.data, diff.data]);

  if (diff.isLoading || changes.isLoading) return <Shimmer className="h-64" />;
  const error = diff.error ?? changes.error;
  if (error) {
    return <ErrorBox error={error} onRetry={() => { void diff.refetch(); void changes.refetch(); }} />;
  }
  const d = diff.data;
  const timeline = changes.data ?? [];
  if (!d) return null;

  const empty = d.nodes.added.length === 0 && d.nodes.removed.length === 0 && d.nodes.changed.length === 0
    && d.edges.added.length === 0 && d.edges.removed.length === 0 && timeline.length === 0;
  const sinceText = stamp(since);

  return (
    <div data-testid="atlas-evolution" className="flex flex-col gap-3">
      <p className="px-1 text-[14px] text-fg-muted">
        {t('ev.since', { since: sinceText })}{!d.from.snapshotId && <> · {t('ev.noSnapshot')}</>}
      </p>

      {empty ? (
        <Card>
          <div className="px-5 py-6" data-testid="atlas-evolution-empty">
            <p className="text-[15px] font-medium text-fg">{t('ev.none', { since: sinceText })}</p>
            <p className="mt-1 text-[14px] text-fg-muted">{t('ev.noneHint')}</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Group label={t('ev.added')} count={d.nodes.added.length} testId="atlas-evolution-added">
              {d.nodes.added.map((n) => <NodeItem key={n.id} node={n} onNode={onNode} tone="ok" />)}
            </Group>
            <Group label={t('ev.changed')} count={d.nodes.changed.length} testId="atlas-evolution-changed">
              {d.nodes.changed.map((c) => (
                <li key={c.node.id} className="flex flex-col gap-1.5 rounded-tile bg-surface px-3 py-2">
                  <NodeButton node={c.node} onNode={onNode} />
                  <FieldChanges fields={c.fields} />
                </li>
              ))}
            </Group>
            <Group label={t('ev.removed')} count={d.nodes.removed.length} testId="atlas-evolution-removed">
              {d.nodes.removed.map((n) => <NodeItem key={n.id} node={n} onNode={onNode} tone="ghost" />)}
            </Group>
          </div>

          {(d.edges.added.length > 0 || d.edges.removed.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Group label={`${t('ev.edges')} · ${t('ev.edgesAdded')}`} count={d.edges.added.length} testId="atlas-evolution-edges-added">
                {d.edges.added.map((e, i) => <EdgeItem key={`a${i}`} edge={e} names={names} onNode={onNode} t={t} tone="ok" />)}
              </Group>
              <Group label={`${t('ev.edges')} · ${t('ev.edgesRemoved')}`} count={d.edges.removed.length} testId="atlas-evolution-edges-removed">
                {d.edges.removed.map((e, i) => <EdgeItem key={`r${i}`} edge={e} names={names} onNode={onNode} t={t} tone="ghost" />)}
              </Group>
            </div>
          )}

          <Card title={t('ev.timeline')}>
            <ol data-testid="atlas-evolution-timeline" className="flex flex-col divide-y divide-border-subtle px-5 pb-3">
              {timeline.map((c) => <TimelineItem key={c.id} change={c} names={names} onNode={onNode} />)}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}

function Group({ label, count, testId, children }: { label: string; count: number; testId: string; children: React.ReactNode }) {
  const t = useDetailT();
  const items = React.Children.toArray(children);
  return (
    <section data-testid={testId} data-count={count} className="flex min-w-0 flex-col gap-2 rounded-panel bg-well p-3">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">{label}<span className="tabular-nums text-fg-muted">{count}</span></h3>
      {items.length === 0 ? <p className="text-[13px] text-fg-subtle">{t('ev.none.section')}</p> : <ul className="flex flex-col gap-1.5">{items}</ul>}
    </section>
  );
}

function NodeButton({ node, onNode }: { node: NodeRef; onNode: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onNode(node.id)} data-testid="atlas-evolution-node" data-node-id={node.id}
      className="flex w-full min-w-0 flex-col items-start rounded-tile px-2 py-1 text-left transition-colors duration-150 hover:bg-hover">
      <span className="max-w-full truncate font-medium text-fg">{node.name}</span>
      <span className="text-[12px] text-fg-muted">{node.kind}</span>
    </button>
  );
}

function NodeItem({ node, onNode, tone }: { node: NodeRef; onNode: (id: string) => void; tone: 'ok' | 'ghost' }) {
  return (
    <li className={cn('rounded-tile bg-surface px-2 py-1', tone === 'ghost' && 'atlas-dashed')} data-tone={tone}>
      <NodeButton node={node} onNode={onNode} />
    </li>
  );
}

function EdgeItem({ edge, names, onNode, t, tone }: {
  edge: { from: string; to: string; relation: string }; names: Map<string, string>; onNode: (id: string) => void;
  t: ReturnType<typeof useDetailT>; tone: 'ok' | 'ghost';
}) {
  const label = (id: string) => names.get(id) ?? t('ev.unknownNode');
  return (
    <li className={cn('flex flex-wrap items-center gap-1.5 rounded-tile bg-surface px-2 py-1.5 text-[13px]', tone === 'ghost' && 'atlas-dashed')}>
      <button type="button" onClick={() => onNode(edge.from)} className="font-medium text-fg underline-offset-2 hover:underline">{label(edge.from)}</button>
      <span className="text-fg-muted">{relationLabel(t, edge.relation)}</span>
      <button type="button" onClick={() => onNode(edge.to)} className="font-medium text-fg underline-offset-2 hover:underline">{label(edge.to)}</button>
    </li>
  );
}

const SOURCE_KEY: Record<string, DetailWord> = {
  console: 'src.console', mcp: 'src.mcp', import: 'src.import', collector: 'src.collector', sync: 'src.sync', system: 'src.system', agent: 'src.agent',
};

function TimelineItem({ change, names, onNode }: { change: AtlasChangeDto; names: Map<string, string>; onNode: (id: string) => void }) {
  const t = useDetailT();
  const when = useWhen();
  const opens = change.entityType === 'service' || change.entityType === 'repo';
  const title = change.summary ?? names.get(change.entityId) ?? change.entityType;
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <Pill tone={change.op === 'created' ? 'ok' : change.op === 'retired' || change.op === 'deleted' ? 'idle' : 'info'}>{t(`op.${change.op}` as DetailWord)}</Pill>
        <span className="font-medium text-fg">{title}</span>
      </span>
      {change.fields.length > 0 && <span className="mt-1.5 block"><FieldChanges fields={change.fields} /></span>}
      <span className="mt-1 block text-[13px] text-fg-muted">
        {t('ev.by', { actor: change.actor })} · {t('ev.fromSource', { source: t(SOURCE_KEY[change.source] ?? 'src.system') })} · {when(change.at)}
      </span>
    </>
  );
  return (
    <li className="py-2.5" data-testid="atlas-evolution-change" data-op={change.op} data-source={change.source}>
      {opens ? (
        <button type="button" onClick={() => onNode(change.entityId)} className="block w-full rounded-tile px-1 text-left transition-colors duration-150 hover:bg-hover">{body}</button>
      ) : body}
    </li>
  );
}
