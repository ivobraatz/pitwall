import { installDiagnostics, recordError, recordEvent, recordLog, recordRequest, type AppInfo } from './buffer.js';
import { PitwallClient, type FetchLike } from './client.js';
import { setDefaultPrefs } from './prefs.js';
import { installRecorder, startProcedure, stopProcedure, type RecordingOptions } from './recorder.js';
import { Store } from './store.js';
import type { LogEntry, RequestEntry, ServerFailure } from './types.js';

export type Locale = 'pt' | 'en';

export interface PitwallConfig {
  /** The product's support bridge, e.g. `/api/v1/support`. Same origin, or a CORS-enabled one. */
  endpoint: string;
  /** The fetch used for the bridge; defaults to `window.fetch`. */
  fetch?: FetchLike;
  /** Extra headers for the bridge (a bearer token, a workspace id). Cookies go along anyway. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** The running build, stamped on every diagnostics bundle. `extra` adds product context (plan, workspace slug…). */
  app?: AppInfo;
  locale?: Locale | (() => Locale);
  /** Mirror `console.*` into the log buffer. Default true. */
  captureConsole?: boolean;
  /**
   * Record the page's own `fetch` calls (method, path, status, duration, trace id — never bodies).
   * Default: same-origin requests. `false` to report them yourself with `recordRequest`.
   */
  captureFetch?: boolean | { match?: (url: URL) => boolean; traceHeaders?: string[] };
  recording?: RecordingOptions & {
    /** Default for the rolling buffer when the person has not chosen. Default true. */
    retroactive?: boolean;
  };
  /** Offer a ticket (or say "we know") when a request fails with a 5xx. Default true. */
  errorPrompt?: boolean;
  /** Where the product shows one ticket: `(id) => '/support/view?id=' + id`. */
  ticketHref?: (id: string) => string;
  /** How to go there — a router push in single-page apps. Default `location.assign`. */
  navigate?: (href: string) => void;
}

export interface NewTicketPrefill {
  title?: string;
  body?: string;
  /** Trace id of the failing request the ticket is being opened from. */
  traceId?: string;
  /** Attach the rolling buffer by default (an error-born ticket wants what led up to it). */
  attachRetroactive?: boolean;
  /** The screen the report is about, when it is not the current one. */
  route?: string;
}

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}

export interface UiState {
  newTicketOpen: boolean;
  prefill: NewTicketPrefill;
  toasts: Toast[];
}

/** How long after one server-error prompt before the next for the same path. */
const PROMPT_COOLDOWN_MS = 20_000;

export class Pitwall {
  readonly client: PitwallClient;
  readonly ui = new Store<UiState>({ newTicketOpen: false, prefill: {}, toasts: [] });
  private lastPrompt = new Map<string, number>();
  private toastSeq = 0;
  private teardown: Array<() => void> = [];

  constructor(readonly config: PitwallConfig) {
    const fetchImpl = config.fetch ?? ((input, init) => window.fetch(input, init));
    this.client = new PitwallClient(config.endpoint, fetchImpl, config.headers ?? (() => ({})));
  }

  get locale(): Locale {
    const l = typeof this.config.locale === 'function' ? this.config.locale() : this.config.locale;
    if (l) return l;
    return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  }

  /** @internal */
  start(): void {
    setDefaultPrefs({ bufferEnabled: this.config.recording?.retroactive ?? true });
    installDiagnostics(this.config.app ?? {}, { captureConsole: this.config.captureConsole ?? true });
    this.teardown.push(installRecorder(this.config.recording ?? {}));
    if (this.config.captureFetch !== false) this.teardown.push(this.instrumentFetch());
  }

  destroy(): void {
    for (const t of this.teardown) t();
    this.teardown = [];
  }

  // ── What products call ────────────────────────────────────────────────────────────

  openNewTicket(prefill: NewTicketPrefill = {}): void { this.ui.set({ newTicketOpen: true, prefill }); }
  closeNewTicket(): void { this.ui.set({ newTicketOpen: false, prefill: {} }); }

  /** "Record the steps": closes nothing, starts the procedure recording and shows the bar. */
  startRecording(): Promise<void> { return startProcedure(); }
  async stopRecording(): Promise<void> {
    const r = await stopProcedure();
    if (r) this.openNewTicket();
  }

  log(level: LogEntry['level'], ...args: unknown[]): void { recordLog(level, args); }
  recordRequest(entry: Omit<RequestEntry, 't'>): void { recordRequest(entry); }
  recordEvent(detail: string): void { recordEvent('custom', detail); }
  /** For error boundaries: a render crash the window never sees. */
  recordBoundaryError(error: Error): void { recordError('boundary', `${error.name}: ${error.message}`, error.stack); }

