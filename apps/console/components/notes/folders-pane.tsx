'use client';

import * as React from 'react';
import Link from 'next/link';
import { NOTE_STAGES, type NoteStage } from '@/lib/api';
import {
  ancestorIds, folderTree, STAGE_LABEL, useCreateFolder, useDeleteFolder, useFolders, useNotesMeta, usePatchFolder,
  type FolderNode,
} from '@/lib/notes';
import { Button, Check, Dialog, ErrorBox, IconChevron, IconPlus, Input, Shimmer, cn } from '@/components/ui';
import { IconPencil, IconTrash, type UrlState } from './parts';

/** A name typed in place: Enter saves, Esc cancels, leaving the field saves what is there. */
function NameInput({ initial = '', indent, label, onSubmit, onCancel }: {
  initial?: string; indent: number; label: string; onSubmit: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  const done = React.useRef(false);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  // A name is one segment of a path: slashes are not allowed in it.
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.replace(/\//g, '').trim();
    if (save && name && name !== initial) onSubmit(name);
    else onCancel();
  };
  return (
    <div style={{ paddingLeft: indent }} className="min-w-0 flex-1 py-1 pr-1">
      <Input ref={ref} value={value} maxLength={80} aria-label={label} placeholder={label} className="h-9 px-3.5 text-[14px]"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        }}
        onBlur={() => finish(true)} />
    </div>
  );
}

function MiniButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors duration-150 hover:bg-well hover:text-fg">
      {children}
    </button>
  );
}

/**
 * The left column: the fixed views (all, inbox, pinned, archived), the folder tree with its
 * in-place actions, and the stage filters. Every row is a link, so the view is shareable.
 */
