import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PitwallClient } from './client.js';
import { guarded, ok, query } from './tools.js';
import { detectRepo } from './sync/git.js';
import { prepareSync } from './sync/run.js';
import { RELATIONS, SCOPES, type SyncResponse } from './sync/types.js';
import { changesText, graphText, insightsText, nodeText, syncText, type ChangeLine, type GraphText, type InsightLine, type NodeDetailText } from './atlas-format.js';

/*
 * The Atlas: what the team runs and what is happening to it. These tools register systems,
 * services and routines, and report work in progress, so the console shows it while it happens.
 * They need a personal token with the `atlas` scope (`list_errors`: the `errors` scope).
 */

const ATLAS = '/v1/staff/atlas';
const ERRORS = '/v1/staff/errors';
const SYSTEM = z.string().min(1).describe('Slug do sistema (veja list_products).');
const RESULT = z.enum(['ok', 'failed']);
const SERVICE_KINDS = [
  'site', 'web', 'app', 'api', 'worker', 'database', 'storage', 'domain', 'email', 'monitor', 'backup', 'package', 'integration',
  'analytics', 'external', 'other', 'pipeline', 'host', 'dns', 'cdn', 'edge', 'queue', 'cache', 'agent', 'cron', 'webhook', 'payment',
  'fiscal', 'seo', 'credential', 'vault', 'certificate',
] as const;
/** The map's columns, left to right (AtlasEngines on the server). */
const ENGINES = ['code', 'delivery', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security'] as const;
const LINK_KINDS = ['host', 'dns', 'storage', 'payment', 'email', 'ai', 'login', 'measure', 'monitor', 'support', 'deploy', 'integration', 'business'] as const;
const CONDITION = z.enum(['ok', 'warn', 'gap', 'planned', 'local']);
const STEP_STATUS = z.enum(['ok', 'warn', 'gap', 'next', 'idea']);
const OWNER = z.enum(['auto', 'agent', 'person', 'together']).describe('Quem faz: auto (roda sozinho), agent (agente), person (pessoa), together.');
const IMPACT = z.enum(['high', 'medium', 'low']);
const TASK = z.string().max(20).describe('Código da tarefa no quadro (T-XXXXX) que resolve isto.');
const STEP = {
  slug: z.string().min(1).max(60).describe('Identifica a etapa dentro do processo.'),
  name: z.string().max(120).optional().describe('Obrigatório ao criar.'),
  status: STEP_STATUS.optional().describe('ok, warn (funciona mal), gap (não existe), next (próximo passo), idea.'),
  system: z.string().optional().describe('Slug do sistema desta etapa, quando o processo cobre vários.'),
  stage: z.string().max(40).optional().describe('Chave de um estágio do processo (coluna da matriz).'),
  owner: OWNER.optional(),
  today: z.string().max(2000).optional().describe('Como é feito hoje.'),
  ideal: z.string().max(2000).optional().describe('Como deveria ser.'),
  next: z.string().max(2000).optional().describe('O próximo passo concreto.'),
  task: TASK.optional(),
  impact: IMPACT.optional(),
  services: z.array(z.string().min(1)).max(30).optional().describe('Serviços envolvidos: id, nome externo, "sistema/Nome" ou "sistema/ambiente/Nome".'),
};
const SYNC = '/v1/staff/atlas/sync';
const RELATION = z.enum(RELATIONS).describe('Tipo da ligação (1.3 do Atlas): depends_on, calls, writes_to, billed_through, deploys_to…');
const OP = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('node'), name: z.string().min(1).max(120), kind: z.string().min(1).max(40),
    key: z.string().max(160).optional(), engine: z.string().max(16).optional(), environment: z.string().max(40).optional(),
    provider: z.string().max(40).optional(), url: z.string().max(500).optional(), group: z.string().max(60).optional(),
    signature: z.string().max(60).optional(), facts: z.record(z.string().max(60), z.string().max(500)).optional(),
    evidence: z.string().max(300).optional(),
  }),
  z.object({ op: z.literal('edge'), from: z.string().min(1).max(160), to: z.string().min(1).max(160), relation: RELATION, evidence: z.string().max(300).optional() }),
  z.object({ op: z.literal('removed'), ref: z.string().min(1).max(160), evidence: z.string().max(300).optional() }),
  z.object({ op: z.literal('task'), ref: z.string().min(1).max(160), code: z.string().min(1).max(20), note: z.string().max(300).optional() }),
]);
/** The working directory the sync reads: PITWALL_REPO_DIR, or where the agent started. */
const repoDir = () => process.env.PITWALL_REPO_DIR?.trim() || process.cwd();
const toolName = () => process.env.PITWALL_TOOL?.trim() || 'claude-code';

