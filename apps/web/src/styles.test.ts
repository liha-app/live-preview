import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * A misspelled custom property does not fail — `var(--muted)` where the token
 * is `--fg-muted` silently inherits, so the text renders in the full
 * foreground and looks deliberate. It shipped once. This is the cheapest place
 * to notice.
 *
 * The two sheets are not peers. `paper.css` is a layer over `styles.css` and
 * may use its tokens; `styles.css` may not use paper's, which are scoped to
 * `.paper` and resolve to nothing on the review screen.
 */
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

const BASE = read('./styles.css');
const PAPER = read('./paper.css');

const declared = (css: string) =>
  [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1] as string);
// A fallback (`var(--x, 8px)`) is a deliberate answer to a missing token.
const named = (css: string) =>
  [...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1] as string);

describe.each([
  { file: 'styles.css', css: BASE, defined: declared(BASE) },
  { file: 'paper.css', css: PAPER, defined: [...declared(PAPER), ...declared(BASE)] },
])('$file', ({ css, defined }) => {
  it('only names custom properties that resolve', () => {
    const available = new Set(defined);
    const missing = [...new Set(named(css).filter((name) => !available.has(name)))];
    expect(missing).toEqual([]);
  });
});
