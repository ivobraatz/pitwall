import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PitwallError } from '../client.js';

/* Safety nets for the sync: a Claude Code SessionEnd hook, git hooks and a Codex notify line. */

export const HOOK_MARK = '# pitwall-atlas';
export const CLAUDE_COMMAND = 'npx -y -p pitwall-mcp@^0.4 pitwall-atlas sync --source agent --tool claude-code --quiet --if-changed';
export const GIT_COMMAND = 'npx -y -p pitwall-mcp@^0.4 pitwall-atlas sync --source git-hook --quiet --if-changed || true';
export const CODEX_NOTIFY = ['npx', '-y', '-p', 'pitwall-mcp@^0.4', 'pitwall-atlas', 'sync', '--source', 'agent', '--tool', 'codex', '--quiet', '--if-changed'];

export type HookResult = 'created' | 'updated' | 'unchanged';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Adds our SessionEnd entry to a settings file, keeping everything else. Idempotent. */
export function mergeClaudeSettings(current: string | null): { text: string; changed: boolean } {
  let doc: Record<string, unknown> = {};
  if (current !== null && current.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
    } catch {
      throw new PitwallError('.claude/settings.json não é JSON válido. Corrija ou mova o arquivo e rode de novo.');
    }
    if (!isObj(parsed)) throw new PitwallError('.claude/settings.json precisa ser um objeto JSON.');
    doc = parsed;
  }
  const hooks = isObj(doc.hooks) ? doc.hooks : {};
  const sessionEnd: unknown[] = Array.isArray(hooks.SessionEnd) ? hooks.SessionEnd : [];
  const present = sessionEnd.some((entry) => isObj(entry) && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => isObj(h) && h.command === CLAUDE_COMMAND));
  if (present) return { text: current ?? '', changed: false };
  sessionEnd.push({ hooks: [{ type: 'command', command: CLAUDE_COMMAND }] });
  doc.hooks = { ...hooks, SessionEnd: sessionEnd };
  return { text: `${JSON.stringify(doc, null, 2)}\n`, changed: true };
}

export function installClaudeHook(root: string): HookResult {
  const file = join(root, '.claude', 'settings.json');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const merged = mergeClaudeSettings(current);
  if (!merged.changed) return 'unchanged';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, merged.text);
  return current === null ? 'created' : 'updated';
}

/** Creates the hook, or appends our line to an existing one. Never overwrites someone else's hook. */
export function installGitHook(file: string): HookResult {
  const line = `${HOOK_MARK}\n${GIT_COMMAND}\n`;
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `#!/bin/sh\n${line}`);
    try {
      chmodSync(file, 0o755);
    } catch {
      // Windows ignores the mode; git runs hooks through sh anyway.
    }
    return 'created';
  }
  const current = readFileSync(file, 'utf8');
  if (current.includes(HOOK_MARK)) return 'unchanged';
  writeFileSync(file, `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${line}`);
  return 'updated';
}

export function codexSnippet(): string {
  const notify = `notify = [${CODEX_NOTIFY.map((a) => JSON.stringify(a)).join(', ')}]`;
  return ['# Em ~/.codex/config.toml (o pitwall-atlas não edita arquivos globais):', notify].join('\n');
}

export const CI_EXAMPLE = `# Sincroniza o Atlas a cada push na main. Troque OWNER/REPO pelo endereço da action.
name: Atlas sync
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  atlas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: OWNER/REPO/.github/actions/atlas-sync@main
        with:
          pitwall-url: \${{ vars.PITWALL_URL }}
          token: \${{ secrets.PITWALL_TOKEN }}
          scope: pushed
`;
