import type { Engine } from './atlas-graph';

/*
 * Where each node of the product map goes: one column per engine, in the order the Atlas defines,
 * groups stacked by name, nodes by where their neighbours sit. Pure and deterministic (the same
 * input always gives the same picture), so the map does not jump when the data refreshes, and it
 * has no React or DOM in it so it can be tested without a page.
 *
 * The company map's links are planned here too (planCompanyRoutes), for the same reason: a pure
 * function is the one place where "no link runs over a card" can be checked.
 */

// Same order as ENGINES in atlas-graph.ts. Kept here as a plain constant so this module stays free of
// the client-side imports that file pulls in (the tests import this module directly).
const ENGINE_ORDER: readonly Engine[] = ['code', 'delivery', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security'];

export interface LayoutInput {
  nodes: Array<{ id: string; engine: Engine; group: string | null; name: string }>;
  edges: Array<{ from: string; to: string }>;
  collapsed: ReadonlySet<Engine>;
}

export interface GroupLabel { key: string; engine: Engine; label: string; x: number; y: number; width: number; height: number }

export interface LayoutOutput {
  positions: Record<string, { x: number; y: number }>;
  lanes: Array<{ engine: Engine; x: number; width: number; height: number; count: number; collapsed: boolean }>;
  summaries: Array<{ id: string; engine: Engine; count: number; x: number; y: number }>;
  /** The name of each group, set on its own line above the group's first node (the layout keeps that line free). */
  groups: GroupLabel[];
}

const PAD = 10;                  // inside a lane, around its nodes (a 232 px lane holds a 212 px card)
export const LANE_HEADER = 52;   // the engine's name and its collapse button, above the first node
export const GROUP_LABEL_H = 16; // the line a group's name is set on
const GROUP_LABEL_GAP = 6;       // between a group's name and its first node
const GROUP_HEADER = GROUP_LABEL_H + GROUP_LABEL_GAP;
const SWEEPS = 4;                // alternating left-to-right and right-to-left passes

/** The id of the summary node that stands for a collapsed engine. */
export const summaryId = (engine: Engine) => `summary:${engine}`;

export function layoutEngines(input: LayoutInput, opts?: { laneWidth?: number; nodeHeight?: number; gap?: number; colGap?: number; groupGap?: number }): LayoutOutput {
  const laneWidth = opts?.laneWidth ?? 232;
  const nodeHeight = opts?.nodeHeight ?? 54;
  const gap = opts?.gap ?? 12;
  const colGap = opts?.colGap ?? 20;
  const groupGap = opts?.groupGap ?? 18;
  const collapsed = input.collapsed;
  const cardWidth = laneWidth - PAD * 2;

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

  // Height of one column: its groups and nodes stacked from the top, at least one node tall. A group's
  // name takes its own line above its first node, so no card is ever under the name.
  const stack = (ids: string[]) => {
    let y = LANE_HEADER;
    let previous: string | null | undefined;
    const at: Array<{ id: string; y: number }> = [];
    const labels: Array<{ group: string; y: number }> = [];
    for (const id of ids) {
      const group = byId.get(id)!.group;
      if (group !== previous) {
        if (previous !== undefined) y += groupGap;
        if (group !== null) { labels.push({ group, y }); y += GROUP_HEADER; }
        previous = group;
      }
      at.push({ id, y });
      y += nodeHeight + gap;
    }
    return { at, labels, end: y - gap };
  };

  const stacked = new Map<Engine, ReturnType<typeof stack>>();
  let contentEnd = LANE_HEADER + nodeHeight;
  for (const e of engines) {
    if (collapsed.has(e)) continue;
    const s = stack(columns.get(e)!);
    stacked.set(e, s);
    contentEnd = Math.max(contentEnd, s.end);
  }
  const height = contentEnd + PAD;

  // All columns share one height so the lane backgrounds line up.
  const positions: LayoutOutput['positions'] = {};
  const summaries: LayoutOutput['summaries'] = [];
  const lanes: LayoutOutput['lanes'] = [];
  const groups: LayoutOutput['groups'] = [];
  engines.forEach((engine, col) => {
    const x = col * (laneWidth + colGap);
    const isCollapsed = collapsed.has(engine);
    const count = columns.get(engine)!.length;
    lanes.push({ engine, x, width: laneWidth, height, count, collapsed: isCollapsed });
    if (isCollapsed) {
      summaries.push({ id: summaryId(engine), engine, count, x: x + PAD, y: LANE_HEADER });
      return;
    }
    const s = stacked.get(engine)!;
    for (const { id, y } of s.at) positions[id] = { x: x + PAD, y };
    for (const g of s.labels) {
      groups.push({ key: `${engine}|${g.group}`, engine, label: g.group, x: x + PAD, y: g.y, width: cardWidth, height: GROUP_LABEL_H });
    }
  });

  return { positions, lanes, summaries, groups };
}

// ── The company map's links: from the base of a card to the top of the card it reaches ─────────────

export interface Box { x: number; y: number; w: number; h: number }
export interface Route { d: string; start: { x: number; y: number }; end: { x: number; y: number }; label: { x: number; y: number }; toAtEnd: boolean }

const PORT_STEP = 14;   // distance between two links that leave or enter the same side of a card
const ROW_DIP = 18;     // how far a link between two cards of one row dips below them

/**
 * One route per link. A link leaves the base of the card that is higher and enters the top of the one
 * below it (a cubic with vertical tangents, so it never doubles back over a card). Two cards in one row
 * are joined by a shallow U under both. The count label sits just inside the end the link points at
 * (its destination), so it stays with the arrow. Links that share a side of a card are spread along it,
 * so they do not run over each other.
 */
export function planCompanyRoutes(
  boxes: ReadonlyMap<string, Box>,
  links: ReadonlyArray<{ id: string; from: string; to: string }>,
): Map<string, Route> {
  type Pending = { id: string; upper: string; lower: string; row: boolean; toIsLower: boolean };
  const pending: Pending[] = [];
  for (const l of links) {
    const a = boxes.get(l.from);
    const b = boxes.get(l.to);
    if (!a || !b || l.from === l.to) continue;
    const upper = a.y <= b.y ? l.from : l.to;
    const lower = upper === l.from ? l.to : l.from;
    const ua = boxes.get(upper)!;
    const la = boxes.get(lower)!;
    pending.push({ id: l.id, upper, lower, row: ua.y + ua.h > la.y, toIsLower: l.to === lower });
  }

  // Ports: on each card, the links on each side, ordered by the other card's x, so that none cross.
  const ports = new Map<string, Array<{ id: string; other: number }>>();
  const addPort = (node: string, side: 'top' | 'bottom', id: string, other: number) => {
    const k = `${node}|${side}`;
    (ports.get(k) ?? ports.set(k, []).get(k)!).push({ id, other });
  };
  for (const p of pending) {
    const ua = boxes.get(p.upper)!;
    const la = boxes.get(p.lower)!;
    addPort(p.upper, 'bottom', p.id, la.x + la.w / 2);
    addPort(p.lower, p.row ? 'bottom' : 'top', p.id, ua.x + ua.w / 2);
  }
  const offset = new Map<string, number>(); // `${linkId}|${cardId}` -> px from the card's centre
  for (const [k, list] of ports) {
    const node = k.split('|')[0];
    const box = boxes.get(node)!;
    list.sort((x, y) => x.other - y.other || (x.id < y.id ? -1 : 1));
    const limit = box.w / 2 - 12;
    list.forEach((port, i) => {
      const spread = (i - (list.length - 1) / 2) * PORT_STEP;
      offset.set(`${port.id}|${node}`, Math.max(-limit, Math.min(limit, spread)));
    });
  }

  const out = new Map<string, Route>();
  for (const p of pending) {
    const ua = boxes.get(p.upper)!;
    const la = boxes.get(p.lower)!;
    const start = { x: ua.x + ua.w / 2 + (offset.get(`${p.id}|${p.upper}`) ?? 0), y: ua.y + ua.h };
    if (p.row) {
      const end = { x: la.x + la.w / 2 + (offset.get(`${p.id}|${p.lower}`) ?? 0), y: la.y + la.h };
      const dip = Math.max(start.y, end.y) + ROW_DIP;
      const d = `M ${start.x} ${start.y} L ${start.x} ${dip} L ${end.x} ${dip} L ${end.x} ${end.y}`;
      out.set(p.id, { d, start, end, toAtEnd: true, label: { x: end.x, y: end.y + 9 } });
      continue;
    }
    const end = { x: la.x + la.w / 2 + (offset.get(`${p.id}|${p.lower}`) ?? 0), y: la.y };
    const mid = (end.y - start.y) / 2;
    const d = `M ${start.x} ${start.y} C ${start.x} ${start.y + mid} ${end.x} ${end.y - mid} ${end.x} ${end.y}`;
    // The label sits in the gap the destination faces: above a lower card's top, below an upper card's base.
    const target = p.toIsLower ? end : start;
    out.set(p.id, {
      d, start, end, toAtEnd: p.toIsLower,
      label: { x: target.x, y: p.toIsLower ? target.y - 9 : target.y + 9 },
    });
  }
  return out;
}
