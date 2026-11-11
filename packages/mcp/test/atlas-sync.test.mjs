import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from "node:child_process";
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const dist = (file) => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));
const { buildBundle } = await import(new URL('../dist/' + 'sync/bundle.js', import.meta.url).href);
const { redact, isForbiddenPath } = await import(new URL('../dist/' + 'sync/sanitize.js', import.meta.url).href);
const { parseGitHubRemote } = await import(new URL('../dist/' + 'sync/git.js', import.meta.url).href);
const { mergeClaudeSettings, CLAUDE_COMMAND } = await import(new URL('../dist/' + 'sync/hooks.js', import.meta.url).href);
const { createServer: createMcp } = await import(new URL('../dist/' + 'server.js', import.meta.url).href);
const CLI = dist('atlas-cli.js');
const ACTION = fileURLToPath(new URL('../../../.github/actions/atlas-sync/action.yml', import.meta.url));

const REMOTE = 'https://github.com/acme-inc/rockets.git';
const TOKEN = 'pwt_SEGREDOsegredoSEGREDOsegredoSEGREDOsegr';
const SECRET = 'sk_live_abc123456789xyz';

const created = [];
const servers = [];
after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/** A repo with one commit on origin/main (so HEAD counts as pushed unless pushed: false). */
function mkRepo(files = {}, { remote = REMOTE, pushed = true } = {}) {
  const dir = tmp('atlas-sync-');
  git(dir, ['init', '-q', '-b', 'main']);
  if (remote) git(dir, ['remote', 'add', 'origin', remote]);
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=Acme Dev', '-c', 'user.email=dev@acme.example', 'commit', '-q', '-m', 'init']);
  if (pushed) git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return dir;
}

function freshHome() {
  return tmp('atlas-home-');
}

function cliEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of ['PITWALL_URL', 'PITWALL_TOKEN', 'PITWALL_REPO_DIR', 'PITWALL_TOOL']) delete env[k];
  return { ...env, ...extra };
}

