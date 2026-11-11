import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PitwallError } from '../client.js';
import type { Scope } from './types.js';

/** Runs git with an argument array (never a shell string). Null when git fails. */
export function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trimEnd();
  } catch {
    return null;
  }
}

/** owner/name in lower case from a GitHub remote (https, ssh scp-style or ssh://). Null for anything else. */
export function parseGitHubRemote(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/(?:[^@/]+@)?github\.com\/|(?:[^@/]+@)?github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  const full = `${m[1]}/${m[2]}`.toLowerCase();
  return /^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(full) ? full : null;
}

export interface RepoInfo {
  root: string;
  /** owner/name of origin, when origin is a GitHub remote. */
  repo: string | null;
  branch: string | null;
  headSha: string | null;
  dirty: boolean;
  /** HEAD is contained in some remote branch. */
  pushed: boolean;
}

export function repoInfo(cwd: string): RepoInfo {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) throw new PitwallError('Esta pasta não é um repositório git (ou o git não está instalado).');
  const root = resolve(top);
  const origin = git(root, ['remote', 'get-url', 'origin']);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const dirty = (git(root, ['status', '--porcelain']) ?? '').length > 0;
  const pushed = headSha !== null && (git(root, ['branch', '-r', '--contains', 'HEAD']) ?? '').length > 0;
  return {
    root,
    repo: origin ? parseGitHubRemote(origin) : null,
    branch: branch && branch !== 'HEAD' ? branch : null,
    headSha,
    dirty,
    pushed,
  };
}

/** Contract 8.2: local when the tree is dirty or HEAD is on no remote branch; otherwise pushed. */
export function defaultScope(info: Pick<RepoInfo, 'dirty' | 'pushed'>): Scope {
  return info.dirty || !info.pushed ? 'local' : 'pushed';
}

/** What start_activity reports about the working copy. Never throws: outside a repo, nothing. */
export function detectRepo(cwd: string): { repo?: string; branch?: string; headSha?: string } {
  try {
    const info = repoInfo(cwd);
    return {
      ...(info.repo ? { repo: info.repo } : {}),
      ...(info.branch ? { branch: info.branch } : {}),
      ...(info.headSha ? { headSha: info.headSha } : {}),
    };
  } catch {
    return {};
  }
}

/** Absolute path of a file in the git directory (works in worktrees and with core.hooksPath). */
export function gitPath(root: string, name: string): string {
  const p = git(root, ['rev-parse', '--git-path', name]);
  if (!p) throw new PitwallError('Não consegui achar o diretório .git deste repositório.');
  return resolve(root, p);
}
