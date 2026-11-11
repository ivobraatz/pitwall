'use client';

import * as React from 'react';
import Link from 'next/link';
import { ago, useLocale, useT } from '@/lib/i18n';
import type {
  AtlasChangeDto, AtlasEventDto, AttentionClass, ChangeSetDto, Evidence, FieldChange, GraphEdge, GraphNode, NodeDetail, NodeRef, NodeRefLink,
} from '@/lib/atlas-graph';
import { IconChevron, Pill, cn } from '@/components/ui';
import { StateGlyph } from '@/components/atlas/parts';
import { DETAIL_WORDS, type DetailWord } from './words';

// Shared pieces of the component drawer: sections that fold, lists that link to other nodes, and
// the words that say how a thing was checked. Colour is never the only signal: each item has its word.

export function useDetailT() { return useT(DETAIL_WORDS); }

export function useWhen() {
  const locale = useLocale();
  return React.useCallback((iso?: string | null) => ago(iso ?? null, locale), [locale]);
}

export function useStamp() {
  const locale = useLocale();
  return React.useCallback((iso?: string | null, dateOnly?: boolean) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const tag = locale === 'pt' ? 'pt-BR' : 'en';
    return dateOnly ? d.toLocaleDateString(tag) : d.toLocaleString(tag);
  }, [locale]);
}

export function Section({ label, count, open = true, testId, children }: {
  label: React.ReactNode; count?: number; open?: boolean; testId?: string; children: React.ReactNode;
}) {
  return (
    <details open={open} data-testid={testId} className="group rounded-tile bg-well">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-grid text-fg-muted transition-transform duration-200 group-open:rotate-90"><IconChevron /></span>
        <span>{label}</span>
        {count !== undefined && <span className="ml-auto text-[13px] font-normal tabular-nums text-fg-muted">{count}</span>}
      </summary>
      <div className="px-4 pb-3.5 text-[14px] text-fg">{children}</div>
    </details>
  );
}

const DOT_FOR: Record<GraphNode['verification'], string> = {
  verified: 'ok', stale: 'warn', found_in_code: 'info', not_found: 'warn', reported: 'idle', declared: 'idle',
};

/** How the node was checked, in words: by whom and when, or what is missing. */
export function VerificationLine({ node }: { node: GraphNode }) {
  const t = useDetailT();
  const when = useWhen();
  const stamp = useStamp();
  let text: string;
  if (node.missingSince) text = t('verify.missing', { since: stamp(node.missingSince, true) });
  else switch (node.verification) {
    case 'verified': text = node.verifiedBy ? t('verify.verifiedBy', { by: node.verifiedBy, when: when(node.verifiedAt) }) : t('verify.verified', { when: when(node.verifiedAt) }); break;
    case 'stale': text = t('verify.stale', { when: when(node.verifiedAt) }); break;
    case 'found_in_code': text = node.codeScope ? `${t('verify.found')} (${t(`verify.scope.${node.codeScope}` as DetailWord)})` : t('verify.found'); break;
    case 'not_found': text = node.removalReportedAt ? t('verify.removalReported', { when: when(node.removalReportedAt) }) : t('verify.not_found'); break;
    case 'reported': text = t('verify.reported'); break;
    default: text = t('verify.declared');
  }
  return (
    <p className="flex items-start gap-2 text-[14px] text-fg" data-testid="atlas-node-verification" data-verification={node.verification}>
      <span aria-hidden className={cn('mt-[7px] inline-block size-[7px] shrink-0 rounded-full', DOT_CLASS[DOT_FOR[node.verification]])} />
      <span>{text}</span>
    </p>
  );
}

const DOT_CLASS: Record<string, string> = { ok: 'bg-success', warn: 'bg-warning', info: 'bg-info', idle: 'bg-fg-subtle' };

const SCOPE_TONE: Record<string, string> = { local: 'idle', pushed: 'info', deployed: 'ok', runtime: 'ok', declared: 'idle' };

export function ScopeLine({ scope }: { scope: GraphNode['codeScope'] }) {
  const t = useDetailT();
  return (
    <p className="flex flex-wrap items-center gap-2 text-[14px]">
      <span className="text-fg-muted">{t('scope.label')}</span>
      {scope ? <Pill tone={SCOPE_TONE[scope] ?? 'idle'}>{t(`scope.${scope}` as DetailWord)}</Pill> : <span className="text-fg-subtle">{t('scope.none')}</span>}
    </p>
  );
}

const CLASS_TONE: Record<AttentionClass, string> = {
  failure: 'error', security: 'warn', task: 'info', improvement: 'idle', config: 'warn', unverified: 'idle',
};

export function ClassPill({ cls }: { cls: AttentionClass }) {
  const t = useDetailT();
  return <Pill tone={CLASS_TONE[cls]}>{t(`refs.class.${cls}` as DetailWord)}</Pill>;
}

export function relationLabel(t: ReturnType<typeof useDetailT>, relation: string) {
  const key = `rel.${relation}` as DetailWord;
  const text = t(key);
  return text === key ? relation : text;
}

