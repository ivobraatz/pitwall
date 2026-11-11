'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Condition, ServiceState, SystemRef } from './atlas';

/* The Atlas as a graph (see the graph endpoints): one inventory, read as architecture, flows, operation, attention and evolution. */

export const ENGINES = ['code', 'delivery', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security'] as const;
export type Engine = (typeof ENGINES)[number];
export const RELATIONS = ['depends_on', 'hosted_on', 'deploys_to', 'resolves_dns', 'protected_by', 'backed_up_by', 'calls', 'reads_from', 'writes_to',
  'billed_through', 'issues_invoice_via', 'sends_email_via', 'triggers', 'schedules', 'monitored_by', 'reports_to', 'tracked_by', 'indexed_by', 'owned_by',
  'uses_credential_ref'] as const;
export type Relation = (typeof RELATIONS)[number];
export const EDGE_CATEGORIES = ['infra', 'data', 'business', 'trigger', 'operational', 'security'] as const;
export type EdgeCategory = (typeof EDGE_CATEGORIES)[number];
export type Origin = 'declared' | 'discovered' | 'reported' | 'observed';
export type Verification = 'verified' | 'stale' | 'found_in_code' | 'not_found' | 'reported' | 'declared';
export type CodeScope = 'local' | 'pushed' | 'deployed';
export const ATTENTION_CLASSES = ['failure', 'security', 'task', 'improvement', 'config', 'unverified'] as const;
export type AttentionClass = (typeof ATTENTION_CLASSES)[number];
export type AttentionCounts = Record<AttentionClass, number>;

export interface GraphNode {
  id: string; key: string; type: 'service' | 'repo';
  name: string; kind: string; engine: Engine; group: string | null;
  productId: string | null; environmentId: string | null; environment: string | null;
  shared: boolean; provider: string | null; url: string | null; signature: string | null;
  state: ServiceState; condition: Condition; origin: Origin;
  verification: Verification; codeScope: CodeScope | null;
  verifiedAt: string | null; verifiedBy: string | null; checkedAt: string | null;
  attention: AttentionCounts;
  activity: { running: boolean; kind: 'deploy' | 'ci' | 'agent' | null; since: string | null };
  lastEvent: { type: string; at: string; status: string | null; title: string } | null;
  retiredAt: string | null; removalReportedAt: string | null; missingSince: string | null;
  createdAt: string; updatedAt: string;
}
export interface GraphEdge {
  id: string; from: string; to: string; relation: Relation; category: EdgeCategory;
  label: string | null; planned: boolean; origin: Origin; verifiedAt: string | null; retiredAt: string | null;
}
export interface SourceStatus {
  name: string; connected: boolean; lastRunAt: string | null; lastOkAt: string | null; lastError: string | null;
  itemsSeen: number | null; stale: boolean;
}
export interface CoverageCheck { key: 'repo_linked' | 'repo_synced' | 'hosting_verified' | 'monitoring' | 'backup' | 'domain' | 'engines'; ok: boolean; applicable: boolean; label: string }
export interface Coverage { percent: number; checks: CoverageCheck[] }
export interface GraphResponse {
  serverTime: string;
  scope: { system: SystemRef | null; environment: string | null };
  engines: Array<{ key: Engine; name: string; position: number }>;
  nodes: GraphNode[]; edges: GraphEdge[]; sources: SourceStatus[]; coverage: Coverage | null;
}

export interface SystemCard {
  id: string; slug: string; name: string; color: string | null; description: string | null;
  state: ServiceState; shared: boolean; nodeCount: number;
  health: { total: number; up: number; down: number; degraded: number; deploying: number; unknown: number };
  attention: AttentionCounts;
  running: { deploys: number; ci: number; agents: number; routines: number };
  pending: { tasks: number; tickets: number; errors: number; alerts: number | null };
  coverage: Coverage;
}
export interface CompanyEdge { from: string; to: string; count: number; relations: Relation[] }
export interface CompanyGraph { serverTime: string; systems: SystemCard[]; shared: GraphNode[]; edges: CompanyEdge[]; sources: SourceStatus[] }

export interface NodeRef { id: string; key: string; name: string; kind: string; engine: Engine; productId: string | null; state: ServiceState }
export interface Evidence {
  id: string; source: string; method: string; ref: string; detail: string | null; relation: Relation | null; scope: string;
  commitSha: string | null; firstSeenAt: string; lastSeenAt: string; goneAt: string | null;
}
export interface NodeRefLink {
  id: string | null; kind: 'task' | 'ticket' | 'error'; code: string; note: string | null; title: string | null; status: string | null;
  class: AttentionClass; via: 'ref' | 'label';
}
export interface AtlasEventDto {
  id: string; at: string; source: string; type: string; status: string | null; title: string; url: string | null;
  commitSha: string | null; detail: string | null; productId: string | null; serviceId: string | null; repoId: string | null;
}
export interface FieldChange { field: string; before: string | null; after: string | null }
export interface AtlasChangeDto {
  id: string; at: string; actor: string; source: string; changeSetId: string | null; entityType: string; entityId: string;
  productId: string | null; op: 'created' | 'updated' | 'retired' | 'restored' | 'renamed' | 'deleted'; fields: FieldChange[]; summary: string | null;
}
export interface ChangeSetDto {
  id: string; receivedAt: string; source: string; tool: string | null; repo: string | null; branch: string | null; commitSha: string | null;
  scope: CodeScope; environment: string | null; actor: string; status: 'applied' | 'noop' | 'partial' | 'rejected'; summary: string | null;
  taskCodes: string[]; result: { created: string[]; updated: string[]; unchanged: number; gone: string[]; removalsReported: string[]; rejected: Array<{ op: string; message: string }>; attention: string[] };
}
export interface NodeDetail {
  node: GraphNode & {
    notes: string | null; facts: Array<{ key: string; value: string }>; items: string[]; externalRef: string | null; monitor: string | null;
    aliases: string[]; owner: string | null; impact: string | null; deployStatus: string | null; monitorStatus: string | null;
    lastDeployAt: string | null; commitSha: string | null; stack: Array<{ key: string; value: string }>;
  };
  system: SystemRef | null;
  incoming: Array<{ edge: GraphEdge; node: NodeRef }>;
  outgoing: Array<{ edge: GraphEdge; node: NodeRef }>;
  impact: { direct: NodeRef[]; indirect: NodeRef[]; systems: SystemRef[] };
  evidence: Evidence[];
  refs: NodeRefLink[];
  events: AtlasEventDto[];
  changes: AtlasChangeDto[];
  repos: Array<{ id: string; fullName: string; role: string | null; lastRunStatus: string | null; lastRunAt: string | null; lastRunUrl: string | null; lastSyncAt: string | null }>;
  processes: Array<{ id: string; slug: string; name: string; step: { slug: string; name: string; status: string } }>;
  changeSets: ChangeSetDto[];
  providerUrl: string | null;
}
export interface Insight { id: string; rule: string; severity: 'check' | 'suggestion'; title: string; detail: string; nodeIds: string[]; system: SystemRef | null }
export interface SnapshotDto { id: string; takenAt: string; reason: string; nodeCount: number; edgeCount: number }
export interface GraphDiff {
  from: { at: string | null; snapshotId: string | null }; to: { at: string; snapshotId: string | null };
  nodes: { added: NodeRef[]; removed: NodeRef[]; changed: Array<{ node: NodeRef; fields: FieldChange[] }> };
  edges: { added: Array<{ from: string; to: string; relation: Relation }>; removed: Array<{ from: string; to: string; relation: Relation }> };
}
export interface GitHubRepo {
  fullName: string; private: boolean; archived: boolean; defaultBranch: string | null; url: string;
  registered: boolean; repoId: string | null; system: SystemRef | null; role: string | null;
}
export interface SyncResponse {
  changeSetId: string; status: 'applied' | 'noop' | 'partial' | 'rejected'; replayed: boolean; created: string[]; updated: string[];
  unchanged: number; gone: string[]; removalsReported: string[]; rejected: Array<{ op: string; message: string }>; attention: string[];
}

const qs = (p: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as Array<[string, string]>).toString();
  return s ? `?${s}` : '';
};

