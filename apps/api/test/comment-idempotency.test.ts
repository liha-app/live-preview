import { describe, expect, it } from 'vitest';
import type { Comment, CreatePreviewResult } from '@liha-cli/shared';
import { createTestServer, uploadBody } from './harness.js';

/*
 * A retried tool call must not leave two comments.
 *
 * This is the one place the product treats an agent and a human differently on
 * purpose: an agent that repeats itself is retrying, and a person who types the
 * same sentence twice means it.
 */

const server = () => createTestServer();

async function makePreview(app: ReturnType<typeof createTestServer>) {
  const response = await app.fetch('/api/previews', {
    method: 'POST',
    ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }]),
  });
  return (await response.json()) as CreatePreviewResult;
}

const post = (app: ReturnType<typeof createTestServer>, slug: string, body: unknown) =>
  app.fetch(`/api/previews/${slug}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const call = {
  body: 'The button is too big at mobile width.',
  authorName: 'Coding agent',
  authorKind: 'agent',
  idempotencyKey: 'a1b2c3d4e5f60718',
};

describe('a repeated tool call', () => {
  it('returns the comment it already made instead of a second one', async () => {
    const app = server();
    const { preview } = await makePreview(app);

    const first = await post(app, preview.slug, call);
    const second = await post(app, preview.slug, call);

    expect(first.status).toBe(201);
    // 200, not 201: nothing was created the second time.
    expect(second.status).toBe(200);

    const a = ((await first.json()) as { comment: Comment }).comment;
    const b = ((await second.json()) as { comment: Comment }).comment;
    expect(b.id).toBe(a.id);

    const list = await app.fetch(`/api/previews/${preview.slug}/comments`);
    const { comments } = (await list.json()) as { comments: Comment[] };
    expect(comments).toHaveLength(1);
  });

  /*
   * Two copies of the same call in flight at once. The pre-check cannot see a
   * row that has not been written yet, so the unique index is what decides and
   * the loser has to read back the winner rather than surface a database error.
   */
  it('survives both copies racing', async () => {
    const app = server();
    const { preview } = await makePreview(app);

    const [a, b] = await Promise.all([
      post(app, preview.slug, call),
      post(app, preview.slug, call),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const ids = await Promise.all(
      [a, b].map(async (r) => ((await r.json()) as { comment: Comment }).comment.id),
    );
    expect(ids[0]).toBe(ids[1]);

    const list = await app.fetch(`/api/previews/${preview.slug}/comments`);
    expect(((await list.json()) as { comments: Comment[] }).comments).toHaveLength(1);
  });

  it('is scoped to one preview, so two reviews never collide', async () => {
    const app = server();
    const one = await makePreview(app);
    const two = await makePreview(app);

    expect((await post(app, one.preview.slug, call)).status).toBe(201);
    // The same key, a different review: a real comment, not a duplicate.
    expect((await post(app, two.preview.slug, call)).status).toBe(201);
  });

  it('lets a different comment through under a different key', async () => {
    const app = server();
    const { preview } = await makePreview(app);

    await post(app, preview.slug, call);
    const other = await post(app, preview.slug, { ...call, idempotencyKey: 'ffffffffffffffff' });
    expect(other.status).toBe(201);
  });
});

describe('a person typing', () => {
  /*
   * No key, no deduplication. Someone who writes "same here" on two different
   * threads, or twice in one, meant to.
   */
  it('can say the same thing twice', async () => {
    const app = server();
    const { preview } = await makePreview(app);
    const human = { body: 'Same here.', authorName: 'Mika' };

    expect((await post(app, preview.slug, human)).status).toBe(201);
    expect((await post(app, preview.slug, human)).status).toBe(201);

    const list = await app.fetch(`/api/previews/${preview.slug}/comments`);
    expect(((await list.json()) as { comments: Comment[] }).comments).toHaveLength(2);
  });
});