/* Async on purpose: the fake console runs in this process and must keep answering while the CLI runs. */
function runCli(args, { cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

/** Fake Pitwall console: records each request and answers with the handler's reply. */
async function fakeConsole(respond = () => ({ status: 201, body: syncReply() })) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, auth: req.headers.authorization, raw, body: raw ? JSON.parse(raw) : undefined };
      requests.push(rec);
      const r = respond(rec);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.body === undefined ? '' : JSON.stringify(r.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  servers.push(server);
  return { url, requests };
}

function syncReply() {
  return {
    changeSetId: 'cs-1', status: 'applied', replayed: false, created: ['rockets:any:api'], updated: [], unchanged: 0,
    gone: [], removalsReported: [], rejected: [], attention: [],
  };
}

async function closedPortUrl() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

// ---------- bundle: the whitelist, ignored folders, depth ----------

test('bundle sends only the whitelist, sorted by path, presence-only files without content', async () => {
  const dir = tmp('atlas-bundle-');
  write(dir, {
    'package.json': '{"name":"rockets"}',
    'src/index.ts': 'export {}',
    'tsconfig.json': '{}',
    'node_modules/left-pad/package.json': '{}',
    'dist/package.json': '{}',
    'packages/api/package.json': '{"name":"api"}',
    'a/b/c/d/package.json': '{"name":"deep"}',
    'a/b/c/d/e/package.json': '{"name":"too-deep"}',
    '.github/workflows/ci.yml': 'on: push',
    Dockerfile: 'FROM node:22',
  });
  const bundle = buildBundle(dir);
  assert.deepEqual(bundle.files.map((f) => f.path), [
    '.github/workflows/ci.yml', 'Dockerfile', 'a/b/c/d/package.json', 'package.json', 'packages/api/package.json', 'tsconfig.json',
  ]);
  const presence = bundle.files.find((f) => f.path === 'tsconfig.json');
  assert.equal(presence.content, undefined);
  assert.equal(bundle.files.find((f) => f.path === 'package.json').content, '{"name":"rockets"}');
  assert.equal(bundle.partial, false);
});

test('env examples keep only NAME= lines and appsettings keep their shape with blank leaves', async () => {
  const dir = tmp('atlas-transform-');
  write(dir, {
    '.env.example': '# Pagamentos\nexport STRIPE_SECRET_KEY=sk_live_abc123456789\nRESEND_API_KEY="re_123"\n',
    'appsettings.json': JSON.stringify({ Logging: { LogLevel: { Default: 'Information' } }, Allowed: ['a', 'b'], Port: 5000, Stripe: { Key: SECRET } }),
    'appsettings.Development.json': '{ not json',
  });
  const bundle = buildBundle(dir);
  const env = bundle.files.find((f) => f.path === '.env.example');
  assert.equal(env.content, 'STRIPE_SECRET_KEY=\nRESEND_API_KEY=\n');
  const app = JSON.parse(bundle.files.find((f) => f.path === 'appsettings.json').content);
  assert.deepEqual(app, { Logging: { LogLevel: { Default: '' } }, Allowed: ['', ''], Port: '', Stripe: { Key: '' } });
  assert.equal(bundle.files.some((f) => f.path === 'appsettings.Development.json'), false);
  assert.equal(bundle.partial, true, 'a skipped candidate makes the bundle partial');
  assert.ok(!JSON.stringify(bundle).includes(SECRET));
});

test('forbidden files are never opened, not even to be ignored', async () => {
  const dir = tmp('atlas-forbidden-');
  write(dir, {
    '.env': `STRIPE_SECRET_KEY=${SECRET}\n`,
    '.env.local': `STRIPE_SECRET_KEY=${SECRET}\n`,
    '.env.production': `STRIPE_SECRET_KEY=${SECRET}\n`,
    '.env.example': 'STRIPE_SECRET_KEY=\n',
    'secrets.json': `{"k":"${SECRET}"}`,
    'credentials.json': `{"k":"${SECRET}"}`,
    'deploy.pem': SECRET,
    'id_rsa': SECRET,
    'package.json': '{"name":"rockets"}',
  });
  const reads = [];
  const bundle = buildBundle(dir, { read: (p) => { reads.push(p); return readFileSync(p, 'utf8'); } });
  for (const name of ['.env', '.env.local', '.env.production', 'secrets.json', 'credentials.json', 'deploy.pem', 'id_rsa']) {
    assert.equal(reads.some((p) => p.endsWith(name)), false, `${name} was read`);
  }
  assert.deepEqual(bundle.forbidden.sort(), ['.env', '.env.local', '.env.production', 'credentials.json', 'deploy.pem', 'id_rsa', 'secrets.json']);
  assert.equal(bundle.files.find((f) => f.path === '.env.example').content, 'STRIPE_SECRET_KEY=\n');
  assert.ok(!JSON.stringify(bundle).includes(SECRET));
});

test('the bundle hash is stable and changes with the content', async () => {
  const a = tmp('atlas-hash-a-');
  const b = tmp('atlas-hash-b-');
  write(a, { 'package.json': '{"a":1}', 'Dockerfile': 'FROM node:22' });
  write(b, { 'Dockerfile': 'FROM node:22', 'package.json': '{"a":1}' });
  assert.equal(buildBundle(a).hash, buildBundle(b).hash);
  write(b, { 'package.json': '{"a":2}' });
  assert.notEqual(buildBundle(a).hash, buildBundle(b).hash);
});

test('the bundle respects the file and size limits and says it is partial', async () => {
  const dir = tmp('atlas-limits-');
  const big = 'x'.repeat(201 * 1024);
  write(dir, { 'package.json': big });
  const bundle = buildBundle(dir);
  assert.equal(bundle.files.length, 0);
  assert.equal(bundle.partial, true);
  assert.match(bundle.skipped[0].reason, /200 KB/);
});

// ---------- sanitizer and remotes ----------

test('the sanitizer redacts the section 6 patterns and keeps ordinary text', async () => {
  const cases = [
    [`key ${SECRET} here`, SECRET],
    ['postgres://app:hunter22@db.acme.example/app', 'hunter22'],
    ['password: hunter22xyz', 'hunter22xyz'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl', 'eyJhbGciOiJI'],
    [`ghp_${'a'.repeat(36)}`, 'ghp_'],
    [TOKEN, 'pwt_'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', 'MIIEow'],
    ['config = aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYmFzZTY0IHZhbHVlISE', 'aGVsbG8'],
  ];
  for (const [input, leaked] of cases) {
    const out = redact(input);
    assert.ok(out.includes('[removido]'), `not redacted: ${input}`);
    assert.ok(!out.includes(leaked), `leaked ${leaked} from ${input}`);
  }
  assert.equal(redact('password: hunter22xyz'), 'password=[removido]');
  assert.equal(redact('postgres://app:hunter22@db.acme.example/app'), 'postgres://[removido]@db.acme.example/app');
  assert.equal(redact('Deploy feito no painel da Acme'), 'Deploy feito no painel da Acme');
});

test('forbidden paths are recognised by name', async () => {
  for (const p of ['.env', '.env.local', 'apps/web/.env.production', 'config/secrets.yml', 'app/key.pem', 'id_rsa.pub']) {
    assert.equal(isForbiddenPath(p), true, p);
  }
  for (const p of ['.env.example', 'package.json', 'docs/key-concepts.md']) {
    assert.equal(isForbiddenPath(p), false, p);
  }
});

test('GitHub remotes parse to owner/name in lower case; others do not', async () => {
  assert.equal(parseGitHubRemote('https://github.com/Acme-Inc/Rockets.git'), 'acme-inc/rockets');
  assert.equal(parseGitHubRemote('https://github.com/acme-inc/rockets'), 'acme-inc/rockets');
  assert.equal(parseGitHubRemote('https://user:tok@github.com/acme-inc/rockets.git/'), 'acme-inc/rockets');
  assert.equal(parseGitHubRemote('git@github.com:acme-inc/rockets.git'), 'acme-inc/rockets');
  assert.equal(parseGitHubRemote('ssh://git@github.com/acme-inc/rockets.git'), 'acme-inc/rockets');
  assert.equal(parseGitHubRemote('https://gitlab.com/acme-inc/rockets.git'), null);
  assert.equal(parseGitHubRemote('git@gitlab.example:acme/rockets.git'), null);
});

// ---------- the CLI against a fake console ----------

test('sync sends the bundle, the report redacted, and the token only in the header', async () => {
  const repo = mkRepo({ 'package.json': '{"name":"rockets"}', '.env.example': '# x\nSTRIPE_SECRET_KEY=\n' });
  write(repo, { '.env': `STRIPE_SECRET_KEY=${SECRET}\n` });
  const console_ = await fakeConsole();
  const res = await runCli(['sync', '--scope', 'pushed', '--source', 'ci', '--tool', 'github-actions',
    '--summary', `Feito com token=abcdefgh123456 e ${SECRET}`, '--task', 't-7k2qm'], {
    cwd: repo, env: cliEnv(freshHome(), { PITWALL_URL: console_.url, PITWALL_TOKEN: TOKEN }),
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Sincronizado acme-inc\/rockets \(escopo pushed\)/);
  assert.equal(console_.requests.length, 1);
  const req = console_.requests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/staff/atlas/sync');
  assert.equal(req.auth, `Bearer ${TOKEN}`);
  assert.equal(req.body.repo, 'acme-inc/rockets');
  assert.equal(req.body.source, 'ci');
  assert.equal(req.body.tool, 'github-actions');
  assert.equal(req.body.report.summary.includes('abcdefgh123456'), false);
  assert.equal(req.body.report.summary.includes(SECRET), false);
  assert.deepEqual(req.body.report.tasks, ['T-7K2QM']);
  assert.deepEqual(req.body.files.find((f) => f.path === '.env.example').content, 'STRIPE_SECRET_KEY=\n');
  assert.equal(req.body.files.some((f) => f.path === '.env'), false);
  assert.equal(req.raw.includes(SECRET), false, 'the .env secret never reaches the console');
  assert.equal(res.stdout.includes(TOKEN) || res.stderr.includes(TOKEN), false);
});

test('the default scope is local with a dirty tree and pushed when HEAD is on the remote', async () => {
  const clean = mkRepo({ 'package.json': '{}' });
  const dirty = mkRepo({ 'package.json': '{}' });
  write(dirty, { 'Dockerfile': 'FROM node:22' });
  const console_ = await fakeConsole();
  const env = cliEnv(freshHome(), { PITWALL_URL: console_.url, PITWALL_TOKEN: TOKEN });
  assert.equal((await runCli(['sync'], { cwd: clean, env })).status, 0);
  assert.equal((await runCli(['sync'], { cwd: dirty, env })).status, 0);
  assert.equal(console_.requests[0].body.scope, 'pushed');
  assert.equal(console_.requests[1].body.scope, 'local');
});

test('deployed without an environment, and a non-GitHub origin, fail without sending', async () => {
  const console_ = await fakeConsole();
  const env = cliEnv(freshHome(), { PITWALL_URL: console_.url, PITWALL_TOKEN: TOKEN });
  const repo = mkRepo({ 'package.json': '{}' });
  const deployed = await runCli(['sync', '--scope', 'deployed'], { cwd: repo, env });
  assert.equal(deployed.status, 1);
  assert.match(deployed.stderr, /--environment/);
  const gitlab = mkRepo({ 'package.json': '{}' }, { remote: 'https://gitlab.example/acme/rockets.git' });
  const other = await runCli(['sync'], { cwd: gitlab, env });
  assert.equal(other.status, 1);
  assert.match(other.stderr, /origin do GitHub/);
  assert.equal(console_.requests.length, 0);
});

test('--if-changed sends once and skips the network while nothing changed', async () => {
  const repo = mkRepo({ 'package.json': '{"v":1}' });
  const console_ = await fakeConsole();
  const env = cliEnv(freshHome(), { PITWALL_URL: console_.url, PITWALL_TOKEN: TOKEN });
  assert.equal((await runCli(['sync', '--scope', 'pushed', '--if-changed'], { cwd: repo, env })).status, 0);
  const again = await runCli(['sync', '--scope', 'pushed', '--if-changed'], { cwd: repo, env });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /Nada mudou/);
  assert.equal(console_.requests.length, 1);
  write(repo, { 'package.json': '{"v":2}' });
  assert.equal((await runCli(['sync', '--scope', 'local', '--if-changed'], { cwd: repo, env })).status, 0);
  assert.equal(console_.requests.length, 2);
});

test('--quiet with the console offline exits 0 with one warning line; without it, exit 1', async () => {
  const repo = mkRepo({ 'package.json': '{}' });
  const env = cliEnv(freshHome(), { PITWALL_URL: await closedPortUrl(), PITWALL_TOKEN: TOKEN });
  const quiet = await runCli(['sync', '--quiet', '--scope', 'pushed'], { cwd: repo, env });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
  const lines = quiet.stderr.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^pitwall-atlas: aviso: Não consegui falar com/);
  assert.equal(quiet.stderr.includes(TOKEN), false);
  const loud = await runCli(['sync', '--scope', 'pushed'], { cwd: repo, env });
  assert.equal(loud.status, 1);
});

test('--quiet outside a repository exits 0', async () => {
  const plain = tmp('atlas-plain-');
  const res = await runCli(['sync', '--quiet'], { cwd: plain, env: cliEnv(freshHome(), { PITWALL_URL: 'http://127.0.0.1:9', PITWALL_TOKEN: TOKEN }) });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /aviso/);
});

test('dry-run lists the bundle and the forbidden names, shows no secret and sends nothing', async () => {
  const repo = mkRepo({ 'package.json': '{}' });
  write(repo, { '.env': `STRIPE_SECRET_KEY=${SECRET}\n` });
  const console_ = await fakeConsole();
  const res = await runCli(['sync', '--dry-run', '--scope', 'pushed'], { cwd: repo, env: cliEnv(freshHome(), { PITWALL_URL: console_.url, PITWALL_TOKEN: TOKEN }) });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /package\.json \(2 B\)/);
  assert.match(res.stdout, /Proibidos, não lidos: \.env\./);
  assert.equal(res.stdout.includes(SECRET), false);
  assert.equal(console_.requests.length, 0);
});

