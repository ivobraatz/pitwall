/**
 * The one way this server talks to Pitwall: JSON over HTTPS to the installation's console, which
 * proxies `/v1/staff/tasks/*`, `/v1/staff/atlas/*` and `/v1/staff/errors/recent` to its API. The token goes in the Authorization header and nowhere
 * else — never into a log line, an error message or a tool result.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** PITWALL_URL: the public address of the installation's console. */
  url?: string;
  /** PITWALL_TOKEN: a personal token, `pwt_…`. */
  token?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export const CONFIG_MESSAGE = 'Configure PITWALL_URL e PITWALL_TOKEN (Configurações → Tokens pessoais no console).';

/** An error whose message is meant for the model to read, as is. */
export class PitwallError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'PitwallError';
  }
}

export interface PitwallClient {
  readonly configured: boolean;
  readonly baseUrl: string | undefined;
  request<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

export function createClient(options: ClientOptions): PitwallClient {
  const baseUrl = options.url?.trim().replace(/\/+$/, '') || undefined;
  const token = options.token?.trim() || undefined;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const configured = !!baseUrl && !!token;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!baseUrl || !token) throw new PitwallError(CONFIG_MESSAGE);
    if (!token.startsWith('pwt_')) throw new PitwallError('PITWALL_TOKEN não parece um token pessoal (começa com pwt_). ' + CONFIG_MESSAGE);
    if (!/^https?:\/\//i.test(baseUrl)) throw new PitwallError(`PITWALL_URL precisa começar com https:// (recebi ${baseUrl}).`);

    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new PitwallError(`Não consegui falar com ${baseUrl}. Verifique a URL e se o console está no ar.`);
    }

    if (res.status === 204) return null as T;
    const text = await res.text().catch(() => '');
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = undefined; }
    }
    if (res.ok) {
      if (data === undefined) throw new PitwallError(`A resposta de ${baseUrl} não é do Pitwall. Confira se PITWALL_URL é o endereço do console.`, res.status);
      return data as T;
    }
    throw new PitwallError(errorMessage(res.status, data), res.status);
  }

  return { configured, baseUrl, request: request as PitwallClient['request'] };
}

function apiMessage(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'message' in data && typeof (data as { message: unknown }).message === 'string')
    return (data as { message: string }).message;
  return undefined;
}

export function errorMessage(status: number, data: unknown): string {
  switch (status) {
    case 401: return 'Token inválido, expirado ou revogado. Gere outro em Configurações → Tokens pessoais.';
    case 403: return apiMessage(data) ?? 'O token não tem o escopo necessário (tasks, atlas ou errors).';
    case 404: return apiMessage(data) ?? 'Não encontrado. Use list_tasks ou list_products.';
    case 413: return apiMessage(data) ?? 'Conteúdo grande demais (limite de 256 KB).';
    case 429: return 'Limite de requisições. Espere um minuto.';
  }
  if (status === 400 || status === 409) return apiMessage(data) ?? `O Pitwall recusou o pedido (${status}).`;
  return `O Pitwall respondeu ${status}.`;
}
