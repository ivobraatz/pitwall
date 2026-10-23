import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Pitwall',
  description: 'Chamados, erros e novidades de todos os sistemas, num lugar só.',
  robots: { index: false, follow: false },
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
