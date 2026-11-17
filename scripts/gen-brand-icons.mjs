// Gera apps/console/components/atlas/brand-icons.ts a partir do pacote simple-icons (CC0).
// Uso: npm pack simple-icons, extraia o .tgz e rode
//   node scripts/gen-brand-icons.mjs <pasta package extraída> apps/console/components/atlas/brand-icons.ts
import fs from 'node:fs';
import path from 'node:path';

const [pkg, out] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path.join(pkg, 'data/simple-icons.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
const bySlug = new Map(data.map((d) => [d.slug, d]));

const slugs = [
  'cloudflare', 'vercel', 'stripe', 'railway', 'github', 'githubactions', 'postgresql', 'redis', 'mysql', 'rabbitmq',
  'minio', 'docker', 'caddy', 'anthropic', 'claude', 'google', 'googleanalytics', 'googlesearchconsole', 'googleads',
  'googlecloud', 'firebase', 'resend', 'sentry', 'uptimekuma', 'vaultwarden', 'bitwarden', 'openstreetmap', 'gmail',
  'npm', 'mailgun', 'meta', 'facebook', 'instagram', 'whatsapp', 'telegram', 'tiktok', 'x', 'pinterest', 'threads',
  'twitch', 'tumblr', 'googleplay', 'android', 'apple', 'appstore', 'openai', 'supabase', 'netlify', 'render',
  'flydotio', 'digitalocean', 'hetzner', 'heroku', 'twilio', 'sendgrid', 'mailchimp', 'brevo', 'expo', 'posthog',
  'grafana', 'betterstack', 'mongodb', 'sqlite', 'kubernetes', 'nginx', 'umami', 'cloudinary', 'plausibleanalytics',
];

// Luminância relativa (WCAG): cor quase preta ou quase branca some num dos temas e passa a seguir o texto.
function luminance(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const lines = [];
for (const slug of slugs) {
  const d = bySlug.get(slug);
  if (!d) throw new Error(`sem ícone: ${slug}`);
  const svg = fs.readFileSync(path.join(pkg, 'icons', `${slug}.svg`), 'utf8');
  const p = svg.match(/<path d="([^"]+)"/)[1];
  const l = luminance(d.hex);
  const hex = l < 0.06 || l > 0.8 ? null : `#${d.hex}`;
  lines.push(`  ${JSON.stringify(slug)}: { title: ${JSON.stringify(d.title)}, hex: ${JSON.stringify(hex)}, path: ${JSON.stringify(p)} },`);
}

const body = `// Gerado por scripts/gen-brand-icons.mjs a partir do simple-icons ${version} (https://simpleicons.org, licença CC0). Não editar à mão:
// as marcas são de seus donos e aparecem só para identificar o fornecedor de cada serviço.
// hex null: a cor da marca é quase preta ou quase branca e o desenho segue a cor do texto.
export type BrandIcon = { title: string; hex: string | null; path: string };

export const BRAND_ICONS = {
${lines.join('\n')}
} satisfies Record<string, BrandIcon>;

export type BrandSlug = keyof typeof BRAND_ICONS;
`;
fs.writeFileSync(out, body);
console.log(`${slugs.length} ícones, ${Math.round(body.length / 1024)} KB`);