interface Overview {
  systems: Array<{
    slug: string; name: string;
    health: { total: number; up: number; down: number; degraded: number; deploying: number; unknown: number };
    pending: { tasks: number; tickets: number; errors: number; alerts: number | null };
    attention?: { gaps: number; warnings: number };
  }>;
  now: Array<{ kind: string; title: string; detail: string | null; actor: string | null }>;
  discoveries: Array<{ source: string; kind: string; name: string; environment: string | null }>;
  collectors: Array<{ name: string; connected: boolean; error: string | null }>;
}
interface Step {
  slug: string; name: string; status: string; stage: string | null; owner: string | null; today: string | null; ideal: string | null;
  next: string | null; task: string | null; impact: string | null; system: { slug: string } | null;
}
interface Process {
  slug: string; name: string; description: string | null; system: { slug: string } | null;
  stages: Array<{ key: string; name: string }>; steps: Step[];
}
interface Attention {
  source: 'service' | 'step'; status: string; title: string; detail: string | null; next: string | null; impact: string | null;
  owner: string | null; task: string | null; system: { slug: string } | null; where: string | null;
}
interface Routine {
  slug: string; name: string; frequency: string; enabled: boolean; description: string | null; prompt: string;
  system: { slug: string } | null; lastRun: { status: string; startedAt: string; summary: string | null } | null;
}

const IMPACT_LABEL: Record<string, string> = { high: 'alto', medium: 'médio', low: 'baixo' };

function processText(list: Process[]): string {
  if (list.length === 0) return 'Nenhum processo cadastrado. Descreva um com register_process.';
  return list.map((p) => {
    const stage = new Map(p.stages.map((s) => [s.key, s.name]));
    const head = `${p.slug} — ${p.name}${p.system ? ` (${p.system.slug})` : ''}`;
    const steps = p.steps.map((s) => {
      const where = [s.system?.slug, s.stage ? stage.get(s.stage) ?? s.stage : null].filter(Boolean).join(' · ');
      const extra = [s.task, s.impact ? `impacto ${IMPACT_LABEL[s.impact] ?? s.impact}` : null].filter(Boolean).join(', ');
      return `  [${s.status}] ${s.slug}: ${s.name}${where ? ` — ${where}` : ''}${extra ? ` (${extra})` : ''}${s.next ? `\n      próximo: ${s.next}` : ''}`;
    });
    return [head, ...steps].join('\n');
  }).join('\n\n');
}

function attentionText(list: Attention[]): string {
  if (list.length === 0) return 'Nada declarado como lacuna ou aviso.';
  return list.map((i) => {
    const where = [i.system?.slug, i.where].filter(Boolean).join(' · ');
    const tail = [i.impact ? `impacto ${IMPACT_LABEL[i.impact] ?? i.impact}` : null, i.task].filter(Boolean).join(', ');
    const what = i.next ?? i.detail;
    return `[${i.status}] ${i.title}${where ? ` — ${where}` : ''}${tail ? ` (${tail})` : ''}${what ? `\n    ${what}` : ''}`;
  }).join('\n');
}

function overviewText(o: Overview): string {
  if (o.systems.length === 0) return 'O Atlas está vazio. Cadastre o primeiro sistema com register_system.';
  const lines = o.systems.map((s) => {
    const h = s.health;
    const health = h.total === 0 ? 'sem serviços' : h.down > 0 ? `${h.down} fora do ar` : `${h.up}/${h.total} no ar`;
    const p = s.pending;
    const a = s.attention;
    const gaps = a && a.gaps + a.warnings > 0 ? ` · ${a.gaps} lacunas, ${a.warnings} avisos` : '';
    return `${s.slug} — ${health} · ${p.tasks} tarefas · ${p.tickets} chamados · ${p.errors} erros (24h) · ${p.alerts ?? '?'} alertas${gaps}`;
  });
  if (o.now.length > 0) lines.push('', 'Agora:', ...o.now.map((n) => `- [${n.kind}] ${n.title}${n.actor ? ` (${n.actor})` : ''}`));
  if (o.discoveries.length > 0) lines.push('', 'Encontrado, não cadastrado:', ...o.discoveries.map((d) => `- ${d.source}: ${d.name}${d.environment ? ` @${d.environment}` : ''}`));
  const off = o.collectors.filter((c) => !c.connected).map((c) => c.name);
  if (off.length > 0) lines.push('', `Coletores não conectados: ${off.join(', ')}.`);
  return lines.join('\n');
}

