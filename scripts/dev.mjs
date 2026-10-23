// One command for the whole local stack: Postgres, API, console and (unless --no-demo) the demo product.
//   corepack pnpm dev            Ctrl+C stops everything this script started
// Anything already listening on its port (e.g. an API you left running) is reused, not started twice.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const withDemo = !process.argv.includes('--no-demo');
const children = [];

const listening = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

async function waitFor(port, label, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await listening(port)) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`${label} did not open port ${port} in ${ms / 1000}s`);
}

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function start(name, cmd, args, cwd = root, env = {}) {
  const child = spawn(cmd, args, { cwd, shell: win, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}]`.padEnd(10);
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(`${tag}${l}`);
    });
  }
  child.on('exit', (code) => console.log(`${tag}saiu (${code})`));
  children.push(child);
}

function stopAll() {
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue;
    if (win) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F']); else c.kill('SIGTERM');
  }
}
process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

try {
  console.log('→ Postgres');
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);

  if (!existsSync(path.join(root, 'node_modules'))) run('corepack', ['pnpm', 'install']);
  if (!existsSync(path.join(root, 'packages/sdk/dist/index.js'))) { console.log('→ build do SDK'); run('corepack', ['pnpm', '--filter', '@pitwall/sdk', 'build']); }

  if (await listening(5180)) console.log('→ API já está em :5180, reaproveitando');
  else start('api', 'dotnet', ['run', '--project', 'apps/api/Pitwall.Api']);
  await waitFor(5180, 'API');

  if (await listening(3200)) console.log('→ console já está em :3200, reaproveitando');
  else start('console', 'corepack', ['pnpm', '--filter', '@pitwall/console', 'dev']);

  if (withDemo) {
    const demo = path.join(root, 'examples/demo-product');
    if (!existsSync(path.join(demo, '.env'))) { console.log('→ cadastrando o sistema demo'); run('node', ['setup.mjs'], demo); }
    if (await listening(4300)) console.log('→ demo já está em :4300, reaproveitando');
    else {
      // The demo's own "pnpm dev" calls plain pnpm, which is often not on PATH (corepack only): run its steps directly.
      run('corepack', ['pnpm', 'build'], demo);
      start('demo', 'node', ['--env-file-if-exists=.env', 'server.mjs'], demo);
    }
  }

  await waitFor(3200, 'console');
  if (withDemo) await waitFor(4300, 'demo');
  console.log(`
  Tudo no ar:
    console  http://localhost:3200   admin@pitwall.local / pitwall-dev-password
    API      http://localhost:5180${withDemo ? '\n    demo     http://localhost:4300' : ''}
  Ctrl+C para parar.
`);
  setInterval(() => {}, 1 << 30); // keep running until Ctrl+C
} catch (e) {
  console.error(e.message);
  stopAll();
  process.exit(1);
}
