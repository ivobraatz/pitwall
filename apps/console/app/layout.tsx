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
    { media: '(prefers-color-scheme: dark)', color: '#0b0c0d' },
    { media: '(prefers-color-scheme: light)', color: '#f7f8f8' },
  ],
};

// Follows the system theme; runs before paint so there is no flash.
const MODE_SCRIPT = "document.documentElement.dataset.mode=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-mode="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