/** A node that can be opened from here: the whole row is the button. */
function NodeButton({ node, trailing, onNode, dashed }: { node: NodeRef; trailing?: React.ReactNode; onNode: (id: string) => void; dashed?: boolean }) {
  return (
    <button type="button" onClick={() => onNode(node.id)} data-testid="atlas-node-link" data-node-id={node.id}
      className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-tile px-2.5 py-2 text-left transition-colors duration-150 hover:bg-hover', dashed && 'atlas-dashed')}>
      <StateGlyph state={node.state} size={12} />
      <span className="min-w-0 flex-1 truncate font-medium text-fg">{node.name}</span>
      {trailing && <span className="shrink-0 text-right text-[13px] text-fg-muted">{trailing}</span>}
    </button>
  );
}

export function EdgeList({ items, direction, onNode }: {
  items: Array<{ edge: GraphEdge; node: NodeRef }>; direction: 'in' | 'out'; onNode: (id: string) => void;
}) {
  const t = useDetailT();
  if (items.length === 0) return <p className="text-fg-subtle">{t('deps.none')}</p>;
  return (
    <ul data-testid={direction === 'in' ? 'atlas-deps-in' : 'atlas-deps-out'} className="flex flex-col">
      {items.map(({ edge, node }) => (
        <li key={edge.id}>
          <NodeButton node={node} onNode={onNode}
            trailing={<>{relationLabel(t, edge.relation)}{edge.planned && ` · ${t('planned')}`}</>} />
        </li>
      ))}
    </ul>
  );
}

export function ImpactList({ impact, onNode }: { impact: NodeDetail['impact']; onNode: (id: string) => void }) {
  const t = useDetailT();
  if (impact.direct.length === 0 && impact.indirect.length === 0) return <p className="text-fg-subtle">{t('impact.none')}</p>;
  return (
    <div className="flex flex-col gap-2.5" data-testid="atlas-impact">
      {impact.direct.length > 0 && (
        <div><p className="mb-1 text-[13px] text-fg-muted">{t('impact.direct')} · {impact.direct.length}</p>
          <ul className="flex flex-col">{impact.direct.map((n) => <li key={n.id}><NodeButton node={n} onNode={onNode} /></li>)}</ul></div>
      )}
      {impact.indirect.length > 0 && (
        <div><p className="mb-1 text-[13px] text-fg-muted">{t('impact.indirect')} · {impact.indirect.length}</p>
          <ul className="flex flex-col">{impact.indirect.map((n) => <li key={n.id}><NodeButton node={n} onNode={onNode} /></li>)}</ul></div>
      )}
      {impact.systems.length > 0 && (
        <div><p className="mb-1 text-[13px] text-fg-muted">{t('impact.systems')}</p>
          <ul className="flex flex-wrap gap-1.5">{impact.systems.map((s) => <li key={s.id} className="rounded-full bg-surface px-3 py-1 text-[13px] font-medium">{s.name}</li>)}</ul></div>
      )}
    </div>
  );
}

