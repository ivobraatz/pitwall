import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient, type ClientOptions } from './client.js';
import { registerAtlasTools } from './atlas.js';
import { registerTools } from './tools.js';

export const VERSION = '0.2.0';

/** The MCP server with its tools (the task board and the Atlas), before any transport is attached (the tests use an in-memory one). */
export function createServer(options: ClientOptions): { server: McpServer; configured: boolean } {
  const client = createClient(options);
  const server = new McpServer(
    { name: 'pitwall', version: VERSION },
    {
      instructions:
        'Quadro de tarefas manuais da equipe no Pitwall. No começo da sessão, rode board_summary e list_tasks com status ' +
        '[blocked, doing]; leia cada bloqueada com get_task, verifique e registre o resultado com comment_task. ' +
        'No fim, crie com create_task só os passos que a pessoa precisa fazer à mão, depois de buscar com list_tasks para não duplicar. ' +
        'Atlas: ao começar a trabalhar num sistema, chame start_activity e, ao terminar, finish_activity com o resultado. ' +
        'Numa rotina, start_routine_run no começo e finish_routine_run no fim, com os links do que foi gerado.',
    },
  );
  registerTools(server, client);
  registerAtlasTools(server, client);
  return { server, configured: client.configured };
}
