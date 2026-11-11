'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useNode, type AttentionClass, type GraphNode } from '@/lib/atlas-graph';
import { Button, ErrorBox, Field, IconButton, IconClose, Input, Pill, Shimmer, cn, useToast } from '@/components/ui';
import { StateLabel, useWords } from '@/components/atlas/parts';
import type { AtlasWord } from '@/components/atlas/words';
import {
  ChangeList, ChangeSetList, ClassPill, EdgeList, EventList, EvidenceList, FactList, ImpactList, ProcessList, RefList, RepoList, ScopeLine,
  Section, VerificationLine, useDetailT, useStamp, useWhen,
} from './node-parts';
import type { DetailWord } from './words';

// The node, opened: a panel at the right on a desktop, a sheet from the bottom on a phone. Escape
// closes the innermost thing first (a dialog of the drawer, then the drawer). Every write goes to
// the API as the person, then refreshes the whole Atlas.

const CLASS_ORDER: AttentionClass[] = ['failure', 'security', 'task', 'improvement', 'config', 'unverified'];
const TASK_CODE = /^T-[A-Z0-9]{4,8}$/;

type Modal = 'rename' | 'link' | 'retire' | null;

export interface NodeDrawerProps {
  nodeId: string | null;
  onClose: () => void;
  onNode: (id: string) => void;
}

