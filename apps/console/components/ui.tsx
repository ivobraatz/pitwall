'use client';

import * as React from 'react';

export function cn(...parts: Array<string | false | null | undefined>) { return parts.filter(Boolean).join(' '); }

// ── Icons (1.75px strokes, round caps; one outline set, grey unless active) ──────────────

export function Icon({ d, size = 18, className }: { d: React.ReactNode; size?: number; className?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{d}</svg>;
}
export const IconClose = () => <Icon size={16} d={<path d="M6 6l12 12M18 6 6 18" />} />;
export const IconClip = () => <Icon d={<path d="M16.5 7.5 8.6 15.4a2.1 2.1 0 0 0 3 3l8-8a4.2 4.2 0 0 0-6-6l-8 8a6.3 6.3 0 0 0 9 9l6-6" />} />;
export const IconChevron = ({ open }: { open?: boolean }) => <Icon size={14} className={cn('transition-transform duration-200', open && 'rotate-90')} d={<path d="m9 6 6 6-6 6" />} />;
export const IconArrow = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<path d="M5 12h14M13 6l6 6-6 6" />} />;
export const IconSearch = ({ size = 16 }: { size?: number }) => <Icon size={size} d={<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>} />;
export const IconPlus = ({ size = 16 }: { size?: number }) => <Icon size={size} d={<path d="M12 5v14M5 12h14" />} />;
export const IconMore = ({ size = 16 }: { size?: number }) => <Icon size={size} d={<><circle cx="5" cy="12" r=".9" /><circle cx="12" cy="12" r=".9" /><circle cx="19" cy="12" r=".9" /></>} />;
export const IconCheck = ({ size = 14 }: { size?: number }) => <Icon size={size} d={<path d="m5 12.5 4.5 4.5L19 7.5" />} />;

// ── Controls ───────────────────────────────────────────────────────────────────────────
// Controls are full pills. One filled primary per screen, in ink; the yellow `accent` variant is the
// brand signal and is kept for the rare action that answers what is waiting on the team.

export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,transform] duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3.5 text-[13px]' : 'h-10 px-5 text-[14px]',
        variant === 'primary' && 'bg-btn text-btn-fg hover:bg-btn-hover',
        variant === 'accent' && 'bg-accent text-on-accent hover:bg-accent-hover',
        variant === 'secondary' && 'border border-border bg-surface text-fg hover:border-border-strong hover:bg-hover',
        variant === 'ghost' && 'text-fg-muted hover:bg-well hover:text-fg',
        variant === 'danger' && 'bg-danger/10 text-danger hover:bg-danger/15',
        className,
      )}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

/** A round button that holds one icon (always pass aria-label). */
export function IconButton({ className, size = 40, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: number }) {
  return (
    <button {...props} style={{ width: size, height: size, ...props.style }}
      className={cn('inline-grid shrink-0 place-items-center rounded-full border border-border bg-surface text-fg-secondary transition-colors duration-150 hover:border-border-strong hover:text-fg disabled:opacity-50', className)}>
      {children}
    </button>
  );
}

const FIELD = 'border border-border bg-surface text-[14px] text-fg outline-none transition-colors duration-150 placeholder:text-fg-subtle hover:border-border-strong focus:border-border-loud focus:ring-4 focus:ring-fg/[.07] focus-visible:outline-0 disabled:opacity-60';

/** `code` sets the field in the code face: for literal code only (keys, secrets, URLs, stack-frame prefixes). */
const CODE = 'font-mono text-[13px]'; // taste-skill-ignore: these fields hold literal code

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { code?: boolean }>(function Input({ className, code, ...props }, ref) {
  return <input ref={ref} {...props} className={cn(FIELD, 'h-10 w-full rounded-full px-4', code && CODE, className)} />;
});

/** A search pill with its glass icon; behaves like Input. */
export const SearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function SearchInput({ className, ...props }, ref) {
  return (
    <label className={cn('relative block', className)}>
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle"><IconSearch /></span>
      <input ref={ref} type="search" {...props} className={cn(FIELD, 'h-10 w-full rounded-full pr-4 pl-10')} />
    </label>
  );
});

