import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import type { Comment, CreatePreviewResult, Preview } from '@liha-cli/shared';
import { LIMITS } from '@liha-cli/shared';
import { createTestServer, ownerHeaders, uploadBody, type TestServer } from './harness.js';

const PAGE = {
  path: 'index.html',
  content: '<!doctype html><html><body><h1>Secret</h1></body></html>',
  type: 'text/html',
};

async function create(server: TestServer, fields: Record<string, string> = {}) {
  const response = await server.fetch('/api/previews', {
    method: 'POST',
    ...uploadBody([PAGE], fields),
  });
  return (await response.json()) as CreatePreviewResult;
}

describe('owner token', () => {
  it('is never stored in plaintext', async () => {
    const server = createTestServer();
    const created = await create(server);
    const row = await server.env.DB.prepare('SELECT * FROM previews WHERE id = ?')
      .bind(created.preview.id)
      .first<{ owner_token_hash: string }>();

    expect(row?.owner_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.owner_token_hash).not.toContain(created.ownerToken);
    expect(JSON.stringify(row)).not.toContain(created.ownerToken);
  });

  it('gates every mutating owner action', async () => {
    const server = createTestServer();
    const created = await create(server);
    const { slug } = created.preview;
    const other = await create(server);

    const attempts: [string, RequestInit][] = [
      [`/api/previews/${slug}`, { method: 'PATCH', body: '{"title":"x"}' }],
      [`/api/previews/${slug}`, { method: 'DELETE' }],
      [`/api/previews/${slug}/current-version`, { method: 'POST', body: '{"versionId":"v"}' }],
      [`/api/previews/${slug}/versions`, { method: 'POST' }],
    ];

    for (const [path, init] of attempts) {
      const anonymous = await server.fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json' },
      });
      expect(anonymous.status, `${init.method} ${path} without a token`).toBe(401);

      const wrongOwner = await server.fetch(path, {
        ...init,
        headers: { ...ownerHeaders(other.ownerToken), 'content-type': 'application/json' },
      });
      expect(wrongOwner.status, `${init.method} ${path} with another owner's token`).toBe(403);
    }
  });

  it('accepts the token as a bearer credential too', async () => {
    const server = createTestServer();
    const created = await create(server);
    const response = await server.fetch(`/api/previews/${created.preview.slug}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${created.ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { preview: Preview }).preview.title).toBe('Renamed');
  });
});

describe('password protection', () => {
  it('requires a password, issues a session, and rate limits guessing', async () => {
    const server = createTestServer();
    const created = await create(server, { password: 'open-sesame' });
    const { slug } = created.preview;
    expect(created.preview.passwordProtected).toBe(true);

    const blocked = await server.fetch(`/api/previews/${slug}`);
    expect(blocked.status).toBe(401);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'password_required',
    );

    const wrong = await server.fetch(`/api/previews/${slug}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(wrong.status).toBe(401);

    const right = await server.fetch(`/api/previews/${slug}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'open-sesame' }),
    });
    expect(right.status).toBe(200);
    const { reviewSession } = (await right.json()) as { reviewSession: string };
    expect(reviewSession).toMatch(/^liha_rs_/);

    const allowed = await server.fetch(`/api/previews/${slug}`, {
      headers: { 'x-liha-review-session': reviewSession },
    });
    expect(allowed.status).toBe(200);

    // Sessions are stored hashed, like owner tokens.
    const row = await server.env.DB.prepare('SELECT token_hash FROM review_sessions').first<{
      token_hash: string;
    }>();
    expect(row?.token_hash).not.toContain(reviewSession);

    for (let attempt = 0; attempt < LIMITS.passwordAttemptsPerWindow; attempt += 1) {
      await server.fetch(`/api/previews/${slug}/auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: `guess-${attempt}` }),
      });
    }
    const limited = await server.fetch(`/api/previews/${slug}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'open-sesame' }),
    });
    expect(limited.status).toBe(429);
  });

  it('stores only a salted PBKDF2 record', async () => {
    const server = createTestServer();
    const created = await create(server, { password: 'open-sesame' });
    const row = await server.env.DB.prepare('SELECT password_hash FROM previews WHERE id = ?')
      .bind(created.preview.id)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$\d+\$/);
    expect(row?.password_hash).not.toContain('open-sesame');
  });

  it('gates content on a signed, preview-scoped token', async () => {
    const server = createTestServer();
    const created = await create(server, { password: 'open-sesame' });
    const { slug } = created.preview;

    const bare = await server.fetchAbsolute(`http://${slug}--1.content.test/index.html`);
    expect(bare.status).toBe(401);

    // The owner's view carries a usable grant.
    const view = (await server.json(`/api/previews/${slug}`, {
      headers: ownerHeaders(created.ownerToken),
    })) as { preview: Preview };
    const contentUrl = view.preview.contentUrl!;
    expect(contentUrl).toContain('?t=');

    const granted = await server.fetchAbsolute(contentUrl);
    expect(granted.status).toBe(200);
    expect(granted.headers.get('cache-control')).toContain('no-store');

    // The same grant is useless against another preview...
    const other = await create(server, { password: 'open-sesame' });
    const token = new URL(contentUrl).searchParams.get('t')!;
    const crossPreview = await server.fetchAbsolute(
      `http://${other.preview.slug}--1.content.test/index.html?t=${encodeURIComponent(token)}`,
    );
    expect(crossPreview.status).toBe(401);

    // ...and a tampered grant is rejected.
    const tampered = await server.fetchAbsolute(
      `http://${slug}--1.content.test/index.html?t=${encodeURIComponent(`${token}x`)}`,
    );
    expect(tampered.status).toBe(401);
  });

  it('invalidates existing reviewer sessions when the password changes', async () => {
    const server = createTestServer();
    const created = await create(server, { password: 'first-password' });
    const { slug } = created.preview;

    const { reviewSession } = (await server.json(`/api/previews/${slug}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'first-password' }),
    })) as { reviewSession: string };
    expect(
      (
        await server.fetch(`/api/previews/${slug}`, {
          headers: { 'x-liha-review-session': reviewSession },
        })
      ).status,
    ).toBe(200);

    await server.fetch(`/api/previews/${slug}`, {
      method: 'PATCH',
      headers: { ...ownerHeaders(created.ownerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'second-password' }),
    });

    const stale = await server.fetch(`/api/previews/${slug}`, {
      headers: { 'x-liha-review-session': reviewSession },
    });
    expect(stale.status).toBe(401);
  });

  it('hides comments behind the password too', async () => {
    const server = createTestServer();
    const created = await create(server, { password: 'open-sesame' });
    const listed = await server.fetch(`/api/previews/${created.preview.slug}/comments`);
    expect(listed.status).toBe(401);

    const posted = await server.fetch(`/api/previews/${created.preview.slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'sneaky' }),
    });
    expect(posted.status).toBe(401);
  });
});

