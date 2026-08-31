import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  readTheme,
  resolveTheme,
  watchSystemTheme,
  writeTheme,
  type ResolvedTheme,
  type Theme,
} from './theme.js';

export interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme(theme: Theme): void;
}

export function useTheme(): ThemeState {
  const [theme, setThemeState] = useState<Theme>(() => readTheme());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readTheme()));

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeTheme(next);
    setResolved(applyTheme(next));
  }, []);

  // Follow the OS while the user is on "system".
  useEffect(() => {
    if (theme !== 'system') return;
    return watchSystemTheme(() => setResolved(applyTheme('system')));
  }, [theme]);

  // Another tab changing the theme should not leave this one out of sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== 'liha.theme') return;
      const next = readTheme();
      setThemeState(next);
      setResolved(applyTheme(next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { theme, resolved, setTheme };
}
