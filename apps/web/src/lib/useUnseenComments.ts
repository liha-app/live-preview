import { useEffect, useRef, useState } from 'react';
import { applyTabBadge } from './tabBadge.js';
import { NOTHING_SEEN_YET, nextUnseen, type UnseenState } from './unseen.js';

/**
 * Whether the person is actually looking at this screen.
 *
 * Both halves are load-bearing. `visibilityState` catches the tab being behind
 * another one; `hasFocus` catches the window sitting beside the editor, which
 * stays `visible` the whole time nobody reads it.
 *
 * `hasFocus` is also what keeps clicking into the artifact from counting as
 * leaving: the window fires `blur` when the cross-origin iframe takes focus,
 * but the document still contains the focused element, so this stays true.
 */
const looking = () =>
  typeof document === 'undefined' ||
  (document.visibilityState === 'visible' && document.hasFocus());

function useLooking(): boolean {
  const [value, setValue] = useState(looking);

  useEffect(() => {
    const update = () => setValue(looking());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return value;
}

/**
 * Keeps the tab's icon and title showing what arrived while you were away.
 *
 * Returns the count as well, for anywhere the tab itself cannot be seen.
 */
export function useUnseenComments(ids: readonly string[] | null, title: string | null): number {
  const [state, setState] = useState<UnseenState>(NOTHING_SEEN_YET);
  const here = useLooking();
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    setState((current) => nextUnseen(current, ids, looking()));
  }, [ids]);

  useEffect(() => {
    // Coming back is the same as reading it: the sidebar is right there, and a
    // badge that outlives the glance is just wrong.
    if (here) setState((current) => nextUnseen(current, idsRef.current, true));
  }, [here]);

  useEffect(() => {
    if (title === null) return;
    applyTabBadge(state.count, title);
  }, [state.count, title]);

  useEffect(() => {
    // Leaving the review puts the tab back how it was found. A stale preview
    // name on the landing page is the kind of thing nobody reports and
    // everybody notices.
    const original = document.title;
    return () => applyTabBadge(0, original);
  }, []);

  return state.count;
}
