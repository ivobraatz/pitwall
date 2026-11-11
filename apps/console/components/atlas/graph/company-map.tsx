'use client';

import * as React from 'react';
import {
  Background, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCompanyGraph, type AttentionClass, type CompanyEdge, type CompanyGraph, type GraphNode, type SystemCard } from '@/lib/atlas-graph';
import { healthReading } from '@/lib/atlas';
import { LANE_HEADER, layoutEngines, planCompanyRoutes, type Box, type Route } from '@/lib/atlas-layout';
import { ProductMark } from '@/components/product';
import { Card, cn } from '@/components/ui';
import { StateGlyph, useWords } from '@/components/atlas/parts';
import { AttentionIcon, attentionLabel } from './legend';
import { startViewport } from './model';
import { useBox } from './viewport';
import { useGraphWords, type GraphWord } from './words';
import type { Engine } from '@/lib/atlas-graph';

/*
 * Level 1: the company in three bands, read from the top down: the systems, the systems other systems
 * depend on (shared), and the services with no system, one column per engine. Links between a system
 * and a shared service leave the base of the card and enter the top of the service (see planCompanyRoutes);
 * a card opens the system (level 2); nothing here is edited.
 */

const CARD_W = 260;
const CARD_H = 124;
const GAP = 24;
const SHARED_W = 212;
const SHARED_H = 54;
const BAND_H = 28;      // a band's title, and the room above its content
const ROW_GAP = 40;     // between one band's content and the next band's title
const LABEL_STRIP = 18; // the line a link's count sits on, between an engine's title and the service under it
const ATTENTION_ORDER: AttentionClass[] = ['failure', 'security', 'task', 'improvement', 'config', 'unverified'];

type SystemData = { card: SystemCard; onOpen: (slug: string) => void };
type SharedData = { node: GraphNode };
type BandData = { title: string };
type EdgeData = { count: number; relations: string[]; route: Route };

const HANDLE = '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent';

function SystemNode({ data }: NodeProps<Node<SystemData, 'system'>>) {
  const t = useGraphWords();
  const words = useWords();
  const c = data.card;
  const running = c.running.deploys + c.running.ci + c.running.agents + c.running.routines;
  const reading = healthReading(c.health);
  // Red only for what was measured as out of order; a service nobody reads is named, not alarmed.
  const alarm = c.health.down > 0 || c.health.degraded > 0;
  const healthText = reading.kind === 'none' ? t('company.noHealth')
    : reading.kind === 'unread' ? words('health.unread', { n: reading.n })
    : reading.kind === 'mixed' ? words('health.mixed', { up: reading.up, measured: reading.measured, unread: reading.unread })
    : words('health.up', { up: reading.up, total: reading.measured });
  return (
    <div data-testid="atlas-company-system" data-slug={c.slug} data-state={c.state} data-shared={c.shared || undefined}
      style={{ width: CARD_W, height: CARD_H }}
      className={cn('relative rounded-panel border bg-surface', c.shared ? 'border-border-loud' : 'border-border')}>
      <Handle type="target" position={Position.Top} className={HANDLE} />
      <button type="button" onClick={() => data.onOpen(c.slug)} aria-label={`${c.name}: ${t('company.open')}`}
        className="nodrag nopan flex size-full flex-col gap-2 rounded-panel p-3.5 text-left transition-colors duration-150 hover:bg-hover">
        <span className="flex min-w-0 items-center gap-2.5">
          <ProductMark product={c} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-fg">{c.name}</span>
            <span className={cn('flex items-center gap-1.5 text-[12px]', alarm ? 'font-semibold text-danger' : 'text-fg-muted')} data-testid="atlas-company-health">
              <StateGlyph state={c.state} size={12} />
              {healthText}
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
      <Handle type="source" position={Position.Bottom} className={HANDLE} />
    </div>
  );
}

