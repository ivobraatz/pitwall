'use client';

import * as React from 'react';
import {
  Background, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCompanyGraph, type AttentionClass, type CompanyEdge, type CompanyGraph, type GraphNode, type SystemCard } from '@/lib/atlas-graph';
import { layoutEngines } from '@/lib/atlas-layout';
import { ProductMark } from '@/components/product';
import { Card, cn } from '@/components/ui';
import { StateGlyph } from '@/components/atlas/parts';
import { AttentionIcon, attentionLabel } from './legend';
import { useGraphWords, type GraphWord } from './words';
import type { Engine } from '@/lib/atlas-graph';

/*
 * Level 1: the company as one card per system, the services several systems share below them, and the
 * links between systems as aggregated arrows. A card opens the system (level 2); nothing here is edited.
 */

const CARD_W = 260;
const CARD_H = 124;
const GAP = 24;
const SHARED_W = 248;
const SHARED_H = 56;
const ATTENTION_ORDER: AttentionClass[] = ['failure', 'security', 'task', 'improvement', 'config', 'unverified'];

type SystemData = { card: SystemCard; onOpen: (slug: string) => void };
type SharedData = { node: GraphNode };
type BandData = { title: string };
type EdgeData = { count: number; relations: string[] };

function SystemNode({ data }: NodeProps<Node<SystemData, 'system'>>) {
  const t = useGraphWords();
  const c = data.card;
  const running = c.running.deploys + c.running.ci + c.running.agents + c.running.routines;
  return (
    <div data-testid="atlas-company-system" data-slug={c.slug} data-state={c.state} data-shared={c.shared || undefined}
      style={{ width: CARD_W, height: CARD_H }}
      className={cn('relative rounded-panel border bg-surface', c.shared ? 'border-border-loud' : 'border-border')}>
      <Handle type="target" position={Position.Left} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <button type="button" onClick={() => data.onOpen(c.slug)} aria-label={`${c.name}: ${t('company.open')}`}
        className="nodrag nopan flex size-full flex-col gap-2 rounded-panel p-3.5 text-left transition-colors duration-150 hover:bg-hover">
        <span className="flex min-w-0 items-center gap-2.5">
          <ProductMark product={c} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-fg">{c.name}</span>
            <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
              <StateGlyph state={c.state} size={12} />
              {c.health.total === 0 ? t('company.noHealth') : t('company.health', { up: c.health.up, total: c.health.total })}
            </span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {ATTENTION_ORDER.filter((k) => c.attention[k] > 0).map((k) => (
            <span key={k} title={attentionLabel(k, t)}
              className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold tabular-nums',
                k === 'failure' ? 'bg-danger/10 text-danger' : 'bg-chip text-fg-secondary')}>
              <AttentionIcon kind={k} size={11} />{c.attention[k]}
            </span>
          ))}
        </span>
        <span className="mt-auto flex items-center justify-between gap-2 text-[12px] text-fg-muted">
          <span className="truncate">{running > 0 ? <><span className="font-semibold text-fg tabular-nums">{running}</span> {t('company.running')}</> : null}</span>
          <span className="shrink-0 tabular-nums">{t('company.coverage', { n: c.coverage.percent })}</span>
        </span>
      </button>
      <Handle type="source" position={Position.Right} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

function SharedNode({ data }: NodeProps<Node<SharedData, 'shared'>>) {
  const n = data.node;
  return (
    <div data-testid="atlas-company-shared" data-engine={n.engine} data-state={n.state} style={{ width: SHARED_W, height: SHARED_H }}
      className="relative flex items-center gap-2.5 rounded-tile border border-border-loud bg-surface px-3">
      <Handle type="target" position={Position.Left} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <StateGlyph state={n.state} size={12} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{n.name}</span>
      {n.provider && <span className="shrink-0 text-[12px] text-fg-muted">{n.provider}</span>}
      <Handle type="source" position={Position.Right} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

function BandNode({ data }: NodeProps<Node<BandData, 'band'>>) {
  return <h3 className="text-[13px] font-semibold text-fg-muted">{data.title}</h3>;
}

/** An aggregated link: its width grows with the number of links behind it; the tooltip names their relations. */
function AggregatedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<Edge<EdgeData>>) {
  const count = data?.count ?? 1;
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: 'var(--ds-border-loud)', strokeWidth: 1 + Math.min(count, 6) * 0.75 }} />
      <EdgeLabelRenderer>
        <span title={(data?.relations ?? []).join(', ')} data-testid="atlas-company-edge" data-count={count}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="nodrag nopan pointer-events-auto absolute rounded-full bg-overlay px-2 py-0.5 text-[12px] font-medium text-fg-secondary shadow-popover">
          {count}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { system: SystemNode, shared: SharedNode, band: BandNode };
