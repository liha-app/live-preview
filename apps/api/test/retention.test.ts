import { describe, expect, it } from 'vitest';
import type { CreatePreviewResult } from '@liha/shared';
import { LIMITS } from '@liha/shared';
import { sweepExpired } from '../src/app.js';
import { createTestServer, uploadBody, type TestServer } from './harness.js';

/*
 * Samples expire; uploads do not.
 *
 * "Open a sample" mints a real preview that the visitor owns, which is the
 * point — and also means one accumulates per curious visitor, forever, for
 * something nobody comes back to. Uploads are somebody's work and are kept
 * until they delete them.
 */

const sample = (server: TestServer) =>
  server.json<CreatePreviewResult>('/api/previews/demo', { method: 'POST' });

const upload = (server: TestServer) =>
  server.json<CreatePreviewResult>('/api/previews', {
    method: 'POST',
    ...uploadBody([{ path: 'index.html', content: '<h1>Mine</h1>', type: 'text/html' }]),
  });

/** Moves an expiry into the past, which is the one thing a test cannot wait for. */
async function expireNow(server: TestServer, previewId: string) {
  await server.env.DB.prepare('UPDATE previews SET expires_at = ? WHERE id = ?')
    .bind('2000-01-01T00:00:00.000Z', previewId)
    .run();
}

const storedKeys = (server: TestServer, previewId: string) =>
  server.env.BUCKET.list({ prefix: `previews/${previewId}/` }).then((r) => r.objects.length);

describe('what a preview is worth keeping', () => {
  it('gives a sample a day and an upload none', async () => {
    const server = createTestServer();

    const { preview: mine } = await upload(server);
    expect(mine.expiresAt).toBeNull();

    const { preview: demo } = await sample(server);
    expect(demo.expiresAt).not.toBeNull();

    const hours = (Date.parse(demo.expiresAt as string) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.5);
    expect(hours).toBeLessThanOrEqual(24);
    expect(LIMITS.sampleLifetimeMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe('the sweep', () => {
  it('leaves a sample alone while its day is still running', async () => {
    const server = createTestServer();
    const { preview } = await sample(server);

    expect(await sweepExpired(server.env)).toBe(0);
    expect((await server.fetch(`/api/previews/${preview.slug}`)).status).toBe(200);
  });

  it('takes the bytes with the row, so nothing is left paid for', async () => {
    const server = createTestServer();
    const { preview } = await sample(server);
    expect(await storedKeys(server, preview.id)).toBeGreaterThan(0);

    await expireNow(server, preview.id);
    expect(await sweepExpired(server.env)).toBe(1);

    expect((await server.fetch(`/api/previews/${preview.slug}`)).status).toBe(404);
    expect(await storedKeys(server, preview.id)).toBe(0);
    // And the artifact host stops answering for it too.
    const page = await server.fetchAbsolute(`http://${preview.slug}--1.content.test/index.html`);
    expect(page.status).toBe(404);
  });

  it('never touches an upload, however old', async () => {
    const server = createTestServer();
    const { preview } = await upload(server);
    await server.env.DB.prepare(
      "UPDATE previews SET created_at = '2001-01-01T00:00:00.000Z'",
    ).run();

    expect(await sweepExpired(server.env)).toBe(0);
    expect((await server.fetch(`/api/previews/${preview.slug}`)).status).toBe(200);
  });

  /*
   * A sweep that tries to clear a backlog in one go is how a cron job starts
   * timing out. The next run picks up the rest.
   */
  it('is bounded per run', async () => {
    const server = createTestServer();
    for (let i = 0; i < 3; i += 1) {
      const { preview } = await sample(server);
      await expireNow(server, preview.id);
    }

    expect(await sweepExpired(server.env, 2)).toBe(2);
    expect(await sweepExpired(server.env, 2)).toBe(1);
    expect(await sweepExpired(server.env, 2)).toBe(0);
  });
});
