import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PitwallClient } from './client.js';
import { guarded, ok, query } from './tools.js';

/*
 * The Atlas: what the team runs and what is happening to it. These tools register systems,
 * services and routines, and report work in progress, so the console shows it while it happens.
 * They need a personal token with the `atlas` scope.
 */

const ATLAS = '/v1/staff/atlas';
const SYSTEM = z.string().min(1).describe('Slug do sistema (veja list_products).');
const RESULT = z.enum(['ok', 'failed']);

interface Overview {
  systems: Array<{ slug: string; name: string; health: { total: number; up: number; down: number; degraded: number; deploying: number; unknown: number }; pending: { tasks: number; tickets: number; errors: number; alerts: number | null } }>;
  now: Array<{ kind: string; title: string; detail: string | null; actor: string | null }>;
  discoveries: Array<{ source: string; kind: string; name: string; environment: string | null }>;
  collectors: Array<{ name: string; connected: boolean; error: string | null }>;
}
interface Routine {
  slug: string; name: string; frequency: string; enabled: boolean; description: string | null; prompt: string;
  system: { slug: string } | null; lastRun: { status: string; startedAt: string; summary: string | null } | null;
}

function overviewText(o: Overview): string {
  if (o.systems.length === 0) return 'O Atlas está vazio. Cadastre o primeiro sistema com register_system.';
  const lines = o.systems.map((s) => {
    const h = s.health;
    const health = h.total === 0 ? 'sem serviços' : h.down > 0 ? `${h.down} fora do ar` : `${h.up}/${h.total} no ar`;
    const p = s.pending;
    return `${s.slug} — ${health} · ${p.tasks} tarefas · ${p.tickets} chamados · ${p.errors} erros (24h) · ${p.alerts ?? '?'} alertas`;
  });
  if (o.now.length > 0) lines.push('', 'Agora:', ...o.now.map((n) => `- [${n.kind}] ${n.title}${n.actor ? ` (${n.actor})` : ''}`));
  if (o.discoveries.length > 0) lines.push('', 'Encontrado, não cadastrado:', ...o.discoveries.map((d) => `- ${d.source}: ${d.name}${d.environment ? ` @${d.environment}` : ''}`));
  const off = o.collectors.filter((c) => !c.connected).map((c) => c.name);
  if (off.length > 0) lines.push('', `Coletores não conectados: ${off.join(', ')}.`);
  return lines.join('\n');
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
      'railway usa "projeto/serviço"; vercel usa o nome do projeto. monitor é o nome do monitor no Uptime Kuma.',
    inputSchema: {
      name: z.string().min(1).max(120),
      system: z.string().optional().describe('Slug do sistema. Omita para serviço externo compartilhado.'),
      environment: z.string().max(40).optional().describe('staging, production… Criado se não existir.'),
      kind: z.enum(['api', 'web', 'worker', 'database', 'site', 'external', 'other']).optional(),
      provider: z.string().max(40).optional().describe('railway, vercel, vm…'),
      externalRef: z.string().max(300).optional(),
      url: z.string().url().max(500).optional(),
      monitor: z.string().max(200).optional(),
      notes: z.string().max(2000).optional(),
    },
  }, guarded(client, async (a: Record<string, unknown>) => {
    const s = await client.request<{ id: string; name: string; created: boolean }>('POST', `${ATLAS}/services`, a);
    return ok(`${s.created ? 'Cadastrado' : 'Atualizado'}: ${s.name}`, s);
  }));

  server.registerTool('link_services', {
    title: 'Ligar serviços',
    description:
      'Registra que um serviço usa outro (a API usa o provedor de e-mail). Cada ponta é o id do serviço, o nome de um serviço externo, ' +
      'ou "sistema/Nome" ou "sistema/ambiente/Nome".',
    inputSchema: { from: z.string().min(1), to: z.string().min(1), label: z.string().max(80).optional() },
  }, guarded(client, async (a: { from: string; to: string; label?: string }) => {
    const l = await client.request('POST', `${ATLAS}/links`, a);
    return ok(`Ligado: ${a.from} → ${a.to}`, l);
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
    const r = await client.request<{ id: string }>('POST', `${ATLAS}/activities`, a);
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
}
