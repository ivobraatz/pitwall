'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Me, type Summary } from '@/lib/api';
import { Lockup, Mark } from './brand';
import { ProductMark } from './product';
import { Avatar, Icon, IconArrow, IconButton, IconClose, IconMore, Segmented, cn } from './ui';

export const MeContext = React.createContext<Me | null>(null);
export function useMe() { return React.useContext(MeContext); }

// The channels of the pit wall: radio (tickets), the board (the team's tasks), the track map (the Atlas), telemetry (errors), the bulletin (releases), the cars (systems).
const IconTickets = () => <Icon size={18} d={<><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" /><path d="M8 10h8M8 13h5" /></>} />;
const IconTasks = () => <Icon size={18} d={<><rect x="3.5" y="4.5" width="5" height="15" rx="1.5" /><rect x="10.5" y="4.5" width="5" height="10" rx="1.5" /><rect x="17.5" y="4.5" width="3" height="6" rx="1.2" /></>} />;
const IconAtlas = () => <Icon size={18} d={<><rect x="4" y="4" width="6" height="5" rx="1.5" /><rect x="14" y="4" width="6" height="5" rx="1.5" /><rect x="9" y="15" width="6" height="5" rx="1.5" /><path d="M7 9v2.5h10V9M12 11.5V15" /></>} />;
const IconErrors = () => <Icon size={18} d={<path d="M3 12.5h3.5l2.2-6 4.3 11.5 2.6-8 1.6 2.5H21" />} />;
const IconReleases = () => <Icon size={18} d={<><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></>} />;
const IconProducts = () => <Icon size={18} d={<><rect x="3.5" y="4.5" width="17" height="4" rx="1.5" /><rect x="3.5" y="10" width="12" height="4" rx="1.5" /><rect x="3.5" y="15.5" width="7.5" height="4" rx="1.5" /></>} />;
const IconSettings = () => <Icon size={18} d={<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5" /></>} />;
const IconMenu = () => <Icon size={18} d={<path d="M4 7h16M4 12h16M4 17h10" />} />;
const IconSwap = () => <Icon size={14} d={<path d="m8 9 4-4 4 4M8 15l4 4 4-4" />} />;

type NavItem = { href: string; label: string; Icon: () => React.JSX.Element; match: (p: string) => boolean };
const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Atendimento', items: [
    { href: '/', label: 'Chamados', Icon: IconTickets, match: (p) => p === '/' || p.startsWith('/tickets') },
    { href: '/tasks', label: 'Tarefas', Icon: IconTasks, match: (p) => p.startsWith('/tasks') },
  ] },
  { label: 'Operação', items: [
    { href: '/atlas', label: 'Atlas', Icon: IconAtlas, match: (p) => p.startsWith('/atlas') },
    { href: '/errors', label: 'Erros', Icon: IconErrors, match: (p) => p.startsWith('/errors') },
    { href: '/releases', label: 'Novidades', Icon: IconReleases, match: (p) => p.startsWith('/releases') },
  ] },
  { label: 'Configuração', items: [
    { href: '/products', label: 'Sistemas', Icon: IconProducts, match: (p) => p.startsWith('/products') },
    { href: '/settings', label: 'Conta e equipe', Icon: IconSettings, match: (p) => p.startsWith('/settings') },
  ] },
];

