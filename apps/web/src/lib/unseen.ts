/**
 * Counting what arrived while you were not looking.
 *
 * The review screen has no server push, so it polls. The question this answers
 * is narrower than "what is new": it is "what showed up while this tab did not
 * have focus", which is the moment a badge is worth anything. Once you are
 * looking at the screen, the sidebar is the answer and the badge is noise.
 *
 * Focus rather than visibility, because a browser window sitting beside the
 * editor is `visible` the whole time you are not reading it.
 *
 * Nothing here needs to know who you are: your own comment is posted while you
 * have focus, so it never counts.
 */

/** How often the comment list is re-fetched, foreground and background alike. */
export const COMMENT_POLL_MS = 15_000;

export interface UnseenState {
  /** Ids already accounted for; `null` until the first list arrives. */
  seen: ReadonlySet<string> | null;
  count: number;
}

export const NOTHING_SEEN_YET: UnseenState = { seen: null, count: 0 };

export function nextUnseen(
  state: UnseenState,
  ids: readonly string[] | null,
  focused: boolean,
): UnseenState {
  // `null` means the list has not arrived. Taking the empty list a screen shows
  // while loading as the baseline makes every existing comment look like it
  // turned up while you were away — which is what shipped, and what the tab
  // said the first time this ran against a preview that already had comments.
  if (ids === null) return state;

  // The first real list is the baseline, focused or not. Opening a link in a
  // background tab is not twenty things happening while you were away.
  if (state.seen === null) return { seen: new Set(ids), count: 0 };

  if (focused) {
    if (state.count === 0 && ids.every((id) => state.seen?.has(id))) return state;
    return { seen: new Set(ids), count: 0 };
  }

  const fresh = ids.filter((id) => !state.seen?.has(id));
  if (fresh.length === 0) return state;
  return { seen: new Set([...state.seen, ...fresh]), count: state.count + fresh.length };
}
