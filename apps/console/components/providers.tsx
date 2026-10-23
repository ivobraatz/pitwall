'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './ui';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (count, err) => (err as { status?: number })?.status !== 401 && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  }));
  return <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>;
}
