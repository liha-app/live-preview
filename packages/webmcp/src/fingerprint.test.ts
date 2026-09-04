import { describe, expect, it, vi } from 'vitest';
import { callFingerprint } from './fingerprint.js';

describe('naming a tool call', () => {
  it('gives the same call the same name', async () => {
    const call = ['The button is too big.', 'Coding agent', '', '{}'];
    expect(await callFingerprint(call)).toBe(await callFingerprint(call));
  });

  it('gives a different call a different name', async () => {
    const a = await callFingerprint(['Too big.', 'Coding agent', '', '{}']);
    const b = await callFingerprint(['Too small.', 'Coding agent', '', '{}']);
    expect(a).not.toBe(b);
  });

  /*
   * Comment text is written by whoever has the link, so it can contain any
   * separator this function might pick. Length-prefixing is what stops one set
   * of arguments being arrangeable to look like another — a reviewer who types
   * a `|` should not be able to collide with somebody else's comment.
   */
  it('cannot be made to confuse one set of arguments for another', async () => {
    const a = await callFingerprint(['ab', 'c']);
    const b = await callFingerprint(['a', 'bc']);
    expect(a).not.toBe(b);

    const c = await callFingerprint(['1:a|1:b', '']);
    const d = await callFingerprint(['a', 'b']);
    expect(c).not.toBe(d);
  });

  it('is short enough for the column and long enough to be unique', async () => {
    const key = await callFingerprint(['x']);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  /*
   * An insecure context has no `crypto.subtle`. Posting the comment without a
   * retry guard is the behaviour that existed before this did; refusing to post
   * would be a worse answer than posting twice.
   */
  it('declines rather than falling back to a weak hash', async () => {
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({} as Crypto);
    expect(await callFingerprint(['anything'])).toBe('');
    vi.restoreAllMocks();
  });
});
