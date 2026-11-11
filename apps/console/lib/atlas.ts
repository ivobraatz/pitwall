'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/* The Atlas as the API hands it over (see StaffAtlasEndpoints). */

/** What is declared about a service beyond what the collectors read. */
export type Condition = 'ok' | 'warn' | 'gap' | 'planned' | 'local';
export type Impact = 'high' | 'medium' | 'low';
export type Owner = 'auto' | 'agent' | 'person' | 'together';
export const LINK_KINDS = ['host', 'dns', 'storage', 'payment', 'email', 'ai', 'login', 'measure', 'monitor', 'support', 'deploy', 'integration', 'business'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type StepStatus = 'ok' | 'warn' | 'gap' | 'next' | 'idea';

export type ServiceState = 'up' | 'down' | 'deploying' | 'degraded' | 'unknown';

export interface AtlasSystem {
  id: string; slug: string; name: string; color: string | null; description: string | null; websiteUrl: string | null;
  health: { total: number; up: number; down: number; degraded: number; deploying: number; unknown: number };
  pending: { tasks: number; tickets: number; errors: number; alerts: number | null };
  attention: { gaps: number; warnings: number };
}
export interface AtlasEnvironment { id: string; slug: string; name: string }
export interface AtlasService {
  id: string; productId: string | null; environmentId: string | null; name: string; kind: string; provider: string | null;
  externalRef: string | null; url: string | null; monitor: string | null; notes: string | null;
  state: ServiceState; monitorStatus: string | null; deployStatus: string | null; lastDeployAt: string | null;
  commitSha: string | null; checkedAt: string | null;
  group: string | null; condition: Condition; facts: Array<{ key: string; value: string }>; items: string[];
  impact: Impact | null; owner: Owner | null; task: string | null;
}
export interface AtlasLink { id: string; from: string; to: string; label: string | null; kind: LinkKind | null; planned: boolean }
export interface AtlasRepo {
  id: string; productId: string | null; fullName: string; lastRunName: string | null; lastRunStatus: string | null;
  lastRunAt: string | null; lastRunUrl: string | null; lastRunSha: string | null;
  commits7d: number | null; runs7d: number | null; failedRuns7d: number | null; openAlerts: number | null; checkedAt: string | null;
}
export interface AtlasCollector { name: string; connected: boolean; lastRunAt: string | null; error: string | null }
export interface NowItem {
  kind: 'activity' | 'routine' | 'deploy' | 'down'; id: string; productId: string | null; serviceId: string | null;
  title: string; detail: string | null; actor: string | null; since: string | null;
}
export interface Discovery { id: string; source: string; kind: 'service' | 'repo' | 'monitor'; externalRef: string; name: string; environment: string | null; url: string | null; firstSeenAt: string }
export interface Atlas {
  serverTime: string; systems: AtlasSystem[]; environments: AtlasEnvironment[]; services: AtlasService[]; links: AtlasLink[];
  repos: AtlasRepo[]; collectors: AtlasCollector[]; now: NowItem[]; discoveries: Discovery[];
}

export interface RoutineRun {
  id: string; status: 'running' | 'ok' | 'failed'; startedAt: string; finishedAt: string | null; summary: string | null;
  actorName: string; links: Array<{ kind: string; label: string; url: string | null }>; stale: boolean;
}
export interface Routine {
  id: string; slug: string; name: string; frequency: 'daily' | 'weekly' | 'monthly'; description: string | null; prompt: string;
  enabled: boolean; updatedAt: string; system: { id: string; slug: string; name: string; color: string | null } | null; lastRun: RoutineRun | null;
}

export interface FlowStep { key: string; value: number | null; detail: string | null }
export interface SystemFlows {
  system: { id: string; slug: string; name: string; color: string | null };
  flows: Array<{ key: 'code' | 'errors' | 'content'; steps: FlowStep[] }>;
}

/** The whole picture, refreshed every few seconds while the tab is in view: "now" has to be now. */
export function useAtlas() {
  return useQuery({ queryKey: ['atlas'], queryFn: () => api<Atlas>('/staff/atlas'), refetchInterval: 5_000, staleTime: 2_000 });
}
export function useRoutines() {
  return useQuery({ queryKey: ['atlas', 'routines'], queryFn: () => api<Routine[]>('/staff/atlas/routines'), refetchInterval: 15_000 });
}
export function useRoutineRuns(slug: string | null) {
  return useQuery({ queryKey: ['atlas', 'runs', slug], queryFn: () => api<RoutineRun[]>(`/staff/atlas/routines/${slug}/runs`), enabled: !!slug });
}
export function useFlows() {
  return useQuery({ queryKey: ['atlas', 'flows'], queryFn: () => api<SystemFlows[]>('/staff/atlas/flows'), refetchInterval: 60_000 });
}

export interface SystemRef { id: string; slug: string; name: string; color: string | null }
export interface ProcessStep {
  id: string; slug: string; name: string; status: StepStatus; stage: string | null; owner: Owner | null;
  today: string | null; ideal: string | null; next: string | null; task: string | null; impact: Impact | null;
  services: string[]; position: number; updatedAt: string; system: SystemRef | null;
}
export interface AtlasProcess {
  id: string; slug: string; name: string; description: string | null; updatedAt: string; system: SystemRef | null;
  stages: Array<{ key: string; name: string; description: string | null }>; steps: ProcessStep[];
}
export interface AttentionItem {
  source: 'service' | 'step'; id: string; status: 'gap' | 'warn'; title: string; detail: string | null; next: string | null;
  impact: Impact | null; owner: Owner | null; task: string | null; system: SystemRef | null; where: string | null;
  processId: string | null; serviceId: string | null;
}

export function useProcesses() {
  return useQuery({ queryKey: ['atlas', 'processes'], queryFn: () => api<AtlasProcess[]>('/staff/atlas/processes'), refetchInterval: 60_000 });
}
export function useAttention() {
  return useQuery({ queryKey: ['atlas', 'attention'], queryFn: () => api<AttentionItem[]>('/staff/atlas/attention'), refetchInterval: 60_000 });
}

/** What a system asks of the person looking: something is down, something waits, or nothing. */
export type Verdict = 'down' | 'attention' | 'unread' | 'ok' | 'empty';
export function verdict(s: AtlasSystem): Verdict {
  if (s.health.down > 0) return 'down';
  if (s.health.degraded > 0 || s.pending.tickets > 0 || s.pending.errors > 0 || (s.pending.alerts ?? 0) > 0) return 'attention';
  if (s.health.total === 0) return 'empty';
  // No service has a state read: that is not a healthy system, it is one nobody has looked at.
  if (healthReading(s.health).kind === 'unread') return 'unread';
  return 'ok';
}
const ORDER: Record<Verdict, number> = { down: 0, attention: 1, unread: 2, ok: 3, empty: 4 };

export interface Health { total: number; up: number; down: number; degraded: number; deploying: number; unknown: number }
export type HealthReading =
  | { kind: 'none' }
  | { kind: 'unread'; n: number }
  | { kind: 'mixed'; up: number; measured: number; unread: number }
  | { kind: 'all'; up: number; measured: number };

/**
 * What the states of a system say, counting only the services that have a state read (up, degraded, down,
 * deploying). "Not read" is not "down": a system with nothing read says so, and never counts as out of order.
 */
export function healthReading(h: Health): HealthReading {
  if (h.total === 0) return { kind: 'none' };
  const measured = h.up + h.down + h.degraded + h.deploying;
  if (measured === 0) return { kind: 'unread', n: h.total };
  const unread = Math.max(0, h.total - measured);
  if (unread > 0) return { kind: 'mixed', up: h.up, measured, unread };
  return { kind: 'all', up: h.up, measured };
}
export function byUrgency(a: AtlasSystem, b: AtlasSystem): number {
  return ORDER[verdict(a)] - ORDER[verdict(b)] || a.name.localeCompare(b.name);
}
