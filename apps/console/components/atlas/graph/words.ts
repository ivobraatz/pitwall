import { useT, type Words } from '@/lib/i18n';

/** The words of the map: the company and product views, their toolbar, modes and legend. */
const pt = {
  'engine.code': 'Código', 'engine.delivery': 'Entrega', 'engine.infra': 'Infraestrutura', 'engine.app': 'Aplicação e dados',
  'engine.automation': 'Automações e agentes', 'engine.business': 'Financeiro', 'engine.marketing': 'Marketing',
  'engine.monitoring': 'Monitoramento e suporte', 'engine.security': 'Segurança',
  'engine.collapse': 'Recolher motor', 'engine.expand': 'Expandir motor', 'engine.summary': '{n} itens',

  'mode.architecture': 'Arquitetura', 'mode.flows': 'Fluxos', 'mode.operation': 'Operação', 'mode.attention': 'Atenção', 'mode.evolution': 'Evolução',
  'mode.label': 'Modo de leitura',

  'toolbar.search': 'Buscar serviço ou repositório', 'toolbar.searchHint': 'Tecle / para buscar', 'toolbar.clearSelection': 'Limpar seleção',
  'toolbar.environment': 'Ambiente', 'toolbar.allEnvironments': 'Todos os ambientes',
  'toolbar.type': 'Tipo', 'toolbar.allTypes': 'Todos os tipos', 'toolbar.state': 'Estado', 'toolbar.allStates': 'Qualquer estado',
  'toolbar.verification': 'Verificação', 'toolbar.allVerifications': 'Qualquer verificação',
  'toolbar.categories': 'Ligações', 'toolbar.filters': 'Filtros', 'toolbar.zoomIn': 'Aproximar', 'toolbar.zoomOut': 'Afastar',
  'toolbar.fit': 'Ajustar à tela', 'toolbar.results': '{n} encontrados', 'toolbar.clearFilters': 'Limpar filtros',
  'toolbar.noResults': 'Nada com esse nome.', 'toolbar.hidden': '{n} ocultos pelos filtros',

  'cat.infra': 'Infraestrutura', 'cat.data': 'Dados', 'cat.business': 'Negócio', 'cat.trigger': 'Disparos',
  'cat.operational': 'Operação', 'cat.security': 'Segurança',

  'state.up': 'No ar', 'state.down': 'Fora do ar', 'state.deploying': 'Em deploy', 'state.degraded': 'Com problema', 'state.unknown': 'Sem leitura',

  'ver.verified': 'verificado', 'ver.stale': 'verificação antiga', 'ver.found_in_code': 'encontrado no código',
  'ver.not_found': 'não encontrado', 'ver.reported': 'relatado por agente', 'ver.declared': 'declarado',

  'attn.failure': 'Falha', 'attn.security': 'Segurança', 'attn.task': 'Tarefa', 'attn.improvement': 'Melhoria',
  'attn.config': 'Configuração', 'attn.unverified': 'Não verificado',

  'shared': 'Compartilhado', 'retired': 'Retirado', 'removal': 'Remoção relatada', 'missing': 'Sumiu do provedor',
  'planned': 'Planejada', 'noCode': 'Sem código',
  'codeScope.local': 'só local', 'codeScope.pushed': 'no repositório remoto', 'codeScope.deployed': 'implantado',

  'op.observed': 'observado {when}', 'op.noEvent': 'sem evento lido', 'op.running': 'em atividade',
  'op.events': 'Eventos recentes', 'op.noEvents': 'Nenhum evento no período.', 'op.source': 'fonte',

  'flow.pick': 'Processo', 'flow.none': 'Nenhum processo com etapas.', 'flow.steps': 'Etapas',
  'flow.noNodes': 'Nenhum serviço desta etapa aparece no mapa.', 'flow.task': 'Tarefa',

  'insight.title': 'Pede atenção', 'insight.none': 'Nada pede atenção agora.', 'insight.check': 'Conferir', 'insight.suggestion': 'Sugestão',

  'evo.since': 'Desde', 'evo.1d': '24 h', 'evo.7d': '7 dias', 'evo.30d': '30 dias', 'evo.date': 'Data',
  'evo.added': 'adicionado', 'evo.changed': 'alterado', 'evo.removed': 'removido',

  'company.open': 'Abrir sistema',
  'company.systems': 'Sistemas', 'company.shared': 'Compartilhados', 'company.mapa': 'Mapa', 'company.lista': 'Lista',
  'company.health': '{up} de {total} no ar', 'company.noHealth': 'Sem serviços',
  'company.running': 'rodando agora', 'company.coverage': 'cobertura {n}%', 'company.none': 'Nenhum sistema no mapa.',
  'company.hint': 'Um cartão por sistema. Clique para ver seus serviços.',
  'company.edgeCount': '{n} ligações', 'company.edgeRelations': 'Relações: {relations}',

  'product.back': 'Todos os sistemas', 'product.empty': 'Este sistema ainda não tem nós no mapa.',
  'product.hint': 'Colunas são motores; cada nó é um serviço ou repositório. Clique para ver o componente.',
  'product.error': 'O mapa não carregou.', 'product.loading': 'Carregando o mapa…',

  'tab.label': 'Visões do Atlas', 'tab.engine': 'Ambientes', 'tab.flows': 'Fluxos', 'tab.routines': 'Rotinas',
  'tab.changes': 'Mudanças', 'tab.map': 'Mapa', 'tab.overview': 'Lista', 'tab.attention': 'Pede atenção',
  'tab.processes': 'Processos', 'tab.suppliers': 'Fornecedores', 'tab.discovery': 'Descoberta',
  'product.integration': 'Integração',
  'changes.none': 'Nenhuma mudança registrada ainda.', 'change.created': 'criado', 'change.updated': 'alterado',
  'change.retired': 'retirado', 'change.restored': 'restaurado', 'change.renamed': 'renomeado', 'change.deleted': 'apagado',
  'legend.title': 'Legenda', 'legend.onAir': 'No ar', 'legend.planned': 'Planejada (tracejada)', 'legend.missing': 'Não encontrado (hachurado)',
  'legend.activity': 'Em atividade (pulsa)', 'legend.links': 'Ligações', 'legend.categories': 'Tipo de ligação',
};

