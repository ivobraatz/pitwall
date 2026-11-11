'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Atlas, AtlasSystem } from '@/lib/atlas';
import { useAtlas } from '@/lib/atlas';
import { useGitHubRepos, useGraph, useSources, type GitHubRepo, type GraphNode, type SyncResponse } from '@/lib/atlas-graph';
import { Button, Card, ErrorBox, Field, Input, Pill, Select, Shimmer, cn, useToast } from '@/components/ui';
import { NodeDrawer } from '../node-drawer';
import { EvolutionPanel } from '../evolution';
import { useDetailT, useWhen } from '../node-parts';
import type { DetailWord } from '../words';
import { CopyBlock, Frame, Notice, slugify } from './wizard';

// The eight steps of the integration. Each one reads what it needs and writes through the same
// endpoints the rest of the console uses; nothing here is stored in the browser.

const ROLES = ['backend', 'frontend', 'fullstack', 'marketing', 'infra', 'tools', 'mobile', 'docs', 'other'] as const;
const SOURCES = ['github', 'railway', 'vercel', 'kuma', 'cloudflare', 'github-webhook'] as const;
const SOURCE_HOW: Record<string, DetailWord> = {
  github: 'src.howGithub', cloudflare: 'src.howCloudflare', 'github-webhook': 'src.howGithubWebhook',
};

type Props = { system: string; onSystem: (slug: string) => void };

function useInvalidate() {
  const queryClient = useQueryClient();
  return React.useCallback(() => queryClient.invalidateQueries({ queryKey: ['atlas'] }), [queryClient]);
}

function useSystem(atlas: Atlas | undefined, slug: string): AtlasSystem | undefined {
  return React.useMemo(() => atlas?.systems.find((s) => s.slug === slug), [atlas, slug]);
}

/** Runs one write: the API's own message on a refusal, a toast either way, the Atlas read again. */
function useWrite() {
  const t = useDetailT();
  const toast = useToast();
  const invalidate = useInvalidate();
  return React.useCallback(async <T,>(path: string, init: { method?: 'POST' | 'DELETE'; json?: unknown }, done: DetailWord): Promise<T | undefined> => {
    try {
      const res = await api<T>(path, { method: init.method ?? 'POST', json: init.json });
      await invalidate();
      toast('ok', t(done));
      return res;
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : t('error'));
      return undefined;
    }
  }, [t, toast, invalidate]);
}

// ── 1 · Sistema ─────────────────────────────────────────────────────────────────────────

