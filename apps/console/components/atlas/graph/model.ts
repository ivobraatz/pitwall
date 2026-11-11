import type { Engine, EdgeCategory, GraphEdge, GraphNode, Verification } from '@/lib/atlas-graph';
import type { ServiceState } from '@/lib/atlas';
import { ENGINES, EDGE_CATEGORIES } from '@/lib/atlas-graph';
import { summaryId } from '@/lib/atlas-layout';

/*
 * The map's rules without the picture: what a filter keeps, what a selection reaches, which edges
 * are drawn once engines are collapsed. Kept apart from the components so each rule has one place.
 */

/** Edge colours by category: one hue each, none of them the failure red (red is for failure only). */
export const CATEGORY_COLOR: Record<EdgeCategory, string> = {
  infra: 'var(--ds-info)',
  data: 'var(--ds-running)',
  business: 'var(--ds-success)',
  trigger: 'var(--ds-violet)',
  operational: 'var(--ds-fg-quaternary)',
  security: 'var(--ds-warning)',
};

/** Shown at first: the structure of what runs. The rest are read on demand. */
export const DEFAULT_CATEGORIES: EdgeCategory[] = ['infra', 'data', 'business'];

export const MODES = ['architecture', 'flows', 'operation', 'attention', 'evolution'] as const;
export type Mode = (typeof MODES)[number];

export interface Filters {
  query: string;
  kind: string;                    // 'all' or a node kind
  state: ServiceState | 'all';
  verification: Verification | 'all';
  categories: EdgeCategory[];
  collapsed: Engine[];
}

export const DEFAULT_FILTERS: Filters = {
  query: '', kind: 'all', state: 'all', verification: 'all', categories: DEFAULT_CATEGORIES, collapsed: [],
};

/** The smallest zoom the map opens at: below it the names are too small to read at first glance. */
export const MIN_START_ZOOM = 0.75;

/**
 * The viewport a map opens with. The whole content when it fits at a readable zoom (centred); otherwise
 * the left edge at the top, at the readable zoom, so the first column is read first and the rest is
 * reached by dragging sideways.
 */
export function startViewport(content: { w: number; h: number }, box: { w: number; h: number }) {
  const pad = 16;
  const fit = Math.min(1, (box.w - pad * 2) / Math.max(content.w, 1), (box.h - pad * 2) / Math.max(content.h, 1));
  if (fit >= MIN_START_ZOOM) return { zoom: fit, x: (box.w - content.w * fit) / 2, y: (box.h - content.h * fit) / 2 };
  return { zoom: MIN_START_ZOOM, x: pad, y: pad };
}

const STORE_KEY = 'atlas-graph-filters';
const STATES: Array<ServiceState | 'all'> = ['all', 'up', 'down', 'deploying', 'degraded', 'unknown'];
const VERIFICATIONS: Array<Verification | 'all'> = ['all', 'verified', 'stale', 'found_in_code', 'not_found', 'reported', 'declared'];

/** The filters a person set last, kept for this tab only. Storage can be blocked: then the defaults hold. */
export function readFilters(): Filters {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw) as Partial<Filters>;
    return {
      query: typeof p.query === 'string' ? p.query : '',
      kind: typeof p.kind === 'string' ? p.kind : 'all',
      state: STATES.includes(p.state as ServiceState) ? (p.state as Filters['state']) : 'all',
      verification: VERIFICATIONS.includes(p.verification as Verification) ? (p.verification as Filters['verification']) : 'all',
      categories: Array.isArray(p.categories) ? p.categories.filter((c): c is EdgeCategory => EDGE_CATEGORIES.includes(c as EdgeCategory)) : DEFAULT_CATEGORIES,
      collapsed: Array.isArray(p.collapsed) ? p.collapsed.filter((e): e is Engine => ENGINES.includes(e as Engine)) : [],
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function writeFilters(f: Filters) {
  try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch { /* not kept for this tab */ }
}

/** Whether a node passes the type, state and verification filters (the query only highlights). */
export function passesFilters(n: GraphNode, f: Filters): boolean {
  if (f.kind !== 'all' && n.kind !== f.kind) return false;
  if (f.state !== 'all' && n.state !== f.state) return false;
  if (f.verification !== 'all' && n.verification !== f.verification) return false;
  return true;
}

/** The search: a name, a key, a provider or a signature that contains the text (case and accents ignored). */
export function matchesQuery(n: GraphNode, query: string): boolean {
  const q = normalize(query);
  if (!q) return false;
  return [n.name, n.key, n.provider, n.signature, n.kind].some((v) => !!v && normalize(v).includes(q));
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * How far each node is from the selected one, following edges either way, up to `depth`. The selected
 * node is 0; direct neighbours 1 (strong), further ones 2+ (medium). Only the given edges are walked.
 */
export function reach(start: string, edges: GraphEdge[], depth = 3): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
  }
  const dist = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!dist.has(nb)) { dist.set(nb, d); next.push(nb); }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Edges as the canvas draws them: an endpoint inside a collapsed engine becomes that engine's summary,
 * and an edge that ends up inside one summary is dropped. Duplicates (same ends, same relation) collapse.
 */
export function remapEdges(edges: GraphEdge[], engineOf: Map<string, Engine>, collapsed: ReadonlySet<Engine>) {
  const end = (id: string) => {
    const e = engineOf.get(id);
    return e && collapsed.has(e) ? summaryId(e) : id;
  };
  const seen = new Set<string>();
  const out: Array<{ id: string; source: string; target: string; edge: GraphEdge }> = [];
  for (const edge of edges) {
    const source = end(edge.from);
    const target = end(edge.to);
    if (source === target) continue;
    const key = `${source}>${target}>${edge.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `${source}>${target}>${edge.id}`, source, target, edge });
  }
  return out;
}

/** The structure the layout depends on: when this key stays the same, the picture does not move. */
export function layoutKey(nodes: GraphNode[], edges: GraphEdge[], collapsed: ReadonlySet<Engine>): string {
  const n = nodes.map((x) => `${x.id}|${x.engine}|${x.group ?? ''}|${x.name}`).sort().join(';');
  const e = edges.map((x) => `${x.from}>${x.to}`).sort().join(';');
  return `${n}#${e}#${[...collapsed].sort().join(',')}`;
}

