import type {
  AttachmentKind, DiagnosticsBundle, KnownIssue, Paged, SupportConfig, TicketAttachment, TicketCategory, TicketDetail,
  TicketSeverity, TicketSummary,
} from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class PitwallError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/**
 * Talks to the product's own support bridge (`/api/v1/support` or wherever it is mounted) —
 * never to Pitwall directly. The product's session goes along: cookies by default, or whatever
 * `headers()` adds (a bearer token). The bridge turns that session into a Pitwall actor.
 */
export class PitwallClient {
  constructor(
    private endpoint: string,
    private fetchImpl: FetchLike,
    private headers: () => Record<string, string> | Promise<Record<string, string>>,
  ) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  /** True for URLs of this client's own calls — the request instrumentation skips them. */
  owns(url: string): boolean {
    try {
      const u = new URL(url, location.href);
      const base = new URL(this.endpoint, location.href);
      return u.origin === base.origin && u.pathname.startsWith(base.pathname);
    } catch { return false; }
  }

  private async request<T>(path: string, init: RequestInit & { params?: Record<string, unknown>; json?: unknown } = {}): Promise<T> {
    const query = init.params
      ? '?' + new URLSearchParams(Object.entries(init.params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()
      : '';
    const headers: Record<string, string> = { ...(await this.headers()) };
    let body = init.body;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const res = await this.fetchImpl(`${this.endpoint}${path}${query === '?' ? '' : query}`, {
      method: init.method ?? 'GET', headers, body, credentials: 'include',
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try { const j = await res.json(); if (j?.message) message = j.message; } catch { /* not JSON */ }
      throw new PitwallError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  config() { return this.request<SupportConfig>('/config'); }

  listTickets(params: { status?: string; search?: string; page?: number; pageSize?: number } = {}) {
    return this.request<Paged<TicketSummary>>('/tickets', { params });
  }

  getTicket(id: string) { return this.request<TicketDetail>(`/tickets/${encodeURIComponent(id)}`); }

  createTicket(data: {
    title: string; body: string; category: TicketCategory; severity: TicketSeverity;
    route?: string; diagnostics?: DiagnosticsBundle; traceIds?: string[];
  }) {
    return this.request<{ id: string; code: string }>('/tickets', { method: 'POST', json: data });
  }

  postMessage(id: string, body: string) {
    return this.request<{ id: string }>(`/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', json: { body } });
  }

  uploadAttachment(id: string, file: File, options: { kind?: AttachmentKind; messageId?: string; meta?: Record<string, unknown> } = {}) {
    const form = new FormData();
    form.append('file', file);
    if (options.kind) form.append('kind', options.kind);
    if (options.messageId) form.append('messageId', options.messageId);
    if (options.meta) form.append('meta', JSON.stringify(options.meta));
    return this.request<TicketAttachment>(`/tickets/${encodeURIComponent(id)}/attachments`, { method: 'POST', body: form });
  }

  closeTicket(id: string) { return this.request<void>(`/tickets/${encodeURIComponent(id)}/close`, { method: 'POST' }); }
  reopenTicket(id: string) { return this.request<void>(`/tickets/${encodeURIComponent(id)}/reopen`, { method: 'POST' }); }

  knownIssue(traceId: string) { return this.request<KnownIssue>('/known-issue', { params: { traceId } }); }

  /** Attachment bytes go through the bridge with the session; an `<img src>` could not carry it. */
  async fetchAttachment(ticketId: string, attachmentId: string, download = false): Promise<{ blob: Blob; contentType: string }> {
    const headers = await this.headers();
    const res = await this.fetchImpl(
      `${this.endpoint}/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}${download ? '?download=true' : ''}`,
      { headers, credentials: 'include' },
    );
    if (!res.ok) throw new PitwallError(`Attachment fetch failed (${res.status})`, res.status);
    const blob = await res.blob();
    return { blob, contentType: res.headers.get('content-type') ?? blob.type };
  }
}
