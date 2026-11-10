'use client';

import * as React from 'react';

export function cn(...parts: Array<string | false | null | undefined>) { return parts.filter(Boolean).join(' '); }

// ── Icons (1.75px strokes, square caps: drawn for the board, not borrowed) ─────────────

export function Icon({ d, size = 18, className }: { d: React.ReactNode; size?: number; className?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" className={className} aria-hidden>{d}</svg>;
}
export const IconClose = () => <Icon size={16} d={<path d="M6 6l12 12M18 6 6 18" />} />;
export const IconClip = () => <Icon d={<path d="M16.5 7.5 8.6 15.4a2.1 2.1 0 0 0 3 3l8-8a4.2 4.2 0 0 0-6-6l-8 8a6.3 6.3 0 0 0 9 9l6-6" />} />;
export const IconChevron = ({ open }: { open?: boolean }) => <Icon size={14} className={cn('transition-transform duration-200', open && 'rotate-90')} d={<path d="m9 6 6 6-6 6" />} />;

// ── Controls ───────────────────────────────────────────────────────────────────────────

export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none',
        'transition-[background-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-[14px]',
        variant === 'primary' && 'bg-btn text-btn-fg hover:bg-btn-hover disabled:bg-chip disabled:text-fg-muted disabled:opacity-100',
        variant === 'secondary' && 'bg-chip text-fg hover:bg-active',
        variant === 'ghost' && 'text-fg-muted hover:bg-hover hover:text-fg',
        variant === 'danger' && 'bg-danger/12 text-danger hover:bg-danger hover:text-on-status',
        className,
      )}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

const FIELD = 'border border-border bg-well text-[14px] text-fg outline-none transition-colors duration-150 placeholder:text-fg-subtle hover:border-border-strong focus:border-focus focus-visible:outline-1 focus-visible:-outline-offset-2 disabled:opacity-60';

/** `code` sets the field in the code face: for literal code only (keys, secrets, URLs, stack-frame prefixes). */
const CODE = 'font-mono text-[13px]'; // taste-skill-ignore: these fields hold literal code

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { code?: boolean }>(function Input({ className, code, ...props }, ref) {
  return <input ref={ref} {...props} className={cn(FIELD, 'h-10 w-full px-3', code && CODE, className)} />;
});

export function Textarea({ className, code, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { code?: boolean }) {
  return <textarea {...props} className={cn(FIELD, 'w-full px-3 py-2.5 leading-[1.5]', code && CODE, className)} />;
}

export function Select({ className, options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select {...props} className={cn(FIELD, 'h-10 cursor-pointer px-3 pr-8', className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={cn('inline-flex h-10 cursor-pointer items-center gap-2 px-3 text-[14px] transition-colors duration-150', checked ? 'bg-accent-bg text-fg' : 'bg-surface text-fg-secondary hover:bg-hover')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[14px] font-semibold text-fg-secondary">{label}</span>
      {children}
      {hint && <span className="text-[13px] leading-[1.45] text-fg-muted">{hint}</span>}
    </label>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────────────────

/** A tile of the board: a flat fill one step from the ground. No outline, no shadow. */
export function Card({ className, children, title, actions, style }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className={cn('bg-surface', className)} style={style}>
      {(title || actions) && (
        <header className="flex min-h-12 flex-wrap items-center gap-2 px-5 pt-4 pb-2">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function SideLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[13px] font-semibold text-fg-muted">{children}</p>;
}

const TONES: Record<string, string> = {
  info: 'bg-info/15 text-info',
  running: 'bg-running/15 text-running',
  warn: 'bg-warning/15 text-warning',
  ok: 'bg-success/15 text-success',
  error: 'bg-danger/15 text-danger',
  accent: 'bg-accent-bg text-accent-fg',
  idle: 'bg-chip text-fg-muted',
};

/** A small square tag: tone fill, the word in sentence case. */
export function Pill({ tone = 'idle', children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 items-center px-2 text-[13px] font-semibold whitespace-nowrap', TONES[tone] ?? TONES.idle, className)}>{children}</span>;
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em andamento', waiting_customer: 'Aguardando cliente',
  fixed_pending_deploy: 'Correção a caminho', resolved: 'Resolvido', closed: 'Fechado',
};
export const STATUS_TONE: Record<string, string> = {
  open: 'info', in_progress: 'running', waiting_customer: 'warn', fixed_pending_deploy: 'ok', resolved: 'ok', closed: 'idle',
};
/** Live states get a solid block, like the status column of a departure board; finished ones go quiet. */
const STATUS_BLOCK: Record<string, string> = {
  open: 'bg-info text-on-status', in_progress: 'bg-running text-on-status', waiting_customer: 'bg-warning text-on-status',
  fixed_pending_deploy: 'bg-success text-on-status', resolved: 'bg-success/15 text-success', closed: 'bg-chip text-fg-muted',
};
export const SEVERITY_LABEL: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', critical: 'Crítica' };
export const SEVERITY_TONE: Record<string, string> = { low: 'idle', normal: 'info', high: 'warn', critical: 'error' };
const SEVERITY_DOT: Record<string, string> = { low: 'bg-fg-subtle', normal: 'bg-info', high: 'bg-warning', critical: 'bg-danger' };
export const CATEGORY_LABEL: Record<string, string> = { bug: 'Problema', question: 'Dúvida', feature: 'Sugestão', billing: 'Cobrança', other: 'Outro', contact: 'Contato' };

export function StatusPill({ status, wide }: { status: string; wide?: boolean }) {
  return <span className={cn('inline-flex h-7 items-center px-2.5 text-[13px] font-semibold whitespace-nowrap', wide && 'w-40', STATUS_BLOCK[status] ?? STATUS_BLOCK.closed)}>{STATUS_LABEL[status] ?? status}</span>;
}
export function SeverityPill({ severity }: { severity: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-[13px] whitespace-nowrap', severity === 'critical' ? 'font-semibold text-danger' : 'text-fg-secondary')}>
      <span className={cn('size-2.5 shrink-0', SEVERITY_DOT[severity] ?? SEVERITY_DOT.normal)} />{SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-surface', className)} />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-14">
      <p className="display text-[28px] text-fg">{title}</p>
      {children && <div className="mt-3 max-w-xl text-[15px] leading-[1.5] text-fg-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-danger/12 px-5 py-4 text-[14px] text-fg">
      <span className="size-2.5 shrink-0 bg-danger" />
      {error instanceof Error ? error.message : 'Algo deu errado.'}
      {onRetry && <Button size="sm" variant="ghost" className="ml-auto" onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rise mb-8 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="display text-[40px] text-fg md:text-[52px]">{title}</h1>
        {subtitle && <div className="mt-3 max-w-2xl text-[15px] leading-[1.5] text-fg-muted">{subtitle}</div>}
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
      <div role="dialog" aria-modal="true" className={cn('rise w-full bg-overlay shadow-popover', wide ? 'max-w-6xl' : 'max-w-lg')}>
        <header className="flex items-center px-6 pt-5 pb-1">
          <h2 className="display text-[26px] text-fg">{title}</h2>
          <button className="ml-auto grid size-9 place-items-center text-fg-muted transition-colors hover:bg-hover hover:text-fg" onClick={onClose} aria-label="Fechar"><IconClose /></button>
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
          <div key={t.id} className="rise flex items-stretch bg-overlay text-[14px] text-fg shadow-popover">
            <span className={cn('w-1.5 shrink-0', t.tone === 'ok' ? 'bg-success' : 'bg-danger')} />
            <span className="px-4 py-3">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