describe('content isolation', () => {
  it('refuses path traversal in every encoding', async () => {
    const server = createTestServer();
    const created = await create(server);
    const host = `http://${created.preview.slug}--1.content.test`;

    for (const path of [
      '/..%2f..%2fmanifest.json',
      '/%2e%2e%2f%2e%2e%2fmanifest.json',
      '/%252e%252e%252fmanifest.json',
      '/manifest.json',
      '/..%5c..%5cmanifest.json',
    ]) {
      const response = await server.fetchAbsolute(`${host}${path}`);
      expect([400, 404], `${path} -> ${response.status}`).toContain(response.status);
    }
  });

  it('cannot reach another preview through the same content host', async () => {
    const server = createTestServer();
    const a = await create(server);
    await create(server);
    const missing = await server.fetchAbsolute(
      `http://${a.preview.slug}--9.content.test/index.html`,
    );
    expect(missing.status).toBe(404);
  });

  it('never serves uploaded SVG as an executable image type', async () => {
    const server = createTestServer();
    const created = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([
        PAGE,
        { path: 'logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>' },
      ]),
    });
    const result = (await created.json()) as CreatePreviewResult;
    const response = await server.fetchAbsolute(
      `http://${result.preview.slug}--1.content.test/logo.svg`,
    );
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects archives containing traversal entries', async () => {
    const server = createTestServer();
    const zipped = zipSync({
      'index.html': new TextEncoder().encode('<html></html>'),
      '../escape.txt': new TextEncoder().encode('nope'),
    });
    const response = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'site.zip', content: zipped, type: 'application/zip' }]),
    });
    expect(response.status).toBe(400);
  });

  it('expands a well-formed zip into a browsable site', async () => {
    const server = createTestServer();
    const zipped = zipSync({
      'dist/index.html': new TextEncoder().encode('<html><body>zipped</body></html>'),
      'dist/assets/app.css': new TextEncoder().encode('body{color:red}'),
    });
    const response = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'site.zip', content: zipped, type: 'application/zip' }]),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as CreatePreviewResult;
    expect(created.preview.type).toBe('html');
    expect(created.version.entryPath).toBe('index.html');

    const css = await server.fetchAbsolute(
      `http://${created.preview.slug}--1.content.test/assets/app.css`,
    );
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
  });
});

