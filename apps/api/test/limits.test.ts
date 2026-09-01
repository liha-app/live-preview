import { describe, expect, it } from 'vitest';
import { LIMITS, type CreatePreviewResult } from '@liha/shared';
import { createTestServer, ownerHeaders, uploadBody, type TestServer } from './harness.js';

const PAGE = { path: 'index.html', content: '<!doctype html><h1>Build</h1>', type: 'text/html' };

const fromClient = (ip: string) => ({ 'cf-connecting-ip': ip });

const errorBody = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

function createPreview(server: TestServer, ip: string) {
  return server.fetch('/api/previews', {
    method: 'POST',
    headers: fromClient(ip),
    ...uploadBody([PAGE]),
  });
}

/**
 * Adds a version row directly, standing in for uploads that already happened.
 * The guard reads these rows, so this exercises it without pushing hundreds of
 * megabytes through the test server.
 */
async function seedVersions(
  server: TestServer,
  previewId: string,
  count: number,
  byteSize: number,
) {
  for (let index = 0; index < count; index += 1) {
    await server.env.DB.prepare(
      `INSERT INTO versions (id, preview_id, number, label, entry_path, manifest,
        file_count, byte_size, source, created_at)
       VALUES (?, ?, ?, NULL, 'index.html', '{"entryPath":"index.html","files":[],"totalBytes":0}',
        1, ?, 'test', ?)`,
    )
      .bind(`ver_seed_${index}`, previewId, index + 2, byteSize, new Date().toISOString())
      .run();
  }
}

describe('new previews', () => {
  it('are rate limited per client', async () => {
    const server = createTestServer();

    for (let index = 0; index < LIMITS.previewsPerWindow; index += 1) {
      expect((await createPreview(server, '203.0.113.7')).status).toBe(201);
    }

    const refused = await createPreview(server, '203.0.113.7');
    expect(refused.status).toBe(429);
    expect((await errorBody(refused)).error.code).toBe('rate_limited');
  });

  it('are counted per client, not globally', async () => {
    const server = createTestServer();

    for (let index = 0; index < LIMITS.previewsPerWindow; index += 1) {
      await createPreview(server, '203.0.113.7');
    }

    expect((await createPreview(server, '198.51.100.4')).status).toBe(201);
  });

  it('share one budget with URL imports, which are refused before any fetch', async () => {
    const server = createTestServer();

    for (let index = 0; index < LIMITS.previewsPerWindow; index += 1) {
      await createPreview(server, '203.0.113.7');
    }

    const refused = await server.fetch('/api/previews/url', {
      method: 'POST',
      headers: { ...fromClient('203.0.113.7'), 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    expect(refused.status).toBe(429);
  });
});

describe('a single preview', () => {
  const create = async (server: TestServer) => {
    const response = await createPreview(server, '203.0.113.9');
    return (await response.json()) as CreatePreviewResult;
  };

  const addVersion = (server: TestServer, created: CreatePreviewResult) =>
    server.fetch(`/api/previews/${created.preview.slug}/versions`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
      ...uploadBody([PAGE]),
    });

  it('accepts more versions while under the limit', async () => {
    const server = createTestServer();
    const created = await create(server);

    await seedVersions(server, created.preview.id, LIMITS.maxVersionsPerPreview - 2, 1024);
    expect((await addVersion(server, created)).status).toBe(201);
  });

  it('stops accepting versions at the limit', async () => {
    const server = createTestServer();
    const created = await create(server);

    // One version already exists from creating the preview.
    await seedVersions(server, created.preview.id, LIMITS.maxVersionsPerPreview - 1, 1024);

    const refused = await addVersion(server, created);
    expect(refused.status).toBe(413);
    const body = await errorBody(refused);
    expect(body.error.code).toBe('payload_too_large');
    expect(body.error.message).toContain(String(LIMITS.maxVersionsPerPreview));
  });

  it('stops accepting versions once its total size is spent', async () => {
    const server = createTestServer();
    const created = await create(server);

    await seedVersions(server, created.preview.id, 1, LIMITS.maxPreviewBytes);

    const refused = await addVersion(server, created);
    expect(refused.status).toBe(413);
    expect((await errorBody(refused)).error.message).toContain('limit is');
  });
});

describe('the whole instance', () => {
  it('refuses an upload once its storage ceiling is spent', async () => {
    // Small enough that the first page fits and the second does not.
    const server = createTestServer({ MAX_TOTAL_BYTES: '40' });

    expect((await createPreview(server, '203.0.113.20')).status).toBe(201);

    const refused = await createPreview(server, '203.0.113.21');
    expect(refused.status).toBe(413);
    expect((await errorBody(refused)).error.message).toContain('full');
  });

  it('frees the space again when a preview is deleted', async () => {
    const server = createTestServer({ MAX_TOTAL_BYTES: '40' });

    const first = (await (await createPreview(server, '203.0.113.20')).json()) as {
      preview: { slug: string };
      ownerToken: string;
    };
    expect((await createPreview(server, '203.0.113.21')).status).toBe(413);

    await server.fetch(`/api/previews/${first.preview.slug}`, {
      method: 'DELETE',
      headers: ownerHeaders(first.ownerToken),
    });

    expect((await createPreview(server, '203.0.113.22')).status).toBe(201);
  });

  it('can opt out of the ceiling entirely', async () => {
    const server = createTestServer({ MAX_TOTAL_BYTES: '0' });

    expect((await createPreview(server, '203.0.113.30')).status).toBe(201);
    expect((await createPreview(server, '203.0.113.31')).status).toBe(201);
  });
});

describe('the configured version cap', () => {
  it('leaves room for the Worker to hold the upload in memory', () => {
    // A Worker isolate has 128 MB, and this path holds the multipart body, the
    // expanded entries and the manifest at once.
    expect(LIMITS.maxVersionBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  });

  it('is not smaller than a single permitted file', () => {
    expect(LIMITS.maxFileBytes).toBeLessThanOrEqual(LIMITS.maxVersionBytes);
  });
});
