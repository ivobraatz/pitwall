#!/usr/bin/env node
/**
 * pitwall-atlas: the Atlas Agent Sync from a terminal, a git hook or CI. It reads the repository
 * (a fixed list of manifests; never secrets) and sends it to the console, which turns it into the
 * Atlas. Results go to stdout, errors to stderr, and the token is never printed.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { PitwallError } from './client.js';
import { syncText } from './atlas-format.js';
import { VERSION } from './version.js';
import { codexSnippet, CI_EXAMPLE, installClaudeHook, installGitHook, type HookResult } from './sync/hooks.js';
import { flag, list, parseArgs, str, UsageError, type Parsed } from './sync/args.js';
import { saveConfig, resolveConfig } from './sync/config.js';
import { gitPath, repoInfo } from './sync/git.js';
import { readFingerprint, sameFingerprint, writeFingerprint } from './sync/state.js';
import { getSyncState, postSync } from './sync/send.js';
import { prepareSync, type Prepared } from './sync/run.js';
import { SCOPES, SOURCES, type Scope, type Source } from './sync/types.js';

const HELP = `pitwall-atlas ${VERSION}: Atlas Agent Sync

Uso:
  pitwall-atlas login --url <https://seu-console> --token <pwt_...>
  pitwall-atlas sync [opções]          envia o estado do repositório atual ao Atlas
  pitwall-atlas state                  mostra a última sincronização deste repositório
  pitwall-atlas install-hooks [--claude] [--git] [--codex]
                                       sem opções: --claude e --git
  pitwall-atlas print-ci               imprime um workflow de exemplo com a action
  pitwall-atlas help

sync:
  --scope local|pushed|deployed   padrão: pushed se a árvore está limpa e o HEAD está no remoto; senão local
  --environment <slug>            obrigatório com --scope deployed
  --system <slug>                 sistema do repositório (usado na primeira associação)
  --source agent|ci|git-hook|cli  padrão: cli
  --tool <nome>                   claude-code, codex, github-actions...
  --summary <texto>               o que foi feito (ou --summary-file <arquivo>)
  --task <T-XXXXX>                tarefa resolvida (pode repetir)
  --partial                       o pacote não tem todos os arquivos: nada é marcado como sumido
  --if-changed                    sai sem rede se pacote, commit e escopo são os do último envio
  --dry-run                       mostra o pacote e o pedido, sem enviar
  --quiet                         modo hook: qualquer erro vira um aviso e a saída é 0
  --json                          imprime a resposta do servidor em JSON

Configuração: PITWALL_URL e PITWALL_TOKEN, ou ~/.config/pitwall/atlas.json (pitwall-atlas login).
Argumentos sem opção são ignorados (o Codex acrescenta um JSON no fim).
`;

const NO_CONFIG = 'Sem configuração do Pitwall. Rode pitwall-atlas login --url <url> --token <pwt_...> ou defina PITWALL_URL e PITWALL_TOKEN.';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function pick<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`--${name} aceita ${allowed.join(', ')}.`);
  return value as T;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function previewText(p: Prepared): string {
  const { bundle, request } = p;
  const lines = [`Pacote: ${bundle.files.length} arquivo(s), ${kb(bundle.bytes)}.`];
  for (const f of bundle.files) lines.push(`  ${f.path} ${f.content === undefined ? '(só presença)' : `(${f.bytes} B)`}`);
  if (bundle.skipped.length > 0) lines.push('Deixados de fora:', ...bundle.skipped.map((s) => `  ${s.path}: ${s.reason}`));
  if (bundle.forbidden.length > 0) lines.push(`Proibidos, não lidos: ${bundle.forbidden.join(', ')}.`);
  // The request without file contents: the preview must stay short and must not repeat secrets.
  const summary = { ...request, files: request.files.map((f) => ({ path: f.path, bytes: f.content === undefined ? 0 : Buffer.byteLength(f.content) })) };
  lines.push('', 'Pedido (não enviado):', JSON.stringify(summary, null, 2));
  return lines.join('\n');
}

async function summaryText(opts: Parsed['opts']): Promise<string | undefined> {
  const inline = str(opts, 'summary');
  const file = str(opts, 'summary-file');
  if (inline !== undefined && file !== undefined) throw new UsageError('Use --summary ou --summary-file, não os dois.');
  return file !== undefined ? readFileSync(resolve(file), 'utf8') : inline;
}

async function cmdSync(p: Parsed): Promise<number> {
  const o = p.opts;
  const quiet = flag(o, 'quiet');
  const scope = pick<Scope>(str(o, 'scope'), SCOPES, 'scope');
  const source = pick<Source>(str(o, 'source'), SOURCES, 'source') ?? 'cli';
  const prep = prepareSync(process.cwd(), {
    summary: await summaryText(o),
    tasks: list(o, 'task'),
    scope,
    environment: str(o, 'environment'),
    system: str(o, 'system'),
    source,
    tool: str(o, 'tool'),
    partial: flag(o, 'partial'),
  });
  const stateFile = gitPath(prep.info.root, 'pitwall-atlas.json');

  if (flag(o, 'if-changed') && sameFingerprint(readFingerprint(stateFile), prep.fingerprint)) {
    if (!quiet) process.stdout.write('Nada mudou desde o último envio.\n');
    return 0;
  }
  if (flag(o, 'dry-run')) {
    process.stdout.write(`${previewText(prep)}\n`);
    return 0;
  }

  const cfg = resolveConfig();
  if (!cfg) throw new PitwallError(NO_CONFIG);
  const res = await postSync(cfg, prep.request);
  writeFingerprint(stateFile, prep.fingerprint);

  if (quiet) return 0;
  if (flag(o, 'json')) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  else process.stdout.write(`${syncText(res, prep.request.repo, prep.scope)}\n`);
  return 0;
}

async function cmdState(p: Parsed): Promise<number> {
  const info = repoInfo(process.cwd());
  if (!info.repo) throw new PitwallError('O origin deste repositório não é um remote do GitHub.');
  const cfg = resolveConfig();
  if (!cfg) throw new PitwallError(NO_CONFIG);
  const st = await getSyncState(cfg, info.repo);
  if (flag(p.opts, 'json')) {
    process.stdout.write(`${JSON.stringify(st, null, 2)}\n`);
    return 0;
  }
  if (!st.registered) {
    process.stdout.write(`${st.repo}: ainda não associado a um sistema. Associe no console (Atlas → Integração) ou envie --system no sync.\n`);
    return 0;
  }
  process.stdout.write(
    `${st.repo}: sistema ${st.system?.name ?? '—'}. Última sincronização: ${st.lastSyncAt ?? 'nunca'}` +
      ` (escopo ${st.lastSyncScope ?? '—'}, commit ${st.lastSyncSha?.slice(0, 7) ?? '—'}).\n`,
  );
  return 0;
}

function cmdLogin(p: Parsed): number {
  const url = str(p.opts, 'url')?.trim();
  const token = str(p.opts, 'token')?.trim();
  if (!url || !token) throw new UsageError('login precisa de --url e --token.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError('--url não é um endereço válido.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new UsageError('--url precisa começar com https://.');
  if (!token.startsWith('pwt_')) throw new UsageError('--token é um token pessoal, começa com pwt_.');
  const file = saveConfig({ url: url.replace(/\/+$/, ''), token }, homedir());
  process.stdout.write(`Configuração gravada em ${file}. O token não é exibido.\n`);
  return 0;
}

const HOOK_TEXT: Record<HookResult, string> = { created: 'criado', updated: 'atualizado', unchanged: 'já estava instalado' };

function cmdInstallHooks(p: Parsed): number {
  const o = p.opts;
  const wantClaude = flag(o, 'claude');
  const wantGit = flag(o, 'git');
  const wantCodex = flag(o, 'codex');
  const defaults = !wantClaude && !wantGit && !wantCodex;
  if (wantClaude || wantGit || defaults) {
    const root = repoInfo(process.cwd()).root;
    if (wantClaude || defaults) {
      const r = installClaudeHook(root);
      process.stdout.write(`Claude Code: .claude/settings.json, hook SessionEnd ${HOOK_TEXT[r]}.\n`);
    }
    if (wantGit || defaults) {
      for (const name of ['post-commit', 'pre-push']) {
        const r = installGitHook(gitPath(root, `hooks/${name}`));
        process.stdout.write(`Git: hooks/${name} ${HOOK_TEXT[r]}.\n`);
      }
    }
  }
  if (wantCodex) {
    process.stdout.write(`${codexSnippet()}\n`);
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  let p: Parsed;
  try {
    p = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`pitwall-atlas: ${errorText(e)}\n`);
    return 2;
  }
  if (flag(p.opts, 'help')) p.command = 'help';
  const quiet = flag(p.opts, 'quiet');
  try {
    switch (p.command) {
      case 'sync': return await cmdSync(p);
      case 'state': return await cmdState(p);
      case 'login': return cmdLogin(p);
      case 'install-hooks': return cmdInstallHooks(p);
      case 'print-ci': process.stdout.write(CI_EXAMPLE); return 0;
      case 'help': process.stdout.write(HELP); return 0;
      default:
        process.stderr.write(`pitwall-atlas: comando desconhecido: ${p.command}. Veja pitwall-atlas help.\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`pitwall-atlas: ${e.message}\n`);
      return 2;
    }
    // Hooks and CI run this without a person watching: a runtime problem is a warning, not a failed commit.
    if (quiet) {
      process.stderr.write(`pitwall-atlas: aviso: ${oneLine(errorText(e))}\n`);
      return 0;
    }
    process.stderr.write(`pitwall-atlas: ${errorText(e)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
