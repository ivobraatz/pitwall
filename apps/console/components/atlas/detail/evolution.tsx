'use client';

import * as React from 'react';

/*
 * Placeholder of the Evolution list (E2 replaces it with the real changes list; the signature stays).
 */
export function EvolutionPanel({ system, since, onNode }: { system: string | null; since: string; onNode: (id: string) => void }) {
  void system; void since; void onNode;
  return <ul data-testid="atlas-evolution-list" className="flex flex-col gap-2" />;
}
