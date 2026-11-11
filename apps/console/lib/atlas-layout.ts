import type { Engine } from './atlas-graph';

/*
 * Where each node of the product map goes: one column per engine, in the order the Atlas defines,
 * groups stacked by name, nodes by where their neighbours sit. Pure and deterministic (the same
 * input always gives the same picture), so the map does not jump when the data refreshes, and it
 * has no React or DOM in it so it can be tested without a page.
 */

// Same order as ENGINES in atlas-graph.ts. Kept here as a plain constant so this module stays free of
// the client-side imports that file pulls in (the tests import this module directly).
const ENGINE_ORDER: readonly Engine[] = ['code', 'delivery', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security'];

export interface LayoutInput {
  nodes: Array<{ id: string; engine: Engine; group: string | null; name: string }>;
  edges: Array<{ from: string; to: string }>;
  collapsed: ReadonlySet<Engine>;
}

export interface LayoutOutput {
  positions: Record<string, { x: number; y: number }>;
  lanes: Array<{ engine: Engine; x: number; width: number; height: number; count: number; collapsed: boolean }>;
  summaries: Array<{ id: string; engine: Engine; count: number; x: number; y: number }>;
}

const PAD = 10;           // inside a lane, around its nodes (a 232 px lane holds a 212 px card)
export const LANE_HEADER = 52;   // the engine's name and its collapse button, above the first node
const GROUP_HEADER = 26;  // a group's heading, when its nodes have one
const SWEEPS = 4;         // alternating left-to-right and right-to-left passes

/** The id of the summary node that stands for a collapsed engine. */
export const summaryId = (engine: Engine) => `summary:${engine}`;

export function layoutEngines(input: LayoutInput, opts?: { laneWidth?: number; nodeHeight?: number; gap?: number; colGap?: number; groupGap?: number }): LayoutOutput {
  const laneWidth = opts?.laneWidth ?? 232;
  const nodeHeight = opts?.nodeHeight ?? 54;
  const gap = opts?.gap ?? 12;
  const colGap = opts?.colGap ?? 20;
  const groupGap = opts?.groupGap ?? 18;
  const collapsed = input.collapsed;

  // Nodes of an unknown engine are dropped rather than placed somewhere arbitrary.
  const nodes = input.nodes.filter((n) => ENGINE_ORDER.includes(n.engine));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const engines = ENGINE_ORDER.filter((e) => nodes.some((n) => n.engine === e));

  // Neighbours in other columns are the only ones that say where a node should sit across the map.
  const neighbours = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of input.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || a.id === b.id || a.engine === b.engine) continue;
    neighbours.get(a.id)!.push(b.id);
    neighbours.get(b.id)!.push(a.id);
  }

  // Groups keep a fixed order (by name, ungrouped last); inside the column, nodes are sorted by name first.
  const groupNames = [...new Set(nodes.map((n) => n.group).filter((g): g is string => g !== null))].sort((a, b) => a.localeCompare(b));
  const groupRank = (g: string | null) => (g === null ? groupNames.length : groupNames.indexOf(g));
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const columns = new Map<Engine, string[]>();
  for (const e of engines) {
    columns.set(e, nodes.filter((n) => n.engine === e)
      .sort((a, b) => groupRank(a.group) - groupRank(b.group) || byName(a, b))
      .map((n) => n.id));
  }

  // Rank = index inside the column. Each sweep moves a node toward the average rank of its neighbours.
  const rank = new Map<string, number>();
  const setRanks = (ids: string[]) => ids.forEach((id, i) => rank.set(id, i));
  for (const ids of columns.values()) setRanks(ids);

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const order = sweep % 2 === 0 ? engines : [...engines].reverse();
    for (const engine of order) {
      const ids = columns.get(engine)!;
      const bary = new Map<string, number>();
      for (const id of ids) {
        const others = neighbours.get(id)!.map((nb) => rank.get(nb)!);
        bary.set(id, others.length > 0 ? others.reduce((s, r) => s + r, 0) / others.length : rank.get(id)!);
      }
      ids.sort((a, b) => groupRank(byId.get(a)!.group) - groupRank(byId.get(b)!.group)
        || bary.get(a)! - bary.get(b)! || byName(byId.get(a)!, byId.get(b)!));
      setRanks(ids);
    }
  }

  // Height of one column: its groups and nodes stacked from the top, at least one node tall.
  const stack = (ids: string[]) => {
    let y = LANE_HEADER;
    let previous: string | null | undefined;
    const at: Array<{ id: string; y: number }> = [];
    for (const id of ids) {
      const group = byId.get(id)!.group;
      if (group !== previous) {
        if (previous !== undefined) y += groupGap;
        if (group !== null) y += GROUP_HEADER;
        previous = group;
      }
      at.push({ id, y });
      y += nodeHeight + gap;
    }
    return { at, end: y - gap };
  };

  const stacked = new Map<Engine, Array<{ id: string; y: number }>>();
  let contentEnd = LANE_HEADER + nodeHeight;
  for (const e of engines) {
    if (collapsed.has(e)) continue;
    const s = stack(columns.get(e)!);
    stacked.set(e, s.at);
    contentEnd = Math.max(contentEnd, s.end);
  }
  const height = contentEnd + PAD;

  // All columns share one height so the lane backgrounds line up.
  const positions: LayoutOutput['positions'] = {};
  const summaries: LayoutOutput['summaries'] = [];
  const lanes: LayoutOutput['lanes'] = [];
  engines.forEach((engine, col) => {
    const x = col * (laneWidth + colGap);
    const isCollapsed = collapsed.has(engine);
    const count = columns.get(engine)!.length;
    lanes.push({ engine, x, width: laneWidth, height, count, collapsed: isCollapsed });
    if (isCollapsed) {
      summaries.push({ id: summaryId(engine), engine, count, x: x + PAD, y: LANE_HEADER });
      return;
    }
    for (const { id, y } of stacked.get(engine)!) positions[id] = { x: x + PAD, y };
  });

  return { positions, lanes, summaries };
}
