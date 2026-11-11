import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/* Where pitwall-atlas finds the console and the token: the environment first, then the user's file. */

export interface SyncConfig {
  url: string;
  token: string;
}

export function configPath(home: string = homedir()): string {
  return join(home, '.config', 'pitwall', 'atlas.json');
}

function readFile(home?: string): Partial<SyncConfig> {
  try {
    const raw = JSON.parse(readFileSync(configPath(home), 'utf8')) as Record<string, unknown>;
    return {
      url: typeof raw.url === 'string' ? raw.url : undefined,
      token: typeof raw.token === 'string' ? raw.token : undefined,
    };
  } catch {
    return {};
  }
}

/** Null when either value is missing everywhere. Each variable overrides the file on its own. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env, home?: string): SyncConfig | null {
  const file = readFile(home);
  const url = env.PITWALL_URL?.trim() || file.url?.trim();
  const token = env.PITWALL_TOKEN?.trim() || file.token?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

/** Writes the user's file with mode 600 where the OS allows it. Returns the path, never the token. */
export function saveConfig(cfg: SyncConfig, home?: string): string {
  const file = configPath(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores the mode; the file still lives in the user's profile.
  }
  return file;
}
