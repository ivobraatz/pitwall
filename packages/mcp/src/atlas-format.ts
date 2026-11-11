/*
 * Short text for the agent and the terminal, for the Atlas reads and the sync result. The JSON
 * stays in the second block of each tool result, as in format.ts.
 */
import type { Relation, Scope, SyncResponse } from './sync/types.js';

const SYNC_STATUS: Record<SyncResponse['status'], string> = {
  applied: 'aplicado', noop: 'sem mudanças', partial: 'parcial', rejected: 'rejeitado',
};
const STATE: Record<string, string> = {
  up: 'no ar', down: 'fora do ar', degraded: 'degradado', deploying: 'implantando', unknown: 'sem dado',
};
const VERIFICATION: Record<string, string> = {
  verified: 'verificado', stale: 'verificação antiga', found_in_code: 'encontrado no código', not_found: 'não encontrado',
  reported: 'relatado por agente', declared: 'declarado',
};
const ATTENTION: Record<string, string> = {
  failure: 'falha', security: 'segurança', task: 'tarefa', improvement: 'melhoria', config: 'configuração', unverified: 'não verificado',
};

const LIST_CAP = 20;
const when = (iso: string) => iso.replace('T', ' ').slice(0, 16);
const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—');

function more(list: string[], cap: number): string[] {
  return list.length > cap ? [...list.slice(0, cap), `  … e mais ${list.length - cap}`] : list;
}

export function syncText(res: SyncResponse, repo: string, scope: Scope): string {
  const out = [
    `Sincronizado ${repo} (escopo ${scope}): ${SYNC_STATUS[res.status] ?? res.status}.`,
    `Criados: ${res.created.length} · alterados: ${res.updated.length} · sem mudança: ${res.unchanged} · ` +
      `sumiram do código: ${res.gone.length} · remoções relatadas: ${res.removalsReported.length}.`,
  ];
  if (res.replayed) out.push('Este pacote já tinha sido enviado; nada foi gravado de novo.');
  if (res.created.length > 0) out.push('Criados:', ...more(res.created.map((c) => `- ${c}`), LIST_CAP));
  if (res.gone.length > 0) out.push('Sumiram do código (ainda sem remoção confirmada):', ...more(res.gone.map((c) => `- ${c}`), LIST_CAP));
  if (res.rejected.length > 0) out.push('Recusados:', ...more(res.rejected.map((r) => `- ${r.op}: ${r.message}`), LIST_CAP));
  if (res.attention.length > 0) out.push('Atenção:', ...more(res.attention.map((a) => `- ${a}`), LIST_CAP));
  return out.join('\n');
}

interface GraphNodeLine {
  id: string; name: string; kind: string; engine: string; state: string; verification: string;
  attention: Record<string, number>;
}
interface GraphEdgeLine { from: string; to: string; relation: Relation }
export interface GraphText {
  nodes: GraphNodeLine[];
  edges: GraphEdgeLine[];
  engines: Array<{ key: string; name: string; position: number }>;
  coverage: { percent: number } | null;
  sources: Array<{ name: string; connected: boolean; stale: boolean }>;
}

function nodeLine(n: GraphNodeLine): string {
  const attention = Object.entries(n.attention).filter(([, v]) => v > 0).map(([k, v]) => `${ATTENTION[k] ?? k} ${v}`).join(', ');
  return `${n.name} [${n.kind}] · ${STATE[n.state] ?? n.state} · ${VERIFICATION[n.verification] ?? n.verification}` +
    `${attention ? ` · ${attention}` : ''} · id ${n.id}`;
}

export function graphText(g: GraphText, label: string): string {
  const head = `${label}: ${g.nodes.length} nós, ${g.edges.length} ligações${g.coverage ? `, cobertura ${g.coverage.percent}%` : ''}.`;
  if (g.nodes.length === 0) return `${head}\nNenhum nó. Cadastre com register_service ou sincronize um repositório.`;
  const names = new Map(g.nodes.map((n) => [n.id, n.name]));
  const out = [head];
  for (const engine of [...g.engines].sort((a, b) => a.position - b.position)) {
    const nodes = g.nodes.filter((n) => n.engine === engine.key);
    if (nodes.length === 0) continue;
    out.push('', `${engine.name} (${nodes.length}):`, ...more(nodes.map((n) => `- ${nodeLine(n)}`), 80));
  }
  if (g.edges.length > 0) {
    out.push('', 'Ligações:', ...more(g.edges.map((e) => `- ${names.get(e.from) ?? e.from} → ${names.get(e.to) ?? e.to} (${e.relation})`), 100));
  }
  const stale = g.sources.filter((s) => s.connected && s.stale).map((s) => s.name);
  if (stale.length > 0) out.push('', `Fontes sem atualização recente: ${stale.join(', ')}.`);
  return out.join('\n');
}

