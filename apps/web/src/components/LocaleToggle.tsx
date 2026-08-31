import { Languages } from 'lucide-react';
import { LOCALES, useI18n } from '../i18n/index.js';

/**
 * Two languages, so a single button that swaps between them beats a menu.
 * The label always names the language you would switch *to*.
 */
export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]!;
  const nextLabel = t(next === 'ja' ? 'lang.ja' : 'lang.en');

  return (
    <button
      type="button"
      className="btn btn--icon btn--quiet"
      onClick={() => setLocale(next)}
      title={`${t('lang.label')}: ${nextLabel}`}
      aria-label={`${t('lang.label')}: ${nextLabel}`}
      lang={next}
    >
      <Languages size={15} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
