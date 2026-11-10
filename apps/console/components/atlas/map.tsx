'use client';

import * as React from 'react';
import {
  Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useStore,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Atlas, AtlasRepo, AtlasService, AtlasSystem, ServiceState } from '@/lib/atlas';
import { ProductMark } from '@/components/product';
import { cn } from '@/components/ui';
import { LINK_COLOR, Legend, MarkGlyph, StateGlyph, conditionMark, liveClass, useLive, useWords } from './parts';
import { LINK_KINDS } from '@/lib/atlas';
import type { AtlasWord } from './words';

/*
 * The map. Zoom is the level of detail: from afar one node per system, with what it leans on;
 * up close the services inside each system and the links between them. A node pulses while
 * something is happening to it, and an edge moves only while something is passing through it.
 */

const COL = 300;          // one column per system
const NEAR = 0.8;         // at this zoom and beyond, systems open into their services
const ROW = 62;

type SystemData = { system: AtlasSystem; state: ServiceState; live: boolean; open: boolean; label: string };
type ServiceData = { service: AtlasService; live: string | false };
type RepoData = { repo: AtlasRepo; state: ServiceState };

const hidden = '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent';

function SystemNode({ data }: NodeProps<Node<SystemData>>) {
  return (
    <div data-testid="atlas-node-system" className={cn('flex w-[260px] items-center gap-3 bg-surface px-4', data.open ? 'h-12' : 'h-[76px]', data.live && 'atlas-live')}>
      <Handle type="target" position={Position.Top} className={hidden} />
      <ProductMark product={data.system} size={data.open ? 24 : 36} />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-semibold text-fg', data.open ? 'text-[14px]' : 'text-[17px]')}>{data.system.name}</span>
        {!data.open && <span className="block truncate text-[13px] text-fg-muted">{data.label}</span>}
      </span>
      <StateGlyph state={data.state} size={data.open ? 14 : 18} />
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </div>
  );
}

