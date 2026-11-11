'use client';

import * as React from 'react';
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraph, useDiff, type Engine, type GraphEdge, type GraphNode, type NodeRef } from '@/lib/atlas-graph';
import { useProcesses, type AtlasEnvironment, type AtlasProcess, type AtlasSystem, type ProcessStep } from '@/lib/atlas';
import { layoutEngines } from '@/lib/atlas-layout';
import { Button, cn } from '@/components/ui';
import { ProductMark } from '@/components/product';
import { StateGlyph, useAgo } from '@/components/atlas/parts';
import { EvolutionPanel } from '@/components/atlas/detail/evolution';
import { NodeDrawer } from '@/components/atlas/detail/node-drawer';
import { AttentionIcon, attentionLabel } from './legend';
import { MapToolbar } from './toolbar';
import { AttentionPanel, FlowsPanel, ModeBar, OperationPanel, SincePicker, processesOf, sinceValue, stepNumbers } from './modes';
import {
  CATEGORY_COLOR, MIN_START_ZOOM, layoutKey, matchesQuery, passesFilters, readFilters, reach, remapEdges, startViewport, writeFilters,
  type Filters, type Mode,
} from './model';
import { useBox } from './viewport';
import { useGraphWords, type GraphWord } from './words';

/*
 * Level 2: one system as a map. Columns are the engines; each node is a service or a repository.
 * The header carries the system and the reading modes; the toolbar carries search and the popovers.
 * Selecting a node draws its neighbourhood and opens the component drawer (level 3), beside the map
 * on a desktop. The selection lives in the URL (?node=) so that a link opens the same picture.
 */