/** Closes a popover on Escape or a click outside it. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open, close, ref]);
}

/** Light, dark, or whatever the system says; kept in this browser only. */
type Theme = 'system' | 'light' | 'dark';
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = React.useState<Theme>('system');
  React.useEffect(() => {
    try { const t = localStorage.getItem('pitwall-theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch { /* storage off */ }
  }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    try { if (t === 'system') localStorage.removeItem('pitwall-theme'); else localStorage.setItem('pitwall-theme', t); } catch { /* storage off */ }
    document.documentElement.dataset.mode = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  };
  return [theme, apply];
}

/** The timing tower, folded into the top of the side bar: every system with its open tickets and 24h errors. */
function TrackSwitcher({ products }: { products: Summary['products'] }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const waiting = products.filter((p) => p.awaitingUs > 0).length;
  const shown = products.slice(0, 4);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu"
        className="flex w-full items-center gap-3 rounded-tile bg-well p-2.5 text-left transition-colors duration-150 hover:bg-active">
        <span className="flex shrink-0 -space-x-1.5">
          {shown.length > 0
            ? shown.slice(0, 3).map((p) => <ProductMark key={p.id} product={p} size={24} className="ring-2 ring-well" />)
            : <span className="grid size-6 place-items-center rounded-lg bg-surface text-fg-subtle"><IconProducts /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-5 font-semibold text-fg">Na pista</span>
          <span className="block truncate text-[12px] leading-4 text-fg-muted">
            {products.length} {products.length === 1 ? 'sistema' : 'sistemas'}{waiting > 0 ? ` · ${waiting} esperando` : ''}
          </span>
        </span>
        <span className="text-fg-subtle"><IconSwap /></span>
      </button>
      {open && (
        <div role="menu" className="pop absolute top-full right-0 left-0 z-50 mt-2 w-[300px] overflow-hidden rounded-2xl bg-overlay p-1.5 shadow-popover">
          <div className="flex items-center px-2.5 pt-1.5 pb-2 text-[12px] text-fg-muted">
            <span>Sistema</span><span className="ml-auto w-14 text-right">Abertos</span><span className="w-14 text-right">Erros 24h</span>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            <Link role="menuitem" href="/" onClick={close} className="flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-[14px] text-fg hover:bg-well">
              <span className="grid size-6 place-items-center rounded-lg bg-well text-fg-muted"><IconProducts /></span>Todos os sistemas
            </Link>
            {products.map((p) => (
              <Link role="menuitem" key={p.id} href={`/?product=${p.id}`} onClick={close} className="flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-[14px] text-fg hover:bg-well">
                <ProductMark product={p} size={24} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.awaitingUs > 0 && <span className="size-[7px] shrink-0 rounded-full bg-accent ring-1 ring-on-accent/30" title="Aguardando a equipe" />}
                <span className="w-10 text-right tabular-nums">{p.open}</span>
                <span className={cn('w-14 text-right tabular-nums', p.errors24h > 0 ? 'font-semibold text-danger' : 'text-fg-subtle')}>{p.errors24h}</span>
              </Link>
            ))}
          </div>
          <Link href="/products" onClick={close} className="mt-1 flex h-10 items-center rounded-xl px-2.5 text-[13px] font-medium text-fg-muted hover:bg-well hover:text-fg">
            Gerenciar sistemas<span className="ml-auto"><IconArrow /></span>
          </Link>
        </div>
      )}
    </div>
  );
}

function NavLink({ item, active, badge, quiet, compact, onClick }: { item: NavItem; active: boolean; badge?: number; quiet?: number; compact?: boolean; onClick?: () => void }) {
  const { href, label, Icon: NavIcon } = item;
  return (
    <Link href={href} title={label} aria-current={active ? 'page' : undefined} onClick={onClick}
      className={cn('relative flex items-center gap-3 rounded-xl text-[14px] transition-colors duration-150',
        compact ? 'size-11 justify-center' : 'h-10 px-3',
        active ? 'bg-btn font-medium text-btn-fg' : 'text-fg-secondary hover:bg-well hover:text-fg')}>
      <span className={cn(active ? 'text-btn-fg' : 'text-fg-muted')}><NavIcon /></span>
      {!compact && <span className="truncate">{label}</span>}
      {badge !== undefined && badge > 0 && (
        <span title="Aguardando a equipe"
          className={cn('min-w-5 rounded-full bg-accent px-1.5 text-center text-[12px] leading-5 font-semibold text-on-accent tabular-nums', compact ? 'absolute -top-0.5 -right-0.5' : 'ml-auto')}>{badge}</span>
      )}
      {!compact && quiet !== undefined && quiet > 0 && (
        <span title="nas últimas 24h" className={cn('ml-auto text-[13px] tabular-nums', active ? 'text-btn-fg/70' : 'text-fg-subtle')}>{quiet}</span>
      )}
    </Link>
  );
}

