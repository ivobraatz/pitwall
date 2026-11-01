'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Field, Input, cn } from '@/components/ui';
import { Lockup, Wordmark } from '@/components/brand';

/*
 * The sign-in screen is the pit wall seen as a board: tiles fitted edge to edge, each one thing.
 * The pictures are real ones of that world (Wikimedia Commons), credited on the strip under each.
 */
const PHOTOS = {
  wall: {
    src: '/login/pit-wall.jpg', w: 1400, h: 933, pos: '22% 20%',
    alt: 'O muro dos boxes de uma equipe em Suzuka, com duas fileiras de monitores sob a cobertura',
    place: 'Muro dos boxes, Suzuka, 2009', credit: 'Morio · CC BY-SA 3.0',
    href: 'https://commons.wikimedia.org/wiki/File:Renault_after_losing_the_title_sponsor_ING_2009_Japan.jpg',
  },
  board: {
    src: '/login/pit-board.jpg', w: 1000, h: 1333, pos: '50% 45%',
    alt: 'Uma placa de pit de fibra de carbono com letras brancas encaixadas em três fileiras',
    place: 'Placa de pit', credit: 'Tokumeigakarinoaoshima · CC0',
    href: 'https://commons.wikimedia.org/wiki/File:Pit_sign_board_of_ROOKIE_Racing.jpg',
  },
  lane: {
    src: '/login/pit-lane.jpg', w: 1400, h: 933, pos: '60% 60%',
    alt: 'Pit lane à noite em Singapura, um carro parado no box e outro saindo com a luz vermelha acesa',
    place: 'Pit lane, Singapura, 2014', credit: 'Morio · CC BY-SA 4.0',
    href: 'https://commons.wikimedia.org/wiki/File:Pit_lane_2014_Singapore_GP.jpg',
  },
  building: {
    src: '/login/pit-building.jpg', w: 1400, h: 933, pos: '30% 50%',
    alt: 'O prédio dos boxes de Marina Bay vazio, com a saída dos boxes pintada de verde, vermelho e branco',
    place: 'Boxes de Marina Bay, 2010', credit: 'Andy Mitchell · CC BY-SA 2.0',
    href: 'https://commons.wikimedia.org/wiki/File:Singapore_F1_Grand_Prix_Pit_Lane_(4448666252).jpg',
  },
} as const;

const CHANNELS = [
  ['Rádio', 'Chamados abertos de dentro de cada sistema.'],
  ['Telemetria', 'Erros 5xx agrupados pelo mesmo bug.'],
  ['Câmera onboard', 'A gravação do que a pessoa fazia.'],
  ['Boletim', 'Novidades escritas a partir dos commits.'],
] as const;

const STRIPS = ['bg-fg text-bg', 'bg-chip text-fg', 'bg-active text-fg', 'bg-fg text-bg'];

function Photo({ p, strip, i, className, priority, moving }: { p: (typeof PHOTOS)[keyof typeof PHOTOS]; strip: number; i: number; className?: string; priority?: boolean; moving?: boolean }) {
  return (
    <figure className={cn('flex min-h-0 flex-col bg-surface', className)}>
      <div className="shutter relative min-h-0 flex-1 overflow-hidden" style={{ '--i': i } as React.CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.src} width={p.w} height={p.h} alt={p.alt} loading={priority ? 'eager' : 'lazy'} decoding="async"
          className={cn('absolute inset-0 size-full object-cover', moving && 'drift')} style={{ objectPosition: p.pos }} />
      </div>
      <figcaption className={cn('shrink-0 px-3 py-2 text-[14px] leading-[1.3]', STRIPS[strip])}>
        <span className="block truncate font-semibold">{p.place}</span>
        <a href={p.href} target="_blank" rel="noopener" className="block truncate opacity-75 hover:underline hover:opacity-100">{p.credit}</a>
      </figcaption>
    </figure>
  );
}

/** The live thing: a pit board with the local time and a greeting, as the box would hold it out. */
function PitBoard({ state, className }: { state: 'idle' | 'error' | 'totp' | 'busy'; className?: string }) {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = now?.getHours() ?? 12;
  const greeting = h < 5 ? 'Boa madrugada.' : h < 12 ? 'Bom dia.' : h < 18 ? 'Boa tarde.' : 'Boa noite.';
  const hh = now ? String(now.getHours()).padStart(2, '0') : '--';
  const mm = now ? String(now.getMinutes()).padStart(2, '0') : '--';
  const day = now?.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) ?? '';
  const line = state === 'error' ? 'Box, box. Confira e tente de novo.' : state === 'totp' ? 'Falta o código do autenticador.' : state === 'busy' ? 'Saindo dos boxes…' : greeting;
  return (
    <div className={cn('flex flex-col bg-accent p-5 text-on-accent', className)} aria-live="polite">
      <p className="text-[14px] font-semibold first-letter:uppercase">{day}</p>
      <p className="display mt-auto text-[clamp(56px,6.4vw,104px)] tabular-nums" suppressHydrationWarning>
        {hh}<span className={cn(now && 'blink')}>:</span>{mm}
      </p>
      <p key={line} className="rise mt-3 text-[16px] font-semibold leading-tight">{line}</p>
    </div>
  );
}