export function Textarea({ className, code, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { code?: boolean }) {
  return <textarea {...props} className={cn(FIELD, 'w-full rounded-tile px-4 py-3 leading-[1.5]', code && CODE, className)} />;
}

export function Select({ className, options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select {...props} className={cn(FIELD, 'select-chevron h-10 cursor-pointer rounded-full pr-9 pl-4', className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A filter chip that toggles: white pill at rest, ink when on. */
export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
      checked ? 'border-btn bg-btn text-btn-fg' : 'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg')}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {checked && <IconCheck />}
      {children}
    </label>
  );
}

/**
 * A segmented track: the options as pills inside one well, the chosen one in ink. For views, tabs and
 * periods (as wide as its options; never stretched across a card).
 */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className, label }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode; count?: number }>;
  size?: 'sm' | 'md'; className?: string; label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-well p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-150',
              size === 'sm' ? 'h-7 px-3 text-[13px]' : 'h-8 px-3.5 text-[14px]',
              on ? 'bg-btn text-btn-fg' : 'text-fg-muted hover:text-fg')}>
            {o.label}
            {o.count !== undefined && <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-fg-subtle')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[13px] font-semibold text-fg-secondary">{label}</span>
      {children}
      {hint && <span className="text-[13px] leading-[1.45] text-fg-muted">{hint}</span>}
    </label>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────────────────

/** A panel: white on the stone ground, 20px corners, no line, no shadow. Header = title (+ subtitle) and actions. */
export function Card({ className, children, title, subtitle, actions, style }: { className?: string; children: React.ReactNode; title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className={cn('rounded-panel bg-surface', className)} style={style}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[16px] leading-6 font-semibold tracking-[-0.01em] text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-fg-muted">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SideLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[13px] font-medium text-fg-muted">{children}</p>;
}

/** A person: initials on a pale disc. */
export function Avatar({ name, size = 28, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const text = (name ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center rounded-full bg-chip font-semibold text-fg-secondary', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) }}>{text}</span>
  );
}

const TONES: Record<string, string> = {
  info: 'bg-info/10 text-info',
  running: 'bg-running/10 text-running',
  warn: 'bg-warning/10 text-warning',
  ok: 'bg-success/10 text-success',
  error: 'bg-danger/10 text-danger',
  accent: 'bg-accent text-on-accent',
  ink: 'bg-btn text-btn-fg',
  idle: 'bg-chip text-fg-secondary',
};

/** A small pill: pale tint of its tone with the word in sentence case. `accent` is the yellow signal. */
export function Pill({ tone = 'idle', children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 flex-none items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap', TONES[tone] ?? TONES.idle, className)}>{children}</span>;
}

/** A 7px status dot; the colour is the meaning. */
export function Dot({ tone = 'idle', className }: { tone?: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-[7px] shrink-0 rounded-full', DOT[tone] ?? DOT.idle, className)} />;
}
const DOT: Record<string, string> = {
  info: 'bg-info', running: 'bg-running', warn: 'bg-warning', ok: 'bg-success', error: 'bg-danger',
  accent: 'bg-accent', idle: 'bg-fg-subtle', done: 'bg-border-strong',
};

export const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em andamento', waiting_customer: 'Aguardando cliente',
  fixed_pending_deploy: 'Correção a caminho', resolved: 'Resolvido', closed: 'Fechado',
};
export const STATUS_TONE: Record<string, string> = {
  open: 'info', in_progress: 'running', waiting_customer: 'warn', fixed_pending_deploy: 'ok', resolved: 'ok', closed: 'idle',
};
/** The dot of each state: live ones in their colour, finished ones quiet. */
export const STATUS_DOT: Record<string, string> = {
  open: 'info', in_progress: 'running', waiting_customer: 'warn', fixed_pending_deploy: 'ok', resolved: 'done', closed: 'done',
};
export const SEVERITY_LABEL: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', critical: 'Crítica' };
export const SEVERITY_TONE: Record<string, string> = { low: 'idle', normal: 'info', high: 'warn', critical: 'error' };
export const CATEGORY_LABEL: Record<string, string> = { bug: 'Problema', question: 'Dúvida', feature: 'Sugestão', billing: 'Cobrança', other: 'Outro', contact: 'Contato' };

/** The state of a ticket: a grey pill with the state's dot; finished states read quieter. */
export function StatusPill({ status, wide }: { status: string; wide?: boolean }) {
  const done = status === 'resolved' || status === 'closed';
  return (
    <span className={cn('inline-flex h-7 flex-none items-center gap-2 rounded-full bg-chip px-3 text-[13px] font-medium whitespace-nowrap', wide && 'w-[168px]', done ? 'text-fg-muted' : 'text-fg')}>
      <Dot tone={STATUS_DOT[status] ?? 'idle'} />{STATUS_LABEL[status] ?? status}
    </span>
  );
}
export function SeverityPill({ severity }: { severity: string }) {
  const loud = severity === 'high' || severity === 'critical';
  return (
    <span className={cn('inline-flex flex-none items-center gap-1.5 text-[13px] whitespace-nowrap', severity === 'critical' ? 'font-semibold text-danger' : loud ? 'font-medium text-warning' : 'text-fg-muted')}>
      {loud && <Dot tone={SEVERITY_TONE[severity]} />}{SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

/** Loading: a flat bar at the size of what will land there. */
export function Shimmer({ className }: { className?: string }) {
  return <div aria-hidden className={cn('rounded-tile bg-well', className)} />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[14px] leading-[1.5] text-fg-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-tile bg-danger/8 px-5 py-4 text-[14px] text-fg">
      <Dot tone="error" />
      {error instanceof Error ? error.message : 'Algo deu errado.'}
      {onRetry && <Button size="sm" variant="ghost" className="ml-auto" onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

/** The title row of a screen: a noun at 26px, an optional line about the data, actions on the right. */
export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
      <div className="min-w-0">
        {back && <div className="mb-1 text-[13px] text-fg-muted">{back}</div>}
        <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.025em] text-fg">{title}</h1>
        {subtitle && <div className="mt-1 max-w-3xl text-[14px] leading-[1.5] text-fg-muted">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim p-4 pt-[8vh]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cn('pop w-full rounded-3xl bg-overlay shadow-popover', wide ? 'max-w-6xl' : 'max-w-lg')}>
        <header className="flex items-center gap-3 px-6 pt-5 pb-1">
          <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">{title}</h2>
          <IconButton className="ml-auto" size={36} onClick={onClose} aria-label="Fechar"><IconClose /></IconButton>
        </header>
        <div className="p-6 pt-4">{children}</div>
      </div>
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────────────

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function rel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('pt-BR');
}
export function dateTime(iso: string | null | undefined): string { return iso ? new Date(iso).toLocaleString('pt-BR') : '—'; }
export function bytes(n: number): string { return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
export function duration(ms: number): string { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ── Toasts (tiny) ───────────────────────────────────────────────────────────────────

type Toast = { id: number; tone: 'ok' | 'error'; text: string };
const ToastContext = React.createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export function useToast() { return React.useContext(ToastContext); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }].slice(-4));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pop flex items-center gap-3 rounded-tile bg-overlay px-4 py-3 text-[14px] text-fg shadow-popover">
            <Dot tone={t.tone === 'ok' ? 'ok' : 'error'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
