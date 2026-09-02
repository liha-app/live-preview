import { describe, expect, it } from 'vitest';
import type { CreatePreviewResult } from '@liha/shared';
import { importUrlPreview } from '../src/url-import.js';
import { createTestServer, ownerHeaders, uploadBody } from './harness.js';

/*
 * A snapshot is the same document served from somewhere else, and the things
 * that break are the ones that were written in terms of where it used to be.
 */

const PAGE = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
<link rel="stylesheet" href="/_astro/index.css">
<title>Marketing site</title>
</head><body><h1>Ship faster</h1><img src="/logo.svg" alt=""></body></html>`;

async function snapshotOf(html: string, headers: Record<string, string> = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    })) as typeof fetch;
  try {
    const imported = await importUrlPreview('https://example.com/');
    const entry = imported.files.find((file) => file.path === 'index.html')!;
    return { imported, html: new TextDecoder().decode(entry.bytes) };
  } finally {
    globalThis.fetch = original;
  }
}

describe('snapshotting a page', () => {
  it('keeps relative assets pointed at the site they came from', async () => {
    const { html } = await snapshotOf(PAGE);
    expect(html).toContain('<base href="https://example.com/">');
    // The markup itself is left alone; the base tag is what moves it.
    expect(html).toContain('href="/_astro/index.css"');
  });

  it('takes the title from the page', async () => {
    const { imported } = await snapshotOf(PAGE);
    expect(imported.title).toBe('Marketing site');
  });

  /*
   * The page's own policy is written in terms of `'self'`, and `'self'` is
   * wherever the document is served from. Moving the document silently
   * redefines every rule in it: the site's own stylesheets and scripts become
   * third-party and it blocks them, so the snapshot renders as bare text.
   * The review bridge is inline, so it blocks that too — and feedback on an
   * imported page quietly loses the DOM context that is the point of it.
   */
  it('drops the policy that was written for the original origin', async () => {
    const { html } = await snapshotOf(PAGE);
    expect(html.toLowerCase()).not.toContain('content-security-policy');
  });

  it('drops it however it is written', async () => {
    for (const meta of [
      `<meta http-equiv=Content-Security-Policy content="default-src 'self'">`,
      `<meta http-equiv='content-security-policy-report-only' content="default-src 'none'">`,
      `<meta charset="utf-8"><meta HTTP-EQUIV = "Content-Security-Policy" CONTENT="default-src 'self'">`,
    ]) {
      const { html } = await snapshotOf(`<html><head>${meta}</head><body>x</body></html>`);
      expect(html.toLowerCase(), meta).not.toContain('content-security-policy');
      // And the rest of the head survives.
      expect(html).toContain('<base href=');
    }
  });

  it('leaves other meta tags where they are', async () => {
    const { html } = await snapshotOf(PAGE);
    expect(html).toContain('<meta charset="utf-8">');
  });
});

/*
 * A preview made from a URL had no way to be brought up to date: the update
 * dialog only took files, so the only way to see the page as it is now was a
 * new preview — and a new share URL, which is the one thing a preview promises
 * not to change.
 */
describe('bringing an imported preview up to date', () => {
  const page = (body: string) =>
    `<!doctype html><html><head><title>Site</title></head><body>${body}</body></html>`;

  async function serving(html: string, run: () => Promise<void>) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  }

  it('fetches the same page again, at the same share URL', async () => {
    const server = createTestServer();
    let created!: CreatePreviewResult;

    await serving(page('<h1>Before</h1>'), async () => {
      created = await server.json<CreatePreviewResult>('/api/previews/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/' }),
      });
    });

    let updated!: { preview: { slug: string; shareUrl: string }; version: { number: number } };
    await serving(page('<h1>After</h1>'), async () => {
      updated = await server.json(`/api/previews/${created.preview.slug}/versions/from-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ownerHeaders(created.ownerToken) },
        body: JSON.stringify({ label: 'today' }),
      });
    });

    expect(updated.version.number).toBe(2);
    expect(updated.preview.shareUrl).toBe(created.preview.shareUrl);

    const html = await (
      await server.fetchAbsolute(`http://${created.preview.slug}--2.content.test/index.html`)
    ).text();
    expect(html).toContain('After');
  });

  it('remembers where it came from, so the URL need not be given again', async () => {
    const server = createTestServer();
    let created!: CreatePreviewResult;
    await serving(page('<h1>One</h1>'), async () => {
      created = await server.json<CreatePreviewResult>('/api/previews/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/' }),
      });
    });
    expect(created.preview.manifest?.sourceUrl).toBe('https://example.com/');
  });

  it('is the owner’s to do, and only for previews made from a URL', async () => {
    const server = createTestServer();
    let created!: CreatePreviewResult;
    await serving(page('<h1>One</h1>'), async () => {
      created = await server.json<CreatePreviewResult>('/api/previews/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/' }),
      });
    });

    const anyone = await server.fetch(`/api/previews/${created.preview.slug}/versions/from-url`, {
      method: 'POST',
    });
    expect(anyone.status).toBe(401);

    const uploaded = await server.json<CreatePreviewResult>('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'index.html', content: '<h1>Mine</h1>', type: 'text/html' }]),
    });
    const refused = await server.fetch(`/api/previews/${uploaded.preview.slug}/versions/from-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ownerHeaders(uploaded.ownerToken) },
      body: JSON.stringify({ url: 'https://example.com/' }),
    });
    expect(refused.status).toBe(400);
  });

  /* The same check as creating one: this makes an outbound request. */
  it('refuses a source pointed at this network', async () => {
    const server = createTestServer();
    let created!: CreatePreviewResult;
    await serving(page('<h1>One</h1>'), async () => {
      created = await server.json<CreatePreviewResult>('/api/previews/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/' }),
      });
    });

    for (const hostile of ['http://127.0.0.1/', 'https://169.254.169.254/']) {
      const response = await server.fetch(
        `/api/previews/${created.preview.slug}/versions/from-url`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...ownerHeaders(created.ownerToken) },
          body: JSON.stringify({ url: hostile }),
        },
      );
      expect(response.status, hostile).toBe(400);
    }
  });
});
