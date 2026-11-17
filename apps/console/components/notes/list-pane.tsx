'use client';

import * as React from 'react';
import Link from 'next/link';
import type { NoteDto } from '@/lib/api';
import { flattenTree, folderTree, useFolders, useNotes, type NoteFilters } from '@/lib/notes';
import { Button, Empty, ErrorBox, Pill, SearchInput, Shimmer, cn, rel } from '@/components/ui';
import { IconPin, NewNoteMenu, StagePill, type UrlState } from './parts';
import type { NoteTemplate } from '@/lib/notes';

const VIEW_NAMES: Record<string, string> = { '': 'Todas', all: 'Todas', inbox: 'Entrada', pinned: 'Fixadas', archived: 'Arquivadas' };

/** The middle column: the notes of the view, the search and the new-note menu. */
export function ListPane({ url, searchRef, onCreate, onBack }: {
  url: UrlState; searchRef: React.RefObject<HTMLInputElement | null>; onCreate: (t: NoteTemplate) => void; onBack: () => void;
}) {
  const folder = url.get('folder');
  const q = url.get('q');
  const stage = url.get('stage');
  const folders = useFolders();

  const filters: NoteFilters = React.useMemo(() => {
    const isFolder = !!folder && !(folder in VIEW_NAMES) && folder !== 'pinned' && folder !== 'archived';
    return {
      folder: isFolder || folder === 'inbox' ? folder : undefined,
      deep: isFolder ? true : undefined,
      pinned: folder === 'pinned' ? true : undefined,
      archived: folder === 'archived' ? true : undefined,
      q: q || undefined,
      stage: stage || undefined,
    };
  }, [folder, q, stage]);
  const list = useNotes(filters);

  // The search waits for a pause in typing before it asks the server.
  const [draft, setDraft] = React.useState(q);
  React.useEffect(() => { setDraft(q); }, [q]);
  React.useEffect(() => {
    const id = setTimeout(() => { if (draft !== q) url.set({ q: draft }); }, 300);
    return () => clearTimeout(id);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = VIEW_NAMES[folder] ?? (folders.data ? flattenTree(folderTree(folders.data.items)).find((n) => n.id === folder)?.path : undefined) ?? 'Anotações';
  const selected = url.get('note').toUpperCase();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-panel bg-surface">
      <header className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-3 lg:hidden" onClick={onBack}>Pastas</Button>
          <h2 className="min-w-0 truncate text-[16px] leading-6 font-semibold tracking-[-0.01em] text-fg">{label}</h2>
          <div className="ml-auto shrink-0"><NewNoteMenu onPick={onCreate} /></div>
        </div>
        <SearchInput ref={searchRef} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="Buscar por título, código ou texto  ( / )" aria-label="Buscar anotações" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {list.isPending ? (
          <div className="flex flex-col gap-2 px-2 pt-1"><Shimmer className="h-20" /><Shimmer className="h-20" /><Shimmer className="h-20" /></div>
        ) : list.error && !list.data ? (
          <div className="px-2 pt-1"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : items.length === 0 ? (
          <Empty title={q || stage ? 'Nada com esses filtros.' : 'Nenhuma anotação aqui.'}>
            {q || stage ? 'Tire a busca ou os estágios para ver tudo.' : 'Anote uma ideia, um achado ou um procedimento em formação. Quando estiver estruturada, vira tarefa.'}
          </Empty>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5">
              {items.map((n) => (
                <li key={n.id}>
                  <NoteRow note={n} selected={n.code === selected} href={url.href({ note: n.code })} />
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <div className="flex justify-center pt-3">
                <Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Carregar mais</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NoteRow({ note: n, selected, href }: { note: NoteDto; selected: boolean; href: string }) {
  return (
    <Link href={href} scroll={false} aria-current={selected ? 'true' : undefined}
      className={cn('flex flex-col gap-1.5 rounded-tile px-3.5 py-3 transition-colors duration-150', selected ? 'bg-sel text-sel-fg' : 'hover:bg-hover')}>
      <div className="flex items-center gap-2 text-[12px] text-fg-muted">
        <span className="min-w-0 truncate">{n.folderPath || 'Entrada'}</span>
        <span className="ml-auto shrink-0 tabular-nums whitespace-nowrap">{rel(n.updatedAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        {n.pinned && <span className="shrink-0 text-accent-fg" title="Fixada"><IconPin /></span>}
        <p className="min-w-0 truncate text-[14px] leading-5 font-medium text-fg">{n.title}</p>
      </div>
      {n.excerpt && <p className="line-clamp-2 text-[13px] leading-[1.4] text-fg-muted">{n.excerpt}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <StagePill stage={n.stage} />
        {n.archivedAt && <Pill tone="warn">Arquivada</Pill>}
        {n.product && <span className="text-[12px] text-fg-muted">{n.product.name}</span>}
        {n.labels.slice(0, 3).map((l) => <Pill key={l} tone="idle">{l}</Pill>)}
      </div>
    </Link>
  );
}
