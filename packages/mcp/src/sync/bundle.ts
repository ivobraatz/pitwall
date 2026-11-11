import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isForbiddenPath, redact } from './sanitize.js';

/* The manifests sent to the Atlas (contract 5.1). Same list on the CLI and in the server's scan. */

export const MAX_FILES = 300;
export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_DEPTH = 4;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', 'bin', 'obj', 'vendor',
  '.venv', 'venv', '__pycache__', '.turbo', '.vercel', '.wrangler', 'target',
]);

const CONTENT: string[] = [
  'package.json', 'pnpm-workspace.yaml', '*.csproj', 'Directory.Packages.props', 'global.json', 'requirements*.txt',
  'pyproject.toml', 'Pipfile', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json', 'Dockerfile', 'Dockerfile.*', '*.dockerfile',
  'docker-compose*.yml', 'docker-compose*.yaml', 'compose*.yml', 'compose*.yaml', '.github/workflows/*.yml',
  '.github/workflows/*.yaml', '.github/dependabot.yml', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'vercel.json',
  'railway.json', 'railway.toml', 'netlify.toml', 'fly.toml', 'render.yaml', 'Procfile', 'prisma/schema.prisma', 'robots.txt',
];

const PRESENCE: string[] = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'tsconfig.json', 'next.config.*', 'nuxt.config.*',
  'vite.config.*', 'astro.config.*', 'svelte.config.*', 'sitemap.xml', 'next-sitemap.config.*', 'app/sitemap.*', 'app/robots.*',
  'src/app/sitemap.*', 'src/app/robots.*', 'drizzle.config.*', '.gitleaks.toml', 'SECURITY.md', 'CODEOWNERS',
  '.github/CODEOWNERS', '*.sln', '*.slnx', '.nvmrc', '.node-version',
];

type Transform = 'env' | 'appsettings';

interface Rule {
  re: RegExp;
  /** Patterns with a slash match the whole relative path; the others match the file name. */
  full: boolean;
  presence: boolean;
  transform?: Transform;
}

function rule(glob: string, opts: { presence?: boolean; transform?: Transform } = {}): Rule {
  const body = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return { re: new RegExp(`^${body}$`), full: glob.includes('/'), presence: !!opts.presence, transform: opts.transform };
}

const RULES: Rule[] = [
  ...CONTENT.map((g) => rule(g)),
  rule('appsettings*.json', { transform: 'appsettings' }),
  rule('.env.example', { transform: 'env' }),
  rule('.env.sample', { transform: 'env' }),
  rule('.env.template', { transform: 'env' }),
  rule('example.env', { transform: 'env' }),
  ...PRESENCE.map((g) => rule(g, { presence: true })),
];

function classify(relPath: string): Rule | null {
  const name = relPath.split('/').pop() ?? relPath;
  return RULES.find((r) => r.re.test(r.full ? relPath : name)) ?? null;
}

/** Walks the tree without following links. Directories below MAX_DEPTH are not entered. */
function walk(root: string, dir: string, depth: number, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir ? join(root, dir) : root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || depth >= MAX_DEPTH) continue;
      walk(root, rel, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

/** Env examples keep only the NAME= lines: values and comments never leave the repo. */
function envExample(text: string): string {
  const names = text.split(/\r?\n/).flatMap((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return m ? [`${m[1]}=`] : [];
  });
  return names.length > 0 ? `${names.join('\n')}\n` : '';
}

/** appsettings keep their structure; every leaf value becomes "". Invalid JSON is not sent. */
function blank(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(blank);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  return '';
}

function transform(text: string, kind?: Transform): string | null {
  if (kind === 'env') return envExample(text);
  if (kind === 'appsettings') {
    try {
      return `${JSON.stringify(blank(JSON.parse(text)), null, 2)}\n`;
    } catch {
      return null;
    }
  }
  return text;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface BundleFile {
  path: string;
  content?: string;
  bytes: number;
}

export interface Bundle {
  files: BundleFile[];
  hash: string;
  /** Some candidate was left out (limits, unreadable): the server must not mark evidence as gone. */
  partial: boolean;
  skipped: Array<{ path: string; reason: string }>;
  /** Forbidden names found on disk. They are never opened; only the names are reported. */
  forbidden: string[];
  bytes: number;
}

export interface BundleOptions {
  /** Injected for the tests, which prove that forbidden files are never read. */
  read?: (absPath: string) => string;
}

export function buildBundle(root: string, opts: BundleOptions = {}): Bundle {
  const read = opts.read ?? ((p: string) => readFileSync(p, 'utf8'));
  const all: string[] = [];
  walk(root, '', 0, all);
  all.sort(byPath);

  const forbidden: string[] = [];
  const candidates: Array<{ path: string; rule: Rule }> = [];
  for (const path of all) {
    if (isForbiddenPath(path)) {
      forbidden.push(path);
      continue;
    }
    const r = classify(path);
    if (r) candidates.push({ path, rule: r });
  }

  const files: BundleFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let total = 0;
  for (const { path, rule: r } of candidates) {
    if (files.length >= MAX_FILES) {
      skipped.push({ path, reason: `limite de ${MAX_FILES} arquivos` });
      continue;
    }
    if (r.presence) {
      files.push({ path, bytes: 0 });
      continue;
    }
    const abs = join(root, path);
    if (statSync(abs).size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: 'maior que 200 KB' });
      continue;
    }
    const raw = transform(read(abs), r.transform);
    if (raw === null) {
      skipped.push({ path, reason: 'JSON inválido' });
      continue;
    }
    const content = redact(raw);
    const size = Buffer.byteLength(content);
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: 'maior que 200 KB' });
      continue;
    }
    if (total + size > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: 'limite de 1 MB no total' });
      continue;
    }
    total += size;
    files.push({ path, content, bytes: size });
  }

  const hash = createHash('sha256');
  for (const f of files) hash.update(f.path).update('\0').update(f.content ?? '').update('\0');

  return { files, hash: hash.digest('hex'), partial: skipped.length > 0, skipped, forbidden, bytes: total };
}