const en: Record<keyof typeof pt, string> = {
  'engine.code': 'Code', 'engine.delivery': 'Delivery', 'engine.infra': 'Infrastructure', 'engine.app': 'Application & data',
  'engine.automation': 'Automation & agents', 'engine.business': 'Business', 'engine.marketing': 'Marketing',
  'engine.monitoring': 'Monitoring & support', 'engine.security': 'Security',
  'engine.collapse': 'Collapse engine', 'engine.expand': 'Expand engine', 'engine.summary': '{n} items',

  'mode.architecture': 'Architecture', 'mode.flows': 'Flows', 'mode.operation': 'Operation', 'mode.attention': 'Attention', 'mode.evolution': 'Evolution',
  'mode.label': 'Reading mode',

  'toolbar.search': 'Search a service or repository', 'toolbar.searchHint': 'Press / to search', 'toolbar.clearSelection': 'Clear selection',
  'toolbar.environment': 'Environment', 'toolbar.allEnvironments': 'All environments',
  'toolbar.type': 'Type', 'toolbar.allTypes': 'All types', 'toolbar.state': 'State', 'toolbar.allStates': 'Any state',
  'toolbar.verification': 'Verification', 'toolbar.allVerifications': 'Any verification',
  'toolbar.categories': 'Links', 'toolbar.filters': 'Filters', 'toolbar.zoomIn': 'Zoom in', 'toolbar.zoomOut': 'Zoom out',
  'toolbar.fit': 'Fit to screen', 'toolbar.results': '{n} found', 'toolbar.clearFilters': 'Clear filters',
  'toolbar.noResults': 'Nothing with that name.', 'toolbar.hidden': '{n} hidden by filters',

  'cat.infra': 'Infrastructure', 'cat.data': 'Data', 'cat.business': 'Business', 'cat.trigger': 'Triggers',
  'cat.operational': 'Operation', 'cat.security': 'Security',

  'state.up': 'Up', 'state.down': 'Down', 'state.deploying': 'Deploying', 'state.degraded': 'Degraded', 'state.unknown': 'Not read',

  'ver.verified': 'verified', 'ver.stale': 'stale check', 'ver.found_in_code': 'found in code',
  'ver.not_found': 'not found', 'ver.reported': 'reported by agent', 'ver.declared': 'declared',

  'attn.failure': 'Failure', 'attn.security': 'Security', 'attn.task': 'Task', 'attn.improvement': 'Improvement',
  'attn.config': 'Configuration', 'attn.unverified': 'Unverified',

  'shared': 'Shared', 'retired': 'Retired', 'removal': 'Removal reported', 'missing': 'Gone from provider',
  'planned': 'Planned', 'noCode': 'No code',
  'codeScope.local': 'local only', 'codeScope.pushed': 'in the remote repository', 'codeScope.deployed': 'deployed',

  'op.observed': 'observed {when}', 'op.noEvent': 'no event read', 'op.running': 'active',
  'op.events': 'Recent events', 'op.noEvents': 'No events in this period.', 'op.source': 'source',

  'flow.pick': 'Process', 'flow.none': 'No process with steps.', 'flow.steps': 'Steps',
  'flow.noNodes': 'No service of this step shows on the map.', 'flow.task': 'Task',

  'insight.title': 'Needs attention', 'insight.none': 'Nothing needs attention now.', 'insight.check': 'Check', 'insight.suggestion': 'Suggestion',

  'evo.since': 'Since', 'evo.1d': '24 h', 'evo.7d': '7 days', 'evo.30d': '30 days', 'evo.date': 'Date',
  'evo.added': 'added', 'evo.changed': 'changed', 'evo.removed': 'removed',

  'company.open': 'Open system',
  'company.systems': 'Systems', 'company.shared': 'Shared', 'company.mapa': 'Map', 'company.lista': 'List',
  'company.health': '{up} of {total} up', 'company.noHealth': 'No services',
  'company.running': 'running now', 'company.coverage': 'coverage {n}%', 'company.none': 'No system on the map.',
  'company.hint': 'One card per system. Click to see its services.',
  'company.edgeCount': '{n} links', 'company.edgeRelations': 'Relations: {relations}',

  'product.back': 'All systems', 'product.empty': 'This system has no node on the map yet.',
  'product.hint': 'Columns are engines; each node is a service or a repository. Click to see the component.',
  'product.error': 'The map did not load.', 'product.loading': 'Loading the map…',

  'tab.label': 'Atlas views', 'tab.engine': 'Environments', 'tab.flows': 'Flows', 'tab.routines': 'Routines',
  'tab.changes': 'Changes', 'tab.map': 'Map', 'tab.overview': 'List', 'tab.attention': 'Needs attention',
  'tab.processes': 'Processes', 'tab.suppliers': 'Suppliers', 'tab.discovery': 'Discovery',
  'product.integration': 'Integration',
  'changes.none': 'No change recorded yet.', 'change.created': 'created', 'change.updated': 'updated',
  'change.retired': 'retired', 'change.restored': 'restored', 'change.renamed': 'renamed', 'change.deleted': 'deleted',
  'legend.title': 'Legend', 'legend.onAir': 'Up', 'legend.planned': 'Planned (dashed)', 'legend.missing': 'Not found (hatched)',
  'legend.activity': 'Active (pulses)', 'legend.links': 'Links', 'legend.categories': 'Link type',
};

export type GraphWord = keyof typeof pt;
export const WORDS: Words<GraphWord> = { pt, en };
export function useGraphWords() { return useT(WORDS); }
