/**
 * The page's short-term memory, for support tickets.
 *
 * Everything here stays in this tab, in memory, until the person opens a ticket and chooses to
 * attach it. Nothing is written to storage and nothing leaves the browser on its own — the
 * buffer exists so that "send me the console log" never has to be asked, not so anyone can watch.
 *
 * Four ring buffers, each bounded:
 *   - log lines (from `console.*` when captured, or `pitwall.log(...)`);
 *   - requests — method, path, status, duration and the server's trace id, never a body;
 *   - unhandled errors and rejections from `window`;
 *   - route changes and other events, so "the screen did not update" can be checked against
 *     what actually happened.
 */

import type { DiagnosticsBundle, ErrorEntry, EventEntry, LogEntry, RequestEntry } from './types.js';

const LOG_CAP = 300;
const REQUEST_CAP = 200;
const ERROR_CAP = 50;
const EVENT_CAP = 150;

const logs: LogEntry[] = [];
const requests: RequestEntry[] = [];
const errors: ErrorEntry[] = [];
const events: EventEntry[] = [];

export interface AppInfo { version?: string; commit?: string; channel?: string; extra?: () => Record<string, unknown> }
let app: AppInfo = {};

function push<T>(buf: T[], cap: number, item: T): void {
  buf.push(item);
  if (buf.length > cap) buf.splice(0, buf.length - cap);
}

// Keys whose values never belong in a ticket, matched anywhere in the key name. Broad on
// purpose: a false positive costs a "[redacted]"; a false negative ships a credential.
const SENSITIVE_KEY = /token|password|passphrase|secret|authorization|auth|api[-_]?key|cookie|credential|private[-_]?key|session|bearer|otp|cpf|cnpj/i;

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 6) return '[…]';
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  if (value instanceof Error) return { name: value.name, message: value.message };
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(v, depth + 1, seen);
  }
  return out;
}

/** One printable line from whatever was logged: strings as-is, the rest as compact, redacted JSON. */
export function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try { return JSON.stringify(redact(a)); } catch { return String(a); }
    })
    .join(' ')
    .slice(0, 2000);
}

export function recordLog(level: LogEntry['level'], args: unknown[]): void {
  push(logs, LOG_CAP, { t: Date.now(), level, msg: format(args) });
}

export function recordRequest(entry: Omit<RequestEntry, 't'>): void {
  push(requests, REQUEST_CAP, { t: Date.now(), ...entry, path: entry.path.slice(0, 500) });
}

export function recordError(kind: ErrorEntry['kind'], msg: string, stack?: string): void {
  push(errors, ERROR_CAP, { t: Date.now(), kind, msg: msg.slice(0, 2000), stack: stack?.slice(0, 6000) });
}

export function recordEvent(kind: EventEntry['kind'], detail: string): void {
  push(events, EVENT_CAP, { t: Date.now(), kind, detail: detail.slice(0, 500) });
}

/** Trace ids of failed requests, newest first — what links a ticket to server-side stack traces. */
export function recentTraceIds(limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = requests.length - 1; i >= 0 && out.length < limit; i--) {
    const r = requests[i];
    if (r.status >= 500 && r.traceId && !seen.has(r.traceId)) {
      seen.add(r.traceId);
      out.push(r.traceId);
    }
  }
  return out;
}

let installed = false;

/** Hooks the window-level sources. Idempotent. */
export function installDiagnostics(info: AppInfo, options: { captureConsole: boolean }): void {
  app = info;
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    recordError('error', e.message || 'Unknown error', e.error instanceof Error ? e.error.stack : undefined);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    if (reason instanceof Error) recordError('rejection', `${reason.name}: ${reason.message}`, reason.stack);
    else recordError('rejection', format([reason]));
  });
  document.addEventListener('visibilitychange', () => recordEvent('visibility', document.visibilityState));
  recordEvent('route', location.pathname + location.search);

  // Route changes in single-page apps: history calls and back/forward.
  const onRoute = () => recordEvent('route', location.pathname + location.search);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      queueMicrotask(onRoute);
      return result;
    };
  }
  window.addEventListener('popstate', onRoute);

  if (options.captureConsole) {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        recordLog(level, args);
        original(...args);
      };
    }
    const originalLog = console.log.bind(console);
    console.log = (...args: unknown[]) => { recordLog('info', args); originalLog(...args); };
  }
}

export function snapshotDiagnostics(): DiagnosticsBundle {
  const perf = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  let extra: Record<string, unknown> = {};
  try { extra = app.extra?.() ?? {}; } catch { extra = {}; }
  return {
    capturedAt: new Date().toISOString(),
    context: {
      ...extra,
      route: location.pathname,
      href: location.pathname + location.search,
      appVersion: app.version ?? '',
      appCommit: app.commit ?? '',
      channel: app.channel ?? '',
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: [...(navigator.languages ?? [])],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      online: navigator.onLine,
      memory: perf ? { usedMB: Math.round(perf.usedJSHeapSize / 1048576), limitMB: Math.round(perf.jsHeapSizeLimit / 1048576) } : undefined,
    },
    logs: [...logs],
    requests: [...requests],
    errors: [...errors],
    events: [...events],
    traceIds: recentTraceIds(),
  };
}
