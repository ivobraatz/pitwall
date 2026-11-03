import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient, type ClientOptions } from './client.js';
import { registerTools } from './tools.js';

export const VERSION = '0.1.0';

/** The MCP server with its eight tools, before any transport is attached (the tests use an in-memory one). */
export function createServer(options: ClientOptions): { server: McpServer; configured: boolean } {
  const client = createClient(options);
  const server = new McpServer(
    { name: 'pitwall', version: VERSION },
    {
      instructions:
        'Quadro de tarefas manuais da equipe no Pitwall. No começo da sessão, rode board_summary e list_tasks com status ' +
        '[blocked, doing]; leia cada bloqueada com get_task, verifique e registre o resultado com comment_task. ' +
        'No fim, crie com create_task só os passos que a pessoa precisa fazer à mão, depois de buscar com list_tasks para não duplicar.',
    },
  );
  registerTools(server, client);
  return { server, configured: client.configured };
}
