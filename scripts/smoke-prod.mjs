// Smoke test of the real production stack (docker-compose.prod.yml), run by CI and usable on the server.
// It covers what unit tests can't see: files the console image must carry, and attachment bytes coming back whole.
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/smoke-prod.mjs
const CONSOLE = process.env.CONSOLE ?? 'http://127.0.0.1:3200';
const API = process.env.API ?? 'http://127.0.0.1:5180';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

function check(ok, what) {
  if (!ok) { console.error(`FALHOU: ${what}`); process.exit(1); }
  console.log(`ok - ${what}`);
}

for (let i = 0; ; i++) {
  const up = await Promise.all([`${API}/health`, `${CONSOLE}/login`].map((u) => fetch(u).then((r) => r.ok, () => false)));
  if (up.every(Boolean)) break;
  if (i === 60) check(false, 'API e console no ar em até 5 minutos');
  await new Promise((r) => setTimeout(r, 5000));
}
check(true, 'API e console no ar');

for (const photo of ['pit-wall', 'pit-board', 'pit-lane', 'pit-building']) {
  const res = await fetch(`${CONSOLE}/login/${photo}.jpg`);
  check(res.ok && res.headers.get('content-type')?.startsWith('image/'), `foto do login ${photo}.jpg`);
}

let cookie = '';
async function staff(method, path, body) {
  const res = await fetch(`${CONSOLE}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Pitwall-Staff': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res;
}

const login = await staff('POST', '/staff/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
check(login.ok, `login pelo console (${login.status})`);

const slug = `smoke${Date.now().toString(36)}`;
const product = await (await staff('POST', '/staff/products', { slug, name: 'Smoke', settings: { locales: ['pt'] } })).json();
check(product.id, 'cria um sistema');
const { token } = await (await staff('POST', `/staff/products/${product.id}/keys`, { name: 'backend', scopes: ['support', 'errors'] })).json();
check(token, 'cria uma chave');

const actor = Buffer.from(JSON.stringify({ customerId: 'c1', customerName: 'Acme', userId: 'u1', userName: 'Ana', userEmail: 'ana@acme.test' })).toString('base64url');
const asProduct = { Authorization: `Bearer ${token}`, 'Pitwall-Actor': actor };
const ticket = await (await fetch(`${API}/v1/support/tickets`, {
  method: 'POST',
  headers: { ...asProduct, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Smoke', body: 'Teste do deploy.', category: 'bug', severity: 'low' }),
})).json();
check(ticket.id, 'abre um chamado');

// 30 MB: above the 25 MB limit of other files, so this also proves the video limit reaches the API.
const video = new Uint8Array(30 * 1024 * 1024).map((_, i) => i % 251);
const form = new FormData();
form.append('file', new Blob([video], { type: 'video/mp4' }), 'tela.mp4');
const upload = await fetch(`${API}/v1/support/tickets/${ticket.id}/attachments`, { method: 'POST', headers: asProduct, body: form });
const attachment = await upload.json();
check(upload.ok && attachment.id, `anexa um vídeo de 30 MB (${upload.status})`);

const back = await staff('GET', `/staff/tickets/${ticket.id}/attachments/${attachment.id}`);
const bytes = new Uint8Array(await back.arrayBuffer());
check(back.ok && bytes.length === video.length && bytes.every((b, i) => b === video[i]), 'o vídeo volta do bucket igual, pelo console');
console.log('tudo certo');
