/* A small parser for pitwall-atlas: no library, one rule per option kind. */

export class UsageError extends Error {}

export type Opts = Record<string, string | boolean | string[]>;

export interface Parsed {
  command: string;
  opts: Opts;
  /** Words that are not options. Codex appends its JSON payload here, so commands ignore them. */
  positionals: string[];
}

const VALUE_OPTS = new Set(['url', 'token', 'scope', 'environment', 'system', 'source', 'tool', 'summary', 'summary-file', 'task']);
const FLAG_OPTS = new Set(['partial', 'if-changed', 'dry-run', 'quiet', 'json', 'claude', 'git', 'codex', 'help']);

export function parseArgs(argv: string[]): Parsed {
  const first = argv[0];
  const hasCommand = first !== undefined && !first.startsWith('-');
  const command = hasCommand ? first : 'help';
  const args = hasCommand ? argv.slice(1) : argv;
  const opts: Opts = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;

    if (FLAG_OPTS.has(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} não recebe valor.`);
      opts[name] = true;
      continue;
    }
    if (VALUE_OPTS.has(name)) {
      let value = inline;
      if (value === undefined) {
        value = args[++i];
        if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} precisa de um valor.`);
      }
      if (name === 'task') {
        const list = Array.isArray(opts.task) ? opts.task : [];
        list.push(value);
        opts.task = list;
      } else {
        opts[name] = value;
      }
      continue;
    }
    throw new UsageError(`Opção desconhecida: ${arg}. Veja pitwall-atlas help.`);
  }
  return { command, opts, positionals };
}

export function str(opts: Opts, name: string): string | undefined {
  const v = opts[name];
  return typeof v === 'string' ? v : undefined;
}

export function list(opts: Opts, name: string): string[] {
  const v = opts[name];
  return Array.isArray(v) ? v : [];
}

export function flag(opts: Opts, name: string): boolean {
  return opts[name] === true;
}
