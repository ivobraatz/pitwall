'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Atlas, Discovery, Routine } from '@/lib/atlas';
import { Button, Check, Dialog, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { useWords } from './parts';
import type { AtlasWord } from './words';

export type FormKind = 'system' | 'service' | 'repo' | 'link' | 'routine' | 'import';
export type FormState =
  | { kind: Exclude<FormKind, 'routine' | 'service'> }
  | { kind: 'service'; discovery?: Discovery }
  | { kind: 'routine'; routine?: Routine };

const KINDS = ['api', 'web', 'worker', 'database', 'site', 'other'];

/** Posts, toasts, refreshes the Atlas and closes. The message of a refusal is the API's own. */
function useSubmit(onDone: () => void) {
  const t = useWords();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const submit = async (path: string, json: unknown, done: AtlasWord = 'saved') => {
    setBusy(true);
    try {
      const res = await api<unknown>(path, { method: 'POST', json });
      await queryClient.invalidateQueries({ queryKey: ['atlas'] });
      toast('ok', t(done));
      onDone();
      return res;
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : t('error'));
      return undefined;
    } finally { setBusy(false); }
  };
  return { busy, submit };
}

function Actions({ busy, onCancel, disabled, label }: { busy: boolean; onCancel: () => void; disabled?: boolean; label?: string }) {
  const t = useWords();
  return (
    <div className="mt-2 flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>{t('action.cancel')}</Button>
      <Button type="submit" variant="primary" loading={busy} disabled={disabled}>{label ?? t('action.save')}</Button>
    </div>
  );
}

function useSystemOptions(atlas: Atlas, none?: string) {
  return React.useMemo(() => [
    ...(none !== undefined ? [{ value: '', label: none }] : []),
    ...atlas.systems.map((s) => ({ value: s.slug, label: s.name })),
  ], [atlas.systems, none]);
}

function SystemForm({ onClose }: { onClose: () => void }) {
  const t = useWords();
  const { busy, submit } = useSubmit(onClose);
  const [f, setF] = React.useState({ slug: '', name: '', description: '', websiteUrl: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => {
      e.preventDefault();
      void submit('/staff/atlas/systems', { slug: f.slug, name: f.name, description: f.description || undefined, websiteUrl: f.websiteUrl || undefined });
    }}>
      <Field label={t('field.name')}><Input value={f.name} maxLength={80} required autoFocus onChange={(e) => setF((v) => ({
        ...v, name: e.target.value,
        slug: v.slug === slugOf(v.name) ? slugOf(e.target.value) : v.slug,
      }))} /></Field>
      <Field label={t('field.slug')} hint={t('field.slugHint')}><Input code value={f.slug} maxLength={40} required pattern="[a-z0-9-]+" onChange={set('slug')} /></Field>
      <Field label={t('field.description')}><Input value={f.description} maxLength={1000} onChange={set('description')} /></Field>
      <Field label={t('field.site')}><Input code type="url" value={f.websiteUrl} placeholder="https://" onChange={set('websiteUrl')} /></Field>
      <Actions busy={busy} onCancel={onClose} />
    </form>
  );
}

