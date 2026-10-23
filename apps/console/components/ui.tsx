'use client';

import * as React from 'react';

export function cn(...parts: Array<string | false | null | undefined>) { return parts.filter(Boolean).join(' '); }

export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'ghost' ? 'rounded-sm' : 'rounded-full border',
        size === 'sm' ? 'h-7 px-3 text-xs' : variant === 'ghost' ? 'h-7 px-2 text-[13px]' : 'h-[34px] px-4 text-[13px]',
        variant === 'primary' && 'border-transparent bg-btn text-btn-fg hover:bg-btn-hover',
        variant === 'secondary' && 'border-btn-outline bg-transparent text-fg hover:border-btn-outline-hover',
        variant === 'ghost' && 'text-fg-muted hover:bg-hover hover:text-fg',
        variant === 'danger' && 'border-btn-outline bg-transparent text-danger hover:border-danger',
        className,
      )}
    >
      {loading && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={cn('h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle hover:border-border-strong focus:border-focus focus:ring-2 focus:ring-focus', className)} />;
});

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle hover:border-border-strong focus:border-focus focus:ring-2 focus:ring-focus', className)} />;
}

export function Select({ className, options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select {...props} className={cn('h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-fg outline-none hover:border-border-strong focus:border-focus focus:ring-2 focus:ring-focus', className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[13px] text-fg-secondary">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Card({ className, children, title, actions }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className={cn('rounded-md border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function SideLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">{children}</p>;
}

const TONES: Record<string, string> = {
  info: 'bg-accent-bg text-accent-fg',
  running: 'bg-accent-bg text-accent-fg',
  warn: 'bg-warning/15 text-warning',
  ok: 'bg-success/15 text-success',
  error: 'bg-danger/15 text-danger',
  idle: 'bg-chip text-fg-muted',
};

export function Pill({ tone = 'idle', children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', TONES[tone] ?? TONES.idle, className)}>{children}</span>;
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em andamento', waiting_customer: 'Aguardando cliente',
  fixed_pending_deploy: 'Correção a caminho', resolved: 'Resolvido', closed: 'Fechado',
};
export const STATUS_TONE: Record<string, string> = {
  open: 'info', in_progress: 'running', waiting_customer: 'warn', fixed_pending_deploy: 'ok', resolved: 'ok', closed: 'idle',
};
export const SEVERITY_LABEL: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', critical: 'Crítica' };
export const SEVERITY_TONE: Record<string, string> = { low: 'idle', normal: 'info', high: 'warn', critical: 'error' };
export const CATEGORY_LABEL: Record<string, string> = { bug: 'Problema', question: 'Dúvida', feature: 'Sugestão', billing: 'Cobrança', other: 'Outro' };

export function StatusPill({ status }: { status: string }) { return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status] ?? status}</Pill>; }
export function SeverityPill({ severity }: { severity: string }) { return <Pill tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity] ?? severity}</Pill>; }

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-chip', className)} />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="px-6 py-12 text-center"><p className="font-semibold text-fg">{title}</p>{children && <div className="mt-1 text-[13px] text-fg-muted">{children}</div>}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-[13px]">
      {error instanceof Error ? error.message : 'Algo deu errado.'}
      {onRetry && <Button size="sm" variant="ghost" className="ml-2" onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0">
        <h1 className="text-xl/6 font-semibold text-fg">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[13px] text-fg-muted">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim p-4 pt-[6vh] backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cn('w-full rounded-lg border border-border bg-overlay shadow-popover', wide ? 'max-w-6xl' : 'max-w-lg')}>
        <header className="flex items-center border-b border-border-subtle px-5 py-3">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button className="ml-auto rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        <div className="p-5">{children}</div>
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
      <div className="fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn('rounded-lg border bg-overlay px-3 py-2.5 text-[13px] text-fg shadow-popover', t.tone === 'ok' ? 'border-success/40' : 'border-danger/40')}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
