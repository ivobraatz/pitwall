'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Lockup } from '@/components/brand';

/*
 * The sign-in screen: a white panel with the form on the stone ground, and one photo of the pit wall
 * (Wikimedia Commons, credited on the caption chip).
 */
const PHOTO = {
  src: '/login/pit-building.jpg', w: 1400, h: 933, pos: '30% 55%',
  alt: 'O prédio dos boxes de Marina Bay vazio, com a saída dos boxes pintada de verde, vermelho e branco',
  place: 'Boxes de Marina Bay, 2010', credit: 'Andy Mitchell · CC BY-SA 2.0',
  href: 'https://commons.wikimedia.org/wiki/File:Singapore_F1_Grand_Prix_Pit_Lane_(4448666252).jpg',
} as const;

const CHANNELS = [
  ['Rádio', 'Chamados abertos de dentro de cada sistema.'],
  ['Telemetria', 'Erros 5xx agrupados pelo mesmo bug.'],
  ['Câmera onboard', 'A gravação do que a pessoa fazia.'],
  ['Boletim', 'Novidades escritas a partir dos commits.'],
] as const;

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
      const wantsTotp = err instanceof ApiError && (err.body as { totpRequired?: boolean } | undefined)?.totpRequired;
      if (wantsTotp) setNeedTotp(true);
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
      <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {needTotp && (
        <Field label="Código do autenticador"><Input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus /></Field>
      )}
      {error && <p className="rounded-tile bg-danger/8 px-4 py-3 text-[14px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} className="mt-2 h-12 w-full text-[15px]">Entrar no console</Button>
      <p className="text-[14px] leading-[1.5] text-fg-muted">Primeiro acesso? Um admin cria a sua conta e entrega a senha temporária.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-full bg-bg p-3">
      <div className="grid min-h-[calc(100vh-24px)] gap-3 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        {/* The sign-in panel: the mark on top, the form in the middle, the four channels at the bottom. */}
        <section className="flex flex-col rounded-panel bg-surface p-6 sm:p-12">
          <Lockup size={36} />

          <div className="my-auto w-full max-w-[380px] py-8">
            <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-fg">Entrar no console</h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-fg-muted">Chamados, erros e novidades de todos os sistemas, num lugar só.</p>
            <React.Suspense><LoginForm /></React.Suspense>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {CHANNELS.map(([name, meaning]) => (
              <div key={name} className="rounded-tile bg-well p-3">
                <p className="text-[13px] font-semibold text-fg">{name}</p>
                <p className="mt-1 text-[12px] leading-4 text-fg-muted">{meaning}</p>
              </div>
            ))}
          </div>
        </section>

        {/* One photo of the pit wall, with a small decorative preview of the console on top. */}
        <section className="relative hidden overflow-hidden rounded-panel bg-deep lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PHOTO.src} width={PHOTO.w} height={PHOTO.h} alt={PHOTO.alt} loading="eager" decoding="async"
            className="absolute inset-0 size-full object-cover" style={{ objectPosition: PHOTO.pos }} />

          <div aria-hidden className="absolute top-4 left-4 w-[260px] rounded-tile bg-accent p-3 text-on-accent">
            <p className="px-1 text-[13px] font-semibold">Aguardando a equipe</p>
            <p className="px-1 text-[12px] opacity-75">sem resposta ou com resposta nova</p>
            <p className="mt-3 flex h-9 items-center rounded-full bg-surface px-3.5 text-[13px] font-semibold text-fg">2 chamados para responder<span className="ml-auto">→</span></p>
          </div>

          <p className="absolute bottom-4 left-4 rounded-full bg-surface/90 px-4 py-2 text-[13px] text-fg">
            <span className="font-semibold">{PHOTO.place}</span>
            {' · '}
            <a href={PHOTO.href} target="_blank" rel="noopener" className="text-fg-muted hover:underline">{PHOTO.credit}</a>
          </p>
        </section>
      </div>
    </main>
  );
}