test('login writes the user file (no token echoed), and sync then works without environment variables', async () => {
  const repo = mkRepo({ 'package.json': '{}' });
  const home = freshHome();
  const console_ = await fakeConsole();
  const login = await runCli(['login', '--url', console_.url, '--token', TOKEN], { cwd: repo, env: cliEnv(home) });
  assert.equal(login.status, 0, login.stderr);
  assert.equal(login.stdout.includes(TOKEN), false);
  const file = join(home, '.config', 'pitwall', 'atlas.json');
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, TOKEN);
  const sent = await runCli(['sync', '--scope', 'pushed'], { cwd: repo, env: cliEnv(home) });
  assert.equal(sent.status, 0, sent.stderr);
  assert.equal(console_.requests.length, 1);
});

test('login refuses a token that is not personal, and a bad URL', async () => {
  const home = freshHome();
  const bad = await runCli(['login', '--url', 'https://pitwall.example.com', '--token', 'abc'], { cwd: tmp('atlas-x-'), env: cliEnv(home) });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /pwt_/);
  const url = await runCli(['login', '--url', 'ftp://pitwall.example.com', '--token', TOKEN], { cwd: tmp('atlas-x-'), env: cliEnv(home) });
  assert.equal(url.status, 2);
});

test('state shows the repository as the console sees it', async () => {
  const repo = mkRepo({ 'package.json': '{}' });
  const console_ = await fakeConsole((req) => ({
    status: 200,
    body: { repo: 'acme-inc/rockets', registered: true, system: { slug: 'acme', name: 'Acme' }, lastSyncAt: '2026-11-10T12:00:00Z', lastSyncSha: 'abcdef1234567', lastSyncScope: 'pushed', lastScanHash: null },
  }));
  const res = await runCli(['state'], { cwd: repo, env: cliEnv(freshHome(), { PITWALL_URL: console_.url, PITWALL_TOKEN: TOKEN }) });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /acme-inc\/rockets: sistema Acme/);
  assert.match(res.stdout, /commit abcdef1/);
  assert.equal(console_.requests[0].url, '/v1/staff/atlas/sync/state?repo=acme-inc%2Frockets');
});