function slugOf(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function ServiceForm({ atlas, discovery, onClose }: { atlas: Atlas; discovery?: Discovery; onClose: () => void }) {
  const t = useWords();
  const { busy, submit } = useSubmit(onClose);
  const systems = useSystemOptions(atlas, discovery ? undefined : t('field.shared'));
  const monitor = discovery?.kind === 'monitor';
  const [f, setF] = React.useState({
    system: discovery ? (atlas.systems[0]?.slug ?? '') : (atlas.systems[0]?.slug ?? ''),
    environment: discovery?.environment?.toLowerCase().replaceAll(' ', '-') ?? atlas.environments[0]?.slug ?? 'production',
    name: discovery ? (discovery.name.split('/').pop() ?? discovery.name) : '',
    kind: 'api', provider: '', externalRef: '', url: '', monitor: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const shared = f.system === '';
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => {
      e.preventDefault();
      if (discovery) {
        void submit(`/staff/atlas/discoveries/${discovery.id}/register`, { system: f.system, environment: f.environment, name: f.name, kind: f.kind });
        return;
      }
      void submit('/staff/atlas/services', {
        system: f.system || undefined, environment: shared ? undefined : f.environment, name: f.name, kind: shared ? 'external' : f.kind,
        provider: f.provider || undefined, externalRef: f.externalRef || undefined, url: f.url || undefined, monitor: f.monitor || undefined,
      });
    }}>
      {discovery && <p className="bg-well px-3 py-2 text-[14px] text-fg-secondary"><span className="font-semibold text-fg">{discovery.source}</span> · {discovery.name}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('field.system')}><Select value={f.system} onChange={set('system')} options={systems} className="w-full" /></Field>
        {!shared && <Field label={t('field.environment')}><Input code value={f.environment} maxLength={40} required list="atlas-envs" onChange={set('environment')} /></Field>}
      </div>
      <datalist id="atlas-envs">{atlas.environments.map((e) => <option key={e.id} value={e.slug} />)}</datalist>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('field.name')}><Input value={f.name} maxLength={120} required onChange={set('name')} /></Field>
        {!shared && <Field label={t('field.kind')}><Select value={f.kind} onChange={set('kind')} options={KINDS.map((k) => ({ value: k, label: k }))} className="w-full" /></Field>}
      </div>
      {!discovery && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('field.provider')} hint={t('field.providerHint')}><Input value={f.provider} maxLength={40} onChange={set('provider')} /></Field>
            <Field label={t('field.ref')} hint={t('field.refHint')}><Input code value={f.externalRef} maxLength={300} onChange={set('externalRef')} /></Field>
          </div>
          <Field label={t('field.url')}><Input code type="url" value={f.url} placeholder="https://" onChange={set('url')} /></Field>
          <Field label={t('field.monitor')} hint={t('field.monitorHint')}><Input value={f.monitor} maxLength={200} onChange={set('monitor')} /></Field>
        </>
      )}
      {discovery && monitor && <p className="text-[13px] text-fg-muted">{t('field.monitorHint')}</p>}
      <Actions busy={busy} onCancel={onClose} disabled={!!discovery && !f.system} label={discovery ? t('action.register') : undefined} />
    </form>
  );
}

function RepoForm({ atlas, onClose }: { atlas: Atlas; onClose: () => void }) {
  const t = useWords();
  const { busy, submit } = useSubmit(onClose);
  const systems = useSystemOptions(atlas, '—');
  const [fullName, setFullName] = React.useState('');
  const [system, setSystem] = React.useState(atlas.systems[0]?.slug ?? '');
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit('/staff/atlas/repos', { fullName, system: system || undefined }); }}>
      <Field label={t('field.repo')} hint={t('field.repoHint')}><Input code value={fullName} required autoFocus maxLength={200} onChange={(e) => setFullName(e.target.value)} /></Field>
      <Field label={t('field.system')}><Select value={system} onChange={(e) => setSystem(e.target.value)} options={systems} className="w-full" /></Field>
      <Actions busy={busy} onCancel={onClose} />
    </form>
  );
}

function LinkForm({ atlas, onClose }: { atlas: Atlas; onClose: () => void }) {
  const t = useWords();
  const { busy, submit } = useSubmit(onClose);
  const options = React.useMemo(() => {
    const system = new Map(atlas.systems.map((s) => [s.id, s.name]));
    const env = new Map(atlas.environments.map((e) => [e.id, e.name]));
    return atlas.services.map((s) => ({
      value: s.id,
      label: [s.productId ? system.get(s.productId) : null, s.environmentId ? env.get(s.environmentId) : null, s.name].filter(Boolean).join(' · '),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [atlas]);
  const [from, setFrom] = React.useState(options[0]?.value ?? '');
  const [to, setTo] = React.useState(options[1]?.value ?? '');
  const [label, setLabel] = React.useState('');
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit('/staff/atlas/links', { from, to, label: label || undefined }); }}>
      <Field label={t('field.from')}><Select value={from} onChange={(e) => setFrom(e.target.value)} options={options} className="w-full" /></Field>
      <Field label={t('field.to')}><Select value={to} onChange={(e) => setTo(e.target.value)} options={options} className="w-full" /></Field>
      <Field label={t('field.label')}><Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Actions busy={busy} onCancel={onClose} disabled={!from || !to || from === to} />
    </form>
  );
}

function RoutineForm({ atlas, routine, onClose }: { atlas: Atlas; routine?: Routine; onClose: () => void }) {
  const t = useWords();
  const { busy, submit } = useSubmit(onClose);
  const systems = useSystemOptions(atlas, t('routine.all'));
  const [f, setF] = React.useState({
    slug: routine?.slug ?? '', name: routine?.name ?? '', frequency: routine?.frequency ?? 'daily', system: routine?.system?.slug ?? '',
    description: routine?.description ?? '', prompt: routine?.prompt ?? '', enabled: routine?.enabled ?? true,
  });
  const set = (k: 'slug' | 'frequency' | 'system' | 'description' | 'prompt') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit('/staff/atlas/routines', f); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('field.name')}><Input value={f.name} required maxLength={120} autoFocus={!routine} onChange={(e) => setF((v) => ({
          ...v, name: e.target.value, slug: !routine && v.slug === slugOf(v.name) ? slugOf(e.target.value) : v.slug,
        }))} /></Field>
        <Field label={t('field.slug')} hint={t('field.slugHint')}><Input code value={f.slug} required maxLength={60} pattern="[a-z0-9-]+" disabled={!!routine} onChange={set('slug')} /></Field>
        <Field label={t('field.frequency')}>
          <Select value={f.frequency} onChange={set('frequency')} className="w-full"
            options={(['daily', 'weekly', 'monthly'] as const).map((v) => ({ value: v, label: t(`freq1.${v}` as AtlasWord) }))} />
        </Field>
        <Field label={t('field.system')}><Select value={f.system} onChange={set('system')} options={systems} className="w-full" /></Field>
      </div>
      <Field label={t('field.what')}><Input value={f.description} maxLength={1000} onChange={set('description')} /></Field>
      <Field label={t('field.prompt')}><Textarea value={f.prompt} rows={9} maxLength={20000} onChange={set('prompt')} /></Field>
      <Check checked={f.enabled} onChange={(enabled) => setF((v) => ({ ...v, enabled }))}>{t('field.enabled')}</Check>
      <Actions busy={busy} onCancel={onClose} />
    </form>
  );
}

