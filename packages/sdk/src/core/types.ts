/** What the support endpoints return — the shapes of Pitwall's customer surface, as the bridge passes them on. */

export type TicketCategory = 'bug' | 'question' | 'feature' | 'billing' | 'other';
export type TicketSeverity = 'low' | 'normal' | 'high' | 'critical';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'fixed_pending_deploy' | 'resolved' | 'closed';
export type AttachmentKind = 'image' | 'file' | 'recording';

export const TICKET_CATEGORIES: TicketCategory[] = ['bug', 'question', 'feature', 'billing', 'other'];
export const TICKET_SEVERITIES: TicketSeverity[] = ['low', 'normal', 'high', 'critical'];
export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting_customer', 'fixed_pending_deploy', 'resolved', 'closed'];

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface TicketSummary {
  id: string;
  /** 20260918-7K3Q: the day it was opened plus four characters. */
  code: string;
  title: string;
  category: TicketCategory;
  severity: TicketSeverity;
  status: TicketStatus;
  openedBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastTeamMessageAt: string | null;
  lastCustomerMessageAt: string | null;
  messageCount: number;
  hasRecording: boolean;
  fixedIn: string | null;
}

export interface TicketPerson { id: string | null; name: string }

export interface TicketMessage {
  id: string;
  body: string;
  fromTeam: boolean;
  internal: boolean;
  createdAt: string;
  author: TicketPerson | null;
}

export interface RecordingMeta {
  mode?: 'retroactive' | 'procedure';
  masked?: boolean;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  eventCount?: number;
  rawBytes?: number;
  encoding?: 'gzip' | 'none';
  traceIds?: string[];
  diagnostics?: DiagnosticsBundle;
}

export interface TicketAttachment {
  id: string;
  messageId: string | null;
  kind: AttachmentKind;
  name: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  fromTeam: boolean;
  meta: RecordingMeta | null;
}

export interface TicketDetail {
  id: string;
  code: string;
  title: string;
  body: string;
  category: TicketCategory;
  severity: TicketSeverity;
  status: TicketStatus;
  route: string | null;
  fixedIn: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  lastTeamMessageAt: string | null;
  lastCustomerMessageAt: string | null;
  openedBy: TicketPerson | null;
  traceIds: string[];
  diagnostics: DiagnosticsBundle | null;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
}

export interface KnownIssue {
  known: boolean;
  status?: TicketStatus;
  fixedIn?: string | null;
  ticketId?: string | null;
  ticketCode?: string | null;
}

export interface SupportConfig {
  product: { slug: string; name: string };
  teamName: string;
  categories: TicketCategory[];
  severities: TicketSeverity[];
  statuses: TicketStatus[];
  retroactiveRecording: boolean;
  maxAttachmentBytes: number;
}

// ── Diagnostics ────────────────────────────────────────────────────────────────────────

export interface LogEntry { t: number; level: 'debug' | 'info' | 'warn' | 'error'; msg: string }
export interface RequestEntry {
  t: number; method: string; path: string; status: number; ms: number;
  traceId?: string; code?: string;
}
export interface ErrorEntry { t: number; kind: 'error' | 'rejection' | 'boundary'; msg: string; stack?: string }
export interface EventEntry { t: number; kind: 'route' | 'realtime' | 'visibility' | 'custom'; detail: string }

export interface DiagnosticsBundle {
  capturedAt: string;
  context: {
    route: string;
    href: string;
    appVersion: string;
    appCommit: string;
    channel: string;
    userAgent: string;
    language: string;
    languages: string[];
    timezone: string;
    viewport: { width: number; height: number; dpr: number };
    online: boolean;
    memory?: { usedMB: number; limitMB: number };
    [extra: string]: unknown;
  };
  logs: LogEntry[];
  requests: RequestEntry[];
  errors: ErrorEntry[];
  events: EventEntry[];
  traceIds: string[];
}

/** A request that failed on the server, as the SDK announces it (the error toast listens). */
export interface ServerFailure { method: string; path: string; status: number; traceId?: string }
