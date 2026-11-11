/*
 * Vocabulary and wire types of the Atlas sync (contract sections 1.3, 3 and 8). The names are the
 * server's: change them here only when the contract changes.
 */

export const RELATIONS = [
  'depends_on', 'hosted_on', 'deploys_to', 'resolves_dns', 'protected_by', 'backed_up_by', 'calls', 'reads_from', 'writes_to',
  'billed_through', 'issues_invoice_via', 'sends_email_via', 'triggers', 'schedules', 'monitored_by', 'reports_to', 'tracked_by',
  'indexed_by', 'owned_by', 'uses_credential_ref',
] as const;
export type Relation = (typeof RELATIONS)[number];

export const SCOPES = ['local', 'pushed', 'deployed'] as const;
export type Scope = (typeof SCOPES)[number];

export const SOURCES = ['agent', 'ci', 'git-hook', 'cli'] as const;
export type Source = (typeof SOURCES)[number];

export const TASK_CODE = /^T-[A-Z0-9]{3,12}$/;

export interface SyncFile {
  path: string;
  /** Absent for presence-only files (the server knows the file exists, not what it says). */
  content?: string;
}

export interface SyncReport {
  summary?: string;
  created?: string[];
  changed?: string[];
  removed?: string[];
  attention?: string[];
  tasks?: string[];
  ops?: Array<Record<string, unknown>>;
}

export interface SyncRequest {
  idempotencyKey?: string;
  source: Source;
  tool?: string;
  repo: string;
  system?: string;
  branch?: string;
  commitSha?: string;
  scope: Scope;
  environment?: string;
  activityId?: string;
  files: SyncFile[];
  bundleHash: string;
  partial: boolean;
  report?: SyncReport;
}

export interface SyncResponse {
  changeSetId: string;
  status: 'applied' | 'noop' | 'partial' | 'rejected';
  replayed: boolean;
  created: string[];
  updated: string[];
  unchanged: number;
  gone: string[];
  removalsReported: string[];
  rejected: Array<{ op: string; message: string }>;
  attention: string[];
}

export interface SyncState {
  repo: string;
  registered: boolean;
  system: { slug: string; name: string } | null;
  lastSyncAt: string | null;
  lastSyncSha: string | null;
  lastSyncScope: string | null;
  lastScanHash: string | null;
}