  /**
   * A request of the product's own API failed on the server. Products with their own API client
   * call this; with `captureFetch` the SDK calls it for them.
   */
  async reportServerFailure(f: ServerFailure): Promise<void> {
    if (this.config.errorPrompt === false) return;
    const now = Date.now();
    if (now - (this.lastPrompt.get(f.path) ?? 0) < PROMPT_COOLDOWN_MS) return;
    this.lastPrompt.set(f.path, now);
    const { t } = await import('../ui/i18n.js');
    const tr = t(this.locale);

    let known = null;
    if (f.traceId) {
      try { known = await this.client.knownIssue(f.traceId); } catch { known = null; }
    }
    if (known?.known && known.status !== 'resolved') {
      this.toast({
        tone: 'info', title: tr('known.toastTitle'),
        description: known.status === 'fixed_pending_deploy' ? tr('known.fixedPending', { where: known.fixedIn ?? '' }) : tr('known.inProgress'),
      });
      return;
    }
    this.toast({
      tone: 'warning', title: tr('errorToast.title'), description: tr('errorToast.description'), duration: 12_000,
      action: {
        label: tr('errorToast.action'),
        onClick: () => this.openNewTicket({ traceId: f.traceId, title: tr('errorToast.prefillTitle', { what: `${f.method} ${f.path}` }), attachRetroactive: true }),
      },
    });
  }

  toast(t: Omit<Toast, 'id' | 'duration'> & { duration?: number }): void {
    const toast: Toast = { duration: 6000, ...t, id: ++this.toastSeq };
    this.ui.set({ toasts: [...this.ui.get().toasts, toast].slice(-4) });
    setTimeout(() => this.dismissToast(toast.id), toast.duration);
  }

  dismissToast(id: number): void {
    this.ui.set({ toasts: this.ui.get().toasts.filter((x) => x.id !== id) });
  }

  ticketHref(id: string): string | null { return this.config.ticketHref?.(id) ?? null; }

  openTicket(id: string): void {
    const href = this.ticketHref(id);
    if (!href) return;
    (this.config.navigate ?? ((h: string) => location.assign(h)))(href);
  }

  // ── Fetch instrumentation ─────────────────────────────────────────────────────────

  private instrumentFetch(): () => void {
    if (typeof window === 'undefined') return () => {};
    const opts = typeof this.config.captureFetch === 'object' ? this.config.captureFetch : {};
    const match = opts.match ?? ((u: URL) => u.origin === location.origin);
    const traceHeaders = (opts.traceHeaders ?? ['x-trace-id', 'x-request-id', 'traceparent']).map((h) => h.toLowerCase());
    const original = window.fetch;
    const self = this;

    async function traceIdOf(res: Response): Promise<string | undefined> {
      for (const h of traceHeaders) {
        const v = res.headers.get(h);
        if (!v) continue;
        // traceparent: 00-<trace id>-<span id>-<flags>
        if (h === 'traceparent') return v.split('-')[1] ?? v;
        return v;
      }
      if (res.status < 500) return undefined;
      try {
        const body = await res.clone().json();
        return body?.traceId ?? body?.error?.traceId ?? undefined;
      } catch { return undefined; }
    }

    const patched: typeof window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let url: URL | null = null;
      try { url = new URL(raw, location.href); } catch { url = null; }
      if (!url || !match(url) || self.client.owns(url.href)) return original.call(window, input, init);

      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const path = url.pathname + url.search;
      const started = performance.now();
      try {
        const res = await original.call(window, input, init);
        const ms = Math.round(performance.now() - started);
        const traceId = await traceIdOf(res);
        recordRequest({ method, path, status: res.status, ms, traceId });
        if (res.status >= 500) void self.reportServerFailure({ method, path: url.pathname, status: res.status, traceId });
        return res;
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        recordRequest({ method, path, status: 0, ms: Math.round(performance.now() - started), code: aborted ? 'ABORTED' : 'NETWORK' });
        throw err;
      }
    };
    window.fetch = patched;
    return () => { if (window.fetch === patched) window.fetch = original; };
  }
}

let current: Pitwall | null = null;

/** The running instance; the UI elements read it. Throws when `init` was never called. */
export function getPitwall(): Pitwall {
  if (!current) throw new Error('Pitwall.init(...) has not been called.');
  return current;
}

export function setPitwall(p: Pitwall | null): void { current = p; }
