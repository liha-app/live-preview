import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en, type MessageKey, type Messages } from './en.js';
import { ja } from './ja.js';

export const LOCALES = ['en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

const CATALOGUES: Record<Locale, Messages> = { en, ja };
const STORAGE_KEY = 'liha.locale';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function readLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* private mode */
  }
  // Fall back to the browser's preference, then English.
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export interface Translate {
  (key: MessageKey, params?: Record<string, string | number>): string;
  /** Picks the singular or plural half of a `one|other` message. */
  plural(key: MessageKey, count: number, params?: Record<string, string | number>): string;
}

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const messages = CATALOGUES[locale];

    const translate = ((key, params) =>
      interpolate(messages[key] ?? en[key] ?? key, params)) as Translate;

    translate.plural = (key, count, params) => {
      const raw = messages[key] ?? en[key] ?? key;
      const [one, other] = raw.split('|');
      // `Intl.PluralRules` keeps this correct for locales with more than two
      // forms; Japanese resolves to a single form, which is why both halves of
      // the catalogue entry are identical there.
      const form = new Intl.PluralRules(locale).select(count);
      const chosen = form === 'one' ? (one ?? raw) : (other ?? one ?? raw);
      return interpolate(chosen, { count, ...params });
    };

    return { locale, setLocale, t: translate };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

export function useT(): Translate {
  return useI18n().t;
}

/** Locale-aware "2h ago" style formatting for comment timestamps. */
export function formatRelativeTime(iso: string, locale: Locale): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  if (minutes < 1) return format.format(0, 'minute');
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return format.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 7) return format.format(-days, 'day');
  return new Date(iso).toLocaleDateString(locale);
}

export type { MessageKey };
