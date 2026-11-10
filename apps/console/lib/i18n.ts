'use client';

import * as React from 'react';

/*
 * The console's two languages. A screen keeps its words in one table per language and reads them
 * with useT(); the choice follows the browser, and a person can pin it (kept in this browser).
 */

export type Locale = 'pt' | 'en';
const KEY = 'pw-locale';
const listeners = new Set<() => void>();

function read(): Locale {
  try {
    const pinned = window.localStorage.getItem(KEY);
    if (pinned === 'pt' || pinned === 'en') return pinned;
  } catch { /* storage blocked: follow the browser */ }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function setLocale(locale: Locale) {
  try { window.localStorage.setItem(KEY, locale); } catch { /* not kept, still applied below */ }
  current = locale;
  document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
  listeners.forEach((l) => l());
}

let current: Locale | null = null;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = (): Locale => (current ??= read());

export function useLocale(): Locale {
  // The server renders Portuguese (the document's language); the browser's choice applies on hydration.
  return React.useSyncExternalStore(subscribe, snapshot, () => 'pt');
}

export type Words<K extends string> = Record<Locale, Record<K, string>>;

/** `t('key')`, with `{name}` placeholders filled from the second argument. */
export function useT<K extends string>(words: Words<K>) {
  const locale = useLocale();
  return React.useCallback((key: K, vars?: Record<string, string | number>) => {
    let text: string = words[locale][key] ?? words.pt[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  }, [locale, words]);
}

/** "5 minutes ago", in the chosen language. */
export function ago(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const rtf = new Intl.RelativeTimeFormat(locale === 'pt' ? 'pt-BR' : 'en', { numeric: 'auto' });
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en');
}
