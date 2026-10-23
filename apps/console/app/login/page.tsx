'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totp, setTotp] = React.useState('');
  const [needTotp, setNeedTotp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/staff/auth/login', { method: 'POST', json: { email, password, totp: needTotp ? totp : undefined } });
      await queryClient.invalidateQueries();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      if (err instanceof ApiError && (err.body as { totpRequired?: boolean } | undefined)?.totpRequired) setNeedTotp(true);
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-border bg-surface p-6 shadow-popover">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-accent font-bold text-on-accent">P</span>
        <div><h1 className="font-semibold">Pitwall</h1><p className="text-[12px] text-fg-muted">Acesso da equipe</p></div>
      </div>
      <div className="flex flex-col gap-3">
        <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {needTotp && (
          <Field label="Código do autenticador"><Input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus /></Field>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">Entrar</Button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <React.Suspense><LoginForm /></React.Suspense>
    </div>
  );
}