/** The yellow card at the foot of the side bar: what is waiting on the team, one click from it. */
function SignalCard({ unanswered, onClick }: { unanswered: number; onClick?: () => void }) {
  if (unanswered === 0) {
    return (
      <div className="rounded-tile bg-well p-3">
        <div className="text-[13px] font-semibold text-fg">Pista livre</div>
        <div className="text-[12px] leading-4 text-fg-muted">Nenhum chamado esperando a equipe.</div>
      </div>
    );
  }
  return (
    <div className="rounded-tile bg-accent p-2.5 text-on-accent">
      <div className="flex items-center gap-2.5 px-0.5 pb-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-on-accent text-accent"><IconTickets /></span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-4 font-semibold">Aguardando a equipe</span>
          <span className="block text-[12px] leading-4 opacity-75">sem resposta ou com resposta nova</span>
        </span>
      </div>
      <Link href="/?unanswered=1" onClick={onClick}
        className="flex h-9 items-center rounded-full bg-surface px-3.5 text-[13px] font-semibold text-fg transition-transform duration-150 active:scale-[.98]">
        {unanswered} {unanswered === 1 ? 'chamado para responder' : 'chamados para responder'}<span className="ml-auto"><IconArrow /></span>
      </Link>
    </div>
  );
}

function AccountMenu({ me, onLogout, compact, onNavigate }: { me: Me; onLogout: () => void; compact?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [theme, setTheme] = useTheme();
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const role = me.role === 'admin' ? 'Admin' : 'Atendente';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="Conta" aria-expanded={open} aria-haspopup="menu"
        className={cn('flex w-full items-center gap-2.5 rounded-tile text-left transition-colors duration-150 hover:bg-well', compact ? 'justify-center p-1' : 'p-2')}>
        <Avatar name={me.name} size={36} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] leading-5 font-semibold text-fg">{me.name}</span>
              <span className="block truncate text-[12px] leading-4 text-fg-muted">{role}</span>
            </span>
            <span className="text-fg-subtle"><IconMore /></span>
          </>
        )}
      </button>
      {open && (
        <div role="menu" className={cn('pop absolute z-[100] w-72 rounded-2xl bg-overlay p-1.5 shadow-popover', compact ? 'bottom-0 left-full ml-3' : 'bottom-full left-0 mb-2')}>
          <div className="px-3 py-2.5">
            <div className="truncate text-[14px] font-semibold text-fg">{me.name}</div>
            <div className="truncate text-[13px] text-fg-muted">{me.email}</div>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="text-[13px] text-fg-muted">Tema</span>
            <Segmented className="ml-auto" size="sm" label="Tema" value={theme} onChange={setTheme}
              options={[{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]} />
          </div>
          <Link role="menuitem" href="/settings" onClick={() => { close(); onNavigate?.(); }} className="flex h-10 items-center rounded-xl px-3 text-[14px] text-fg-secondary hover:bg-well hover:text-fg">Conta e equipe</Link>
          <button role="menuitem" onClick={onLogout} className="flex h-10 w-full items-center rounded-xl px-3 text-left text-[14px] text-danger hover:bg-well">Sair</button>
        </div>
      )}
    </div>
  );
}

