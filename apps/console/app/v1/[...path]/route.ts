/**
 * /v1/** → the Pitwall API, resolved at request time (a next.config rewrite would freeze the API
 * address at build time, and one image has to run anywhere). Same origin for the browser, so the
 * session cookie stays first-party and SameSite=Strict; bodies and responses stream through.
 */
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const FORWARD_REQUEST = ['content-type', 'content-length', 'cookie', 'x-pitwall-staff', 'user-agent', 'accept'];
const FORWARD_RESPONSE = ['content-type', 'content-disposition', 'content-length', 'set-cookie', 'cache-control', 'location'];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const api = (process.env.PITWALL_API_URL ?? 'http://localhost:5180').replace(/\/$/, '');
  const { path } = await ctx.params;
  const target = `${api}/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQUEST) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  // The API decides Secure cookies and per-address rate limits from these.
  headers.set('x-forwarded-proto', req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', ''));
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method, headers, redirect: 'manual', cache: 'no-store',
      body: hasBody ? req.body : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch {
    return Response.json({ message: 'A API do Pitwall não respondeu.' }, { status: 502 });
  }

  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    if (h === 'set-cookie') for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
    else { const v = res.headers.get(h); if (v) out.set(h, v); }
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