interface ImportResult { systems: number; services: number; links: number; repos: number; routines: number }

/** A whole map from a file picked at this moment: checked first (nothing saved), then loaded. */
function ImportForm({ onClose }: { onClose: () => void }) {
  const t = useWords();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = React.useState<unknown>(null);
  const [checked, setChecked] = React.useState<ImportResult | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setChecked(null); setErrors([]); setFile(null);
    const picked = e.target.files?.[0];
    if (!picked) return;
    try { setFile(JSON.parse(await picked.text())); } catch { setErrors([t('import.invalid')]); }
  };
  const run = async (dryRun: boolean) => {
    setBusy(true); setErrors([]);
    try {
      const res = await api<ImportResult>('/staff/atlas/import', { method: 'POST', json: file, params: { dryRun } });
      if (dryRun) setChecked(res);
      else { await queryClient.invalidateQueries({ queryKey: ['atlas'] }); toast('ok', t('import.summary', { ...res })); onClose(); }
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { errors?: string[] } | undefined) : undefined;
      setErrors(body?.errors?.length ? body.errors : [e instanceof Error ? e.message : t('error')]);
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-[1.5] text-fg-secondary">{t('import.hint')}</p>
      <Field label={t('field.file')}><input type="file" accept="application/json,.json" onChange={pick} className="text-[14px] text-fg-secondary" /></Field>
      {checked && <p className="bg-well px-3 py-2 text-[14px] text-fg">{t('import.summary', { ...checked })}</p>}
      {errors.length > 0 && (
        <ul className="max-h-48 overflow-y-auto bg-danger/12 px-3 py-2 text-[13px] text-fg">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('action.cancel')}</Button>
        {checked ? <Button variant="primary" loading={busy} onClick={() => run(false)}>{t('import.apply')}</Button>
          : <Button variant="primary" loading={busy} disabled={!file} onClick={() => run(true)}>{t('import.check')}</Button>}
      </div>
    </div>
  );
}

export function AtlasForm({ state, atlas, onClose }: { state: FormState | null; atlas: Atlas; onClose: () => void }) {
  const t = useWords();
  if (!state) return null;
  const title = state.kind === 'import' ? t('action.import')
    : state.kind === 'service' && state.discovery ? t('discovery.title')
    : t(`action.${state.kind}` as AtlasWord);
  return (
    <Dialog open onClose={onClose} title={title}>
      {state.kind === 'system' && <SystemForm onClose={onClose} />}
      {state.kind === 'service' && <ServiceForm atlas={atlas} discovery={state.discovery} onClose={onClose} />}
      {state.kind === 'repo' && <RepoForm atlas={atlas} onClose={onClose} />}
      {state.kind === 'link' && <LinkForm atlas={atlas} onClose={onClose} />}
      {state.kind === 'routine' && <RoutineForm atlas={atlas} routine={state.routine} onClose={onClose} />}
      {state.kind === 'import' && <ImportForm onClose={onClose} />}
    </Dialog>
  );
}