const EDGE_TYPES = { aggregated: AggregatedEdge };

export function buildCompanyCanvas(graph: CompanyGraph, onOpen: (slug: string) => void, title: { systems: string; shared: string; engine: (e: Engine) => string }) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const own = graph.systems.filter((s) => !s.shared);
  const sharedSystems = graph.systems.filter((s) => s.shared);

  nodes.push({ id: 'band:systems', type: 'band', position: { x: 0, y: -36 }, selectable: false, draggable: false, data: { title: title.systems } satisfies BandData });
  own.forEach((c, i) => nodes.push({
    id: c.id, type: 'system', position: { x: i * (CARD_W + GAP), y: 0 }, draggable: false, selectable: false, style: { pointerEvents: 'all' },
    data: { card: c, onOpen } satisfies SystemData,
  }));

  const sharedTop = CARD_H + 64;
  const sharedTotal = sharedSystems.length + graph.shared.length;
  if (sharedTotal > 0) {
    nodes.push({ id: 'band:shared', type: 'band', position: { x: 0, y: sharedTop - 36 }, selectable: false, draggable: false, data: { title: title.shared } satisfies BandData });
  }
  sharedSystems.forEach((c, i) => nodes.push({
    id: c.id, type: 'system', position: { x: i * (CARD_W + GAP), y: sharedTop }, draggable: false, selectable: false, style: { pointerEvents: 'all' },
    data: { card: c, onOpen } satisfies SystemData,
  }));

  // Shared services: one column per engine, the same layout as the product map.
  const sharedBase = sharedTop + (sharedSystems.length > 0 ? CARD_H + 36 : 0);
  const layout = layoutEngines({
    nodes: graph.shared.map((n) => ({ id: n.id, engine: n.engine, group: n.group, name: n.name })),
    edges: [], collapsed: new Set(),
  });
  for (const n of graph.shared) {
    const pos = layout.positions[n.id];
    if (!pos) continue;
    nodes.push({ id: n.id, type: 'shared', position: { x: pos.x - 16, y: sharedBase + pos.y - 52 }, draggable: false, selectable: false, style: { pointerEvents: 'all' }, data: { node: n } satisfies SharedData });
  }
  for (const lane of layout.lanes) {
    nodes.push({ id: `band:${lane.engine}`, type: 'band', position: { x: lane.x, y: sharedBase - 36 }, selectable: false, draggable: false, data: { title: title.engine(lane.engine) } satisfies BandData });
  }

  const ids = new Set(nodes.map((n) => n.id));
  graph.edges.forEach((e: CompanyEdge, i) => {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) return;
    edges.push({
      id: `agg:${i}:${e.from}>${e.to}`, source: e.from, target: e.to, type: 'aggregated', selectable: false, focusable: false,
      data: { count: e.count, relations: e.relations } satisfies EdgeData,
    });
  });
  return { nodes, edges };
}

export function CompanyMap({ onSystem }: { onSystem: (slug: string) => void }) {
  return (
    <ReactFlowProvider>
      <CompanyCanvas onSystem={onSystem} />
    </ReactFlowProvider>
  );
}

function CompanyCanvas({ onSystem }: { onSystem: (slug: string) => void }) {
  const t = useGraphWords();
  const graph = useCompanyGraph();
  const built = React.useMemo(() => (graph.data
    ? buildCompanyCanvas(graph.data, onSystem, { systems: t('company.systems'), shared: t('company.shared'), engine: (e) => t(`engine.${e}` as GraphWord) })
    : null), [graph.data, onSystem, t]);

  if (graph.error) return <Card><p className="p-6 text-[14px] text-danger">{t('product.error')}</p></Card>;
  if (!built) return <div className="h-[62vh] min-h-[420px] rounded-tile bg-well" aria-label={t('product.loading')} />;
  if (graph.data && graph.data.systems.length === 0) return <Card><p className="p-6 text-[14px] text-fg-muted">{t('company.none')}</p></Card>;

  return (
    <div className="flex flex-col gap-2" data-testid="atlas-company-map">
      <p className="px-1 text-[13px] text-fg-muted">{t('company.hint')}</p>
      <div className="atlas-flow h-[62vh] min-h-[420px] overflow-hidden rounded-tile bg-well">
        <ReactFlow
          nodes={built.nodes} edges={built.edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
          fitView fitViewOptions={{ padding: 0.14, maxZoom: 1 }} minZoom={0.2} maxZoom={1.6}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
          onlyRenderVisibleElements proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="var(--ds-border-default)" />
        </ReactFlow>
      </div>
    </div>
  );
}

