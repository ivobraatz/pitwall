'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Me, type Summary } from '@/lib/api';
import { Lockup, Mark } from './brand';
import { ProductMark, ProductStripe } from './product';
import { Icon, cn } from './ui';

export const MeContext = React.createContext<Me | null>(null);
export function useMe() { return React.useContext(MeContext); }

// The channels of the pit wall: radio (tickets), the board (the team's tasks), telemetry (errors), the bulletin (releases), the cars (systems).
const IconTickets = () => <Icon size={20} d={<><path d="M4 6h16v9H9l-5 4Z" /><path d="M8 10h8" /></>} />;
const IconTasks = () => <Icon size={20} d={<><path d="M4 5h4.5v14H4ZM10 5h4.5v9H10ZM16 5h4v6h-4Z" /></>} />;
const IconErrors = () => <Icon size={20} d={<path d="M3 13h4l2-6 4 12 2.5-8L17 13h4" />} />;
const IconReleases = () => <Icon size={20} d={<><path d="M5 4h14v16H5Z" /><path d="M9 9h6M9 13h6M9 17h3" /></>} />;
const IconProducts = () => <Icon size={20} d={<><path d="M4 5h16v4H4ZM4 10.5h11v4H4ZM4 16h7v4H4Z" /></>} />;
const IconSettings = () => <Icon size={20} d={<><path d="M12 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5" /></>} />;

const NAV = [
  { href: '/', label: 'Chamados', Icon: IconTickets, match: (p: string) => p === '/' || p.startsWith('/tickets') },
  { href: '/tasks', label: 'Tarefas', Icon: IconTasks, match: (p: string) => p.startsWith('/tasks') },
  { href: '/errors', label: 'Erros', Icon: IconErrors, match: (p: string) => p.startsWith('/errors') },
  { href: '/releases', label: 'Novidades', Icon: IconReleases, match: (p: string) => p.startsWith('/releases') },
  { href: '/products', label: 'Sistemas', Icon: IconProducts, match: (p: string) => p.startsWith('/products') },
  { href: '/settings', label: 'Conta e equipe', Icon: IconSettings, match: (p: string) => p.startsWith('/settings') },
];

