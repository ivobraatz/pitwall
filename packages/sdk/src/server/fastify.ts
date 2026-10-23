/**
 * @pitwall/sdk/fastify — the support bridge as a Fastify plugin.
 *
 *   await app.register(pitwallSupport, {
 *     prefix: '/api/support',
 *     baseUrl: process.env.PITWALL_URL!, apiKey: process.env.PITWALL_KEY!,
 *     resolveActor: (request) => request.user && { customerId: request.user.workspaceId, userId: request.user.id, userName: request.user.name },
 *   });
 *
 * Registered in its own encapsulated context, it streams request bodies through untouched —
 * multipart uploads are not parsed by the product's own multipart plugin on the way.
 */

import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { bridgeTarget, encodeActor, type PitwallActor } from './index.js';

// Typed loosely on purpose: the SDK does not depend on Fastify; these are the parts it uses.
interface FastifyRequestLike { method: string; url: string; raw: IncomingMessage; headers: Record<string, string | string[] | undefined>; params: unknown }
interface FastifyReplyLike {
  code(status: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(payload?: unknown): unknown;
}
interface FastifyInstanceLike {
  addContentTypeParser(type: string, fn: (req: FastifyRequestLike, payload: IncomingMessage, done: (err: Error | null, body?: unknown) => void) => void): void;
  route(opts: { method: string[]; url: string; handler: (req: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown> }): void;
  removeAllContentTypeParsers?: () => void;
}

export interface FastifyBridgeOptions {
  baseUrl: string;
  apiKey: string;
  resolveActor: (request: never) => PitwallActor | null | undefined | Promise<PitwallActor | null | undefined>;
  fetch?: typeof fetch;
}

export async function pitwallSupport(app: FastifyInstanceLike, opts: FastifyBridgeOptions): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  // Leave every body as the raw stream: it is forwarded, not read.
  app.removeAllContentTypeParsers?.();
  app.addContentTypeParser('*', (_req, _payload, done) => done(null));

  app.route({
    method: ['GET', 'POST'],
    url: '/*',
    handler: async (request, reply) => {
      const actor = await opts.resolveActor(request as never);
      if (!actor?.customerId) return reply.code(401).send({ message: 'Not signed in.' });
      const url = new URL(request.url, 'http://local');
      const wildcard = String((request.params as Record<string, string>)['*'] ?? '');
      const target = bridgeTarget(opts.baseUrl, wildcard.split('/'), url.search);
      if (!target) return reply.code(400).send({ message: 'Invalid path.' });

      const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, 'Pitwall-Actor': encodeActor(actor) };
      const ct = request.headers['content-type'];
      if (typeof ct === 'string') headers['Content-Type'] = ct;
      let res: Response;
      try {
        res = await doFetch(target, {
          method: request.method, headers,
          body: request.method === 'POST' ? (Readable.toWeb(request.raw) as ReadableStream) : undefined,
          ...(request.method === 'POST' ? { duplex: 'half' } : {}),
        } as RequestInit);
      } catch {
        return reply.code(502).send({ message: 'Support is unreachable right now.' });
      }
      reply.code(res.status);
      for (const h of ['content-type', 'content-disposition', 'content-length']) {
        const v = res.headers.get(h);
        if (v) reply.header(h, v);
      }
      return reply.send(res.body ? Readable.fromWeb(res.body as never) : undefined);
    },
  });
}

export default pitwallSupport;