export function NodeDrawer({ nodeId, onClose, onNode }: NodeDrawerProps) {
  const t = useDetailT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useNode(nodeId);
  const asideRef = React.useRef<HTMLElement>(null);
  const [modal, setModal] = React.useState<Modal>(null);
  const [busy, setBusy] = React.useState(false);
  const modalRef = React.useRef<Modal>(null);
  modalRef.current = modal;

  React.useEffect(() => { setModal(null); }, [nodeId]);
  React.useEffect(() => { if (nodeId) asideRef.current?.focus(); }, [nodeId]);
  React.useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalRef.current) setModal(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, onClose]);

  if (!nodeId) return null;

  const detail = query.data;
  const node = detail?.node;

  /** One write on this service, then the whole Atlas is read again (the node's own query too). */
  const write = async (method: 'POST' | 'DELETE', suffix: string, json: unknown, done: DetailWord) => {
    if (!node) return false;
    setBusy(true);
    try {
      await api(`/staff/atlas/services/${node.id}${suffix}`, { method, json });
      await queryClient.invalidateQueries({ queryKey: ['atlas'] });
      toast('ok', t(done));
      return true;
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : t('error'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const title = node?.name ?? '';
  const subtitle = node && [
    node.kind,
    t(`engine.${node.engine}` as DetailWord),
    detail?.system?.name ?? t('shared'),
    node.environment ?? t('noEnv'),
  ].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-scrim sm:justify-end" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={asideRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="atlas-node-title" data-testid="atlas-node-drawer"
        className="flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-panel bg-overlay shadow-popover outline-none sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:max-h-none sm:w-[34rem] sm:rounded-panel">
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id="atlas-node-title" className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] break-words text-fg">{title || '…'}</h2>
            {subtitle && <p className="mt-1 text-[13px] text-fg-muted">{subtitle}</p>}
          </div>
          <IconButton size={36} onClick={onClose} aria-label={t('close')}><IconClose /></IconButton>
        </header>

        <div className="flex flex-col gap-3 px-5 pt-1 pb-6">
          {query.isLoading && <Shimmer className="h-40" />}
          {query.error && <ErrorBox error={query.error} onRetry={() => void query.refetch()} />}
          {detail && node && (
            <>
              {node.retiredAt && <Banner tone="idle" text={t('retired.banner', { when: formatWhen(node.retiredAt) })} />}
              {!node.retiredAt && node.removalReportedAt && <Banner tone="warn" text={t('removal.banner', { when: formatWhen(node.removalReportedAt) })} />}

              <StatusRow node={node} />

              <section className="rounded-tile bg-well px-4 py-3" aria-label={t('verify.label')}>
                <VerificationLine node={node} />
                <div className="mt-2 flex flex-col gap-1.5"><ScopeLine scope={node.codeScope} /></div>
              </section>

              {(node.facts.length > 0 || node.stack.length > 0) && (
                <Section label={t('sec.facts')} testId="atlas-node-sec-facts">
                  <FactList facts={[...node.facts, ...node.stack]} />
                </Section>
              )}
              {node.items.length > 0 && (
                <Section label={t('sec.items')} testId="atlas-node-sec-items">
                  <ul className="flex flex-wrap gap-1.5">{node.items.map((i) => <li key={i} className="rounded-full bg-surface px-3 py-1 text-[14px] text-fg-secondary">{i}</li>)}</ul>
                </Section>
              )}
              {node.notes && (
                <Section label={t('sec.notes')} open={false} testId="atlas-node-sec-notes">
                  <p className="whitespace-pre-wrap">{node.notes}</p>
                </Section>
              )}

              <Section label={t('sec.deps')} count={detail.incoming.length + detail.outgoing.length} testId="atlas-node-sec-deps">
                <div className="flex flex-col gap-3">
                  <div><p className="mb-1 text-[13px] text-fg-muted">{t('deps.in')}</p><EdgeList items={detail.incoming} direction="in" onNode={onNode} /></div>
                  <div><p className="mb-1 text-[13px] text-fg-muted">{t('deps.out')}</p><EdgeList items={detail.outgoing} direction="out" onNode={onNode} /></div>
                </div>
              </Section>

              <Section label={t('sec.impact')} count={detail.impact.direct.length + detail.impact.indirect.length} testId="atlas-node-sec-impact">
                <ImpactList impact={detail.impact} onNode={onNode} />
              </Section>

              <Section label={t('sec.refs')} count={detail.refs.length} testId="atlas-node-sec-refs">
                <RefList items={detail.refs} />
              </Section>

              <Section label={t('sec.evidence')} count={detail.evidence.length} testId="atlas-node-sec-evidence">
                <EvidenceList items={detail.evidence} />
              </Section>

              <Section label={t('sec.events')} count={detail.events.length} open={false} testId="atlas-node-sec-events">
                <EventList items={detail.events} />
              </Section>

              <Section label={t('sec.changes')} count={detail.changes.length} open={false} testId="atlas-node-sec-changes">
                <ChangeList items={detail.changes} />
              </Section>

              {detail.repos.length > 0 && (
                <Section label={t('sec.repos')} count={detail.repos.length} open={false} testId="atlas-node-sec-repos">
                  <RepoList items={detail.repos} />
                </Section>
              )}
              <Section label={t('sec.processes')} count={detail.processes.length} open={false} testId="atlas-node-sec-processes">
                <ProcessList items={detail.processes} />
              </Section>
              <Section label={t('sec.changesets')} count={detail.changeSets.length} open={false} testId="atlas-node-sec-changesets">
                <ChangeSetList items={detail.changeSets} />
              </Section>

              <Actions
                node={node}
                providerUrl={detail.providerUrl ?? node.url}
                busy={busy}
                onRename={() => setModal('rename')}
                onLink={() => setModal('link')}
                onRetire={() => setModal('retire')}
                onConfirmRemoval={() => void write('POST', '/confirm-removal', {}, 'toast.removalConfirmed')}
                onRestore={() => void write('POST', '/restore', {}, 'toast.restored')}
              />
            </>
          )}
        </div>
      </aside>

      {modal === 'rename' && node && (
        <Sheet title={t('rename.title')} onClose={() => setModal(null)}>
          <RenameForm initial={node.name} busy={busy} onCancel={() => setModal(null)}
            onSubmit={async (name) => { if (await write('POST', '/rename', { name }, 'toast.renamed')) setModal(null); }} />
        </Sheet>
      )}
      {modal === 'link' && node && (
        <Sheet title={t('link.title')} onClose={() => setModal(null)}>
          <LinkForm busy={busy} onCancel={() => setModal(null)}
            onSubmit={async (code) => { if (await write('POST', '/refs', { kind: 'task', code }, 'toast.linked')) setModal(null); }} />
        </Sheet>
      )}
      {modal === 'retire' && node && (
        <Sheet title={t('retire.title')} onClose={() => setModal(null)}>
          <p className="text-[14px] text-fg-secondary">{t('retire.body')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setModal(null)}>{t('act.cancel')}</Button>
            <Button type="button" variant="danger" loading={busy}
              onClick={async () => { if (await write('DELETE', '', undefined, 'toast.retired')) setModal(null); }}>{t('act.retire')}</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Banner({ tone, text }: { tone: 'idle' | 'warn'; text: string }) {
  return (
    <p role="status" className={cn('rounded-tile px-4 py-2.5 text-[14px] text-fg', tone === 'warn' ? 'bg-warning/10' : 'bg-well')}>{text}</p>
  );
}

const CONDITION_TONE: Record<GraphNode['condition'], string> = { ok: 'idle', warn: 'warn', gap: 'warn', planned: 'info', local: 'idle' };

function StatusRow({ node }: { node: GraphNode }) {
  const t = useDetailT();
  const words = useWords();
  const counts = CLASS_ORDER.filter((c) => node.attention[c] > 0);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="atlas-node-status">
      <StateLabel state={node.state} />
      <Pill tone={CONDITION_TONE[node.condition]}>{words(`cond.${node.condition}` as AtlasWord)}</Pill>
      <Pill tone="idle">{t(`origin.${node.origin}` as DetailWord)}</Pill>
      {counts.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5" data-attention={c}>
          <ClassPill cls={c} /><span className="text-[13px] font-semibold tabular-nums text-fg">{node.attention[c]}</span>
        </span>
      ))}
    </div>
  );
}

function Actions({ node, providerUrl, busy, onRename, onLink, onRetire, onConfirmRemoval, onRestore }: {
  node: GraphNode; providerUrl: string | null; busy: boolean;
  onRename: () => void; onLink: () => void; onRetire: () => void; onConfirmRemoval: () => void; onRestore: () => void;
}) {
  const t = useDetailT();
  const isService = node.type === 'service';
  return (
    <div className="mt-1 flex flex-wrap gap-2" data-testid="atlas-node-actions">
      {providerUrl && (
        <a href={providerUrl} target="_blank" rel="noreferrer"
          className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-fg transition-colors hover:bg-hover">
          {t('act.provider')}
        </a>
      )}
      {isService && !node.retiredAt && (
        <>
          <Button size="sm" variant="secondary" onClick={onRename} disabled={busy}>{t('act.rename')}</Button>
          <Button size="sm" variant="secondary" onClick={onLink} disabled={busy}>{t('act.link')}</Button>
          {node.removalReportedAt && <Button size="sm" variant="primary" onClick={onConfirmRemoval} loading={busy}>{t('act.confirmRemoval')}</Button>}
          <Button size="sm" variant="danger" onClick={onRetire} disabled={busy}>{t('act.retire')}</Button>
        </>
      )}
      {isService && node.retiredAt && <Button size="sm" variant="primary" onClick={onRestore} loading={busy}>{t('act.restore')}</Button>}
    </div>
  );
}

/** A small dialog of its own (not window.prompt): the drawer's Escape leaves it first. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim p-3 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-panel bg-overlay p-5 shadow-popover">
        <h3 className="mb-3 text-[18px] font-semibold tracking-[-0.015em] text-fg">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function RenameForm({ initial, busy, onCancel, onSubmit }: { initial: string; busy: boolean; onCancel: () => void; onSubmit: (name: string) => void }) {
  const t = useDetailT();
  const [name, setName] = React.useState(initial);
  const clean = name.trim();
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (clean && clean !== initial) onSubmit(clean); }}>
      <Field label={t('rename.label')} hint={t('rename.hint')}>
        <Input value={name} maxLength={160} autoFocus required onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t('act.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!clean || clean === initial}>{t('act.save')}</Button>
      </div>
    </form>
  );
}

function LinkForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (code: string) => void }) {
  const t = useDetailT();
  const [code, setCode] = React.useState('');
  const clean = code.trim().toUpperCase();
  const valid = TASK_CODE.test(clean);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(clean); }}>
      <Field label={t('link.label')} hint={code && !valid ? t('link.invalid') : t('link.hint')}>
        <Input code value={code} maxLength={16} autoFocus required placeholder="T-XXXXX" onChange={(e) => setCode(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>{t('act.cancel')}</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!valid}>{t('act.save')}</Button>
      </div>
    </form>
  );
}
