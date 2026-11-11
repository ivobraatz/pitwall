'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAtlas } from '@/lib/atlas';
import { Button, PageHeader, Shimmer } from '@/components/ui';
import { useDetailT } from '@/components/atlas/detail/node-parts';
import { CoverageBadge, Stepper, parseStep, STEP_COUNT } from '@/components/atlas/detail/onboarding/wizard';
import {
  StepAgents, StepDiscovery, StepEnvironments, StepMap, StepRepos, StepSources, StepSystem, StepValidate,
} from '@/components/atlas/detail/onboarding/steps';

// The integration, step by step. The step and the system live in the address (?step= and ?system=),
// so a person can send the link to whoever finishes the next step.

function Onboarding() {
  const t = useDetailT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const atlas = useAtlas();

  const step = parseStep(params.get('step'));
  const system = params.get('system') ?? '';
  const chosen = atlas.data?.systems.find((s) => s.slug === system);

  const update = React.useCallback((changes: { step?: number; system?: string }) => {
    // Read the address as it is now: a click right after another change must not write over it.
    const next = new URLSearchParams(window.location.search);
    if (changes.step !== undefined) next.set('step', String(changes.step));
    if (changes.system !== undefined) {
      if (changes.system) next.set('system', changes.system);
      else next.delete('system');
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router]);

  const onSystem = React.useCallback((slug: string) => update({ system: slug }), [update]);
  const goto = (n: number) => update({ step: n });

  const props = { system, onSystem };
  const body = {
    1: <StepSystem {...props} />,
    2: <StepRepos {...props} />,
    3: <StepEnvironments {...props} />,
    4: <StepSources {...props} />,
    5: <StepDiscovery {...props} />,
    6: <StepValidate {...props} />,
    7: <StepMap {...props} />,
    8: <StepAgents {...props} />,
  }[step];

  return (
    <div className="flex flex-col gap-5" data-testid="onboarding">
      <PageHeader
        back={<Link href="/atlas" className="underline-offset-2 hover:underline">{t('ob.title')} · Atlas</Link>}
        title={t('ob.title')}
        subtitle={t('ob.subtitle')}
        actions={chosen && <CoverageBadge system={system} />}
      />

      <Stepper step={step} onStep={goto} />

      {atlas.isLoading ? <Shimmer className="h-40" /> : body}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" disabled={step <= 1} onClick={() => goto(step - 1)}>{t('ob.back')}</Button>
        {step < STEP_COUNT && <Button variant="primary" onClick={() => goto(step + 1)}>{t('ob.next')}</Button>}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return <React.Suspense><Onboarding /></React.Suspense>;
}
