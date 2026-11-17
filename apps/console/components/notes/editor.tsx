'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { NOTE_STAGES, type EditableStage, type NoteDetail } from '@/lib/api';
import { STATUS_NAME } from '@/components/tasks/card';
import { Markdown } from '@/components/tasks/markdown';
import { Button, Dialog, Dot, Empty, ErrorBox, IconMore, Input, Segmented, Select, Shimmer, Textarea, cn, dateTime, rel, useToast } from '@/components/ui';
import {
  STAGE_LABEL, applySaved, fetchNote, flattenTree, folderTree, noteKey, parseLabels, useArchiveNote, useDeleteNote, useDuplicateNote,
  useFolders, useNote, useNotesMeta, useUnarchiveNote, type NotePatch,
} from '@/lib/notes';
import { endSession, startSession, TEXT_DELAY, type SaveStatus } from '@/lib/notes-autosave';
import { ConvertDialog } from './convert-dialog';
import { HistoryDialog } from './history-dialog';
import { IconPin, useMenuDismiss, type UrlState } from './parts';

/** The right column. Reads the note from the cache; the editor owns the text while it is open. */
export function NotePane({ code, url, focusTitle }: { code: string; url: UrlState; focusTitle: boolean }) {
  const q = useNote(code || null);
  const [rev, setRev] = React.useState(0);
  if (!code) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-panel bg-surface">
        <Empty title="Escolha uma anotação">Ou crie uma com Nova anotação. Ela começa na Entrada, ou na pasta aberta.</Empty>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="flex flex-1 flex-col gap-3 rounded-panel bg-surface p-5">
        {q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : <><Shimmer className="h-8 w-2/3" /><Shimmer className="h-40" /></>}
      </div>
    );
  }
  // A new key per reload: the editor starts again from what the server holds.
  return <NoteEditor key={`${q.data.code}:${rev}`} live={q.data} url={url} focusTitle={focusTitle} onReload={() => setRev((r) => r + 1)} />;
}