function ServiceNode({ data }: NodeProps<Node<ServiceData>>) {
  const s = data.service;
  return (
    <div data-testid="atlas-node-service" data-condition={s.condition}
      className={cn('flex h-[52px] w-[260px] items-center gap-2.5 px-3', s.productId ? 'bg-well' : 'bg-chip', s.condition === 'gap' && 'atlas-hatch-loud', s.condition === 'planned' && 'atlas-dashed', data.live)}>
      <Handle type="target" position={Position.Top} className={hidden} />
      {s.condition === 'gap' || s.condition === 'planned' ? <MarkGlyph mark={conditionMark(s.condition)} /> : <StateGlyph state={s.state} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-fg">{s.name}</span>
        {s.provider && <span className="block truncate text-[13px] text-fg-muted">{s.provider}</span>}
      </span>
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </div>
  );
}

function RepoNode({ data }: NodeProps<Node<RepoData>>) {
  return (
    <div className={cn('flex h-10 w-[260px] items-center gap-2.5 bg-alt px-3', data.state === 'deploying' && 'atlas-live')}>
      <StateGlyph state={data.state} />
      <span className="truncate text-[13px] text-fg-secondary">{data.repo.fullName}</span>
      <Handle type="source" position={Position.Bottom} className={hidden} />
    </div>
  );
}

const NODE_TYPES = { system: SystemNode, service: ServiceNode, repo: RepoNode };

function systemState(s: AtlasSystem): ServiceState {
  const h = s.health;
  return h.down > 0 ? 'down' : h.deploying > 0 ? 'deploying' : h.degraded > 0 ? 'degraded' : h.up > 0 ? 'up' : 'unknown';
}

function Graph({ atlas, onSystem }: { atlas: Atlas; onSystem: (slug: string) => void }) {
  const t = useWords();
  const near = useStore((s) => s.transform[2] >= NEAR);
  const live = useLive(atlas);

  const { nodes, edges } = React.useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const byId = new Map(atlas.services.map((s) => [s.id, s]));
    const stroke = 'var(--ds-border-loud)';
    const edge = (id: string, source: string, target: string, moving: boolean, kind?: keyof typeof LINK_COLOR | null, planned?: boolean): Edge => ({
      id, source, target, animated: moving, focusable: false,
      style: {
        stroke: moving ? 'var(--ds-running)' : kind ? LINK_COLOR[kind] : stroke, strokeWidth: moving ? 2 : kind ? 2 : 1.25,
        ...(planned ? { strokeDasharray: '6 5' } : {}),
      },
    });

    let deepest = 0;
    atlas.systems.forEach((system, col) => {
      const x = col * COL;
      const own = atlas.services.filter((s) => s.productId === system.id);
      const repos = atlas.repos.filter((r) => r.productId === system.id);
      nodes.push({
        id: system.id, type: 'system', position: { x, y: 0 }, draggable: false,
        data: { system, state: systemState(system), live: live.systems.has(system.id), open: near, label: t('map.services', { n: own.length }) } satisfies SystemData,
      });
      repos.forEach((repo, i) => {
        const state: ServiceState = repo.lastRunStatus === 'success' ? 'up' : repo.lastRunStatus === 'failure' ? 'down' : repo.lastRunStatus === 'running' ? 'deploying' : 'unknown';
        nodes.push({ id: repo.id, type: 'repo', position: { x, y: -70 - i * 46 }, draggable: false, data: { repo, state } satisfies RepoData });
        edges.push(edge(`r-${repo.id}`, repo.id, system.id, state === 'deploying'));
      });
      if (near) {
        own.forEach((service, i) => {
          nodes.push({
            id: service.id, type: 'service', position: { x, y: 62 + i * ROW }, draggable: false,
            data: { service, live: liveClass(live, service.id) } satisfies ServiceData,
          });
        });
        deepest = Math.max(deepest, 62 + own.length * ROW);
      } else deepest = Math.max(deepest, 100);
    });

    const external = atlas.services.filter((s) => s.productId === null);
    const width = Math.max(atlas.systems.length, 1) * COL;
    const perRow = Math.max(1, Math.floor(width / COL));
    external.forEach((service, i) => {
      nodes.push({
        id: service.id, type: 'service', draggable: false,
        position: { x: (i % perRow) * COL, y: deepest + 90 + Math.floor(i / perRow) * ROW },
        data: { service, live: liveClass(live, service.id) } satisfies ServiceData,
      });
    });

    // Up close an edge joins two services; from afar it joins the systems they belong to, once.
    const seen = new Set<string>();
    for (const link of atlas.links) {
      const from = byId.get(link.from);
      const to = byId.get(link.to);
      if (!from || !to) continue;
      const source = near || !from.productId ? from.id : from.productId;
      const target = near || !to.productId ? to.id : to.productId;
      const key = `${source}>${target}`;
      if (source === target || seen.has(key)) continue;
      seen.add(key);
      const moving = live.flowing.has(from.id) || live.flowing.has(to.id);
      edges.push(edge(key, source, target, moving, link.kind, link.planned));
    }
    return { nodes, edges };
  }, [atlas, near, live, t]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      minZoom={0.15} maxZoom={1.8} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => {
        const system = node.type === 'system' ? (node.data as SystemData).system
          : node.type === 'service' ? atlas.systems.find((s) => s.id === (node.data as ServiceData).service.productId) : undefined;
        if (system) onSystem(system.slug);
      }}
    >
      <Background gap={24} size={1} color="var(--ds-border-default)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export function AtlasMap({ atlas, onSystem }: { atlas: Atlas; onSystem: (slug: string) => void }) {
  const t = useWords();
  return (
    <div data-testid="atlas-map">
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-[14px] text-fg-muted">{t('map.hint')}</p>
        <Legend className="ml-auto" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-fg-muted" data-testid="atlas-map-legend" aria-label={t('map.legendLinks')}>
        <span className="font-semibold">{t('map.legendLinks')}</span>
        {LINK_KINDS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0 w-5 border-t-[3px]" style={{ borderColor: LINK_COLOR[k] }} />{t(`link.${k}` as AtlasWord)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0 w-5 border-t-[3px] border-dashed" style={{ borderColor: 'var(--ds-fg-secondary)' }} />{t('map.planned')}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="atlas-hatch-loud inline-block h-3.5 w-5" />{t('map.gap')}</span>
      </div>
      <div className="atlas-flow h-[62vh] min-h-[420px] bg-alt">
        <ReactFlowProvider><Graph atlas={atlas} onSystem={onSystem} /></ReactFlowProvider>
      </div>
    </div>
  );
}
