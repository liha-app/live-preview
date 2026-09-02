import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTHING_SEEN_YET, nextUnseen, type UnseenState } from './unseen.js';
import { IDLE_ICON, badgedIcon, badgedTitle } from './tabBadge.js';

const fold = (focused: boolean, ...lists: string[][]) =>
  lists.reduce<UnseenState>((state, ids) => nextUnseen(state, ids, focused), NOTHING_SEEN_YET);

describe('what arrived while you were away', () => {
  it('treats the first list as the baseline, focused or not', () => {
    // Opening a share link in a background tab is not twenty things happening.
    expect(fold(false, ['a', 'b', 'c']).count).toBe(0);
    expect(fold(true, ['a', 'b', 'c']).count).toBe(0);
  });

  /*
   * The screen renders an empty list while the request is in flight. Taking
   * that as the baseline made every comment a preview already had look like it
   * arrived while you were away — the tab said "(3)" on a preview nobody had
   * touched.
   */
  it('waits for the list before deciding what was already there', () => {
    const loading = nextUnseen(NOTHING_SEEN_YET, null, false);
    expect(loading).toBe(NOTHING_SEEN_YET);
    expect(nextUnseen(loading, ['a', 'b', 'c'], false).count).toBe(0);
  });

  it('counts what appears while the tab does not have focus', () => {
    expect(fold(false, ['a'], ['a', 'b'], ['a', 'b', 'c']).count).toBe(2);
  });

  it('counts nothing while you are looking at it', () => {
    // Your own comment is posted with the tab focused, which is why none of
    // this needs to know who you are.
    expect(fold(true, ['a'], ['a', 'b']).count).toBe(0);
  });

  it('clears once you come back, and starts counting again if you leave', () => {
    const away = fold(false, ['a'], ['a', 'b']);
    expect(away.count).toBe(1);

    const back = nextUnseen(away, ['a', 'b'], true);
    expect(back.count).toBe(0);

    expect(nextUnseen(back, ['a', 'b', 'c'], false).count).toBe(1);
  });

  it('does not count the same comment twice across polls', () => {
    const state = fold(false, ['a'], ['a', 'b'], ['a', 'b'], ['a', 'b']);
    expect(state.count).toBe(1);
  });

  it('keeps the same object when a poll brings nothing new', () => {
    // The state feeds a React effect; a fresh object every 15 seconds would
    // redraw the icon forever.
    const state = fold(false, ['a', 'b']);
    expect(nextUnseen(state, ['a', 'b'], false)).toBe(state);
    expect(nextUnseen(state, ['a', 'b'], true)).toBe(state);
  });

  it('is not confused by a deletion', () => {
    const state = fold(false, ['a', 'b'], ['a']);
    expect(state.count).toBe(0);
  });
});

describe('the tab badge', () => {
  it('says the count in the title, and nothing when there is none', () => {
    expect(badgedTitle(0, 'Marketing site')).toBe('Marketing site');
    expect(badgedTitle(3, 'Marketing site')).toBe('(3) Marketing site');
  });

  it('draws a number, and stops at 9+', () => {
    expect(decodeURIComponent(badgedIcon(4))).toContain('>4</text>');
    expect(decodeURIComponent(badgedIcon(12))).toContain('>9+</text>');
  });

  /*
   * The page names an icon in its markup so the tab is not blank before the
   * bundle runs. If the two drift apart the icon visibly swaps on every load.
   */
  it('points at the same mark that index.html already names', () => {
    // Read from the package root: Vite rewrites `new URL(…, import.meta.url)`
    // into an asset URL, which for the entry HTML is the dev server's.
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain(`href="${IDLE_ICON}"`);
  });

  it('ships the mark it points at', () => {
    const mark = readFileSync(join(process.cwd(), 'public', IDLE_ICON), 'utf8');
    expect(mark.startsWith('<svg')).toBe(true);
    // Artwork, not a placeholder, and small enough to be an icon.
    expect(mark.length).toBeGreaterThan(500);
    expect(mark.length).toBeLessThan(20_000);
  });
});
