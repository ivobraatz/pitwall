import path from 'node:path';
import type { NextConfig } from 'next';

// /v1 is proxied to the API by app/v1/[...path]/route.ts (read at request time, not build time):
// one origin, so the session cookie is first-party and SameSite=Strict holds.
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@pitwall/sdk'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    }];
  },
};

export default config;
