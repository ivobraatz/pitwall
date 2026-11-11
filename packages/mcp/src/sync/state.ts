import { readFileSync, writeFileSync } from 'node:fs';
import type { Scope } from './types.js';

/* What the last successful sync sent, kept in .git so --if-changed can skip the network. */

export interface Fingerprint {
  bundleHash: string;
  headSha: string | null;
  scope: Scope;
}

export function readFingerprint(file: string): Fingerprint | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof v.bundleHash !== 'string' || typeof v.scope !== 'string') return null;
    return { bundleHash: v.bundleHash, headSha: typeof v.headSha === 'string' ? v.headSha : null, scope: v.scope as Scope };
  } catch {
    return null;
  }
}

export function writeFingerprint(file: string, fp: Fingerprint): void {
  writeFileSync(file, `${JSON.stringify(fp)}\n`);
}

export function sameFingerprint(a: Fingerprint | null, b: Fingerprint): boolean {
  return a !== null && a.bundleHash === b.bundleHash && a.headSha === b.headSha && a.scope === b.scope;
}