export function EvidenceList({ items }: { items: Evidence[] }) {
  const t = useDetailT();
  const stamp = useStamp();
  if (items.length === 0) return <p className="text-fg-subtle">{t('evidence.none')}</p>;
  return (
    <ul data-testid="atlas-evidence" className="flex flex-col gap-2.5">
      {items.map((e) => (
        <li key={e.id} data-scope={e.scope} data-gone={e.goneAt ? 'true' : undefined} className={cn('rounded-tile bg-surface px-3 py-2.5', e.goneAt && 'atlas-dashed')}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={SCOPE_TONE[e.scope] ?? 'idle'}>{t(`scope.${e.scope}` as DetailWord) === `scope.${e.scope}` ? e.scope : t(`scope.${e.scope}` as DetailWord)}</Pill>
            <span className="min-w-0 break-all font-medium text-fg">{e.source}</span>
          </div>
          <p className="mt-1 break-all text-[13px] text-fg-secondary">{e.method} · <span className="font-mono text-[12.5px]">{e.ref}</span>
            {e.relation && <> · {relationLabel(t, e.relation)}</>}
          </p>
          {e.detail && <p className="mt-1 text-[13px] text-fg-muted">{e.detail}</p>}
          <p className="mt-1 text-[12px] text-fg-subtle">
            {t('evidence.seen', { first: stamp(e.firstSeenAt, true) })} · {t('evidence.last', { last: stamp(e.lastSeenAt, true) })}
            {e.goneAt && <> · {t('evidence.gone', { gone: stamp(e.goneAt, true) })}</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

const REF_KIND_TONE: Record<string, string> = { task: 'info', ticket: 'info', error: 'idle' };

export function RefList({ items }: { items: NodeRefLink[] }) {
  const t = useDetailT();
  if (items.length === 0) return <p className="text-fg-subtle">{t('refs.none')}</p>;
  return (
    <ul data-testid="atlas-refs" className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={`${r.kind}-${r.code}`} data-class={r.class} className="flex flex-wrap items-center gap-2 rounded-tile bg-surface px-3 py-2">
          <ClassPill cls={r.class} />
          {r.kind === 'task' ? (
            <Link href={`/tasks?task=${encodeURIComponent(r.code)}`} className="font-semibold text-fg underline-offset-2 tabular-nums hover:underline">{r.code}</Link>
          ) : (
            <span className="font-semibold tabular-nums text-fg">{r.code}</span>
          )}
          {r.title && <span className="min-w-0 flex-1 truncate text-fg-secondary">{r.title}</span>}
          {r.status && <Pill tone={REF_KIND_TONE[r.kind] ?? 'idle'}>{r.status}</Pill>}
          {r.via === 'label' && <span className="text-[12px] text-fg-subtle">{t('refs.via.label')}</span>}
          {r.note && <p className="basis-full text-[13px] text-fg-muted">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}

export function EventList({ items }: { items: AtlasEventDto[] }) {
  const t = useDetailT();
  const when = useWhen();
  if (items.length === 0) return <p className="text-fg-subtle">{t('events.none')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {items.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 py-2">
          <span className="font-medium text-fg">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{e.title}</a> : e.title}</span>
          <span className="text-[13px] text-fg-muted">{e.source} · {e.type}{e.status && ` · ${e.status}`} · {when(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChangeList({ items }: { items: AtlasChangeDto[] }) {
  const t = useDetailT();
  const when = useWhen();
  if (items.length === 0) return <p className="text-fg-subtle">{t('changes.none')}</p>;
  return (
    <ul data-testid="atlas-changes" className="flex flex-col divide-y divide-border-subtle">
      {items.map((c) => (
        <li key={c.id} className="flex flex-col gap-1 py-2.5">
          <span className="text-fg"><span className="font-medium">{t(`op.${c.op}` as DetailWord)}</span>{c.summary && <> · {c.summary}</>}</span>
          {c.fields.length > 0 && <FieldChanges fields={c.fields} />}
          <span className="text-[13px] text-fg-muted">{c.actor} · {t(`src.${sourceKey(c.source)}` as DetailWord)} · {when(c.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function sourceKey(source: string) {
  return ({ console: 'console', mcp: 'mcp', import: 'import', collector: 'collector', sync: 'sync', system: 'system', agent: 'agent' } as Record<string, string>)[source] ?? 'system';
}

export function FieldChanges({ fields }: { fields: FieldChange[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
      {fields.map((f) => (
        <React.Fragment key={f.field}>
          <dt className="text-fg-muted">{f.field}</dt>
          <dd className="min-w-0 break-words text-fg-secondary">
            <span className="line-through decoration-fg-subtle">{f.before ?? '—'}</span>
            <span aria-hidden className="mx-1.5 text-fg-subtle">→</span>
            <span className="text-fg">{f.after ?? '—'}</span>
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function RepoList({ items }: { items: NodeDetail['repos'] }) {
  const t = useDetailT();
  const when = useWhen();
  if (items.length === 0) return <p className="text-fg-subtle">{t('repos.none')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5">
          <span className="font-medium break-all text-fg">{r.fullName}{r.role && <span className="ml-2 font-normal text-fg-muted">{r.role}</span>}</span>
          <span className="text-[13px] text-fg-muted">
            {r.lastRunStatus ?? '—'} · {when(r.lastRunAt)}{r.lastSyncAt && ` · ${t('repos.sync', { when: when(r.lastSyncAt) })}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ProcessList({ items }: { items: NodeDetail['processes'] }) {
  const t = useDetailT();
  if (items.length === 0) return <p className="text-fg-subtle">{t('processes.none')}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((p) => <li key={p.id}><span className="font-medium text-fg">{p.name}</span> <span className="text-fg-muted">· {p.step.name}</span></li>)}
    </ul>
  );
}

export function ChangeSetList({ items }: { items: ChangeSetDto[] }) {
  const t = useDetailT();
  const when = useWhen();
  if (items.length === 0) return <p className="text-fg-subtle">{t('changesets.none')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {items.map((c) => (
        <li key={c.id} className="flex flex-col gap-0.5 py-2">
          <span className="text-fg">{c.summary ?? c.commitSha?.slice(0, 7) ?? c.id.slice(0, 8)}</span>
          <span className="text-[13px] text-fg-muted">{c.actor} · {c.status} · {c.scope} · {when(c.receivedAt)}{c.taskCodes.length > 0 && ` · ${c.taskCodes.join(', ')}`}</span>
        </li>
      ))}
    </ul>
  );
}

export function FactList({ facts }: { facts: Array<{ key: string; value: string }> }) {
  return (
    <dl data-testid="atlas-node-facts" className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {facts.map((f) => (
        <React.Fragment key={f.key}><dt className="text-fg-muted">{f.key}</dt><dd className="min-w-0 break-words text-fg">{f.value}</dd></React.Fragment>
      ))}
    </dl>
  );
}