/** The timing tower: each system with its team colour, open tickets and 24h errors. Picking one filters the queue. */
function ProductPanel({ products }: { products: Summary['products'] }) {
  const params = useSearchParams();
  const [filter, setFilter] = React.useState('');
  const selected = params.get('product');
  const shown = products.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  const item = (active: boolean) => cn('group flex h-10 items-center gap-3 pr-3 text-[14px] transition-colors duration-150', active ? 'bg-sel text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg');
  return (
    <div className="mt-6 flex min-h-0 flex-col">
      <div className="flex items-baseline px-5 pb-2 text-[13px] font-semibold text-fg-muted">
        <span>Na pista</span><span className="ml-auto tabular-nums">{products.length}</span>
      </div>
      {products.length > 6 && (
        <div className="px-3 pb-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar sistemas" aria-label="Filtrar sistemas"
            className="h-9 w-full bg-surface px-3 text-[14px] text-fg outline-none placeholder:text-fg-subtle focus:bg-hover" />
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3">
        <Link href="/" className={item(!selected)}><span className="h-full w-1 bg-fg-subtle" />Todos os sistemas</Link>
        {shown.map((p) => (
          <Link key={p.id} href={`/?product=${p.id}`} className={item(selected === p.id)} title="chamados abertos · erros nas últimas 24h">
            <ProductStripe product={p} className="h-full w-1" />
            <ProductMark product={p} size={20} />
            <span className="truncate">{p.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2 text-[13px] tabular-nums">
              {p.awaitingUs > 0 && <span className="size-2 bg-warning" title="aguardando a equipe" />}
              <span className="text-fg">{p.open}</span>
              <span className={cn('w-6 text-right', p.errors24h > 0 ? 'font-semibold text-danger' : 'text-fg-subtle')}>{p.errors24h}</span>
            </span>
          </Link>
        ))}
        {shown.length === 0 && <p className="px-2 py-2 text-[13px] text-fg-muted">Nenhum sistema.</p>}
      </div>
    </div>
  );
}

/** Signed-in frame: the side bar, the session check, and a redirect to /login when it lapses. */
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
    return <div className="grid h-full place-items-center"><Mark size={40} className="blink" /></div>;
  }

  const logout = async () => {
    await api('/staff/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };
  const initials = me.data.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const unanswered = summary.data?.unanswered ?? 0;
  const onQueue = pathname === '/' || pathname.startsWith('/tickets');

  return (
    <MeContext.Provider value={me.data}>
      <div className="flex h-full">
        {/* Side bar: a rail of icons on tablets, the full board (names + timing tower) from lg up. */}
        <aside className="hidden w-[72px] shrink-0 flex-col bg-alt py-4 md:flex lg:w-64">
          <Link href="/" className="mb-6 flex h-10 items-center justify-center text-[26px] lg:justify-start lg:px-5" aria-label="Pitwall, início">
            <span className="lg:hidden"><Mark size={32} /></span>
            <span className="hidden lg:inline-flex"><Lockup size={30} /></span>
          </Link>
          <nav className="flex flex-col gap-0.5 px-3">
            {NAV.map(({ href, label, Icon: NavIcon, match }) => {
              const active = match(pathname);
              return (
                <Link key={href} href={href} title={label} aria-current={active ? 'page' : undefined}
                  className={cn('relative flex h-11 items-center justify-center gap-3 text-[15px] transition-colors duration-150 lg:justify-start lg:px-3',
                    active ? 'bg-active font-semibold text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>
                  <span className={cn(active && 'text-accent-fg')}><NavIcon /></span>
                  <span className="hidden lg:inline">{label}</span>
                  {href === '/' && unanswered > 0 && (
                    <span className="absolute top-1 right-1 min-w-5 bg-accent px-1 text-center text-[13px] leading-5 font-bold text-on-accent tabular-nums lg:static lg:ml-auto" title="Aguardando a equipe">{unanswered}</span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
            {onQueue && summary.data && <React.Suspense><ProductPanel products={summary.data.products} /></React.Suspense>}
          </div>
          <div className="relative mt-auto px-3 pt-4">
            <button onClick={() => setMenu((v) => !v)} aria-label="Conta" aria-expanded={menu}
              className="flex h-12 w-full items-center justify-center gap-3 text-left transition-colors hover:bg-hover lg:justify-start lg:px-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-chip text-[13px] font-bold text-fg">{initials}</span>
              <span className="hidden min-w-0 lg:block">
                <span className="block truncate text-[14px] font-semibold text-fg">{me.data.name}</span>
                <span className="block truncate text-[13px] text-fg-muted">{me.data.role === 'admin' ? 'Admin' : 'Atendente'}</span>
              </span>
            </button>
            {menu && (
              <div className="rise absolute bottom-0 left-full z-[9999] ml-2 w-64 bg-overlay p-1.5 shadow-popover lg:bottom-full lg:left-3 lg:mb-2 lg:ml-0" onMouseLeave={() => setMenu(false)}>
                <div className="px-3 py-2.5"><div className="truncate font-semibold text-fg">{me.data.name}</div><div className="truncate text-[13px] text-fg-muted">{me.data.email}</div></div>
                <Link href="/settings" onClick={() => setMenu(false)} className="flex h-10 items-center px-3 text-[14px] text-fg-secondary hover:bg-hover hover:text-fg">Conta e equipe</Link>
                <button onClick={logout} className="flex h-10 w-full items-center px-3 text-left text-[14px] text-danger hover:bg-hover">Sair</button>
              </div>
            )}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-4 bg-alt px-4 py-3 md:hidden">
            <Link href="/" aria-label="Pitwall"><Mark size={28} /></Link>
            <nav className="flex gap-1 overflow-x-auto text-[14px]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={cn('flex h-9 items-center px-3 whitespace-nowrap', n.match(pathname) ? 'bg-active font-semibold text-fg' : 'text-fg-muted')}>{n.label}</Link>
              ))}
            </nav>
          </div>
          {(me.data.mustChangePassword || me.data.totpRequired) && pathname !== '/settings' && (
            <div className="flex items-center gap-3 bg-warning px-6 py-2.5 text-[14px] font-semibold text-on-status">
              {me.data.mustChangePassword ? 'Troque a senha temporária antes de seguir.' : 'Esta instalação exige o autenticador.'}
              <Link href="/settings" className="underline underline-offset-2">Ir para Conta</Link>
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-y-auto bg-bg px-4 py-8 md:px-8 lg:px-12 lg:py-10"><div className="mx-auto max-w-[1360px]">{children}</div></main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
