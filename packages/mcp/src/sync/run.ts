import { buildBundle, type Bundle } from './bundle.js';
import { PitwallError } from '../client.js';
import { defaultScope, repoInfo, type RepoInfo } from './git.js';
import type { Fingerprint } from './state.js';
import { sanitizeText } from './sanitize.js';
import { TASK_CODE, type Scope, type Source, type SyncReport, type SyncRequest } from './types.js';

/* Turns a working copy and what the agent reports into one SyncRequest (contract 8.3 and 3). */

export interface SyncInput {
  summary?: string;
  created?: string[];
  changed?: string[];
  removed?: string[];
  attention?: string[];
  tasks?: string[];
  ops?: Array<Record<string, unknown>>;
  scope?: Scope;
  environment?: string;
  system?: string;
  source: Source;
  tool?: string;
  partial?: boolean;
}

export interface Prepared {
  info: RepoInfo;
  bundle: Bundle;
  scope: Scope;
  request: SyncRequest;
  fingerprint: Fingerprint;
}

const LIST_MAX = 50;
const LIST_ITEM_MAX = 300;

function cleanList(items: string[] | undefined): string[] | undefined {
  const out = (items ?? []).slice(0, LIST_MAX).map((s) => sanitizeText(s, LIST_ITEM_MAX)).filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Every string in an op is redacted and cut; the server validates the shape itself. */
function cleanDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return sanitizeText(v, 500);
  if (depth > 6) return undefined;
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x, depth + 1));
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x, depth + 1)]));
  return v;
}

function buildReport(input: SyncInput, tasks: string[]): SyncReport | undefined {
  const report: SyncReport = {};
  if (input.summary?.trim()) report.summary = sanitizeText(input.summary.trim(), 4000);
  const created = cleanList(input.created);
  const changed = cleanList(input.changed);
  const removed = cleanList(input.removed);
  const attention = cleanList(input.attention);
  if (created) report.created = created;
  if (changed) report.changed = changed;
  if (removed) report.removed = removed;
  if (attention) report.attention = attention;
  if (tasks.length > 0) report.tasks = tasks;
  if (input.ops && input.ops.length > 0) report.ops = input.ops.slice(0, 200).map((op) => cleanDeep(op) as Record<string, unknown>);
  return Object.keys(report).length > 0 ? report : undefined;
}

export function prepareSync(cwd: string, input: SyncInput): Prepared {
  const info = repoInfo(cwd);
  if (!info.repo) throw new PitwallError('Não achei o remote origin do GitHub deste repositório (https ou ssh). Confira com git remote -v.');

  const scope = input.scope ?? defaultScope(info);
  if (scope === 'deployed' && !input.environment) throw new PitwallError('Escopo deployed exige o ambiente (--environment).');

  const tasks = [...new Set((input.tasks ?? []).map((t) => t.trim().toUpperCase()))];
  const badTask = tasks.find((t) => !TASK_CODE.test(t));
  if (badTask) throw new PitwallError(`Código de tarefa inválido: ${badTask}. Use T-XXXXX.`);

  const bundle = buildBundle(info.root);
  const request: SyncRequest = {
    source: input.source,
    repo: info.repo,
    scope,
    files: bundle.files.map((f) => (f.content === undefined ? { path: f.path } : { path: f.path, content: f.content })),
    bundleHash: bundle.hash,
    partial: !!input.partial || bundle.partial,
  };
  if (input.tool) request.tool = input.tool;
  if (input.system) request.system = input.system;
  if (input.environment) request.environment = input.environment;
  if (info.branch) request.branch = info.branch;
  if (info.headSha) request.commitSha = info.headSha;
  const report = buildReport(input, tasks);
  if (report) request.report = report;

  return { info, bundle, scope, request, fingerprint: { bundleHash: bundle.hash, headSha: info.headSha, scope } };
}
