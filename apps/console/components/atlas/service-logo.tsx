import { cn } from '@/components/ui';
import { BRAND_ICONS, type BrandSlug } from './brand-icons';

/*
 * The supplier's logo next to a service: Cloudflare, Vercel, Stripe, Postgres… It only identifies who runs or provides
 * the thing; state is still told by the dot. A brand the icon set does not carry (removed at the owner's request)
 * is drawn as plain geometry or as its initial on the brand colour.
 */

const CUSTOM = {
  oracle: { title: 'Oracle', hex: '#C74634' },
  microsoft: { title: 'Microsoft', hex: '#00A4EF' },
  clarity: { title: 'Microsoft Clarity', hex: '#0078D4' },
  bing: { title: 'Bing', hex: '#258FFA' },
  linkedin: { title: 'LinkedIn', hex: '#0A66C2' },
} as const;
type CustomKey = keyof typeof CUSTOM;
export type Brand = BrandSlug | CustomKey;

/*
 * The words that name each brand. Tokens are compared without case or accents, so "Webhook STRIPE", "R2 rhflex-prod"
 * and "STRIPE_SECRET_KEY" all find their supplier. The longest alias wins ("Google Search Console" is Search Console,
 * not Google). Short or common words count only in the provider field, where nothing else is written.
 */
const ALIASES: Array<[alias: string, brand: Brand, providerOnly?: true]> = [
  ['cloudflare', 'cloudflare'], ['cloudflared', 'cloudflare'], ['r2', 'cloudflare'], ['email routing', 'cloudflare'],
  ['cloudflare workers', 'cloudflare'], ['cloudflare pages', 'cloudflare'], ['cf', 'cloudflare', true],
  ['vercel', 'vercel'], ['stripe', 'stripe'], ['railway', 'railway'],
  ['github', 'github'], ['gh', 'github', true], ['github actions', 'githubactions'],
  ['postgres', 'postgresql'], ['postgresql', 'postgresql'], ['pg', 'postgresql', true],
  ['redis', 'redis'], ['mysql', 'mysql'], ['rabbitmq', 'rabbitmq'], ['minio', 'minio'], ['docker', 'docker'], ['caddy', 'caddy'],
  ['anthropic', 'anthropic'], ['claude', 'claude'],
  ['google', 'google'], ['ga4', 'googleanalytics'], ['google analytics', 'googleanalytics'], ['ga', 'googleanalytics', true],
  ['search console', 'googlesearchconsole'], ['google search console', 'googlesearchconsole'], ['gsc', 'googlesearchconsole', true],
  ['google ads', 'googleads'], ['google cloud', 'googlecloud'], ['gcp', 'googlecloud'],
  ['firebase', 'firebase'], ['fcm', 'firebase'], ['resend', 'resend'], ['sentry', 'sentry'],
  ['uptime kuma', 'uptimekuma'], ['kuma', 'uptimekuma', true], ['vaultwarden', 'vaultwarden'], ['bitwarden', 'bitwarden'],
  ['oracle', 'oracle'], ['oci', 'oracle', true], ['openstreetmap', 'openstreetmap'], ['osm', 'openstreetmap', true],
  ['gmail', 'gmail'], ['npm', 'npm'], ['mailgun', 'mailgun'],
  ['meta', 'meta'], ['facebook', 'facebook'], ['instagram', 'instagram'], ['whatsapp', 'whatsapp'], ['telegram', 'telegram'],
  ['tiktok', 'tiktok'], ['twitter', 'x'], ['x', 'x', true], ['pinterest', 'pinterest'], ['threads', 'threads'],
  ['twitch', 'twitch'], ['tumblr', 'tumblr'], ['linkedin', 'linkedin'],
  ['play store', 'googleplay'], ['google play', 'googleplay'], ['android', 'android'],
  ['app store', 'appstore'], ['apple', 'apple'], ['openai', 'openai'], ['chatgpt', 'openai'],
  ['supabase', 'supabase'], ['netlify', 'netlify'], ['render', 'render', true], ['fly', 'flydotio', true], ['fly io', 'flydotio'],
  ['digitalocean', 'digitalocean'], ['hetzner', 'hetzner'], ['heroku', 'heroku'],
  ['twilio', 'twilio'], ['sendgrid', 'sendgrid'], ['mailchimp', 'mailchimp'], ['brevo', 'brevo'],
  ['expo', 'expo'], ['posthog', 'posthog'], ['grafana', 'grafana'], ['better stack', 'betterstack'],
  ['mongodb', 'mongodb'], ['sqlite', 'sqlite'], ['kubernetes', 'kubernetes'], ['k8s', 'kubernetes'], ['nginx', 'nginx'],
  ['umami', 'umami'], ['cloudinary', 'cloudinary'], ['plausible', 'plausibleanalytics'],
  ['microsoft', 'microsoft'], ['azure', 'microsoft'], ['clarity', 'clarity'], ['microsoft clarity', 'clarity'],
  ['bing', 'bing'], ['bing webmaster', 'bing'],
];