function NoteEditor({ live, url, focusTitle, onReload }: { live: NoteDetail; url: UrlState; focusTitle: boolean; onReload: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const folders = useFolders();
  const meta = useNotesMeta();
  const archive = useArchiveNote();
  const unarchive = useUnarchiveNote();
  const remove = useDeleteNote();
  const duplicate = useDuplicateNote();

  // The session lives across remounts while it has something unsaved (see notes-autosave.ts).
  const [saver] = React.useState(() => startSession(live.code, live.updatedAt, { title: live.title, body: live.body }, (n, sent) => applySaved(qc, n, sent)));
  const [status, setStatus] = React.useState<SaveStatus>(saver.status);
  const [title, setTitle] = React.useState(saver.text.title);
  const [body, setBody] = React.useState(saver.text.body);
  const [mode, setMode] = React.useState<'edit' | 'view'>('edit');
  const [fields, setFields] = React.useState({
    stage: live.stage, folderId: live.folder?.id ?? null, product: live.product?.slug ?? null, pinned: live.pinned, labels: live.labels,
  });
  const [labelsText, setLabelsText] = React.useState(live.labels.join(', '));
  const [converting, setConverting] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const titleRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    saver.attach({ status: setStatus, error: (text) => toast('error', text) });
    const beforeUnload = (e: BeforeUnloadEvent) => { if (saver.dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); saver.detach(); };
  }, [saver, toast]);

  React.useEffect(() => {
    if (focusTitle) { titleRef.current?.focus(); titleRef.current?.select(); }
  }, [focusTitle]);

  const converted = live.stage === 'converted' || !!live.task;
  const saved = status === 'saved';

  const onTitle = (raw: string) => {
    const v = raw.replace(/\s*\n\s*/g, ' ');
    setTitle(v);
    const t = v.trim();
    if (t) saver.queue({ title: t }, TEXT_DELAY);
  };
  // An empty title is not saved (the server refuses it); leaving the field brings back the last one saved.
  const onTitleBlur = () => { if (!title.trim()) setTitle(saver.text.title); };
  const onBody = (v: string) => { setBody(v); saver.queue({ body: v }, TEXT_DELAY); };

  const choose = (patch: NotePatch, local: Partial<typeof fields>) => {
    setFields((f) => ({ ...f, ...local }));
    saver.queue(patch, 0);
  };
  const commitLabels = () => {
    const next = parseLabels(labelsText);
    setLabelsText(next.join(', '));
    if (next.join('|') !== fields.labels.join('|')) choose({ labels: next }, { labels: next });
  };

  const reload = async () => {
    endSession(live.code);
    try {
      qc.setQueryData(noteKey(live.code), await fetchNote(live.code));
      onReload();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Algo deu errado.');
    }
  };

  const statusLine = {
    saved: { tone: 'ok', text: 'Salvo' },
    dirty: { tone: 'warn', text: 'Alterações não salvas' },
    saving: { tone: 'running', text: 'Salvando…' },
    error: { tone: 'error', text: 'Erro ao salvar' },
    conflict: { tone: 'error', text: 'Conflito' },
  }[status];

  const stageValue = converted ? 'converted' : fields.stage;
  const stageOptions = converted
    ? [{ value: 'converted', label: STAGE_LABEL.converted }]
    : NOTE_STAGES.filter((s) => s !== 'converted').map((s) => ({ value: s, label: STAGE_LABEL[s] }));
  const folderOptions = [
    { value: '', label: 'Entrada' },
    ...flattenTree(folderTree(folders.data?.items ?? [])).map((n) => ({ value: n.id, label: n.path })),
  ];
  const productOptions = [
    { value: '', label: 'Geral da equipe' },
    ...(meta.data?.products ?? []).map((p) => ({ value: p.slug, label: p.name })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-panel bg-surface">
      <header className="flex flex-col gap-3 px-5 pt-4 pb-4">
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-fg-muted">
          <Button variant="ghost" size="sm" className="-ml-3 lg:hidden" onClick={() => url.set({ note: '' })}>Voltar</Button>
          <span className="font-semibold tabular-nums text-fg-secondary">{live.code}</span>
          <span className="inline-flex items-center gap-1.5" aria-live="polite"><Dot tone={statusLine.tone} />{statusLine.text}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant={fields.pinned ? 'secondary' : 'ghost'} aria-pressed={fields.pinned}
              onClick={() => choose({ pinned: !fields.pinned }, { pinned: !fields.pinned })}>
              <IconPin />{fields.pinned ? 'Fixada' : 'Fixar'}
            </Button>
            <NoteMenu
              archived={!!live.archivedAt} saved={saved}
              onHistory={() => setHistory(true)}
              onDuplicate={() => duplicate.mutate(live.code, { onSuccess: (n) => url.set({ note: n.code }) })}
              onArchive={() => archive.mutate(live.code)}
              onDelete={() => setDeleting(true)}
            />
          </div>
        </div>

        <textarea ref={titleRef} value={title} onChange={(e) => onTitle(e.target.value)} onBlur={onTitleBlur} rows={1} maxLength={200}
          aria-label="Título da anotação" placeholder="Sem título"
          className="-mx-2 block w-[calc(100%+1rem)] resize-none rounded-tile bg-transparent px-2 py-1 text-[22px] leading-[1.25] font-semibold tracking-[-0.02em] text-fg outline-none placeholder:text-fg-subtle [field-sizing:content] hover:bg-hover focus:bg-hover" />

        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Estágio" value={stageValue} disabled={converted}
            onChange={(e) => { const v = e.target.value as EditableStage; choose({ stage: v }, { stage: v }); }} options={stageOptions} />
          <Select aria-label="Pasta" value={fields.folderId ?? ''}
            onChange={(e) => choose({ folderId: e.target.value || null }, { folderId: e.target.value || null })} options={folderOptions} />
          <Select aria-label="Sistema" value={fields.product ?? ''}
            onChange={(e) => choose({ product: e.target.value || null }, { product: e.target.value || null })} options={productOptions} />
          <div className="min-w-44 flex-1">
            <Input aria-label="Etiquetas" value={labelsText} placeholder="etiquetas, separadas por vírgula"
              onChange={(e) => setLabelsText(e.target.value)} onBlur={commitLabels}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLabels(); } }} />
          </div>
        </div>
      </header>

      {status === 'conflict' && (
        <div role="alert" className="mx-5 mb-3 flex flex-wrap items-center gap-3 rounded-tile bg-danger/10 px-4 py-3 text-[14px] text-fg">
          Outra pessoa mudou esta anotação. Recarregar traz a versão salva e descarta o que não foi salvo aqui.
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void reload()}>Recarregar</Button>
        </div>
      )}
      {live.archivedAt && (
        <div className="mx-5 mb-3 flex flex-wrap items-center gap-3 rounded-tile bg-well px-4 py-3 text-[14px] text-fg-secondary">
          Arquivada em {dateTime(live.archivedAt)}.
          <Button size="sm" variant="secondary" className="ml-auto" disabled={!saved} loading={unarchive.isPending}
            onClick={() => unarchive.mutate(live.code)}>Desarquivar</Button>
        </div>
      )}
      {converted && live.task && (
        <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-tile bg-well px-4 py-3 text-[14px] text-fg-secondary">
          Virou a tarefa <Link href={`/tasks?task=${live.task.code}`} className="font-semibold text-fg underline underline-offset-2 hover:no-underline">{live.task.code}</Link>
          <span className="text-fg-muted">({STATUS_NAME[live.task.status]})</span>
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-1 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" label="Modo do corpo" value={mode} onChange={setMode}
            options={[{ value: 'edit', label: 'Escrever' }, { value: 'view', label: 'Ver' }]} />
          <Button size="sm" variant="primary" className="ml-auto" disabled={!saved || converted} onClick={() => setConverting(true)}
            title={converted ? 'Esta anotação já virou tarefa' : !saved ? 'Espere o texto salvar' : undefined}>
            Virar tarefa
          </Button>
        </div>
        {mode === 'edit' ? (
          <Textarea code value={body} onChange={(e) => onBody(e.target.value)} maxLength={100000}
            aria-label="Corpo em markdown" placeholder={'O que foi descoberto, o porquê e os passos.\n\nMarkdown: ## Título, - [ ] passo, `código`, [link](https://…)'}
            className="min-h-[50vh] flex-1 text-[14px] leading-[1.6] lg:min-h-0" />
        ) : (
          <div className="min-h-[50vh] flex-1 overflow-y-auto rounded-tile bg-well px-4 py-3 lg:min-h-0">
            {body.trim() ? <Markdown>{body}</Markdown> : <p className="text-[14px] text-fg-subtle">Sem texto ainda.</p>}
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-subtle px-5 py-3 text-[13px] text-fg-muted">
        {live.backlinks.length > 0 && <RefList label="Citada por" url={url} items={live.backlinks.map((b) => ({ code: b.code, title: b.title, missing: false }))} />}
        {live.linked.length > 0 && <RefList label="Cita" url={url} items={live.linked} />}
        <span className="ml-auto whitespace-nowrap" title={dateTime(live.updatedAt)}>Editada {rel(live.updatedAt)} por {live.updatedByName}</span>
      </footer>

      {converting && <ConvertDialog code={live.code} onClose={() => setConverting(false)} />}
      {history && (
        <HistoryDialog code={live.code} canRestore={saved} onClose={() => setHistory(false)}
          onRestored={() => {
            // The restored body is in the cache already; the session of the old text must end before the reload reads it.
            endSession(live.code);
            setHistory(false);
            onReload();
          }} />
      )}
      <Dialog open={deleting} onClose={() => setDeleting(false)} title="Apagar anotação">
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-[1.5] text-fg-secondary">
            Apagar <strong className="font-semibold text-fg">{live.title}</strong> ({live.code}) de vez? O histórico vai junto, e não tem volta.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(false)}>Cancelar</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(live.code, {
              onSuccess: () => { setDeleting(false); url.set({ note: '' }); },
              onSettled: () => setDeleting(false),
            })}>Apagar anotação</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function RefList({ label, items, url }: { label: string; items: Array<{ code: string; title: string; missing: boolean }>; url: UrlState }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-medium text-fg-secondary">{label}</span>
      {items.map((r) => r.missing ? (
        <span key={r.code} className="text-fg-subtle">{r.code} (não existe)</span>
      ) : (
        <Link key={r.code} href={url.href({ note: r.code })} scroll={false} className="min-w-0 truncate font-medium text-fg underline underline-offset-2 hover:no-underline">
          {r.title || r.code}
        </Link>
      ))}
    </span>
  );
}

/** Less frequent actions of the note: history, duplicate, archive, and delete (only once archived). */
function NoteMenu({ archived, saved, onHistory, onDuplicate, onArchive, onDelete }: {
  archived: boolean; saved: boolean; onHistory: () => void; onDuplicate: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, ref);
  const item = 'flex h-10 w-full items-center rounded-xl px-3 text-left text-[14px] text-fg-secondary transition-colors duration-150 hover:bg-well hover:text-fg disabled:opacity-50';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Mais ações" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center rounded-full border border-border bg-surface text-fg-secondary transition-colors duration-150 hover:border-border-strong hover:text-fg">
        <IconMore size={16} />
      </button>
      {open && (
        <div role="menu" className="pop absolute top-full right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl bg-overlay p-1.5 shadow-popover">
          <button role="menuitem" type="button" className={item} onClick={() => { close(); onHistory(); }}>Histórico</button>
          <button role="menuitem" type="button" className={item} disabled={!saved} onClick={() => { close(); onDuplicate(); }}>Duplicar</button>
          {!archived && <button role="menuitem" type="button" className={item} disabled={!saved} onClick={() => { close(); onArchive(); }}>Arquivar</button>}
          {archived && <button role="menuitem" type="button" className={cn(item, 'text-danger')} onClick={() => { close(); onDelete(); }}>Apagar</button>}
        </div>
      )}
    </div>
  );
}
