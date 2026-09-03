import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The share card is a committed PNG and a handful of meta tags, and the two
 * can drift apart silently: a regenerated image at a different size, a renamed
 * file, a relative URL that resolves for a browser and not for the server that
 * fetches an unfurl. None of that shows up on the page itself, so it is caught
 * here instead of in somebody's Slack.
 */

const root = join(import.meta.dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const meta = (property: string) =>
  new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`).exec(html)?.[1] ??
  new RegExp(`<meta\\s+property="${property}"\\s*\\n?\\s*content="([^"]*)"`).exec(html)?.[1];

/** Width and height out of a PNG's IHDR, which is always the first chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('ascii'), 'not a PNG').toBe('PNG');
  expect(bytes.subarray(12, 16).toString('ascii'), 'IHDR is not first').toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the share card', () => {
  it('is served from an absolute URL', () => {
    const image = meta('og:image');
    // A crawler has no document to resolve "/og.png" against.
    expect(image, 'og:image is missing').toBeTruthy();
    expect(new URL(image!).protocol).toBe('https:');
  });

  it('names a file that is actually in the bundle', () => {
    const image = new URL(meta('og:image')!);
    const file = join(root, 'public', image.pathname);
    expect(() => readFileSync(file), `${image.pathname} is not in public/`).not.toThrow();
  });

  it('declares the size the image really is', () => {
    const image = new URL(meta('og:image')!);
    const actual = pngSize(readFileSync(join(root, 'public', image.pathname)));

    expect(actual).toEqual({
      width: Number(meta('og:image:width')),
      height: Number(meta('og:image:height')),
    });
    // What Slack, X and iMessage all crop from. Anything else gets letterboxed.
    expect(actual).toEqual({ width: 1200, height: 630 });
  });

  it('says enough for a large card to render', () => {
    expect(meta('og:title')).toBeTruthy();
    expect(meta('og:description')).toBeTruthy();
    expect(meta('og:image:alt'), 'the card needs alt text like any other image').toBeTruthy();
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});