export function StepSystem({ system, onSystem }: Props) {
  const t = useDetailT();
  const atlas = useAtlas();
  const write = useWrite();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const systems = atlas.data?.systems ?? [];

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await write('/staff/atlas/systems', { json: { slug, name } }, 'ob.done');
    setBusy(false);
    if (ok !== undefined) { onSystem(slug); setName(''); setSlug(''); }
  };

  return (
    <Frame step={1} title={t('ob.s1')} hint={t('sys.pick')}>
      {atlas.isLoading ? <Shimmer className="h-24" /> : systems.length === 0 ? <Notice>{t('sys.none')}</Notice> : (
        <ul className="flex flex-col gap-1.5" data-testid="onboarding-systems">
          {systems.map((s) => {
            const picked = s.slug === system;
            return (
              <li key={s.id}>
                <button type="button" onClick={() => onSystem(s.slug)} aria-pressed={picked} data-testid="onboarding-system" data-slug={s.slug}
                  className={cn('flex w-full items-center gap-3 rounded-tile px-4 py-3 text-left transition-colors duration-150', picked ? 'bg-well' : 'hover:bg-hover')}>
                  <span className="min-w-0 flex-1 font-medium text-fg">{s.name}</span>
                  {picked && <Pill tone="ok">{t('sys.selected')}</Pill>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Card title={t('sys.create')}>
        <form className="flex flex-col gap-4 px-5 pb-5" onSubmit={create}>
          <Field label={t('sys.name')}>
            <Input value={name} maxLength={80} required onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)); }} />
          </Field>
          <Field label={t('sys.slug')} hint={t('sys.slugHint')}>
            <Input code value={slug} maxLength={40} required pattern="[a-z0-9-]+" onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={!name || !slug}>{t('sys.create')}</Button></div>
        </form>
      </Card>
    </Frame>
  );
}

// ── 2 · Repositórios ────────────────────────────────────────────────────────────────────

export function StepRepos({ system }: Props) {
  const t = useDetailT();
  const atlas = useAtlas();
  const repos = useGitHubRepos(true);
  const write = useWrite();
  const sys = useSystem(atlas.data, system);
  const graph = useGraph(system || null, null);
  const notConnected = repos.error instanceof ApiError && repos.error.status === 409;
  // The services of this system: the ones this repository can deliver. Retired ones are not offered.
  const services = (graph.data?.nodes ?? []).filter((n) => n.type === 'service' && !n.retiredAt);

  return (
    <Frame step={2} title={t('ob.s2')} hint={t('repo.pickSystem')}>
      {repos.isLoading && <Shimmer className="h-32" />}
      {notConnected && (
        <Notice tone="warn">
          <p className="font-medium" data-testid="onboarding-github-off">{repos.error instanceof ApiError ? repos.error.message : t('repo.connect')}</p>
          <p className="mt-1 text-fg-secondary">{t('repo.connectHow')}</p>
        </Notice>
      )}
      {repos.error && !notConnected && <ErrorBox error={repos.error} onRetry={() => void repos.refetch()} />}
      {repos.data && repos.data.length === 0 && <Notice>{t('repo.none')}</Notice>}
      {repos.data && repos.data.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="onboarding-repos">
          {repos.data.map((r) => <RepoRow key={r.fullName} repo={r} system={sys} services={services} onAssociate={(role, ids) => write(
            '/staff/atlas/repos', { json: { fullName: r.fullName, system: system || undefined, role: role || undefined, services: ids } }, 'ob.done')} />)}
        </ul>
      )}
    </Frame>
  );
}

function RepoRow({ repo, system, services, onAssociate }: {
  repo: GitHubRepo; system: AtlasSystem | undefined; services: GraphNode[]; onAssociate: (role: string, services: string[]) => Promise<unknown>;
}) {
  const t = useDetailT();
  const [role, setRole] = React.useState(repo.role ?? '');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const roleOptions = [{ value: '', label: t('repo.roleNone') }, ...ROLES.map((r) => ({ value: r, label: t(`repo.roles.${r}` as DetailWord) }))];
  const toggle = (id: string, on: boolean) => setPicked((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  return (
    <li className="flex flex-col gap-3 rounded-tile bg-well px-4 py-3" data-testid="onboarding-repo" data-full-name={repo.fullName}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-all text-fg">{repo.fullName}</p>
          <p className="text-[13px] text-fg-muted">{[repo.private ? 'privado' : 'público', repo.archived ? 'arquivado' : null, repo.defaultBranch].filter(Boolean).join(' · ')}</p>
        </div>
        {repo.registered ? (
          <Pill tone="ok">{t('repo.registered')}{repo.system && ` · ${repo.system.name}`}</Pill>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44"><Select aria-label={t('repo.role')} value={role} options={roleOptions} onChange={(e) => setRole(e.target.value)} /></div>
            <Button size="sm" variant="secondary" disabled={!system} loading={busy}
              onClick={async () => { setBusy(true); await onAssociate(role, picked); setBusy(false); }}>{t('repo.associate')}</Button>
          </div>
        )}
      </div>
      {!repo.registered && (
        <fieldset className="flex flex-col gap-1.5" data-testid="onboarding-repo-services">
          <legend className="text-[13px] font-semibold text-fg-secondary">{t('repo.services')}</legend>
          <p className="text-[13px] text-fg-muted">{t('repo.servicesHint')}</p>
          {services.length === 0 ? <p className="text-[13px] text-fg-muted">{t('repo.noServices')}</p> : (
            <ul className="flex flex-wrap gap-2">
              {services.map((s) => (
                <li key={s.id}>
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[14px] text-fg-secondary has-[:checked]:border-btn has-[:checked]:bg-btn has-[:checked]:text-btn-fg">
                    <input type="checkbox" className="sr-only" value={s.id} checked={picked.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
                    {s.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </li>
  );
}

// ── 3 · Ambientes ───────────────────────────────────────────────────────────────────────

export function StepEnvironments(_: Props) {
  const t = useDetailT();
  const atlas = useAtlas();
  const write = useWrite();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const envs = atlas.data?.environments ?? [];
  return (
    <Frame step={3} title={t('ob.s3')} hint={t('env.hint')}>
      <Card title={t('env.list')}>
        {envs.length === 0 ? <p className="px-5 pb-5 text-[14px] text-fg-muted">{t('env.none')}</p> : (
          <ul className="flex flex-wrap gap-2 px-5 pb-5" data-testid="onboarding-envs">
            {envs.map((e) => <li key={e.id}><Pill tone="idle">{e.name} <span className="font-mono opacity-70">{e.slug}</span></Pill></li>)}
          </ul>
        )}
      </Card>
      <Card title={t('env.create')}>
        <form className="flex flex-col gap-4 px-5 pb-5" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await write('/staff/atlas/environments', { json: { slug, name } }, 'ob.done');
          if (ok !== undefined) { setName(''); setSlug(''); }
        }}>
          <Field label={t('sys.name')}><Input value={name} maxLength={60} required onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)); }} /></Field>
          <Field label={t('sys.slug')} hint={t('sys.slugHint')}><Input code value={slug} maxLength={40} required pattern="[a-z0-9-]+" onChange={(e) => setSlug(e.target.value)} /></Field>
          <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!name || !slug}>{t('env.create')}</Button></div>
        </form>
      </Card>
    </Frame>
  );
}

// ── 4 · Fontes ──────────────────────────────────────────────────────────────────────────

export function StepSources(_: Props) {
  const t = useDetailT();
  const when = useWhen();
  const sources = useSources();
  return (
    <Frame step={4} title={t('ob.s4')} hint={t('src.howGeneric')}>
      {sources.isLoading && <Shimmer className="h-40" />}
      {sources.error && <ErrorBox error={sources.error} onRetry={() => void sources.refetch()} />}
      {sources.data && (
        <ul className="flex flex-col gap-2" data-testid="onboarding-sources">
          {SOURCES.map((name) => {
            const s = sources.data?.find((x) => x.name === name);
            const connected = !!s?.connected;
            return (
              <li key={name} data-source={name} data-connected={connected} className="flex flex-col gap-2 rounded-tile bg-well px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{name}</span>
                  <Pill tone={!connected ? 'idle' : s?.stale ? 'warn' : 'ok'}>
                    {!connected ? t('src.off') : s?.stale ? t('src.stale') : t('src.connected')}
                  </Pill>
                  {s?.lastOkAt && <span className="text-[13px] text-fg-muted">{t('src.lastOk', { when: when(s.lastOkAt) })}</span>}
                  {s?.lastError && <span className="text-[13px] text-danger">{t('src.error', { error: s.lastError })}</span>}
                </div>
                {!connected && (
                  <p className="text-[13px] text-fg-secondary"><span className="font-medium text-fg">{t('src.how')}:</span> {t(SOURCE_HOW[name] ?? 'src.howGeneric')}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
}

// ── 5 · Descoberta ──────────────────────────────────────────────────────────────────────

export function StepDiscovery({ system }: Props) {
  const t = useDetailT();
  const atlas = useAtlas();
  const invalidate = useInvalidate();
  const toast = useToast();
  const sys = useSystem(atlas.data, system);
  const repos = (atlas.data?.repos ?? []).filter((r) => sys && r.productId === sys.id);
  const [results, setResults] = React.useState<Record<string, SyncResponse | string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);

  const scan = async (id: string) => {
    setBusy(id);
    try {
      const res = await api<SyncResponse>(`/staff/atlas/repos/${id}/scan`, { method: 'POST' });
      setResults((r) => ({ ...r, [id]: res }));
      await invalidate();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : t('error');
      setResults((r) => ({ ...r, [id]: message }));
      toast('error', message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Frame step={5} title={t('scan.title')} hint={t('scan.hint')}>
      {!sys && <Notice>{t('ob.pickFirst')}</Notice>}
      {sys && repos.length === 0 && <Notice>{t('scan.none')}</Notice>}
      {repos.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="onboarding-scan">
          {repos.map((r) => {
            const res = results[r.id];
            return (
              <li key={r.id} data-repo={r.fullName} className="flex flex-col gap-2 rounded-tile bg-well px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 font-medium break-all text-fg">{r.fullName}</span>
                  <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => void scan(r.id)}>{t('scan.run')}</Button>
                </div>
                {typeof res === 'string' && <p role="status" className="text-[13px] text-danger">{res}</p>}
                {res && typeof res !== 'string' && (
                  <div className="text-[14px] text-fg" data-testid="onboarding-scan-result">
                    <p>{t('scan.done', { created: res.created.length, updated: res.updated.length, gone: res.gone.length })}</p>
                    {res.rejected.length > 0 && <p className="text-[13px] text-fg-muted">{t('scan.rejected', { n: res.rejected.length })}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
}

// ── 6 · Validar ─────────────────────────────────────────────────────────────────────────

export function StepValidate({ system }: Props) {
  const t = useDetailT();
  const atlas = useAtlas();
  const graph = useGraph(system, null);
  const write = useWrite();
  const [opened, setOpened] = React.useState<string | null>(null);
  const sys = useSystem(atlas.data, system);
  const envSlug = React.useMemo(() => new Map((atlas.data?.environments ?? []).map((e) => [e.id, e.slug])), [atlas.data]);
  const nodes = (graph.data?.nodes ?? []).filter((n) => n.type === 'service' && sys && n.productId === sys.id
    && (n.origin === 'discovered' || n.origin === 'reported'));

  const confirm = (n: GraphNode) => {
    const environment = n.environmentId ? envSlug.get(n.environmentId) : undefined;
    if (!environment || !sys) return;
    void write('/staff/atlas/services', { json: { system: sys.slug, environment, name: n.name, kind: n.kind, origin: 'declared' } }, 'val.confirmed');
  };

  return (
    <Frame step={6} title={t('val.title')} hint={t('val.hint')}>
      {!sys && <Notice>{t('ob.pickFirst')}</Notice>}
      {graph.isLoading && <Shimmer className="h-32" />}
      {sys && !graph.isLoading && nodes.length === 0 && <Notice>{t('val.none')}</Notice>}
      {nodes.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="onboarding-validate">
          {nodes.map((n) => (
            <li key={n.id} data-node-id={n.id} className="flex flex-col gap-2 rounded-tile bg-well px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => setOpened(n.id)} data-testid="onboarding-node" className="text-left font-medium text-fg underline-offset-2 hover:underline">{n.name}</button>
                <p className="text-[13px] text-fg-muted">{n.kind} · {n.environment ?? t('noEnv')} · {t(`origin.${n.origin}` as DetailWord)}</p>
              </div>
              {n.retiredAt ? <Pill tone="idle">{t('val.retired')}</Pill> : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => confirm(n)} disabled={!n.environmentId}>{t('val.confirm')}</Button>
                  <Button size="sm" variant="danger" onClick={() => void write(`/staff/atlas/services/${n.id}`, { method: 'DELETE' }, 'toast.retired')}>{t('act.retire')}</Button>
                  {!n.environmentId && <span className="basis-full text-[12px] text-fg-subtle">{t('val.noEnv')}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <NodeDrawer nodeId={opened} onClose={() => setOpened(null)} onNode={setOpened} />
    </Frame>
  );
}

// ── 7 · Mapa e cobertura ────────────────────────────────────────────────────────────────

export function StepMap({ system }: Props) {
  const t = useDetailT();
  const graph = useGraph(system, null);
  const coverage = graph.data?.coverage;
  const [opened, setOpened] = React.useState<string | null>(null);
  const since = React.useMemo(() => new Date(Date.now() - 7 * 86400_000).toISOString(), []);
  if (!system) return <Frame step={7} title={t('ob.s7')}><Notice>{t('ob.pickFirst')}</Notice></Frame>;
  return (
    <Frame step={7} title={t('ob.s7')}>
      {graph.isLoading && <Shimmer className="h-48" />}
      {coverage && (
        <Card title={t('cov.title')} actions={<Pill tone={coverage.percent >= 80 ? 'ok' : 'warn'}>{t('ob.coverage', { percent: coverage.percent })}</Pill>}>
          <ul className="flex flex-col divide-y divide-border-subtle px-5 pb-3" data-testid="onboarding-coverage-checks">
            {coverage.checks.map((c) => (
              <li key={c.key} data-check={c.key} data-ok={c.ok} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                <span className="text-fg">{t(`cov.${c.key}` as DetailWord)}</span>
                <Pill tone={!c.applicable ? 'idle' : c.ok ? 'ok' : 'warn'}>
                  {!c.applicable ? t('cov.na') : c.ok ? t('cov.ok') : t('cov.missing')}
                </Pill>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div><Link href={`/atlas?system=${encodeURIComponent(system)}`} className="inline-flex h-10 items-center rounded-full border border-border bg-surface px-5 text-[14px] font-semibold text-fg transition-colors hover:bg-hover">{t('cov.openMap')}</Link></div>
      <section className="flex flex-col gap-3" aria-label={t('ev.title')}>
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-fg">{t('ev.title')}</h3>
        <EvolutionPanel system={system} since={since} onNode={setOpened} />
      </section>
      <NodeDrawer nodeId={opened} onClose={() => setOpened(null)} onNode={setOpened} />
    </Frame>
  );
}

// ── 8 · Agentes ─────────────────────────────────────────────────────────────────────────

const LOGIN = 'npx -y -p pitwall-mcp pitwall-atlas login --url https://pitwall.example.com --token <token-de-pessoa>';
const HOOKS = 'npx -y -p pitwall-mcp pitwall-atlas install-hooks --claude --git';

export function StepAgents({ system }: Props) {
  const t = useDetailT();
  const ci = [
    '# .github/workflows/atlas.yml',
    'on:',
    '  push:',
    '    branches: [main]',
    'jobs:',
    '  atlas:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: ./.github/actions/atlas-sync',
    '        with:',
    '          pitwall-url: https://pitwall.example.com',
    '          token: ${{ secrets.PITWALL_ATLAS_TOKEN }}',
    `          system: ${system || 'acme'}`,
  ].join('\n');
  return (
    <Frame step={8} title={t('agents.title')} hint={t('agents.hint')}>
      <Card title={t('agents.login')}><div className="px-5 pb-5"><CopyBlock text={LOGIN} /></div></Card>
      <Card title={t('agents.hooks')}><div className="px-5 pb-5"><CopyBlock text={HOOKS} /></div></Card>
      <Card title={t('agents.ci')}><div className="px-5 pb-5"><CopyBlock text={ci} /></div></Card>
    </Frame>
  );
}
