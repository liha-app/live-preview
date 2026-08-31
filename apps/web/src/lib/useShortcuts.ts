import { useEffect } from 'react';

export interface ShortcutHandlers {
  [combo: string]: (event: KeyboardEvent) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  );
}

/**
 * Global keyboard shortcuts.
 *
 * Single-letter shortcuts are suppressed while the user is typing; combos that
 * include a modifier (and Escape) always fire, so ⌘Enter can submit from inside
 * the composer and Escape can always back out.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const withModifier = event.metaKey || event.ctrlKey;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const combo = withModifier ? `mod+${key}` : key;

      const handler = handlers[combo];
      if (!handler) return;

      const alwaysAllowed = withModifier || key === 'Escape';
      if (!alwaysAllowed && isTypingTarget(event.target)) return;
      if (!withModifier && event.altKey) return;

      handler(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
