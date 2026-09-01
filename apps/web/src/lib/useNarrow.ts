import { useEffect, useState } from 'react';

/**
 * True on a phone-width screen.
 *
 * CSS handles nearly all of the narrow layout. This exists for the one thing
 * CSS cannot reach: the text inside an `<option>`, which the browser truncates
 * mid-character when the select is narrow. The breakpoint is the same 620px
 * the stylesheet uses, and it has to stay that way.
 */
const NARROW = '(max-width: 620px)';

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(NARROW).matches === true,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
}
