/**
 * @pitwall/sdk/server — the product's backend side (Node 18+, any framework with Fetch API
 * requests: Next.js route handlers, Hono, Remix…; Fastify has its own plugin in /fastify).
 *
 *   const bridge = createSupportBridge({
 *     baseUrl: process.env.PITWALL_URL!, apiKey: process.env.PITWALL_KEY!,
 *     resolveActor: async (req) => { const s = await session(req); return s && { customerId: s.companyId, userId: s.userId, userName: s.name }; },
 *   });
 *   // app/api/support/[[...path]]/route.ts
 *   export const GET = (req: Request, ctx) => bridge.handle(req, (await ctx.params).path ?? []);
 *   export const POST = GET;
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PitwallActor {
  /** The customer account (workspace, company). People see this account's tickets and no others. */
  customerId: string;
  customerName?: string | null;
  userId?: string | null;
  userName?: string | null;
  /** Only if the team should see it. */
  userEmail?: string | null;
}

export interface BridgeOptions<Req = Request> {
  baseUrl: string;
  /** A key with the `support` scope. Never ship it to a browser. */
  apiKey: string;
  /** Who is asking, from the product's own session. Null refuses the request (401). */
  resolveActor: (req: Req) => PitwallActor | null | Promise<PitwallActor | null>;
  fetch?: typeof fetch;
}

export function encodeActor(actor: PitwallActor): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url');
}

/**
 * The Pitwall URL for a bridged path, or null when the path tries to leave the support surface
 * (`..`, encoded separators) — the product's key must not reach anything else through here.
 */
export function bridgeTarget(baseUrl: string, segments: string[], search: string): string | null {
  const clean = segments.filter((s) => s.length > 0);
  if (clean.some((s) => s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('%'))) return null;
  return `${baseUrl.replace(/\/$/, '')}/v1/support/${clean.map(encodeURIComponent).join('/')}${search}`;
}

const PASS_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length'];

export function createSupportBridge(options: BridgeOptions<Request>) {
  const doFetch = options.fetch ?? fetch;
  return {
    /** Forwards one Fetch API request; `path` is what follows the mount point, as segments. */
    async handle(req: Request, path: string[] | string): Promise<Response> {
      const actor = await options.resolveActor(req);
      if (!actor?.customerId) return Response.json({ message: 'Not signed in.' }, { status: 401 });
      if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405 });
      const segments = Array.isArray(path) ? path : path.split('/');
      const target = bridgeTarget(options.baseUrl, segments, new URL(req.url).search);
      if (!target) return Response.json({ message: 'Invalid path.' }, { status: 400 });

      const headers = new Headers({ Authorization: `Bearer ${options.apiKey}`, 'Pitwall-Actor': encodeActor(actor) });
      const contentType = req.headers.get('content-type');
      if (contentType) headers.set('Content-Type', contentType);
      let res: Response;
      try {
        res = await doFetch(target, {
          method: req.method, headers,
          body: req.method === 'POST' ? req.body : undefined,
          // Required by Node's fetch to stream a request body.
          ...(req.method === 'POST' ? { duplex: 'half' } : {}),
        } as RequestInit);
      } catch {
        return Response.json({ message: 'Support is unreachable right now.' }, { status: 502 });
      }
      const out = new Headers();
      for (const h of PASS_RESPONSE_HEADERS) { const v = res.headers.get(h); if (v) out.set(h, v); }
      return new Response(res.body, { status: res.status, headers: out });
    },
  };
}

// ── Webhooks ───────────────────────────────────────────────────────────────────────────

export interface PitwallEvent<T = unknown> {
  id: string;
  type: 'ticket.created' | 'ticket.replied' | 'ticket.status_changed' | 'release.published' | 'ping' | string;
  createdAt: string;
  product: { id: string; slug: string };
  data: T;
}

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhook(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/**
 * Checks `Pitwall-Signature` against the raw body (read it as text before parsing). Returns the
 * parsed event, or null when the signature is wrong or older than five minutes. Pitwall retries
 * anything but a 2xx, so handle each `event.id` once.
 */
export function verifyWebhook<T = unknown>(secret: string, header: string | null | undefined, rawBody: string, now = Date.now()): PitwallEvent<T> | null {
  if (!header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((s) => s.trim())));
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || !v1) return null;
  if (Math.abs(now / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return null;
  const expected = signWebhook(secret, ts, rawBody).split('v1=')[1];
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(rawBody) as PitwallEvent<T>; } catch { return null; }
}

// ── Server errors ──────────────────────────────────────────────────────────────────────

export interface ServerErrorReport {
  traceId: string;
  occurredAt?: string;
  customerId?: string | null;
  userId?: string | null;
  method: string;
  path: string;
  routeTemplate?: string | null;
  statusCode?: number;
  exceptionType: string;
  message: string;
  stackTrace?: string | null;
  release?: string | null;
  environment?: string | null;
}

export interface ErrorReporterOptions {
  baseUrl: string;
  /** A key with the `errors` scope. */
  apiKey: string;
  release?: string;
  environment?: string;
  /** Scrub secrets and SQL out of messages and stacks before they leave. Applied to both. */
  sanitize?: (text: string) => string;
  fetch?: typeof fetch;
}

/**
 * Batches error reports (up to 50, every 2 seconds) and never throws into the caller. When
 * Pitwall is unreachable the queue keeps the newest 1000 and drops the rest.
 */
export function createErrorReporter(options: ErrorReporterOptions) {
  const doFetch = options.fetch ?? fetch;
  const sanitize = options.sanitize ?? ((s: string) => s);
  const queue: ServerErrorReport[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    timer = null;
    while (queue.length) {
      const batch = queue.splice(0, 50);
      try {
        await doFetch(`${options.baseUrl.replace(/\/$/, '')}/v1/ingest/errors`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ errors: batch }),
        });
      } catch { /* best effort: an error reporter must not become the error */ }
    }
  }

  return {
    report(r: ServerErrorReport): void {
      queue.push({
        ...r,
        occurredAt: r.occurredAt ?? new Date().toISOString(),
        message: sanitize(r.message),
        stackTrace: r.stackTrace ? sanitize(r.stackTrace) : r.stackTrace,
        release: r.release ?? options.release,
        environment: r.environment ?? options.environment,
      });
      if (queue.length > 1000) queue.splice(0, queue.length - 1000);
      if (!timer) timer = setTimeout(() => { void flush(); }, 2000);
    },
    /** The usual shape from a thrown error. */
    reportError(err: unknown, ctx: { traceId: string; method: string; path: string; routeTemplate?: string; statusCode?: number; customerId?: string | null; userId?: string | null }): void {
      const e = err instanceof Error ? err : new Error(String(err));
      this.report({ ...ctx, exceptionType: e.name || 'Error', message: e.message, stackTrace: e.stack ?? null });
    },
    flush,
  };
}