test('unknown options are a usage error (exit 2)', async () => {
  const res = await runCli(['sync', '--nope'], { cwd: tmp('atlas-x-'), env: cliEnv(freshHome()) });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Opção desconhecida/);
});

// ---------- hooks ----------

test('the Claude settings merge keeps the existing hooks and adds SessionEnd once', async () => {
  const current = JSON.stringify({
    model: 'x',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
  });
  const first = mergeClaudeSettings(current);
  assert.equal(first.changed, true);
  const doc = JSON.parse(first.text);
  assert.equal(doc.model, 'x');
  assert.equal(doc.hooks.PreToolUse[0].hooks[0].command, 'echo hi');
  assert.equal(doc.hooks.SessionEnd[0].hooks[0].command, CLAUDE_COMMAND);
  assert.match(CLAUDE_COMMAND, /npx -y -p pitwall-mcp@\^0\.4 pitwall-atlas sync .*--quiet --if-changed/);
  const second = mergeClaudeSettings(first.text);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test('install-hooks appends to an existing git hook without overwriting it', async () => {
  const repo = mkRepo({ 'package.json': '{}' });
  const postCommit = join(repo, '.git', 'hooks', 'post-commit');
  mkdirSync(dirname(postCommit), { recursive: true });
  writeFileSync(postCommit, '#!/bin/sh\necho hi\n');
  const env = cliEnv(freshHome());
  const first = await runCli(['install-hooks', '--claude', '--git'], { cwd: repo, env });
  assert.equal(first.status, 0, first.stderr);
  const again = await runCli(['install-hooks', '--claude', '--git'], { cwd: repo, env });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /já estava instalado/);

  const text = readFileSync(postCommit, 'utf8');
  assert.match(text, /^#!\/bin\/sh\necho hi\n/);
  assert.equal(text.split('# pitwall-atlas').length - 1, 1);
  assert.match(text, /pitwall-atlas sync --source git-hook --quiet --if-changed \|\| true/);
  assert.ok(existsSync(join(repo, '.git', 'hooks', 'pre-push')));

  const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionEnd[0].hooks[0].command, CLAUDE_COMMAND);
});

test('print-ci uses the action, and install-hooks --codex prints the notify line only', async () => {
  const env = cliEnv(freshHome());
  const ci = await runCli(['print-ci'], { cwd: tmp('atlas-x-'), env });
  assert.match(ci.stdout, /actions\/checkout@v4/);
  assert.match(ci.stdout, /\.github\/actions\/atlas-sync@main/);
  const codex = await runCli(['install-hooks', '--codex'], { cwd: tmp('atlas-x-'), env });
  assert.equal(codex.status, 0);
  assert.match(codex.stdout, /notify = \["npx", "-y", "-p", "pitwall-mcp@\^0\.4", "pitwall-atlas", "sync"/);
});

test('the release action runs the CLI in quiet mode, from the same inputs', async () => {
  const action = readFileSync(ACTION, 'utf8');
  assert.match(action, /using: composite/);
  assert.match(action, /pitwall-atlas sync/);
  assert.match(action, /--quiet/);
  assert.match(action, /PITWALL_TOKEN: \$\{\{ inputs\.token \}\}/);
});

// ---------- MCP tools over the same code ----------

async function mcp(fetch) {
  const { server } = createMcp({ url: 'https://pitwall.example.com', token: TOKEN, fetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const textOf = (r) => r.content.map((c) => c.text).join('\n');

test('atlas_sync packs the working copy and sends what the agent reported', async () => {
  const repo = mkRepo({ 'package.json': '{"name":"rockets"}' });
  const calls = [];
  const client = await mcp(async (input, init) => {
    calls.push({ url: input, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(syncReply()), { status: 201, headers: { 'content-type': 'application/json' } });
  });
  process.env.PITWALL_REPO_DIR = repo;
  try {
    const res = await client.callTool({
      name: 'atlas_sync',
      arguments: { summary: 'Ajustei o frete com token=abcdefgh123456', tasks: ['T-7K2QM'], ops: [{ op: 'edge', from: 'a', to: 'b', relation: 'calls' }] },
    });
    assert.equal(res.isError, undefined, textOf(res));
    assert.match(textOf(res), /Sincronizado acme-inc\/rockets/);
  } finally {
    delete process.env.PITWALL_REPO_DIR;
  }
  assert.equal(calls[0].url, 'https://pitwall.example.com/v1/staff/atlas/sync');
  const body = calls[0].body;
  assert.equal(body.source, 'agent');
  assert.equal(body.tool, 'claude-code');
  assert.equal(body.report.summary.includes('abcdefgh123456'), false);
  assert.deepEqual(body.report.tasks, ['T-7K2QM']);
  assert.equal(body.report.ops[0].relation, 'calls');
  assert.equal(body.files[0].path, 'package.json');
});

test('atlas_sync refuses a relation outside the vocabulary and a task code that is not one', async () => {
  const client = await mcp(async () => new Response('{}', { status: 201 }));
  const badRelation = await client.callTool({ name: 'atlas_sync', arguments: { summary: 'x', ops: [{ op: 'edge', from: 'a', to: 'b', relation: 'magic' }] } });
  assert.equal(badRelation.isError, true);
});

test('start_activity sends the repository, branch, commit and tool it runs in', async () => {
  const repo = mkRepo({ 'package.json': '{}' });
  const calls = [];
  const client = await mcp(async (input, init) => {
    calls.push({ url: input, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'a1' }), { status: 201, headers: { 'content-type': 'application/json' } });
  });
  process.env.PITWALL_REPO_DIR = repo;
  try {
    await client.callTool({ name: 'start_activity', arguments: { system: 'rockets', description: 'Corrigindo o frete' } });
  } finally {
    delete process.env.PITWALL_REPO_DIR;
  }
  assert.equal(calls[0].body.repo, 'acme-inc/rockets');
  assert.equal(calls[0].body.branch, 'main');
  assert.equal(calls[0].body.headSha.length, 40);
  assert.equal(calls[0].body.tool, 'claude-code');
});

test('link_services carries the relation', async () => {
  const calls = [];
  const client = await mcp(async (input, init) => {
    calls.push(JSON.parse(init.body));
    return new Response('{"id":"l1"}', { status: 201, headers: { 'content-type': 'application/json' } });
  });
  const res = await client.callTool({ name: 'link_services', arguments: { from: 'rockets/api', to: 'rockets/db', relation: 'writes_to' } });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].relation, 'writes_to');
});

test('the graph, node, changes and insights read as text', async () => {
  const responses = {
    '/v1/staff/atlas/graph': {
      scope: { system: { name: 'Acme' }, environment: null },
      engines: [{ key: 'app', name: 'Aplicação e dados', position: 3 }],
      nodes: [{ id: 's1', key: 'acme:any:api', name: 'API', kind: 'api', engine: 'app', state: 'down', verification: 'verified', attention: { failure: 1, security: 0, task: 0, improvement: 0, config: 0, unverified: 0 } }],
      edges: [], sources: [{ name: 'railway', connected: true, stale: true }], coverage: { percent: 60 },
    },
    '/v1/staff/atlas/nodes/s1': {
      node: { name: 'API', kind: 'api', state: 'down', verification: 'verified', verifiedAt: '2026-11-10T10:00:00Z', origin: 'declared', environment: 'production' },
      engine: 'Aplicação e dados', system: { name: 'Acme' }, providerUrl: 'https://railway.com/dashboard',
      incoming: [], outgoing: [{ edge: { relation: 'writes_to' }, node: { name: 'Banco' } }],
      impact: { direct: [{ name: 'Site' }], indirect: [], systems: [{ name: 'Acme' }] },
      evidence: [], refs: [], events: [], repos: [{ fullName: 'acme-inc/rockets' }],
    },
    '/v1/staff/atlas/changes': [{ at: '2026-11-10T10:00:00Z', actor: 'Ana (Claude)', op: 'updated', entityType: 'service', summary: 'API', fields: [{ field: 'condition', before: 'ok', after: 'warn' }] }],
    '/v1/staff/atlas/insights': [{ severity: 'check', title: 'Sem monitoramento', detail: 'API não tem monitor' }],
  };
  const seen = [];
  const client = await mcp(async (input) => {
    const url = new URL(input);
    seen.push(url.pathname + url.search);
    const body = responses[url.pathname] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const graph = textOf(await client.callTool({ name: 'atlas_graph', arguments: { system: 'acme' } }));
  assert.match(graph, /Sistema Acme: 1 nós, 0 ligações, cobertura 60%/);
  assert.match(graph, /API \[api\] · fora do ar · verificado · falha 1 · id s1/);
  assert.match(graph, /Fontes sem atualização recente: railway/);
  assert.equal(seen[0], '/v1/staff/atlas/graph?system=acme');

  const node = textOf(await client.callTool({ name: 'atlas_node', arguments: { ref: 's1' } }));
  assert.match(node, /Se cair: 1 direto\(s\), 0 indireto\(s\) \(Site\)/);
  assert.match(node, /writes_to → Banco/);

  assert.match(textOf(await client.callTool({ name: 'atlas_changes', arguments: {} })), /condition: ok → warn/);
  assert.match(textOf(await client.callTool({ name: 'atlas_insights', arguments: {} })), /\[verificar\] Sem monitoramento/);
});
