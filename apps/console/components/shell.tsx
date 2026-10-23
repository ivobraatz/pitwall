'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Me, type Summary } from '@/lib/api';
import { cn } from './ui';

export const MeContext = React.createContext<Me | null>(null);
export function useMe() { return React.useContext(MeContext); }

const icon = (paths: React.ReactNode) => function Icon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths}</svg>;
};
const IconTickets = icon(<><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4Z" /><path d="M14 5v14" strokeDasharray="2 3" /></>);
const IconErrors = icon(<><path d="M12 4 3 19h18Z" /><path d="M12 10v4M12 16.5v.5" /></>);
const IconReleases = icon(<><path d="M5 19c0-6 4-11 14-14-1 10-6 14-14 14Z" /><path d="m5 19 6-6" /></>);
const IconProducts = icon(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
const IconSettings = icon(<><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></>);

const NAV = [
  { href: '/', label: 'Chamados', Icon: IconTickets, match: (p: string) => p === '/' || p.startsWith('/tickets') },
  { href: '/errors', label: 'Erros', Icon: IconErrors, match: (p: string) => p.startsWith('/errors') },
  { href: '/releases', label: 'Novidades', Icon: IconReleases, match: (p: string) => p.startsWith('/releases') },
  { href: '/products', label: 'Sistemas', Icon: IconProducts, match: (p: string) => p.startsWith('/products') },
  { href: '/settings', label: 'Conta e equipe', Icon: IconSettings, match: (p: string) => p.startsWith('/settings') },
];

/** Side panel: the products, filterable, each with open tickets and 24h errors. Picking one filters the queue. */
function ProductPanel({ products }: { products: Summary['products'] }) {
  const params = useSearchParams();
  const [filter, setFilter] = React.useState('');
  const selected = params.get('product');
  const shown = products.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  const item = (active: boolean) => cn('flex h-7 items-center gap-2 rounded-sm px-2 text-[13px]', active ? 'bg-sel text-sel-fg hover:bg-sel-hover' : 'text-fg-secondary hover:bg-hover');
  return (
    <>
      <div className="px-3 pb-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar sistemas…" aria-label="Filtrar sistemas"
          className="h-7 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle hover:border-border-strong focus:border-focus focus:ring-2 focus:ring-focus" />
      </div>
      <div className="flex items-center px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
        <span>Sistemas</span><span className="ml-auto tabular-nums">{products.length}</span>
      </div>
      <div className="flex flex-col px-2">
        <Link href="/" className={item(!selected)}>Todos os sistemas</Link>
        {shown.map((p) => (
          <Link key={p.id} href={`/?product=${p.id}`} className={item(selected === p.id)}>
            <span className="truncate">{p.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-fg-muted" title="chamados abertos · erros nas últimas 24h">
              {p.awaitingUs > 0 && <span className="size-1.5 rounded-full bg-warning" title="aguardando a equipe" />}
              {p.open}<span className="text-fg-subtle">·</span><span className={p.errors24h > 0 ? 'text-danger' : ''}>{p.errors24h}</span>
            </span>
          </Link>
        ))}
        {shown.length === 0 && <p className="px-2 py-2 text-[12px] text-fg-muted">Nenhum sistema.</p>}
      </div>
    </>
  );
}

/** Signed-in frame: rail, context panel, the session check, and a redirect to /login when it lapses. */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menu, setMenu] = React.useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/staff/auth/me'), staleTime: 60_000 });
  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/staff/summary'), refetchInterval: 60_000, enabled: !!me.data });

  React.useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, pathname, router]);

  // Any 401 while working means the session ended: back to the sign-in screen.
  React.useEffect(() => queryClient.getQueryCache().subscribe((e) => {
    const err = e.query.state.error;
    if (err instanceof ApiError && err.status === 401 && e.query.queryKey[0] !== 'me') router.replace('/login');
  }), [queryClient, router]);

  if (!me.data) {
    return <div className="grid h-full place-items-center text-fg-subtle"><span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /></div>;
  }

  const logout = async () => {
    await api('/staff/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };
  const initials = me.data.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <MeContext.Provider value={me.data}>
      <div className="flex h-full">
        {/* Rail, 56px: icons, the active one in a rounded outline; the account sits at the foot. */}
        <aside className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-deep py-3 md:flex">
          <Link href="/" className="mb-3 grid size-8 place-items-center rounded-md bg-accent text-[14px] font-bold text-on-accent" title="Pitwall">P</Link>
          {NAV.map(({ href, label, Icon, match }) => {
            const active = match(pathname);
            return (
              <Link key={href} href={href} title={label} aria-label={label}
                className={cn('relative grid size-9 place-items-center rounded-lg border transition-colors duration-150', active ? 'border-border-loud bg-active text-fg' : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg')}>
                <Icon />
                {href === '/' && summary.data && summary.data.unanswered > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-on-accent" title="Aguardando a equipe">{summary.data.unanswered}</span>
                )}
              </Link>
            );
          })}
          <div className="relative mt-auto">
            <button onClick={() => setMenu((v) => !v)} aria-label="Conta" aria-expanded={menu}
              className="grid size-8 place-items-center rounded-full bg-chip text-[12px] font-semibold text-fg hover:bg-hover">{initials}</button>
            {menu && (
              <div className="absolute bottom-0 left-11 z-[9999] w-56 rounded-lg border border-border bg-overlay p-1 shadow-popover" onMouseLeave={() => setMenu(false)}>
                <div className="px-2 py-1.5"><div className="truncate font-semibold text-fg">{me.data.name}</div><div className="truncate text-[12px] text-fg-muted">{me.data.email}</div></div>
                <div className="my-1 border-t border-border-subtle" />
                <Link href="/settings" onClick={() => setMenu(false)} className="flex h-7 items-center rounded-sm px-2 text-[13px] text-fg-secondary hover:bg-hover">Conta e equipe</Link>
                <button onClick={logout} className="flex h-7 w-full items-center rounded-sm px-2 text-left text-[13px] text-danger hover:bg-hover">Sair</button>
              </div>
            )}
          </div>
        </aside>
        {/* Context panel: only where the queue lives, since picking a product filters it. */}
        {(pathname === '/' || pathname.startsWith('/tickets')) && (
          <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-alt lg:flex">
            <div className="flex h-12 items-center px-4"><span className="text-[14px] font-semibold text-fg">Pitwall</span></div>
            {summary.data && <React.Suspense><ProductPanel products={summary.data.products} /></React.Suspense>}
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-border bg-alt px-4 py-2 md:hidden">
            <span className="font-semibold text-fg">Pitwall</span>
            <nav className="flex gap-3 overflow-x-auto text-[13px]">
              {NAV.map((n) => <Link key={n.href} href={n.href} className={n.match(pathname) ? 'font-semibold whitespace-nowrap text-sel-fg' : 'text-fg-muted whitespace-nowrap'}>{n.label}</Link>)}
            </nav>
          </div>
          {(me.data.mustChangePassword || me.data.totpRequired) && pathname !== '/settings' && (
            <div className="border-b border-warning/30 bg-warning/10 px-6 py-2 text-[13px] text-fg">
              {me.data.mustChangePassword ? 'Troque a senha temporária.' : 'Esta instalação exige o autenticador.'}{' '}
              <Link href="/settings" className="underline">Ir para Conta</Link>
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-y-auto bg-bg px-4 py-6 md:px-8"><div className="mx-auto max-w-6xl">{children}</div></main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