describe('deletion', () => {
  it('removes the preview and its stored objects', async () => {
    const server = createTestServer();
    const created = await create(server);
    const { slug } = created.preview;

    const response = await server.fetch(`/api/previews/${slug}`, {
      method: 'DELETE',
      headers: ownerHeaders(created.ownerToken),
    });
    expect(response.status).toBe(200);
    expect((await server.fetch(`/api/previews/${slug}`)).status).toBe(404);
    expect((await server.fetchAbsolute(`http://${slug}--1.content.test/index.html`)).status).toBe(
      404,
    );

    const remaining = await server.env.BUCKET.list({ prefix: `previews/${created.preview.id}/` });
    expect(remaining.objects).toHaveLength(0);
  });
});

describe('comment validation', () => {
  /*
   * Zod drops unknown keys by default, so a misspelled field used to store an
   * empty target and answer 201 — the caller told their feedback landed, and
   * the thing that makes it worth anything silently gone. An agent writing to
   * this API cannot see that happen; it has to be told.
   */
  it('refuses a target it does not recognise rather than dropping it', async () => {
    const server = createTestServer();
    const created = await server.json<CreatePreviewResult>('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }]),
    });

    for (const target of [
      { dom: { selector: '#cta', tagName: 'BUTTON' } },
      { element: { css: '#cta', tagName: 'BUTTON' } },
      { element: { selector: '#cta', tagName: 'BUTTON' }, viewpoint: { width: 390 } },
    ]) {
      const response = await server.fetch(`/api/previews/${created.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName: 'Mika', body: 'Too big.', target }),
      });
      expect(response.status, JSON.stringify(target)).toBe(400);
    }

    // The shape it does recognise still goes through, with the context intact.
    const ok = await server.json<{ comment: { target: { element: { selector: string } } } }>(
      `/api/previews/${created.preview.slug}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          authorName: 'Mika',
          body: 'Too big.',
          target: { element: { selector: '#cta', tagName: 'BUTTON' } },
        }),
      },
    );
    expect(ok.comment.target.element.selector).toBe('#cta');
  });

  it('rejects malformed annotations and oversized bodies', async () => {
    const server = createTestServer();
    const created = await create(server);
    const post = (body: unknown) =>
      server.fetch(`/api/previews/${created.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect((await post({ body: '' })).status).toBe(400);
    expect((await post({ body: 'x'.repeat(20_000) })).status).toBe(400);
    expect(
      (await post({ body: 'ok', target: { annotation: { type: 'pin', point: { x: 5, y: 5 } } } }))
        .status,
    ).toBe(400);
    expect((await post({ body: 'ok', versionId: 'vr_nonexistent' })).status).toBe(404);

    const good = await post({
      body: 'ok',
      target: { annotation: { type: 'rect', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } },
    });
    expect(good.status).toBe(201);
    expect(((await good.json()) as { comment: Comment }).comment.authorName).toBe('Anonymous');
  });
});