function LoginForm({ onState }: { onState: (s: 'idle' | 'error' | 'totp' | 'busy') => void }) {
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
    onState('busy');
    try {
      await api('/staff/auth/login', { method: 'POST', json: { email, password, totp: needTotp ? totp : undefined } });
      await queryClient.invalidateQueries();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      const wantsTotp = err instanceof ApiError && (err.body as { totpRequired?: boolean } | undefined)?.totpRequired;
      if (wantsTotp) setNeedTotp(true);
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      onState(wantsTotp && !needTotp ? 'totp' : 'error');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {needTotp && (
        <Field label="Código do autenticador" className="rise"><Input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus /></Field>
      )}
      {error && <p className="rise flex items-center gap-2 text-[14px] font-semibold text-danger"><span className="size-2.5 shrink-0 bg-danger" />{error}</p>}
      <Button type="submit" variant="primary" loading={busy} className="mt-2 h-12 w-full text-[16px]">Entrar no console</Button>
      <p className="max-w-sm text-[16px] leading-[1.45] text-fg-muted">Primeiro acesso? Um admin cria a sua conta e entrega a senha temporária.</p>
    </form>
  );
}

export default function LoginPage() {
  const [state, setState] = React.useState<'idle' | 'error' | 'totp' | 'busy'>('idle');
  const tile = 'rise min-h-0';
  return (
    <main className="min-h-full bg-bg p-2">
      {/*
        Desktop: 12 columns × 6 rows, 8px gaps, filling the viewport. Phone: the form first, then the board in two columns.
      */}
      <div className="grid grid-cols-2 gap-2 lg:h-[calc(100svh-16px)] lg:min-h-[680px] lg:grid-cols-12 lg:grid-rows-6">
        {/* The sign-in panel, in the tone opposite to the ground. */}
        <section className={cn(tile, 'opposite col-span-2 flex flex-col p-6 md:p-8 lg:col-span-4 lg:col-start-9 lg:row-span-4 lg:row-start-1')} style={{ '--i': 1 } as React.CSSProperties}>
          <Lockup size={28} className="text-[26px]" />
          <p className="mt-6 max-w-sm text-[16px] leading-[1.5] text-fg-secondary">O console de suporte open source: chamados, erros e novidades de todos os sistemas, num lugar só.</p>
          <div className="mt-auto pt-8">
            <h2 className="display mb-6 text-[44px] text-fg">Entrar</h2>
            <React.Suspense><LoginForm onState={setState} /></React.Suspense>
          </div>
        </section>

        {/* The name, the largest thing on the board. */}
        <section className={cn(tile, 'col-span-2 flex min-h-56 flex-col overflow-hidden bg-surface p-5 lg:col-span-6 lg:row-span-3 lg:min-h-0')} style={{ '--i': 0 } as React.CSSProperties}>
          <h1 className="mt-auto -mb-[0.12em] text-[clamp(88px,15vw,232px)] text-fg"><Wordmark /></h1>
        </section>

        <Photo p={PHOTOS.wall} strip={0} i={2} priority className="col-span-1 h-72 lg:col-span-2 lg:col-start-7 lg:row-span-3 lg:row-start-1 lg:h-auto" />

        <PitBoard state={state} className={cn(tile, 'col-span-1 min-h-72 lg:col-span-2 lg:col-start-11 lg:row-span-2 lg:row-start-5 lg:min-h-0')} />

        <Photo p={PHOTOS.board} strip={1} i={3} className="col-span-1 h-80 lg:col-span-2 lg:col-start-1 lg:row-span-3 lg:row-start-4 lg:h-auto" />

        {/* What the four channels of the wall are, here. */}
        <section className={cn(tile, 'col-span-2 grid grid-cols-2 gap-2 lg:col-span-4 lg:col-start-3 lg:row-span-3 lg:row-start-4 lg:grid-cols-1 lg:grid-rows-4')} style={{ '--i': 4 } as React.CSSProperties}>
          {CHANNELS.map(([name, meaning]) => (
            <div key={name} className="flex min-h-0 flex-col justify-center bg-surface px-4 py-4 transition-colors duration-200 hover:bg-hover lg:px-5 lg:py-3">
              <p className="display text-[26px] text-fg">{name}</p>
              <p className="mt-1.5 text-[16px] leading-snug text-fg-muted">{meaning}</p>
            </div>
          ))}
        </section>

        <Photo p={PHOTOS.building} strip={2} i={5} className="col-span-1 h-64 lg:col-span-2 lg:col-start-7 lg:row-span-3 lg:row-start-4 lg:h-auto" />
        <Photo p={PHOTOS.lane} strip={3} i={6} moving className="col-span-1 h-64 lg:col-span-2 lg:col-start-9 lg:row-span-2 lg:row-start-5 lg:h-auto" />
      </div>
    </main>
  );
}