interface ErrorGroup {
  product: { slug: string; name: string } | null; signature: string; route: string | null; method: string; exceptionType: string;
  message: string; statusCode: number; count: number; customers: number; firstSeen: string; lastSeen: string; traceId: string;
  tickets: { total: number; open: number }; tasks: { total: number; open: number; codes: string[] }; tracked: boolean;
}

function errorsText(r: { items: ErrorGroup[] }): string {
  if (r.items.length === 0) return 'Nenhum erro no período.';
  return r.items.map((e) => {
    const refs = [
      e.tickets.total > 0 ? `${e.tickets.total} chamado(s)` : null,
      e.tasks.total > 0 ? `tarefa ${e.tasks.codes.join(', ')}` : null,
    ].filter(Boolean).join(' + ');
    return `${e.product?.slug ?? '?'} ${e.method} ${e.route ?? '?'} — ${e.exceptionType}: ${e.message}\n` +
      `  ${e.count}x (${e.customers} cliente(s)), de ${e.firstSeen} a ${e.lastSeen} · trace ${e.traceId} · assinatura ${e.signature}\n` +
      `  ${e.tracked ? `já registrado: ${refs}` : 'sem chamado nem tarefa'}`;
  }).join('\n');
}

export function registerAtlasTools(server: McpServer, client: PitwallClient): void {
  server.registerTool('atlas_overview', {
    title: 'Ver o Atlas',
    description: 'O estado da operação: cada sistema com saúde e pendências, o que está acontecendo agora e o que os coletores acharam sem cadastro.',
    annotations: { readOnlyHint: true },
  }, guarded(client, async () => {
    const o = await client.request<Overview>('GET', ATLAS);
    return ok(overviewText(o), o);
  }));

  server.registerTool('list_errors', {
    title: 'Listar erros do servidor',
    description: 'Erros do servidor agrupados por assinatura (mesmo bug, vários clientes): sistema, rota, exceção, mensagem, contagem, primeira e última ocorrência, um trace de exemplo e se já existe chamado ou tarefa. Os mais frequentes primeiro. Pede o escopo errors.',
    inputSchema: {
      since: z.string().max(40).optional().describe('Horas atrás (ex.: 24, o padrão; até 720) ou uma data ISO.'),
      product: z.string().optional().describe('Slug do sistema (veja list_products).'),
      limit: z.number().int().min(1).max(200).optional().describe('Máximo de grupos (padrão 50).'),
    },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { since?: string; product?: string; limit?: number }) => {
    const r = await client.request<{ since: string; items: ErrorGroup[] }>('GET', `${ERRORS}/recent${query({ since: a.since, product: a.product, limit: a.limit })}`);
    return ok(errorsText(r), r);
  }));

  server.registerTool('register_system', {
    title: 'Cadastrar sistema',
    description: 'Cadastra um sistema (marca ou produto) no Atlas, ou atualiza os campos enviados de um que já existe. O slug identifica: minúsculas, números e hífen.',
    inputSchema: {
      slug: z.string().min(1).max(40),
      name: z.string().max(80).optional().describe('Obrigatório ao criar.'),
      description: z.string().max(1000).optional(),
      websiteUrl: z.string().url().max(300).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('#rrggbb'),
    },
  }, guarded(client, async (a: Record<string, unknown>) => {
    const s = await client.request<{ slug: string; name: string; created: boolean }>('POST', `${ATLAS}/systems`, a);
    return ok(`${s.created ? 'Cadastrado' : 'Atualizado'}: ${s.slug} — ${s.name}`, s);
  }));

  server.registerTool('register_service', {
    title: 'Cadastrar serviço',
    description:
      'Cadastra ou atualiza um serviço de um sistema num ambiente (API, site, worker, banco). Identificado por sistema + ambiente + nome. ' +
      'Sem system, é um serviço externo compartilhado (DNS, e-mail, pagamentos). provider e externalRef dizem ao coletor onde achar: ' +
      'railway usa "projeto/serviço"; vercel usa o nome do projeto. monitor é o nome do monitor no Uptime Kuma. ' +
      'O que os coletores não veem vem declarado: facts (detalhes chave → valor), items (lista: redes, bancos, canais), ' +
      'condition (gap = falta, warn = funciona mal) com impact, owner e task.',
    inputSchema: {
      name: z.string().min(1).max(120),
      system: z.string().optional().describe('Slug do sistema. Omita para serviço externo compartilhado.'),
      environment: z.string().max(40).optional().describe('staging, production… Criado se não existir.'),
      kind: z.enum(SERVICE_KINDS).optional(),
      engine: z.enum(ENGINES).optional().describe('Coluna do mapa. Sem ela, vem do kind (pipeline → delivery, payment → business…).'),
      key: z.string().max(160).optional().describe('Identidade estável ("sistema:ambiente:nome"). Sem ela, o servidor gera uma; mande a mesma ao atualizar.'),
      signature: z.string().max(60).optional().describe('Assinatura do catálogo de descoberta (ex.: "stripe"): o sync casa o que acha com este serviço em vez de criar outro.'),
      provider: z.string().max(40).optional().describe('railway, vercel, vm, cloudflare, stripe…'),
      externalRef: z.string().max(300).optional(),
      url: z.string().url().max(500).optional(),
      monitor: z.string().max(200).optional(),
      notes: z.string().max(2000).optional(),
      group: z.string().max(60).optional().describe('Bloco em que aparece no sistema: "Núcleo", "Na web", "Integrações".'),
      condition: CONDITION.optional().describe('ok (padrão), warn, gap, planned, local (só na máquina).'),
      facts: z.record(z.string().max(60), z.string().max(500)).optional().describe('Detalhes: {"Health": "/health", "Memória": "1 GB"}. Substitui os anteriores.'),
      items: z.array(z.string().min(1).max(80)).max(200).optional().describe('Lista de coisas que o serviço cobre. Substitui a anterior.'),
      impact: IMPACT.optional(),
      owner: OWNER.optional(),
      task: TASK.optional(),
    },
  }, guarded(client, async (a: Record<string, unknown>) => {
    const s = await client.request<{ id: string; name: string; created: boolean }>('POST', `${ATLAS}/services`, a);
    return ok(`${s.created ? 'Cadastrado' : 'Atualizado'}: ${s.name}`, s);
  }));

  server.registerTool('link_services', {
    title: 'Ligar serviços',
    description:
      'Registra que um serviço usa outro (a API usa o provedor de e-mail). Cada ponta é o id do serviço, o nome de um serviço externo, ' +
      'ou "sistema/Nome" ou "sistema/ambiente/Nome". kind diz o tipo da dependência (colore o mapa); planned marca uma ligação que ainda não existe.',
    inputSchema: {
      from: z.string().min(1),
      to: z.string().min(1),
      label: z.string().max(80).optional(),
      kind: z.enum(LINK_KINDS).optional(),
      relation: RELATION.optional().describe('Prefira a kind: diz exatamente o que a ligação significa no grafo.'),
      planned: z.boolean().optional(),
    },
  }, guarded(client, async (a: { from: string; to: string; label?: string; kind?: string; relation?: string; planned?: boolean }) => {
    const l = await client.request('POST', `${ATLAS}/links`, a);
    return ok(`Ligado: ${a.from} → ${a.to}${a.planned ? ' (planejado)' : ''}`, l);
  }));

  server.registerTool('register_process', {
    title: 'Descrever processo',
    description:
      'Cadastra ou atualiza um processo: como algo é feito, etapa por etapa (venda, suporte, publicação, funil de um produto). ' +
      'stages são as colunas (oferta, atração, conversão…), opcionais. Mandar steps substitui todas as etapas, na ordem enviada; ' +
      'para mudar uma etapa só, use update_process_step. Identificado pelo slug.',
    inputSchema: {
      slug: z.string().min(1).max(60),
      name: z.string().max(120).optional().describe('Obrigatório ao criar.'),
      description: z.string().max(2000).optional(),
      system: z.string().optional().describe('Slug do sistema, se o processo é de um só.'),
      stages: z.array(z.object({ key: z.string().min(1).max(40), name: z.string().min(1).max(80), description: z.string().max(500).optional() })).max(20).optional(),
      steps: z.array(z.object(STEP)).max(200).optional(),
    },
  }, guarded(client, async (a: Record<string, unknown>) => {
    const p = await client.request<{ slug: string; name: string; steps: number; created: boolean }>('POST', `${ATLAS}/processes`, a);
    return ok(`${p.created ? 'Cadastrado' : 'Atualizado'}: ${p.slug} — ${p.name} (${p.steps} etapas)`, p);
  }));

  server.registerTool('update_process_step', {
    title: 'Atualizar etapa de processo',
    description:
      'Cria ou atualiza uma etapa de um processo sem mexer nas outras. Ao fechar uma lacuna, mude status para ok e diga em today como ficou.',
    inputSchema: { process: z.string().min(1).describe('Slug do processo (veja atlas_processes).'), ...STEP },
  }, guarded(client, async ({ process, ...step }: { process: string; slug: string } & Record<string, unknown>) => {
    const s = await client.request<Step>('POST', `${ATLAS}/processes/${encodeURIComponent(process.trim())}/steps`, step);
    return ok(`Etapa ${s.slug}: ${s.name} [${s.status}]`, s);
  }));

  server.registerTool('atlas_processes', {
    title: 'Ver processos',
    description: 'Lista os processos com as etapas em ordem: situação, sistema, estágio, tarefa e próximo passo. system filtra um sistema.',
    inputSchema: { system: SYSTEM.optional() },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { system?: string }) => {
    const list = await client.request<Process[]>('GET', `${ATLAS}/processes` + query({ system: a.system }));
    return ok(processText(list), list);
  }));

  server.registerTool('atlas_attention', {
    title: 'Ver o que pede atenção',
    description:
      'Tudo que foi declarado como lacuna (gap) ou aviso (warn), em serviços e etapas de processo, do maior impacto para o menor. ' +
      'Bom ponto de partida para escolher o que fazer.',
    inputSchema: { system: SYSTEM.optional() },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { system?: string }) => {
    const list = await client.request<Attention[]>('GET', `${ATLAS}/attention` + query({ system: a.system }));
    return ok(attentionText(list), list);
  }));

  server.registerTool('register_repo', {
    title: 'Cadastrar repositório',
    description: 'Liga um repositório (dono/nome) a um sistema, para o Atlas mostrar a última execução do CI e os alertas de segurança.',
    inputSchema: { fullName: z.string().min(3).max(200).describe('dono/nome'), system: SYSTEM.optional() },
  }, guarded(client, async (a: { fullName: string; system?: string }) => {
    const r = await client.request<{ fullName: string }>('POST', `${ATLAS}/repos`, a);
    return ok(`Repositório cadastrado: ${r.fullName}`, r);
  }));

  server.registerTool('register_routine', {
    title: 'Cadastrar rotina',
    description:
      'Cadastra ou atualiza uma rotina: algo que roda sozinho, de tempos em tempos. O prompt é a instrução completa que o executor entrega ao agente. ' +
      'Identificada pelo slug.',
    inputSchema: {
      slug: z.string().min(1).max(60),
      name: z.string().max(120).optional().describe('Obrigatório ao criar.'),
      frequency: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Obrigatório ao criar.'),
      system: z.string().optional().describe('Slug do sistema; vazio para rotina da operação inteira.'),
      description: z.string().max(1000).optional().describe('O que ela faz, em uma frase.'),
      prompt: z.string().max(20000).optional(),
      enabled: z.boolean().optional(),
    },
  }, guarded(client, async (a: Record<string, unknown>) => {
    const r = await client.request<{ slug: string; name: string; frequency: string; created: boolean }>('POST', `${ATLAS}/routines`, a);
    return ok(`${r.created ? 'Cadastrada' : 'Atualizada'}: ${r.slug} — ${r.name} (${r.frequency})`, r);
  }));

  server.registerTool('list_routines', {
    title: 'Listar rotinas',
    description: 'Lista as rotinas com a frequência, o prompt e a última execução.',
    inputSchema: { frequency: z.enum(['daily', 'weekly', 'monthly']).optional(), enabled: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { frequency?: string; enabled?: boolean }) => {
    const list = await client.request<Routine[]>('GET', `${ATLAS}/routines` + query({ frequency: a.frequency, enabled: a.enabled }));
    const text = list.length === 0 ? 'Nenhuma rotina cadastrada.' : list.map((r) =>
      `${r.slug} [${r.frequency}${r.enabled ? '' : ', desligada'}] ${r.name}${r.system ? ` (${r.system.slug})` : ''} — última: ${r.lastRun ? `${r.lastRun.status} em ${r.lastRun.startedAt}` : 'nunca'}`).join('\n');
    return ok(text, list);
  }));

  server.registerTool('start_activity', {
    title: 'Começar atividade',
    description:
      'Avisa que você começou a trabalhar num sistema, para aparecer na faixa "Agora" do Atlas. Chame no começo de toda sessão de trabalho ' +
      'e guarde o id para o finish_activity. component é a parte mexida; se for o nome de um serviço cadastrado, ele pulsa no mapa.',
    inputSchema: {
      description: z.string().min(1).max(500).describe('Uma frase: "Corrigindo o cálculo de frete".'),
      system: SYSTEM.optional(),
      component: z.string().max(120).optional(),
    },
  }, guarded(client, async (a: { description: string; system?: string; component?: string }) => {
    // Where the work happens, so the console can tie the activity to a repo, branch and commit.
    const r = await client.request<{ id: string }>('POST', `${ATLAS}/activities`, { ...a, ...detectRepo(repoDir()), tool: toolName() });
    return ok(`Atividade iniciada. Ao terminar: finish_activity(id="${r.id}").`, r);
  }));

  server.registerTool('finish_activity', {
    title: 'Terminar atividade',
    description: 'Encerra a atividade aberta com start_activity, com o resultado em uma frase.',
    inputSchema: { id: z.string().min(1), status: RESULT.optional().describe('Padrão ok.'), result: z.string().max(2000).optional() },
  }, guarded(client, async (a: { id: string; status?: string; result?: string }) => {
    const r = await client.request('POST', `${ATLAS}/activities/${encodeURIComponent(a.id.trim())}/finish`, { status: a.status, result: a.result });
    return ok('Atividade encerrada.', r);
  }));

  server.registerTool('start_routine_run', {
    title: 'Começar execução de rotina',
    description: 'Registra que uma rotina começou a rodar. Devolve o id da execução, usado em finish_routine_run.',
    inputSchema: { routine: z.string().min(1).describe('Slug da rotina (veja list_routines).') },
  }, guarded(client, async (a: { routine: string }) => {
    const r = await client.request<{ id: string }>('POST', `${ATLAS}/routines/${encodeURIComponent(a.routine.trim())}/runs`);
    return ok(`Execução iniciada. Ao terminar: finish_routine_run(id="${r.id}").`, r);
  }));

  server.registerTool('finish_routine_run', {
    title: 'Terminar execução de rotina',
    description:
      'Encerra a execução de uma rotina com o resultado e o que ela gerou. Em links, liste cada PR, tarefa ou alerta criado. ' +
      'O primeiro encerramento vale: chamar de novo não muda o resultado.',
    inputSchema: {
      id: z.string().min(1),
      status: RESULT.optional().describe('Padrão ok.'),
      result: z.string().max(4000).optional().describe('O que foi feito e encontrado, em poucas linhas.'),
      links: z.array(z.object({
        kind: z.enum(['pr', 'task', 'alert', 'other']).optional(),
        label: z.string().min(1).max(200),
        url: z.string().url().max(500).optional(),
      })).max(30).optional(),
    },
  }, guarded(client, async (a: { id: string; status?: string; result?: string; links?: unknown[] }) => {
    const r = await client.request('POST', `${ATLAS}/runs/${encodeURIComponent(a.id.trim())}/finish`, { status: a.status, result: a.result, links: a.links });
    return ok('Execução encerrada.', r);
  }));

  server.registerTool('atlas_sync', {
    title: 'Sincronizar o repositório com o Atlas',
    description:
      'Envia o estado do repositório atual (diretório de trabalho ou PITWALL_REPO_DIR) ao Atlas: os manifestos da lista branca, sem segredos, ' +
      'mais o que você fez (summary, created, changed, removed, attention, tasks) e as ops estruturadas. Chame no fim de um trabalho em código. ' +
      'scope: local se há mudanças não enviadas; pushed se o HEAD está no remoto; deployed exige environment. ' +
      'Nada é apagado: removed só marca "remoção relatada", à espera de confirmação no console.',
    inputSchema: {
      summary: z.string().min(1).max(4000).describe('O que foi feito, em poucas frases.'),
      created: z.array(z.string().min(1).max(300)).max(50).optional().describe('Itens criados (serviços, arquivos de configuração).'),
      changed: z.array(z.string().min(1).max(300)).max(50).optional(),
      removed: z.array(z.string().min(1).max(300)).max(50).optional(),
      attention: z.array(z.string().min(1).max(300)).max(50).optional().describe('O que ainda pede atenção.'),
      tasks: z.array(z.string().max(20)).max(50).optional().describe('Códigos T-XXXXX resolvidos por este trabalho.'),
      ops: z.array(OP).max(200).optional().describe('Mudanças estruturadas: node (criar/atualizar nó), edge (ligação com relation), removed, task.'),
      scope: z.enum(SCOPES).optional(),
      environment: z.string().max(40).optional().describe('Obrigatório com scope deployed.'),
      system: z.string().max(40).optional().describe('Slug do sistema, só se o repositório ainda não está associado.'),
      partial: z.boolean().optional().describe('true se você não enviou todos os arquivos: não marca nada como sumido.'),
    },
  }, guarded(client, async (a: {
    summary: string; created?: string[]; changed?: string[]; removed?: string[]; attention?: string[]; tasks?: string[];
    ops?: Array<Record<string, unknown>>; scope?: 'local' | 'pushed' | 'deployed'; environment?: string; system?: string; partial?: boolean;
  }) => {
    const prep = prepareSync(repoDir(), { ...a, source: 'agent', tool: toolName() });
    const res = await client.request<SyncResponse>('POST', SYNC, prep.request);
    return ok(syncText(res, prep.request.repo, prep.scope), res);
  }));

  server.registerTool('atlas_graph', {
    title: 'Ver o mapa do Atlas',
    description: 'O mapa de um sistema (ou de toda a operação, sem system): nós por motor, com estado, verificação e o que pede atenção, e as ligações. Use o id de um nó com atlas_node.',
    inputSchema: {
      system: SYSTEM.optional(),
      environment: z.string().max(40).optional().describe('Mantém só o ambiente dado e os nós sem ambiente.'),
    },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { system?: string; environment?: string }) => {
    const g = await client.request<GraphText & { scope: { system: { name: string } | null } }>('GET', `${ATLAS}/graph` + query({ system: a.system, environment: a.environment }));
    const label = g.scope?.system ? `Sistema ${g.scope.system.name}` : 'Toda a operação';
    return ok(graphText(g, label), g);
  }));

  server.registerTool('atlas_node', {
    title: 'Ver um nó do Atlas',
    description: 'Detalhe de um serviço ou repositório: de quem depende, quem depende dele, o impacto se cair, as evidências, tarefas e eventos recentes.',
    inputSchema: { ref: z.string().min(1).describe('Id do nó (veja atlas_graph).') },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { ref: string }) => {
    const d = await client.request<NodeDetailText>('GET', `${ATLAS}/nodes/${encodeURIComponent(a.ref.trim())}`);
    return ok(nodeText(d), d);
  }));

  server.registerTool('atlas_changes', {
    title: 'Ver mudanças do Atlas',
    description: 'O que mudou no Atlas: criações, alterações, retiradas, com quem e de onde veio (console, mcp, sync, collector). since é uma data ISO.',
    inputSchema: {
      since: z.string().max(40).optional().describe('Data ISO; sem valor, as mais recentes.'),
      system: SYSTEM.optional(),
    },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { since?: string; system?: string }) => {
    const list = await client.request<ChangeLine[]>('GET', `${ATLAS}/changes` + query({ since: a.since, system: a.system, limit: 100 }));
    return ok(changesText(list), list);
  }));

  server.registerTool('atlas_insights', {
    title: 'Ver recomendações do Atlas',
    description: 'Regras determinísticas sobre o mapa: serviço sem monitoramento, banco sem backup, repositório sem sincronia, alertas, nós que sumiram do código.',
    inputSchema: { system: SYSTEM.optional() },
    annotations: { readOnlyHint: true },
  }, guarded(client, async (a: { system?: string }) => {
    const list = await client.request<InsightLine[]>('GET', `${ATLAS}/insights` + query({ system: a.system }));
    return ok(insightsText(list), list);
  }));
}
