import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { THEMES, type Theme } from '../lib/theme.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/en.js';

const ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };
const LABELS: Record<Theme, MessageKey> = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
};

interface Props {
  theme: Theme;
  onChange(theme: Theme): void;
}

export function ThemeToggle({ theme, onChange }: Props) {
  const t = useT();
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
  const Icon = ICONS[theme];
  const label = t('theme.switchTo', { current: t(LABELS[theme]), next: t(LABELS[next]) });

  return (
    <button
      type="button"
      className="btn btn--icon btn--quiet"
      onClick={() => onChange(next)}
      title={label}
      aria-label={`${t('theme.label')}: ${label}`}
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
