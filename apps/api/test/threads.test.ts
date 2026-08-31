import { describe, expect, it } from 'vitest';
import type { Comment, CreatePreviewResult } from '@liha/shared';
import { LIMITS } from '@liha/shared';
import { createTestServer, ownerHeaders, uploadBody, type TestServer } from './harness.js';

const PAGE = { path: 'index.html', content: '<html><body>hi</body></html>', type: 'text/html' };

async function create(server: TestServer) {
  const response = await server.fetch('/api/previews', { method: 'POST', ...uploadBody([PAGE]) });
  return (await response.json()) as CreatePreviewResult;
}

async function comment(server: TestServer, slug: string, body: unknown) {
  const response = await server.fetch(`/api/previews/${slug}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as { comment: Comment } };
}

const list = (server: TestServer, slug: string, status = 'all') =>
  server.json(`/api/previews/${slug}/comments?status=${status}`) as Promise<{
    comments: Comment[];
    counts: { open: number; resolved: number; total: number };
  }>;

describe('comment threads', () => {
  it('replies attach to a thread and follow their parent in the listing', async () => {
    const server = createTestServer();
    const created = await create(server);
    const { slug } = created.preview;

    const root = await comment(server, slug, {
      authorName: 'Sam',
      body: 'Make this button smaller.',
      target: { annotation: { type: 'pin', point: { x: 0.5, y: 0.5 } } },
    });
    expect(root.json.comment.parentId).toBeNull();
    expect(root.json.comment.replyCount).toBe(0);

    const other = await comment(server, slug, { body: 'Unrelated note.' });

    const reply = await comment(server, slug, {
      authorName: 'Alex',
      body: 'Agreed — 14px would do.',
      parentId: root.json.comment.id,
    });
    expect(reply.status).toBe(201);
    expect(reply.json.comment.parentId).toBe(root.json.comment.id);
    expect(reply.json.comment.replyCount).toBe(0);

    const listed = await list(server, slug);
    // Root, its reply, then the unrelated thread.
    expect(listed.comments.map((item) => item.id)).toEqual([
      root.json.comment.id,
      reply.json.comment.id,
      other.json.comment.id,
    ]);
    expect(listed.comments[0]!.replyCount).toBe(1);
    // Counts are threads, not messages.
    expect(listed.counts).toEqual({ open: 2, resolved: 0, total: 2 });
  });

  it('a reply inherits the thread version and does not carry its own target', async () => {
    const server = createTestServer();
    const created = await create(server);
    const { slug } = created.preview;

    const root = await comment(server, slug, {
      body: 'On v1.',
      target: { annotation: { type: 'pin', point: { x: 0.1, y: 0.1 } } },
    });

    // Ship v2, then reply to the v1 thread.
    await server.fetch(`/api/previews/${slug}/versions`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
      ...uploadBody([{ ...PAGE, content: '<html><body>v2</body></html>' }]),
    });

    const reply = await comment(server, slug, {
      body: 'Still applies.',
      parentId: root.json.comment.id,
      target: { annotation: { type: 'pin', point: { x: 0.9, y: 0.9 } } },
    });
    expect(reply.json.comment.versionId).toBe(root.json.comment.versionId);
    expect(reply.json.comment.target.annotation).toBeFalsy();
  });

  it('refuses nested replies and cross-preview parents', async () => {
    const server = createTestServer();
    const a = await create(server);
    const b = await create(server);

    const root = await comment(server, a.preview.slug, { body: 'root' });
    const reply = await comment(server, a.preview.slug, {
      body: 'reply',
      parentId: root.json.comment.id,
    });

    const nested = await server.fetch(`/api/previews/${a.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'nested', parentId: reply.json.comment.id }),
    });
    expect(nested.status).toBe(400);

    const crossPreview = await server.fetch(`/api/previews/${b.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hijack', parentId: root.json.comment.id }),
    });
    expect(crossPreview.status).toBe(404);

    const missing = await server.fetch(`/api/previews/${a.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x', parentId: 'cm_nope' }),
    });
    expect(missing.status).toBe(404);
  });

  it('resolves and reopens a whole thread at once', async () => {
    const server = createTestServer();
    const created = await create(server);
    const { slug } = created.preview;

    const root = await comment(server, slug, { body: 'root' });
    await comment(server, slug, { body: 'reply one', parentId: root.json.comment.id });
    await comment(server, slug, { body: 'reply two', parentId: root.json.comment.id });

    await server.fetch(`/api/previews/${slug}/comments/${root.json.comment.id}/resolve`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
    });

    const resolved = await list(server, slug, 'resolved');
    expect(resolved.comments).toHaveLength(3);
    expect(resolved.comments.every((item) => item.status === 'resolved')).toBe(true);
    expect(resolved.counts).toEqual({ open: 0, resolved: 1, total: 1 });

    // A resolved thread disappears from the open list entirely, replies included.
    expect((await list(server, slug, 'open')).comments).toHaveLength(0);

    await server.fetch(`/api/previews/${slug}/comments/${root.json.comment.id}/reopen`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
    });
    const reopened = await list(server, slug, 'open');
    expect(reopened.comments).toHaveLength(3);
    expect(reopened.comments.every((item) => item.status === 'open')).toBe(true);
  });
});

describe('comment rate limiting', () => {
  it('stops a flood from anyone holding the share link', async () => {
    const server = createTestServer();
    const created = await create(server);
    const { slug } = created.preview;

    for (let index = 0; index < LIMITS.commentsPerWindow; index += 1) {
      const result = await comment(server, slug, { body: `note ${index}` });
      expect(result.status, `comment ${index}`).toBe(201);
    }
    const blocked = await server.fetch(`/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'one too many' }),
    });
    expect(blocked.status).toBe(429);
  });
});