const ENGINES_ORDER: Engine[] = ['code', 'delivery', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security'];
const hidden = '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent';
const NODE_W = 212;
const NODE_H = 54;
const GROUP_LABEL_OFFSET = 24; // how far above its first node a group's name sits (the layout keeps this room)

type CardData = {
  node: GraphNode;
  dim: boolean;
  hit: boolean;
  selected: boolean;
  step: number | null;
  badge: 'added' | 'changed' | 'removed' | null;
  running: boolean;
  ghost: boolean;
};
type LaneData = { engine: Engine; count: number; collapsed: boolean; onToggle: (e: Engine) => void };
type SummaryData = { engine: Engine; count: number; onToggle: (e: Engine) => void };
type GroupData = { label: string };

function CardNode({ data }: NodeProps<Node<CardData, 'card'>>) {
  const t = useGraphWords();
  const since = useAgo();
  const n = data.node;
  const stateWord = t(`state.${n.state}` as GraphWord);
  const sub = n.lastEvent ? `${stateWord} · ${t('op.observed', { when: since(n.lastEvent.at) })}`
    : `${stateWord} · ${n.provider ?? n.kind}`;
  const chips = (Object.keys(n.attention) as Array<keyof GraphNode['attention']>).filter((k) => n.attention[k] > 0);
  const badgeWord = data.badge ? t(data.badge === 'added' ? 'evo.added' : data.badge === 'changed' ? 'evo.changed' : 'evo.removed') : null;
  const title = [n.name, n.shared ? t('shared') : null, n.codeScope ? t(`codeScope.${n.codeScope}` as GraphWord) : null,
    t(`ver.${n.verification}` as GraphWord), badgeWord].filter(Boolean).join(' · ');
  return (
    <div data-testid="atlas-graph-node" data-node-id={n.id} data-engine={n.engine} data-state={n.state} data-verification={n.verification}
      data-shared={n.shared || undefined} data-type={n.type} data-dim={data.dim || undefined} data-running={data.running || undefined}
      title={title}
      style={{ width: NODE_W, height: NODE_H }}
      className={cn('relative flex flex-col justify-center gap-0.5 rounded-tile border bg-surface px-3 py-1.5 transition-opacity duration-150',
        n.shared ? 'border-border-loud' : 'border-border',
        n.verification === 'not_found' && 'atlas-hatch',
        (data.ghost || n.removalReportedAt) && 'border-dashed opacity-70',
        data.dim && 'opacity-35',
        data.hit && 'ring-2 ring-accent',
        data.selected && 'ring-2 ring-focus',
        data.running && (n.state === 'down' ? 'atlas-live atlas-live-down' : 'atlas-live'))}>
      <Handle type="target" position={Position.Left} className={hidden} />
      <div className="flex min-w-0 items-center gap-2">
        {n.type === 'repo' ? <span className="shrink-0 rounded-full bg-chip px-1.5 text-[11px] font-semibold text-fg-secondary">repo</span>
          : <StateGlyph state={n.state} size={12} />}
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-fg">{n.name}</span>
        {data.step !== null && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-btn text-[11px] font-semibold text-btn-fg tabular-nums">{data.step}</span>}
        {badgeWord && <span className="shrink-0 rounded-full bg-accent-bg px-1.5 text-[11px] font-semibold text-accent-fg">{badgeWord}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[12px] leading-4 text-fg-muted">
        <span className="min-w-0 flex-1 truncate">{sub}</span>
        {chips.map((k) => (
          <span key={k} title={attentionLabel(k, t)}
            className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 font-semibold tabular-nums',
              k === 'failure' ? 'bg-danger/10 text-danger' : 'bg-chip text-fg-secondary')}>
            <AttentionIcon kind={k} size={11} />{n.attention[k]}
          </span>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className={hidden} />
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<LaneData, 'lane'>>) {
  const t = useGraphWords();
  return (
    <div data-testid="atlas-graph-lane" data-engine={data.engine} data-collapsed={data.collapsed || undefined}
      className="h-full rounded-panel bg-hover">
      <div className="flex h-[52px] items-center gap-2 px-3">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-fg-secondary">{t(`engine.${data.engine}` as GraphWord)}</h3>
        <span className="text-[12px] text-fg-subtle tabular-nums">{data.count}</span>
        <button type="button" className="nodrag nopan ml-auto h-7 shrink-0 rounded-full px-2 text-[12px] font-medium text-fg-muted hover:bg-surface hover:text-fg"
          aria-expanded={!data.collapsed} onClick={() => data.onToggle(data.engine)}>
          {data.collapsed ? t('engine.expand') : t('engine.collapse')}
        </button>
      </div>
    </div>
  );
}

function GroupNode({ data }: NodeProps<Node<GroupData, 'group'>>) {
  return <p className="pointer-events-none truncate text-[12px] leading-4 font-semibold text-fg-muted" style={{ width: NODE_W }}>{data.label}</p>;
}

function SummaryNode({ data }: NodeProps<Node<SummaryData, 'summary'>>) {
  const t = useGraphWords();
  return (
    <div data-testid="atlas-graph-summary" data-engine={data.engine} style={{ width: NODE_W, height: NODE_H }}
      className="relative flex items-center gap-2 rounded-tile border border-dashed border-border-loud bg-surface px-3">
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{t(`engine.${data.engine}` as GraphWord)}</span>
      <span className="text-[12px] text-fg-muted tabular-nums">{t('engine.summary', { n: data.count })}</span>
      <button type="button" className="nodrag nopan h-7 rounded-full px-2.5 text-[12px] font-medium text-fg-muted hover:bg-well hover:text-fg"
        aria-expanded={false} onClick={() => data.onToggle(data.engine)}>{t('engine.expand')}</button>
      <Handle type="target" position={Position.Left} className={hidden} />
      <Handle type="source" position={Position.Right} className={hidden} />
    </div>
  );
}

const NODE_TYPES = { card: CardNode, lane: LaneNode, summary: SummaryNode, group: GroupNode };

/** A removed node, as the diff reports it: it is not in the graph any more, so it is drawn as a ghost. */
function ghostOf(ref: NodeRef): GraphNode {
  return {
    id: `ghost:${ref.id}`, key: ref.key, type: 'service', name: ref.name, kind: ref.kind, engine: ref.engine, group: null,
    productId: ref.productId, environmentId: null, environment: null, shared: false, provider: null, url: null, signature: null,
    state: ref.state, condition: 'ok', origin: 'declared', verification: 'declared', codeScope: null,
    verifiedAt: null, verifiedBy: null, checkedAt: null,
    attention: { failure: 0, security: 0, task: 0, improvement: 0, config: 0, unverified: 0 },
    activity: { running: false, kind: null, since: null }, lastEvent: null,
    retiredAt: null, removalReportedAt: null, missingSince: null, createdAt: '', updatedAt: '',
  };
}

export function ProductMap({ system, environments, environment, onEnvironment, node, onNode, onBack }: {
  system: AtlasSystem;
  environments: AtlasEnvironment[];
  environment: string | null;
  onEnvironment: (slug: string | null) => void;
  /** The selected node's id, from the URL. */
  node: string | null;
  onNode: (id: string | null) => void;
  onBack: () => void;
}) {
  return (
    <ReactFlowProvider>
      <ProductCanvas system={system} environments={environments} environment={environment} onEnvironment={onEnvironment} node={node} onNode={onNode} onBack={onBack} />
    </ReactFlowProvider>
  );
}

function ProductCanvas({ system, environments, environment, onEnvironment, node, onNode, onBack }: {
  system: AtlasSystem;
  environments: AtlasEnvironment[];
  environment: string | null;
  onEnvironment: (slug: string | null) => void;
  node: string | null;
  onNode: (id: string | null) => void;
  onBack: () => void;
}) {
  const t = useGraphWords();
  const flow = useReactFlow();
  const graph = useGraph(system.slug, environment);
  const processes = useProcesses();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [boxRef, box] = useBox<HTMLDivElement>();

  const [filters, setFilters] = React.useState<Filters>(() => readFilters());
  const [mode, setMode] = React.useState<Mode>('architecture');
  const [flowId, setFlowId] = React.useState<string | null>(null);
  const [since, setSince] = React.useState<'day' | 'week' | 'month' | 'date'>('week');
  const [sinceDate, setSinceDate] = React.useState('');
  const selected = node;

  const updateFilters = React.useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => { const next = { ...prev, ...patch }; writeFilters(next); return next; });
  }, []);
  const toggleEngine = React.useCallback((engine: Engine) => {
    setFilters((prev) => {
      const set = new Set(prev.collapsed);
      if (set.has(engine)) set.delete(engine); else set.add(engine);
      const next = { ...prev, collapsed: ENGINES_ORDER.filter((e) => set.has(e)) };
      writeFilters(next);
      return next;
    });
  }, []);

  // "/" goes to the search, Escape clears the selection. Both only when no field has the focus.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape' && !typing) onNode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNode]);

  // The window of "since" is fixed per choice, so the diff's query does not change on every render.
  const sinceIso = React.useMemo(() => sinceValue(since, sinceDate), [since, sinceDate]);
  const diff = useDiff(mode === 'evolution' ? sinceIso : null, 'now', system.slug);

  const data = graph.data;
  const allNodes = data?.nodes ?? [];
  const allEdges = data?.edges ?? [];
  const visible = React.useMemo(() => allNodes.filter((n) => passesFilters(n, filters)), [allNodes, filters]);
  const visibleIds = new Set(visible.map((n) => n.id));
  const shown = visible.filter((n) => n.type === 'service' || n.type === 'repo');
  const hiddenCount = allNodes.length - visible.length;

  const collapsed = React.useMemo(() => new Set(filters.collapsed), [filters.collapsed]);
  const ghosts = mode === 'evolution' ? (diff.data?.nodes.removed ?? []).map(ghostOf) : [];
  const ghostIds = new Set(ghosts.map((g) => g.id));
  const laneNodes: GraphNode[] = [...shown, ...ghosts];

  // The layout depends on the structure only: toggling a link type or a filter-free refresh keeps the picture still.
  const structural = visibleIds.size > 0 ? allEdges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)) : [];
  const structKey = layoutKey(laneNodes, structural, collapsed);
  const layout = React.useMemo(() => layoutEngines({
    nodes: laneNodes.map((n) => ({ id: n.id, engine: n.engine, group: n.group, name: n.name })),
    edges: structural.map((e) => ({ from: e.from, to: e.to })),
    collapsed,
  }), [structKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The map opens at a readable zoom: all of it when it fits, else the first columns from the left.
  // React Flow reads this once, when it mounts; later resizes do not move the picture.
  const opening = React.useMemo(() => {
    if (!box || layout.lanes.length === 0) return null;
    const w = Math.max(...layout.lanes.map((l) => l.x + l.width));
    return startViewport({ w, h: layout.lanes[0].height }, box);
  }, [layout, box]);

  // Edges drawn now: the chosen kinds, plus every edge of the selected node (it shows all its kinds).
  const engineOf = new Map<string, Engine>(laneNodes.map((n) => [n.id, n.engine]));
  const drawable = structural.filter((e) => filters.categories.includes(e.category) || (selected !== null && (e.from === selected || e.to === selected)));
  const reached = selected !== null ? reach(selected, drawable) : null;

  // Query: nodes that match stay strong, the rest dim. The first match is centred.
  const query = filters.query.trim();
  const matchIds = new Set(query ? shown.filter((n) => matchesQuery(n, query)).map((n) => n.id) : []);
  const firstMatch = [...matchIds].map((id) => layout.positions[id]).find(Boolean);
  const firstMatchKey = firstMatch ? `${firstMatch.x},${firstMatch.y}` : '';
  React.useEffect(() => {
    if (!firstMatch) return;
    flow.setCenter(firstMatch.x + NODE_W / 2, firstMatch.y + NODE_H / 2, { zoom: Math.max(flow.getZoom(), MIN_START_ZOOM), duration: 300 });
    // Centre only when the match itself changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, firstMatchKey]);

  // Flows: the chosen process numbers the services of its steps.
  const processList = processesOf(processes.data ?? [], system.id);
  const flowProcess: AtlasProcess | null = processList.find((p) => p.id === flowId) ?? null;
  const stepOf = mode === 'flows' ? stepNumbers(flowProcess) : new Map<string, number>();

  const activeIds = (() => {
    if (reached) return new Set(reached.keys());
    if (mode === 'flows' && flowProcess) return new Set(stepOf.keys());
    return null;
  })();

  const cardNodes: Node[] = [];
  for (const lane of layout.lanes) {
    cardNodes.push({
      id: `lane:${lane.engine}`, type: 'lane', position: { x: lane.x, y: 0 }, zIndex: -1, style: { pointerEvents: 'all', width: lane.width, height: lane.height },
      selectable: false, draggable: false, connectable: false, focusable: false,
      data: { engine: lane.engine, count: lane.count, collapsed: lane.collapsed, onToggle: toggleEngine } satisfies LaneData,
    });
  }
  for (const s of layout.summaries) {
    cardNodes.push({
      id: s.id, type: 'summary', position: { x: s.x, y: s.y }, draggable: false, style: { pointerEvents: 'all' },
      data: { engine: s.engine, count: s.count, onToggle: toggleEngine } satisfies SummaryData,
    });
  }
  // A group's name sits above its first node, in the room the layout keeps for it.
  const groupTops = new Map<string, { x: number; y: number; label: string }>();
  for (const n of laneNodes) {
    const pos = layout.positions[n.id];
    if (!pos || !n.group) continue;
    const key = `${n.engine}|${n.group}`;
    const at = groupTops.get(key);
    if (!at || pos.y < at.y) groupTops.set(key, { x: pos.x, y: pos.y, label: n.group });
  }
  for (const [key, g] of groupTops) {
    cardNodes.push({
      id: `group:${key}`, type: 'group', position: { x: g.x, y: g.y - GROUP_LABEL_OFFSET }, selectable: false, draggable: false, focusable: false,
      data: { label: g.label } satisfies GroupData,
    });
  }
  const byId = new Map(laneNodes.map((n) => [n.id, n]));
  for (const n of laneNodes) {
    const pos = layout.positions[n.id];
    if (!pos) continue;
    const inActive = activeIds === null || activeIds.has(n.id);
    const attention = Object.values(n.attention).reduce((s, v) => s + v, 0);
    const dim = !inActive || (query !== '' && !matchIds.has(n.id)) || (mode === 'attention' && attention === 0);
    const badge = mode !== 'evolution' ? null
      : ghostIds.has(n.id) ? 'removed'
      : diff.data?.nodes.added.some((a) => a.id === n.id) ? 'added'
      : diff.data?.nodes.changed.some((c) => c.node.id === n.id) ? 'changed' : null;
    cardNodes.push({
      id: n.id, type: 'card', position: pos, draggable: false, selectable: false, style: { pointerEvents: 'all' },
      data: {
        node: n, dim, hit: matchIds.has(n.id), selected: selected === n.id,
        step: stepOf.get(n.id) ?? null, badge, running: n.activity.running, ghost: ghostIds.has(n.id),
      } satisfies CardData,
    });
  }

  // Edges: between the nodes as drawn (collapsed engines stand for themselves), coloured by kind.
  const dimEdge = (a: string, b: string) => activeIds !== null && !(activeIds.has(a) && activeIds.has(b));
  const edges: Edge[] = [];
  const pairs = remapEdges(drawable, engineOf, collapsed);
  for (const p of pairs) {
    const e: GraphEdge = p.edge;
    const sourceNode = byId.get(e.from);
    const targetNode = byId.get(e.to);
    const moving = !!sourceNode?.activity.running || !!targetNode?.activity.running;
    const touches = selected !== null && (e.from === selected || e.to === selected);
    edges.push({
      id: p.id, source: p.source, target: p.target, type: 'smoothstep', selectable: false, focusable: false,
      animated: moving,
      markerEnd: { type: MarkerType.ArrowClosed, color: CATEGORY_COLOR[e.category], width: 14, height: 14 },
      style: {
        stroke: CATEGORY_COLOR[e.category],
        strokeWidth: touches ? 2.25 : 1.5,
        ...(e.planned ? { strokeDasharray: '6 5' } : {}),
        opacity: dimEdge(p.source, p.target) && !touches ? 0.2 : 1,
      },
    });
  }

  const selectedNode = selected && !ghostIds.has(selected) ? byId.get(selected) ?? null : null;
  const drawerId = selectedNode ? selectedNode.id : null;
  const onNodeClick = React.useCallback((_: React.MouseEvent, n: Node) => {
    if (n.type === 'card') onNode(selected === n.id ? null : n.id);
  }, [onNode, selected]);

  // A process step picked in the panel selects its first service on the map.
  const onStep = (step: ProcessStep) => {
    const id = step.services.find((s) => byId.has(s));
    if (id) onNode(id);
  };

  const noNodes = !graph.isLoading && data && allNodes.length === 0;
  const side = mode !== 'architecture';

  return (
    <div className="flex flex-col gap-3" data-testid="atlas-product-map">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="ghost" onClick={onBack}>← {t('product.back')}</Button>
        <ProductMark product={system} size={32} />
        <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] text-fg">{system.name}</h2>
        {system.description && <p className="hidden min-w-0 truncate text-[14px] text-fg-muted xl:block">{system.description}</p>}
        <div className="ml-auto min-w-0 max-w-full">
          <ModeBar mode={mode} onMode={setMode} />
        </div>
      </div>
      <MapToolbar filters={filters} onFilters={updateFilters} kinds={[...new Set(allNodes.map((n) => n.kind))].sort()}
        environments={environments} environment={environment} onEnvironment={onEnvironment} searchRef={searchRef}
        hidden={hiddenCount} matches={matchIds.size} query={query} selected={selected !== null} onClear={() => onNode(null)} />
      <div className={cn('grid gap-3', side && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <div ref={boxRef} className="atlas-flow relative h-[calc(100dvh-17rem)] min-h-[560px] overflow-hidden rounded-panel bg-well"
          data-testid="atlas-graph-canvas" title={t('product.hint')}>
          {graph.error ? <p className="p-6 text-[14px] text-danger">{t('product.error')}</p>
            : !data ? <div className="h-full" aria-label={t('product.loading')} />
            : noNodes ? <p className="p-6 text-[14px] text-fg-muted">{t('product.empty')}</p>
            : opening && (
              <ReactFlow
                key={`${system.slug}|${environment ?? ''}`}
                nodes={cardNodes} edges={edges} nodeTypes={NODE_TYPES}
                defaultViewport={opening}
                minZoom={0.3} maxZoom={1.8}
                nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
                onNodeClick={onNodeClick}
                onPaneClick={() => onNode(null)}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={24} size={1} color="var(--ds-border-default)" />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap className="max-lg:hidden" pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === 'card' ? 'var(--ds-border-loud)' : 'transparent')} />
              </ReactFlow>
            )}
          <NodeDrawer inMap nodeId={drawerId} onClose={() => onNode(null)} onNode={onNode} />
        </div>
        {side && (
          <aside className="flex flex-col gap-3" aria-label={t('mode.label')}>
            {mode === 'flows' && <FlowsPanel processes={processList} flowId={flowId} onFlow={setFlowId} onStep={onStep} />}
            {mode === 'operation' && <OperationPanel slug={system.slug} systemId={system.id} />}
            {mode === 'attention' && <AttentionPanel slug={system.slug} onNode={onNode} />}
            {mode === 'evolution' && (
              <>
                <SincePicker choice={since} date={sinceDate} onChoice={setSince} onDate={setSinceDate} />
                <EvolutionPanel system={system.slug} since={sinceIso} onNode={onNode} />
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
