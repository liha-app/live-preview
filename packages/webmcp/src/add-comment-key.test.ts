import { describe, expect, it, vi } from 'vitest';
import { buildTools } from './tools.js';
import type { LihaWebMcpHost } from './host.js';

/*
 * The server can only collapse a retried call if the tool sends it a key. An
 * earlier revision imported the fingerprint and never called it, so the guard
 * existed on the server and was unreachable from the browser. These tests hold
 * the browser side to it: same call, same key; different call, different key;
 * a page without WebCrypto posts unguarded rather than not at all.
 */

function host(overrides: Partial<LihaWebMcpHost> = {}) {
  const addComment = vi.fn(async (input: { body: string; parentId?: string }) => ({
    id: 'cm_1',
    body: input.body,
    status: 'open',
    parentId: input.parentId ?? null,
    versionNumber: 1,
    target: {},
  }));
  const h = {
    getPreview: () => ({ slug: 'abcdefghijkm', type: 'web', currentVersionId: 'vr_1' }),
    getShareInfo: () => null,
    getVersions: () => [],
    getComments: () => [],
    isOwner: () => false,
    addComment,
    resolveComment: vi.fn(),
    listArtifactFiles: () => [],
    readArtifactFile: vi.fn(),
    focusComment: vi.fn(),
    setViewport: vi.fn(),
    ...overrides,
  } as unknown as LihaWebMcpHost;
  return { h, addComment };
}

const addComment = (h: LihaWebMcpHost) => buildTools(h).find((t) => t.name === 'add_comment')!;

const keyOf = (spy: ReturnType<typeof vi.fn>, call = 0) =>
  (spy.mock.calls[call]![0] as { idempotencyKey?: string }).idempotencyKey;

describe('a repeated add_comment', () => {
  it('sends the same key both times', async () => {
    const { h, addComment: spy } = host();
    const tool = addComment(h);
    const args = { body: 'The button is too big.', authorName: 'Coding agent', replyTo: 'cm_9' };

    await tool.execute(args);
    await tool.execute(args);

    expect(keyOf(spy, 0)).toMatch(/^[0-9a-f]{32}$/);
    expect(keyOf(spy, 1)).toBe(keyOf(spy, 0));
  });

  it('sends a different key for a different comment', async () => {
    const { h, addComment: spy } = host();
    const tool = addComment(h);

    await tool.execute({ body: 'Too big.' });
    await tool.execute({ body: 'Too small.' });
    // Same words, different thread: a different act.
    await tool.execute({ body: 'Too big.', replyTo: 'cm_2' });
    // Same words, different anchor.
    await tool.execute({ body: 'Too big.', selector: '#cta' });

    const keys = [0, 1, 2, 3].map((i) => keyOf(spy, i));
    expect(new Set(keys).size).toBe(4);
  });

  /*
   * No `crypto.subtle` means no secure context. The comment still posts — the
   * behaviour before the guard existed — it just posts without a key, and the
   * host must not receive an empty string it would forward as one.
   */
  it('posts without a key where the page has no WebCrypto', async () => {
    const spy = vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({} as Crypto);
    try {
      const { h, addComment: add } = host();
      await addComment(h).execute({ body: 'Still posted.' });
      expect(add).toHaveBeenCalledTimes(1);
      expect('idempotencyKey' in (add.mock.calls[0]![0] as object)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
