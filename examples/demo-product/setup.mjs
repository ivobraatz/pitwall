// Registers the demo product in a local Pitwall (as the bootstrap admin) and writes .env with its
// key and webhook secret. Run once: node setup.mjs
import { writeFile } from 'node:fs/promises';

const API = process.env.PITWALL_URL ?? 'http://localhost:5180';
const EMAIL = process.env.PITWALL_ADMIN_EMAIL ?? 'admin@pitwall.local';
const PASSWORD = process.env.PITWALL_ADMIN_PASSWORD ?? 'pitwall-dev-password';
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Pitwall-Staff': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

await call('POST', '/v1/staff/auth/login', { email: EMAIL, password: PASSWORD });
const products = await call('GET', '/v1/staff/products');
let product = products.find((p) => p.slug === 'demo');
if (!product) {
  product = await call('POST', '/v1/staff/products', {
    slug: 'demo', name: 'Acme Analytics (demo)',
    description: 'A pretend analytics product used to try Pitwall end to end.',
    webhookUrl: 'http://localhost:4300/webhooks/pitwall',
    settings: { ownFramePrefixes: ['/examples/demo-product/'], locales: ['pt', 'en'], autoPublishReleases: true, teamName: 'Equipe Acme' },
  });
}
const key = await call('POST', `/v1/staff/products/${product.id}/keys`, { name: 'demo backend', scopes: ['support', 'errors'] });
const { secret } = await call('POST', `/v1/staff/products/${product.id}/webhook/secret`);
await writeFile(new URL('./.env', import.meta.url), `PITWALL_URL=${API}\nPITWALL_KEY=${key.token}\nPITWALL_WEBHOOK_SECRET=${secret}\n`);
console.log(`Demo product ${product.slug} ready; .env written.`);
