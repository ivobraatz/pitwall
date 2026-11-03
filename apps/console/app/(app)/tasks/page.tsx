'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { TaskStatus, TeamTask } from '@/lib/api';
import { isOverdue, useBoard, useTasksMeta } from '@/lib/tasks';
import { useMe } from '@/components/shell';
import { Button, ErrorBox, PageHeader, Shimmer } from '@/components/ui';
import { TaskBoard } from '@/components/tasks/board';
import { TaskDrawer } from '@/components/tasks/drawer';
import { TaskFilters, type TaskFilterValues } from '@/components/tasks/filters';
import { ShortcutsHelp, useShortcuts } from '@/components/tasks/shortcuts';

function Tasks() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const get = (k: string) => params.get(k) ?? '';

  const setParams = React.useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const filters: TaskFilterValues = {
    product: get('product'), assignee: get('assignee'), label: get('label'), q: get('q'),
    overdue: get('overdue') === '1', claude: get('claude') === '1',
  };
  const openCode = get('task');

  const dragging = React.useRef(false);
  const meta = useTasksMeta();
  const board = useBoard({ product: filters.product, assignee: filters.assignee, label: filters.label, q: filters.q }, dragging);
  const [creating, setCreating] = React.useState<TaskStatus | null>(null);
  const [help, setHelp] = React.useState(false);
  const search = React.useRef<HTMLInputElement>(null);

  const visible = React.useCallback((t: TeamTask) =>
    (!filters.overdue || isOverdue(t)) && (!filters.claude || t.source === 'claude'),
  [filters.overdue, filters.claude]);

  const open = React.useCallback((t: TeamTask) => setParams({ task: t.code }), [setParams]);
  const close = React.useCallback(() => setParams({ task: '' }), [setParams]);

  useShortcuts({
    onNew: () => { if (!openCode) setCreating('todo'); },
    onSearch: () => { search.current?.focus(); search.current?.select(); },
    onEscape: () => { if (help) setHelp(false); else if (openCode) close(); else if (creating) setCreating(null); },
    onHelp: () => setHelp(true),
  });

  const onFilter = (patch: Partial<TaskFilterValues>) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) out[k] = typeof v === 'boolean' ? (v ? '1' : '') : v;
    setParams(out);
  };

  const counts = board.data?.counts;
  return (
    <>
      <PageHeader
        title="Tarefas"
        subtitle={
          <>
            O que a equipe precisa fazer à mão: painéis externos, testes em aparelho, credenciais. O Claude registra pelo MCP e
            confere o que você bloquear.{counts && counts.overdue > 0 && <> <span className="font-semibold text-danger">{counts.overdue} atrasada{counts.overdue === 1 ? '' : 's'}.</span></>}
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setHelp(true)} title="Atalhos (?)">Atalhos</Button>
            <Button variant="primary" onClick={() => setCreating('todo')}>Nova tarefa</Button>
          </>
        }
      />
      <TaskFilters value={filters} onChange={onFilter} meta={meta.data} searchRef={search} />
      {board.error && !board.data ? (
        <ErrorBox error={board.error} onRetry={() => void board.refetch()} />
      ) : board.data ? (
        <TaskBoard
          board={board.data} visible={visible} product={filters.product || undefined}
          creating={creating} setCreating={setCreating} onOpen={open} dragging={dragging}
          createdBy={me?.name ?? ''} meta={meta.data}
        />
      ) : (
        <div className="flex gap-2">{[0, 1, 2, 3].map((i) => <Shimmer key={i} className="h-96 flex-1" />)}</div>
      )}
      {openCode && <TaskDrawer code={openCode} meta={meta.data} onClose={close} />}
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
    </>
  );
}

export default function TasksPage() {
  return <React.Suspense><Tasks /></React.Suspense>;
}