/** Signed-in frame: the side bar panel on the stone ground, the session check, and a redirect to /login when it lapses. */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = React.useState(false);
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

  React.useEffect(() => { setSheet(false); }, [pathname]);

  if (!me.data) {
    return <div className="grid h-full place-items-center"><Mark size={40} className="blink" /></div>;
  }

  const logout = async () => {
    await api('/staff/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };
  const unanswered = summary.data?.unanswered ?? 0;
  const errors24h = summary.data?.products.reduce((a, p) => a + p.errors24h, 0) ?? 0;
  const counts = (href: string) => ({ badge: href === '/' ? unanswered : undefined, quiet: href === '/errors' ? errors24h : undefined });

  const nav = (compact: boolean, onClick?: () => void) => (
    <nav className={cn('flex flex-col', compact ? 'items-center gap-1' : 'gap-5')} aria-label="Navegação">
      {GROUPS.map((g) => (
        <div key={g.label} className={cn('flex flex-col gap-0.5', compact && 'items-center')}>
          {!compact && <div className="px-3 pb-1 text-[12px] font-medium text-fg-subtle">{g.label}</div>}
          {g.items.map((item) => <NavLink key={item.href} item={item} active={item.match(pathname)} compact={compact} onClick={onClick} {...counts(item.href)} />)}
        </div>
      ))}
    </nav>
  );

  return (
    <MeContext.Provider value={me.data}>
      <div className="flex h-full flex-col bg-bg md:flex-row md:gap-3 md:p-3">
        {/* Side bar: a rail of icons on tablets, the full panel (names, the timing tower, the signal card) from lg up. */}
        <aside className="hidden w-[76px] shrink-0 flex-col rounded-panel bg-surface p-3 md:flex lg:w-[252px]">
          <Link href="/" className="mb-4 flex h-11 items-center justify-center lg:justify-start lg:px-1.5" aria-label="Pitwall, início">
            <span className="lg:hidden"><Mark size={34} /></span>
            <span className="hidden lg:inline-flex"><Lockup size={34} /></span>
          </Link>
          {summary.data && <div className="mb-5 hidden lg:block"><TrackSwitcher products={summary.data.products} /></div>}
          <div className="hidden min-h-0 flex-1 overflow-y-auto lg:block">{nav(false)}</div>
          <div className="min-h-0 flex-1 overflow-y-auto lg:hidden">{nav(true)}</div>
          <div className="mt-3 flex flex-col gap-2">
            {summary.data && <div className="hidden lg:block"><SignalCard unanswered={unanswered} /></div>}
            <div className="lg:hidden"><AccountMenu me={me.data} onLogout={logout} compact /></div>
            <div className="hidden lg:block"><AccountMenu me={me.data} onLogout={logout} /></div>
          </div>
        </aside>

        {/* Phone: a bar on the ground with the mark and a menu that opens the whole side bar as a sheet. */}
        <div className="flex h-14 shrink-0 items-center gap-3 px-4 md:hidden">
          <Link href="/" aria-label="Pitwall, início"><Lockup size={30} /></Link>
          {unanswered > 0 && (
            <Link href="/?unanswered=1" className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-semibold text-on-accent tabular-nums">{unanswered} esperando</Link>
          )}
          <IconButton className={cn(unanswered > 0 ? '' : 'ml-auto')} onClick={() => setSheet(true)} aria-label="Abrir menu" aria-expanded={sheet}><IconMenu /></IconButton>
        </div>
        {sheet && (
          <div className="fade-in fixed inset-0 z-50 flex flex-col bg-bg p-3 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="pop flex min-h-0 flex-1 flex-col rounded-panel bg-surface p-3">
              <div className="mb-4 flex items-center px-1.5">
                <Lockup size={30} />
                <IconButton className="ml-auto" size={36} onClick={() => setSheet(false)} aria-label="Fechar menu"><IconClose /></IconButton>
              </div>
              {summary.data && <div className="mb-5"><TrackSwitcher products={summary.data.products} /></div>}
              <div className="min-h-0 flex-1 overflow-y-auto">{nav(false, () => setSheet(false))}</div>
              <div className="mt-3 flex flex-col gap-2">
                {summary.data && <SignalCard unanswered={unanswered} onClick={() => setSheet(false)} />}
                <AccountMenu me={me.data} onLogout={logout} onNavigate={() => setSheet(false)} />
              </div>
            </div>
          </div>
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-8 md:px-1 md:pt-1 md:pb-3">
          <div className="mx-auto max-w-[1400px]">
            {(me.data.mustChangePassword || me.data.totpRequired) && pathname !== '/settings' && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-tile bg-accent-bg px-4 py-3 text-[14px] font-medium text-fg">
                <span className="size-[7px] rounded-full bg-warning" />
                {me.data.mustChangePassword ? 'Troque a senha temporária antes de seguir.' : 'Esta instalação exige o autenticador.'}
                <Link href="/settings" className="ml-auto font-semibold underline underline-offset-2">Ir para Conta</Link>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </MeContext.Provider>
  );
}