export interface NodeDetailText {
  node: {
    name: string; kind: string; state: string; verification: string; verifiedAt: string | null; origin: string;
    environment: string | null;
  };
  engine: string;
  system: { name: string } | null;
  providerUrl: string | null;
  incoming: Array<{ edge: { relation: string }; node: { name: string } }>;
  outgoing: Array<{ edge: { relation: string }; node: { name: string } }>;
  impact: { direct: Array<{ name: string }>; indirect: unknown[]; systems: Array<{ name: string }> };
  evidence: Array<{ source: string; method: string; ref: string; scope: string; goneAt: string | null }>;
  refs: Array<{ kind: string; code: string; title: string | null; class: string }>;
  events: Array<{ at: string; source: string; type: string; title: string }>;
  repos: Array<{ fullName: string }>;
}

export function nodeText(d: NodeDetailText): string {
  const n = d.node;
  const out = [
    `${n.name} [${n.kind}] — ${d.engine} · ${d.system?.name ?? 'compartilhado'} · ${n.environment ?? 'sem ambiente'}`,
    `Estado: ${STATE[n.state] ?? n.state}; verificação: ${VERIFICATION[n.verification] ?? n.verification}` +
      `${n.verifiedAt ? ` (${when(n.verifiedAt)})` : ''}; origem: ${n.origin}.`,
  ];
  if (d.providerUrl) out.push(`Abrir no provedor: ${d.providerUrl}`);
  if (d.outgoing.length > 0) out.push('Depende de:', ...more(d.outgoing.map((x) => `- ${x.edge.relation} → ${x.node.name}`), 30));
  if (d.incoming.length > 0) out.push('Usado por:', ...more(d.incoming.map((x) => `- ${x.node.name} → ${x.edge.relation}`), 30));
  out.push(
    `Se cair: ${d.impact.direct.length} direto(s), ${d.impact.indirect.length} indireto(s)` +
      `${d.impact.direct.length > 0 ? ` (${d.impact.direct.slice(0, 10).map((x) => x.name).join(', ')})` : ''}` +
      `${d.impact.systems.length > 0 ? ` · sistemas: ${d.impact.systems.map((s) => s.name).join(', ')}` : ''}.`,
  );
  if (d.evidence.length > 0) {
    out.push('Evidências:', ...more(d.evidence.map((e) => `- ${e.source} · ${e.method} · ${e.ref} · escopo ${e.scope}${e.goneAt ? ' · sumiu' : ''}`), 10));
  }
  if (d.refs.length > 0) out.push('Tarefas e chamados:', ...d.refs.map((r) => `- ${r.kind} ${r.code}${r.title ? ` — ${r.title}` : ''} (${ATTENTION[r.class] ?? r.class})`));
  if (d.events.length > 0) out.push('Eventos recentes:', ...d.events.slice(0, 5).map((e) => `- ${when(e.at)} ${e.source} ${e.type} — ${e.title}`));
  if (d.repos.length > 0) out.push(`Repositórios: ${d.repos.map((r) => r.fullName).join(', ')}.`);
  return out.join('\n');
}

export interface ChangeLine {
  at: string; actor: string; op: string; entityType: string; summary: string | null;
  fields: Array<{ field: string; before: string | null; after: string | null }>;
}

export function changesText(list: ChangeLine[]): string {
  if (list.length === 0) return 'Nenhuma mudança no período.';
  const lines: string[] = [];
  for (const c of list.slice(0, 100)) {
    lines.push(`${when(c.at)} · ${c.actor} · ${c.op} ${c.summary ?? c.entityType}`);
    for (const f of c.fields.slice(0, 5)) lines.push(`    ${f.field}: ${f.before ?? '∅'} → ${f.after ?? '∅'}`);
  }
  return lines.join('\n');
}

export interface InsightLine { severity: string; title: string; detail: string }

export function insightsText(list: InsightLine[]): string {
  if (list.length === 0) return 'Nenhum ponto de atenção pelas regras do Atlas.';
  return list.map((i) => `[${i.severity === 'check' ? 'verificar' : 'sugestão'}] ${i.title}: ${i.detail}`).join('\n');
}