export function FoldersPane({ url }: { url: UrlState }) {
  const folders = useFolders();
  const meta = useNotesMeta();
  const createFolder = useCreateFolder();
  const patchFolder = usePatchFolder();
  const deleteFolder = useDeleteFolder();
  const data = folders.data;
  const tree = React.useMemo(() => folderTree(data?.items ?? []), [data]);
  const [closed, setClosed] = React.useState<Set<string>>(() => new Set());
  const [adding, setAdding] = React.useState<{ parentId: string | null } | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<FolderNode | null>(null);

  const folder = url.get('folder');
  const stages = url.get('stage').split(',').filter(Boolean);
  const stageCount = (s: NoteStage) => meta.data?.stages.find((x) => x.stage === s)?.count;

  // A folder opened from the URL is never hidden inside a closed branch.
  React.useEffect(() => {
    if (!data || !folder) return;
    const up = ancestorIds(folder, data.items);
    if (up.length) setClosed((c) => { const n = new Set(c); up.forEach((id) => n.delete(id)); return n; });
  }, [folder, data]);

  const toggle = (id: string) => setClosed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const open = (id: string) => setClosed((c) => { const n = new Set(c); n.delete(id); return n; });

  const views: Array<{ key: string; label: string; count?: number }> = [
    { key: 'all', label: 'Todas' },
    { key: 'inbox', label: 'Entrada', count: data?.inbox },
    { key: 'pinned', label: 'Fixadas' },
    { key: 'archived', label: 'Arquivadas', count: data?.archived },
  ];
  const isActive = (key: string) => (key === 'all' ? folder === '' || folder === 'all' : folder === key);

  const renderNodes = (nodes: FolderNode[]): React.ReactNode => nodes.map((n) => {
    const isOpen = !closed.has(n.id);
    return (
      <li key={n.id}>
        <div className="group flex items-center" style={{ paddingLeft: (n.depth - 1) * 14 }}>
          {n.children.length > 0 ? (
            <button type="button" aria-label={isOpen ? `Recolher ${n.name}` : `Abrir ${n.name}`} aria-expanded={isOpen}
              onClick={() => toggle(n.id)} className="grid size-6 shrink-0 place-items-center rounded-full text-fg-subtle hover:text-fg">
              <IconChevron open={isOpen} />
            </button>
          ) : <span aria-hidden className="size-6 shrink-0" />}
          {renaming === n.id ? (
            <NameInput initial={n.name} indent={0} label="Nome da pasta" onCancel={() => setRenaming(null)}
              onSubmit={(name) => patchFolder.mutate({ id: n.id, name }, { onSettled: () => setRenaming(null) })} />
          ) : (
            <Link href={url.href({ folder: n.id, note: '', q: '' })} scroll={false} aria-current={folder === n.id ? 'page' : undefined}
              className={cn('flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-[14px] transition-colors duration-150',
                folder === n.id ? 'bg-sel font-medium text-sel-fg' : 'text-fg-secondary hover:bg-well hover:text-fg')}>
              <span className="truncate">{n.name}</span>
              <span className="ml-auto text-[12px] tabular-nums text-fg-subtle">{n.noteCount}</span>
            </Link>
          )}
          {renaming !== n.id && (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
              {n.depth < 4 && (
                <MiniButton label={`Nova subpasta em ${n.name}`} onClick={() => { open(n.id); setAdding({ parentId: n.id }); }}>
                  <IconPlus size={14} />
                </MiniButton>
              )}
              <MiniButton label={`Renomear ${n.name}`} onClick={() => setRenaming(n.id)}><IconPencil /></MiniButton>
              <MiniButton label={`Apagar ${n.name}`} onClick={() => setDeleting(n)}><IconTrash /></MiniButton>
            </div>
          )}
        </div>
        {isOpen && adding?.parentId === n.id && (
          <NameInput indent={n.depth * 14 + 24} label="Nome da subpasta" onCancel={() => setAdding(null)}
            onSubmit={(name) => createFolder.mutate({ name, parentId: n.id }, { onSettled: () => setAdding(null) })} />
        )}
        {isOpen && n.children.length > 0 && <ul>{renderNodes(n.children)}</ul>}
      </li>
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-panel bg-surface">
      <h1 className="px-5 pt-5 pb-3 text-[18px] leading-6 font-semibold tracking-[-0.015em] text-fg">Anotações</h1>

      <nav aria-label="Visões" className="flex flex-col gap-0.5 px-2">
        {views.map((v) => (
          <Link key={v.key} href={url.href({ folder: v.key, note: '', q: '' })} scroll={false} aria-current={isActive(v.key) ? 'page' : undefined}
            className={cn('flex h-9 items-center gap-2 rounded-xl px-3 text-[14px] transition-colors duration-150',
              isActive(v.key) ? 'bg-btn font-medium text-btn-fg' : 'text-fg-secondary hover:bg-well hover:text-fg')}>
            {v.label}
            {v.count !== undefined && <span className={cn('ml-auto text-[12px] tabular-nums', isActive(v.key) ? 'text-btn-fg/70' : 'text-fg-subtle')}>{v.count}</span>}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 px-5 pt-4 pb-1">
        <span className="text-[13px] font-medium text-fg-muted">Pastas</span>
        <button type="button" aria-label="Nova pasta" title="Nova pasta" onClick={() => setAdding({ parentId: null })}
          className="ml-auto grid size-7 place-items-center rounded-full text-fg-subtle transition-colors duration-150 hover:bg-well hover:text-fg">
          <IconPlus size={14} />
        </button>
      </div>
      {adding?.parentId === null && (
        <div className="px-2">
          <NameInput indent={24} label="Nome da pasta" onCancel={() => setAdding(null)}
            onSubmit={(name) => createFolder.mutate({ name, parentId: null }, { onSettled: () => setAdding(null) })} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {folders.error && !data ? <div className="px-2 pt-2"><ErrorBox error={folders.error} onRetry={() => void folders.refetch()} /></div>
          : !data ? <div className="flex flex-col gap-2 px-2 pt-2"><Shimmer className="h-8" /><Shimmer className="h-8" /></div>
          : tree.length === 0 ? <p className="px-3 pt-2 text-[13px] leading-[1.5] text-fg-subtle">Nenhuma pasta ainda. As anotações podem ficar na Entrada.</p>
          : <ul>{renderNodes(tree)}</ul>}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle px-5 py-4">
        <span className="text-[13px] font-medium text-fg-muted">Estágio</span>
        <div className="flex flex-wrap gap-2">
          {NOTE_STAGES.map((s) => (
            <Check key={s} checked={stages.includes(s)}
              onChange={(on) => url.set({ stage: on ? [...stages, s].join(',') : stages.filter((x) => x !== s).join(',') })}>
              {STAGE_LABEL[s]}
              {stageCount(s) !== undefined && <span className="tabular-nums text-fg-subtle">{stageCount(s)}</span>}
            </Check>
          ))}
        </div>
      </div>

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Apagar pasta">
        {deleting && (
          <div className="flex flex-col gap-5">
            <p className="text-[14px] leading-[1.5] text-fg-secondary">
              Apagar a pasta <strong className="font-semibold text-fg">{deleting.name}</strong>? As anotações dentro dela, inclusive as
              arquivadas, voltam para a Entrada, e as subpastas sobem um nível. Nada do texto se perde.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
              <Button variant="danger" loading={deleteFolder.isPending} onClick={() => {
                const id = deleting.id;
                deleteFolder.mutate(id, {
                  onSuccess: () => { if (folder === id) url.set({ folder: '' }); },
                  onSettled: () => setDeleting(null),
                });
              }}>Apagar pasta</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
