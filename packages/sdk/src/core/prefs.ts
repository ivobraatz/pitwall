/**
 * Per-browser support preferences: whether the rolling recording buffer runs, and whether
 * recordings mask data. Kept in localStorage because they are about this machine — a shared
 * workstation may want the buffer off — and because a preference about what gets recorded
 * should take effect without a round trip.
 */

export interface SupportPrefs {
  /** Rolling DOM buffer of the last minutes, so an error can be reported with what led to it. */
  bufferEnabled: boolean;
  /** Replace table cells, marked elements and input values with asterisks in every recording. */
  maskData: boolean;
}

const KEY = 'pitwall-support-prefs';
const EVENT = 'pitwall:prefs';
let defaults: SupportPrefs = { bufferEnabled: true, maskData: true };

export function setDefaultPrefs(d: Partial<SupportPrefs>): void {
  defaults = { ...defaults, ...d };
}

export function readPrefs(): SupportPrefs {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SupportPrefs>;
    return {
      bufferEnabled: typeof parsed.bufferEnabled === 'boolean' ? parsed.bufferEnabled : defaults.bufferEnabled,
      maskData: typeof parsed.maskData === 'boolean' ? parsed.maskData : defaults.maskData,
    };
  } catch {
    return defaults;
  }
}

export function writePrefs(patch: Partial<SupportPrefs>): SupportPrefs {
  const next = { ...readPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: lives for the session */ }
  window.dispatchEvent(new Event(EVENT));
  return next;
}

export function subscribePrefs(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