const PARSED = ALIASES
  .map(([alias, brand, providerOnly]) => ({ words: alias.split(' '), joined: alias.replace(/ /g, ''), brand, providerOnly: !!providerOnly }))
  .sort((a, b) => b.words.length - a.words.length);

function tokens(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function find(text: string | null | undefined, provider: boolean): Brand | null {
  if (!text) return null;
  const t = tokens(text);
  for (const a of PARSED) {
    if (a.providerOnly && !provider) continue;
    if (t.includes(a.joined)) return a.brand;
    for (let i = 0; i + a.words.length <= t.length; i++) {
      if (a.words.every((w, j) => t[i + j] === w)) return a.brand;
    }
  }
  return null;
}

/** The brand of the provider field alone ("railway", "cloudflare"…). */
export function providerBrand(provider: string | null | undefined): Brand | null {
  return find(provider, true);
}

/**
 * What the service is, by its name (Postgres, GA4, Webhook STRIPE), else where it runs. A pipeline is told by where it
 * runs, and CI found in code is a GitHub workflow; a domain or record by who serves its DNS.
 */
export function serviceBrand(s: { name: string; provider?: string | null; kind?: string | null }): Brand | null {
  if (s.kind === 'pipeline') return find(s.provider, true) ?? 'githubactions';
  if (s.kind === 'domain') return find(s.provider, true) ?? find(s.name, false);
  return find(s.name, false) ?? find(s.provider, true);
}

export function brandTitle(brand: Brand) {
  return brand in CUSTOM ? CUSTOM[brand as CustomKey].title : BRAND_ICONS[brand as BrandSlug].title;
}

export function BrandLogo({ brand, size = 14, className }: { brand: Brand; size?: number; className?: string }) {
  const title = brandTitle(brand);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden data-brand={brand} className={cn('shrink-0', className)}>
      <title>{title}</title>
      <BrandShape brand={brand} />
    </svg>
  );
}

function BrandShape({ brand }: { brand: Brand }) {
  switch (brand) {
    case 'oracle':
      return <path fill={CUSTOM.oracle.hex} fillRule="evenodd"
        d="M7 5.5h10a6.5 6.5 0 0 1 0 13H7a6.5 6.5 0 0 1 0-13zm.3 2.8h9.4a3.7 3.7 0 0 1 0 7.4H7.3a3.7 3.7 0 0 1 0-7.4z" />;
    case 'microsoft':
      return (
        <>
          <path fill="#F25022" d="M1 1h10.5v10.5H1z" /><path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
          <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" /><path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
        </>
      );
    case 'clarity': case 'bing': case 'linkedin':
      return (
        <>
          <rect x="1" y="1" width="22" height="22" rx="5" fill={CUSTOM[brand].hex} />
          <text x="12" y="17" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="inherit">{CUSTOM[brand].title.replace('Microsoft ', '')[0]}</text>
        </>
      );
    default: {
      const icon = BRAND_ICONS[brand];
      return <path d={icon.path} fill={icon.hex ?? 'currentColor'} />;
    }
  }
}

/** The service's logo, or nothing when no brand is recognised (an internal API, a domain, a backup). */
export function ServiceLogo({ service, size, className }: {
  service: { name: string; provider?: string | null; kind?: string | null }; size?: number; className?: string;
}) {
  const brand = serviceBrand(service);
  return brand ? <BrandLogo brand={brand} size={size} className={cn('text-fg', className)} /> : null;
}