export function useGraph(system: string | null, environment: string | null) {
  return useQuery({ queryKey: ['atlas', 'graph', system, environment], queryFn: () => api<GraphResponse>(`/staff/atlas/graph${qs({ system, environment })}`), refetchInterval: 10_000, staleTime: 4_000 });
}
export function useCompanyGraph() {
  return useQuery({ queryKey: ['atlas', 'company'], queryFn: () => api<CompanyGraph>('/staff/atlas/graph/company'), refetchInterval: 10_000, staleTime: 4_000 });
}
export function useNode(id: string | null) {
  return useQuery({ queryKey: ['atlas', 'node', id], queryFn: () => api<NodeDetail>(`/staff/atlas/nodes/${id}`), enabled: !!id, refetchInterval: 15_000 });
}
export function useChanges(p: { since?: string | null; system?: string | null; entityId?: string | null; limit?: number }) {
  return useQuery({ queryKey: ['atlas', 'changes', p], queryFn: () => api<AtlasChangeDto[]>(`/staff/atlas/changes${qs({ since: p.since, system: p.system, entityId: p.entityId, limit: p.limit ? String(p.limit) : null })}`), refetchInterval: 30_000 });
}
export function useEvents(p: { since?: string | null; system?: string | null; serviceId?: string | null; repoId?: string | null }) {
  return useQuery({ queryKey: ['atlas', 'events', p], queryFn: () => api<AtlasEventDto[]>(`/staff/atlas/events${qs(p)}`), refetchInterval: 10_000 });
}
export function useSnapshots() {
  return useQuery({ queryKey: ['atlas', 'snapshots'], queryFn: () => api<SnapshotDto[]>('/staff/atlas/snapshots'), refetchInterval: 60_000 });
}
export function useDiff(from: string | null, to: string | null, system: string | null) {
  return useQuery({ queryKey: ['atlas', 'diff', from, to, system], queryFn: () => api<GraphDiff>(`/staff/atlas/diff${qs({ from, to, system })}`), enabled: !!from });
}
export function useInsights(system: string | null) {
  return useQuery({ queryKey: ['atlas', 'insights', system], queryFn: () => api<Insight[]>(`/staff/atlas/insights${qs({ system })}`), refetchInterval: 60_000 });
}
export function useChangeSets(p: { system?: string | null; repo?: string | null }) {
  return useQuery({ queryKey: ['atlas', 'changesets', p], queryFn: () => api<ChangeSetDto[]>(`/staff/atlas/changesets${qs(p)}`), refetchInterval: 30_000 });
}
export function useSources() {
  return useQuery({ queryKey: ['atlas', 'sources'], queryFn: () => api<SourceStatus[]>('/staff/atlas/sources'), refetchInterval: 30_000 });
}
export function useGitHubRepos(enabled: boolean) {
  return useQuery({ queryKey: ['atlas', 'github-repos'], queryFn: () => api<GitHubRepo[]>('/staff/atlas/github/repos'), enabled, retry: false });
}
