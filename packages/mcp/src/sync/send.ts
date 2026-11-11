import { createClient, type FetchLike } from '../client.js';
import type { SyncConfig } from './config.js';
import type { SyncRequest, SyncResponse, SyncState } from './types.js';

/* The two sync calls, through the same client the MCP tools use (URL, Bearer, error messages). */

export async function postSync(cfg: SyncConfig, body: SyncRequest, fetch?: FetchLike): Promise<SyncResponse> {
  const client = createClient({ url: cfg.url, token: cfg.token, fetch, timeoutMs: 30_000 });
  return client.request<SyncResponse>('POST', '/v1/staff/atlas/sync', body);
}

export async function getSyncState(cfg: SyncConfig, repo: string, fetch?: FetchLike): Promise<SyncState> {
  const client = createClient({ url: cfg.url, token: cfg.token, fetch });
  return client.request<SyncState>('GET', `/v1/staff/atlas/sync/state?repo=${encodeURIComponent(repo)}`);
}
