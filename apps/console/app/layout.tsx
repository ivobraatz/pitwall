import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'Pitwall', template: '%s · Pitwall' },
  description: 'Chamados, erros e novidades de todos os sistemas, num lugar só.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
    { media: '(prefers-color-scheme: light)', color: '#ecebe6' },
  ],
};

// The theme the person chose in the account menu (light, dark), or the system's; runs before paint so there is no flash.
const MODE_SCRIPT = "try{var t=localStorage.getItem('pitwall-theme')}catch(e){}document.documentElement.dataset.mode=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-mode="light" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
