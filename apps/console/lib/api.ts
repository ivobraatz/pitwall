/**
 * The console's only door to the API: same origin (next.config rewrites /v1), the session cookie
 * goes along by itself, and every write carries the console header the API's CSRF check wants.
 */

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}

type Params = Record<string, string | number | boolean | null | undefined>;

export async function api<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit; params?: Params } = {}): Promise<T> {
  const qs = init.params
    ? new URLSearchParams(Object.entries(init.params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()
    : '';
  const headers: Record<string, string> = { 'X-Pitwall-Staff': '1' };
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const res = await fetch(`/v1${path}${qs ? `?${qs}` : ''}`, { method: init.method ?? 'GET', headers, body, credentials: 'same-origin' });
  if (!res.ok) {
    let parsed: unknown;
    let message = `Erro ${res.status}`;
    try { parsed = await res.json(); if ((parsed as { message?: string })?.message) message = (parsed as { message: string }).message; } catch { /* not json */ }
    throw new ApiError(message, res.status, parsed);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Attachment bytes as a blob: images and recordings are rendered from object URLs. */
export async function fetchBlob(path: string): Promise<{ blob: Blob; contentType: string }> {
  const res = await fetch(`/v1${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(`Erro ${res.status}`, res.status);
  const blob = await res.blob();
  return { blob, contentType: res.headers.get('content-type') ?? blob.type };
}

// ── Shapes ───────────────────────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'fixed_pending_deploy' | 'resolved' | 'closed';
export const STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting_customer', 'fixed_pending_deploy', 'resolved', 'closed'];
export const SEVERITIES = ['low', 'normal', 'high', 'critical'] as const;
export const CATEGORIES = ['bug', 'question', 'feature', 'billing', 'other'] as const;

export interface Me { id: string; name: string; email: string; role: 'admin' | 'agent'; totpEnabled: boolean; mustChangePassword: boolean; totpRequired: boolean }
export interface ProductRef { id: string; slug: string; name: string }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface ProductSettings {
  teamName: string | null; ownFramePrefixes: string[]; autoPublishReleases: boolean; locales: string[];
  retroactiveRecording: boolean; customerTicketUrl: string | null;
}
export interface Product extends ProductRef {
  description: string | null; webhookUrl: string | null; hasWebhookSecret: boolean; settings: ProductSettings;
  createdAt: string; updatedAt: string; disabledAt: string | null;
}
export interface ProductKey { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
export interface WebhookDelivery { id: string; event: string; status: string; attempts: number; lastStatusCode: number | null; lastError: string | null; createdAt: string; deliveredAt: string | null; nextAttemptAt: string }

export interface Summary {
  byStatus: Record<string, number>; open: number; unanswered: number; openedThisWeek: number;
  medianFirstResponseMinutes: number | null;
  topSignatures: Array<{ productId: string; signature: string; tickets: number; customers: number }>;
  products: Array<ProductRef & { open: number; awaitingUs: number; errors24h: number }>;
  series: Array<{ date: string; tickets: number; errors: number }>;
}

export interface QueueRow {
  id: string; code: string; title: string; category: string; severity: string; status: TicketStatus;
  product: ProductRef; customer: { id: string; name: string | null }; openedBy: string | null;
  assignee: string | null; assigneeId: string | null; errorSignature: string | null; fixedIn: string | null;
  createdAt: string; updatedAt: string; lastTeamMessageAt: string | null; lastCustomerMessageAt: string | null;
  messageCount: number; hasRecording: boolean; awaitingUs: boolean;
}

export interface Attachment {
  id: string; messageId: string | null; kind: 'image' | 'file' | 'recording'; name: string; contentType: string;
  sizeBytes: number; createdAt: string; fromTeam: boolean;
  meta: { mode?: string; durationMs?: number; eventCount?: number; masked?: boolean; startedAt?: string; diagnostics?: Diagnostics } | null;
}
export interface Diagnostics {
  capturedAt: string;
  context: Record<string, unknown> & { appVersion?: string; appCommit?: string; channel?: string; userAgent?: string; viewport?: { width: number; height: number; dpr: number }; language?: string; timezone?: string };
  logs: Array<{ t: number; level: string; msg: string }>;
  requests: Array<{ t: number; method: string; path: string; status: number; ms: number; traceId?: string; code?: string }>;
  errors: Array<{ t: number; kind: string; msg: string; stack?: string }>;
  events: Array<{ t: number; kind: string; detail: string }>;
  traceIds: string[];
}
export interface Message { id: string; body: string; fromTeam: boolean; internal: boolean; createdAt: string; author: { id: string | null; name: string } | null }
export interface ServerErrorRow {
  id: string; traceId: string; method: string; path: string; routeTemplate: string | null; statusCode: number;
  exceptionType: string; message: string; stackTrace: string | null; signature: string; release: string | null;
  environment?: string | null; occurredAt: string; customerRef?: string | null; userRef?: string | null; productId?: string;
}
export interface Dossier {
  ticket: {
    id: string; code: string; title: string; body: string; category: string; severity: string; status: TicketStatus;
    route: string | null; fixedIn: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null; closedAt: string | null;
    lastTeamMessageAt: string | null; lastCustomerMessageAt: string | null; openedBy: { id: string | null; name: string } | null;
    traceIds: string[]; diagnostics: Diagnostics | null; messages: Message[]; attachments: Attachment[];
  };
  product: ProductRef & { customerTicketUrl: string | null };
  customer: { id: string; name: string | null };
  opener: { id: string | null; name: string | null; email: string | null };
  errorSignature: string | null; resolutionNote: string | null; assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  serverErrors: ServerErrorRow[]; signatureOccurrences: number;
  related: Array<{ id: string; code: string; title: string; status: TicketStatus; customer: string; updatedAt: string }>;
  sameCustomer: Array<{ id: string; code: string; title: string; status: TicketStatus; updatedAt: string }>;
}
export interface StaffMember { id: string; name: string; email: string; role: string; totpEnabled: boolean; lastLoginAt: string | null; disabled: boolean }

export interface ErrorGroup {
  product: ProductRef | null; signature: string; count: number; customers: number; firstSeen: string; lastSeen: string;
  sample: { exceptionType: string; message: string; method: string; route: string; release: string | null; statusCode: number } | null;
  tickets: { total: number; open: number };
}

export interface ReleaseRow {
  id: string; version: string; status: 'draft' | 'published' | 'silent'; changeKind: string; createdAt: string; publishedAt: string | null;
  product: ProductRef; commits: number; tickets: string[]; notes: Array<{ locale: string; title: string; summary: string }>;
}
export interface ReleaseDetail extends Omit<ReleaseRow, 'commits' | 'notes' | 'tickets'> {
  announce: boolean; commitShas: string[]; ticketCodes: string[];
  notes: Array<{ id: string; locale: string; slug: string; title: string; summary: string; new: string[]; improvements: string[]; bodyMarkdown: string }>;
}