function SharedNode({ data }: NodeProps<Node<SharedData, 'shared'>>) {
  const n = data.node;
  return (
    <div data-testid="atlas-company-shared" data-engine={n.engine} data-state={n.state} style={{ width: SHARED_W, height: SHARED_H }}
      className="relative flex items-center gap-2.5 rounded-tile border border-border-loud bg-surface px-3">
      <Handle type="target" position={Position.Top} className={HANDLE} />
      <StateGlyph state={n.state} size={12} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{n.name}</span>
      {n.provider && <span className="shrink-0 text-[12px] text-fg-muted">{n.provider}</span>}
      <Handle type="source" position={Position.Bottom} className={HANDLE} />
    </div>
  );
}

/** A band's title sits on the canvas colour, so a link that passes under it is hidden there rather than struck through. */
function BandNode({ data }: NodeProps<Node<BandData, 'band'>>) {
  return <h3 className="pointer-events-none inline-block rounded bg-well pr-2 text-[13px] leading-5 font-semibold whitespace-nowrap text-fg-muted">{data.title}</h3>;
}

/** An aggregated link: a curve from the base of one card to the top of the other, its width growing with the count. */
function AggregatedEdge({ id, data }: EdgeProps<Edge<EdgeData>>) {
  if (!data) return null;
  const count = data.count;
  return (
    <>
      <BaseEdge id={id} path={data.route.d} style={{ stroke: 'var(--ds-border-loud)', strokeWidth: 1 + Math.min(count, 6) * 0.75 }} />
      <EdgeLabelRenderer>
        <span title={data.relations.join(', ')} data-testid="atlas-company-edge" data-count={count}
          style={{ transform: `translate(-50%, -50%) translate(${data.route.label.x}px, ${data.route.label.y}px)` }}
          className="nodrag nopan pointer-events-auto absolute rounded-full bg-overlay px-1.5 py-px text-[11px] leading-4 font-medium text-fg-secondary shadow-popover">
          {count}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { system: SystemNode, shared: SharedNode, band: BandNode };
const EDGE_TYPES = { aggregated: AggregatedEdge };

/**
 * The company's picture as React Flow nodes. The rows never overlap: each band's title sits in its own
 * BAND_H strip above its content, and the engine columns of the shared services stand side by side. Each
 * engine's title is followed by a LABEL_STRIP where the links' counts sit, so no count lands on a title.
 */
export function buildCompanyCanvas(graph: CompanyGraph, onOpen: (slug: string) => void, title: { systems: string; shared: string; engine: (e: Engine) => string }) {
  const nodes: Node[] = [];
  const boxes = new Map<string, Box>();
  const own = graph.systems.filter((s) => !s.shared);
  const sharedSystems = graph.systems.filter((s) => s.shared);
  let width = 0;
  let height = 0;

  // Band 1: the systems.
  nodes.push({ id: 'band:systems', type: 'band', position: { x: 0, y: 0 }, selectable: false, draggable: false, data: { title: title.systems } satisfies BandData });
  own.forEach((c, i) => {
    const x = i * (CARD_W + GAP);
    const y = BAND_H;
    boxes.set(c.id, { x, y, w: CARD_W, h: CARD_H });
    nodes.push({ id: c.id, type: 'system', position: { x, y }, draggable: false, selectable: false, style: { pointerEvents: 'all' }, data: { card: c, onOpen } satisfies SystemData });
  });
  width = Math.max(width, own.length * (CARD_W + GAP) - GAP);
  let y = BAND_H + CARD_H + ROW_GAP;
  height = Math.max(height, BAND_H + CARD_H);

  // Band 2: the shared band, with the systems other systems depend on and the shared services below.
  if (sharedSystems.length + graph.shared.length > 0) {
    nodes.push({ id: 'band:shared', type: 'band', position: { x: 0, y }, selectable: false, draggable: false, data: { title: title.shared } satisfies BandData });
    y += BAND_H;
  }
  if (sharedSystems.length > 0) {
    sharedSystems.forEach((c, i) => {
      const x = i * (CARD_W + GAP);
      boxes.set(c.id, { x, y, w: CARD_W, h: CARD_H });
      nodes.push({ id: c.id, type: 'system', position: { x, y }, draggable: false, selectable: false, style: { pointerEvents: 'all' }, data: { card: c, onOpen } satisfies SystemData });
    });
    width = Math.max(width, sharedSystems.length * (CARD_W + GAP) - GAP);
    y += CARD_H + ROW_GAP;
  }
  if (graph.shared.length > 0) {
    // One column per engine: the engine's title above it, a strip for the counts, then its services.
    const layout = layoutEngines({
      nodes: graph.shared.map((n) => ({ id: n.id, engine: n.engine, group: n.group, name: n.name })),
      edges: [], collapsed: new Set(),
    });
    for (const lane of layout.lanes) {
      nodes.push({ id: `band:${lane.engine}`, type: 'band', position: { x: lane.x, y }, selectable: false, draggable: false, data: { title: title.engine(lane.engine) } satisfies BandData });
      width = Math.max(width, lane.x + lane.width);
    }
    const top = y + BAND_H + LABEL_STRIP;
    for (const n of graph.shared) {
      const pos = layout.positions[n.id];
      if (!pos) continue;
      const at = { x: pos.x, y: top + (pos.y - LANE_HEADER) };
      boxes.set(n.id, { x: at.x, y: at.y, w: SHARED_W, h: SHARED_H });
      nodes.push({ id: n.id, type: 'shared', position: at, draggable: false, selectable: false, style: { pointerEvents: 'all' }, data: { node: n } satisfies SharedData });
    }
    const bottom = layout.lanes.length > 0 ? top + layout.lanes[0].height - LANE_HEADER : top;
    height = Math.max(height, bottom);
  } else {
    height = Math.max(height, y);
  }
  height = Math.max(height, y);

  // Links: only between the cards drawn here; the route of each is planned on the cards' boxes.
  const links = graph.edges
    .map((e: CompanyEdge, i) => ({ e, id: `agg:${i}:${e.from}>${e.to}` }))
    .filter(({ e }) => boxes.has(e.from) && boxes.has(e.to) && e.from !== e.to);
  const routes = planCompanyRoutes(boxes, links.map(({ e, id }) => ({ id, from: e.from, to: e.to })));
  const edges: Edge[] = [];
  for (const { e, id } of links) {
    const route = routes.get(id);
    if (!route) continue;
    edges.push({
      id, source: e.from, target: e.to, type: 'aggregated', selectable: false, focusable: false,
      data: { count: e.count, relations: e.relations, route } satisfies EdgeData,
    });
  }
  return { nodes, edges, size: { w: width, h: height } };
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
  const [boxRef, box] = useBox<HTMLDivElement>();
  const built = React.useMemo(() => (graph.data
    ? buildCompanyCanvas(graph.data, onSystem, { systems: t('company.systems'), shared: t('company.shared'), engine: (e) => t(`engine.${e}` as GraphWord) })
    : null), [graph.data, onSystem, t]);
  const opening = React.useMemo(() => (built && box ? startViewport(built.size, box) : null), [built, box]);

  if (graph.error) return <Card><p className="p-6 text-[14px] text-danger">{t('product.error')}</p></Card>;
  if (graph.data && graph.data.systems.length === 0) return <Card><p className="p-6 text-[14px] text-fg-muted">{t('company.none')}</p></Card>;

  return (
    <div className="flex flex-col gap-2" data-testid="atlas-company-map">
      <p className="px-1 text-[13px] text-fg-muted">{t('company.hint')}</p>
      <div ref={boxRef} className="atlas-flow relative h-[calc(100dvh-17rem)] min-h-[560px] overflow-hidden rounded-panel bg-well">
        {!built || !opening ? <div className="h-full" aria-label={t('product.loading')} /> : (
          <ReactFlow
            nodes={built.nodes} edges={built.edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
            defaultViewport={opening} minZoom={0.3} maxZoom={1.6}
            nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            onlyRenderVisibleElements proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="var(--ds-border-default)" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
