'use client';

import * as React from 'react';
import { useShortcuts } from '@/components/tasks/shortcuts';
import { cn } from '@/components/ui';
import { FoldersPane } from '@/components/notes/folders-pane';
import { ListPane } from '@/components/notes/list-pane';
import { NotePane } from '@/components/notes/editor';
import { useUrlState, type UrlState } from '@/components/notes/parts';
import { NOTE_TEMPLATES, useCreateNote, type NoteTemplate } from '@/lib/notes';

const VIEWS = ['', 'all', 'inbox', 'pinned', 'archived'];

/**
 * Notes: three columns from lg up (folders, list, note), one at a time below it: folders, then the
 * list of the chosen view, then the note, each with a way back. The state lives in the URL.
 */
function Notes() {
  const url: UrlState = useUrlState();
  const search = React.useRef<HTMLInputElement>(null);
  const create = useCreateNote();
  const [created, setCreated] = React.useState<string | null>(null);

  const folder = url.get('folder');
  const note = url.get('note');
  const q = url.get('q');
  const stage = url.get('stage');
  // Where a new note goes: the folder open (a folder id), otherwise the Entrada.
  const folderId = folder && !VIEWS.includes(folder) ? folder : null;

  const newNote = React.useCallback((t: NoteTemplate) => {
    create.mutate({
      title: t.title, body: t.body || undefined, folderId, pinned: folder === 'pinned' || undefined,
    }, {
      onSuccess: (n) => { setCreated(n.code); url.set({ note: n.code }); },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create, folder, folderId, url.set]);

  useShortcuts({
    onNew: () => { if (!create.isPending) newNote(NOTE_TEMPLATES[0]); },
    onSearch: () => { search.current?.focus(); search.current?.select(); },
    onEscape: () => {},
    onHelp: () => {},
  });

  // On a phone one column shows at a time: folders at the root, the list once a view or a search is chosen, the note once one is open.
  const view = note ? 'editor' : (folder || q || stage) ? 'list' : 'folders';

  return (
    <>
      <div className="flex flex-col gap-3 lg:h-[calc(100dvh-40px)] lg:flex-row">
        <div className={cn('min-h-0 flex-col lg:flex lg:w-[248px] lg:shrink-0', view === 'folders' ? 'flex' : 'hidden')}>
          <FoldersPane url={url} />
        </div>
        <div className={cn('min-h-0 min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0', view === 'list' ? 'flex' : 'hidden')}>
          <ListPane url={url} searchRef={search} onCreate={newNote} onBack={() => url.set({ folder: '', q: '', stage: '' })} />
        </div>
        <div className={cn('min-h-0 min-w-0 flex-1 flex-col lg:flex', view === 'editor' ? 'flex' : 'hidden')}>
          <NotePane code={note} url={url} focusTitle={!!note && created === note.toUpperCase()} />
        </div>
      </div>
    </>
  );
}

export default function NotesPage() {
  return <React.Suspense><Notes /></React.Suspense>;
}
