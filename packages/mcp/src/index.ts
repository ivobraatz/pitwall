#!/usr/bin/env node
/**
 * pitwall-mcp: the team's Pitwall task board as MCP tools, over stdio.
 *
 *   PITWALL_URL    the public address of your installation's console (https://<seu-dominio>)
 *   PITWALL_TOKEN  a personal token, pwt_… (Configurações → Tokens pessoais)
 *
 * stdout belongs to the protocol: everything this process says for people goes to stderr, and
 * the token is never part of it.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION } from './server.js';

const { server, configured } = createServer({ url: process.env.PITWALL_URL, token: process.env.PITWALL_TOKEN });

if (!configured) {
  const missing = [!process.env.PITWALL_URL?.trim() && 'PITWALL_URL', !process.env.PITWALL_TOKEN?.trim() && 'PITWALL_TOKEN'].filter(Boolean);
  console.error(`pitwall-mcp ${VERSION}: faltando ${missing.join(' e ')}. As tools vão responder com a instrução de configuração.`);
}

await server.connect(new StdioServerTransport());
console.error(`pitwall-mcp ${VERSION}: pronto${configured ? ` (${process.env.PITWALL_URL?.trim().replace(/\/+$/, '')})` : ''}.`);
