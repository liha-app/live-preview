import { describe, expect, it } from 'vitest';
import type { CreatePreviewResult } from '@liha/shared';
import { createTestServer, uploadBody } from './harness.js';

/**
 * A preview served from its own hostname.
 *
 * The Worker holds the whole wildcard because Cloudflare cannot route on
 * anything narrower, so what it does with a hostname it does not recognise
 * matters as much as what it does with one it does: liha.review carries more
 * than this service.
 */
const REVIEW = 'https://lp-{slug}.liha.review';
const CONTENT = 'https://lp-{label}.liha.review';

const APP_SHELL = '<!doctype html><html><head><title>Liha</title></head><body></body></html>';

function serverWithAssets(overrides: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const server = createTestServer({
    REVIEW_ORIGIN_TEMPLATE: REVIEW,
    CONTENT_ORIGIN_TEMPLATE: CONTENT,
    APP_ORIGIN: 'https://livepreview.liha.dev',
    ASSETS: {
      fetch: (request: Request) => {
        const path = new URL(request.url).pathname;
        asked.push(path);
        return Promise.resolve(
          path.endsWith('.css')
            ? new Response('body{}', { headers: { 'content-type': 'text/css' } })
            : new Response(APP_SHELL, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
        );
      },
    },
    ...overrides,
  } as never);
  return { server, asked };
}

async function createPreview(server: ReturnType<typeof serverWithAssets>['server']) {
  const response = await server.fetch('/api/previews', {
    method: 'POST',
    ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }]),
  });
  return (await response.json()) as CreatePreviewResult;
}

describe('a preview on its own hostname', () => {
  it('is what the share link points at', async () => {
    const { server } = serverWithAssets();
    const created = await createPreview(server);

    expect(created.preview.shareUrl).toBe(`https://lp-${created.preview.slug}.liha.review`);
  });

  it('serves the app, told which preview it is', async () => {
    const { server } = serverWithAssets();
    const created = await createPreview(server);

    const response = await server.fetchAbsolute(`https://lp-${created.preview.slug}.liha.review/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    // The app reads this rather than parsing a hostname whose shape is
    // deployment configuration.
    expect(html).toContain(`<meta name="liha:slug" content="${created.preview.slug}" />`);
  });

  it('serves the same screen for any path under it', async () => {
    const { server, asked } = serverWithAssets();
    const created = await createPreview(server);
    const host = `https://lp-${created.preview.slug}.liha.review`;

    for (const path of ['/', '/settings', '/deep/link']) {
      const response = await server.fetchAbsolute(host + path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain('liha:slug');
    }
    // Built files are still fetched by their own path.
    await server.fetchAbsolute(`${host}/assets/app.css`);
    expect(asked).toEqual(['/', '/', '/', '/assets/app.css']);
  });

  it('sends a policy that reaches the API and the artifact', async () => {
    const { server } = serverWithAssets();
    const created = await createPreview(server);

    const response = await server.fetchAbsolute(`https://lp-${created.preview.slug}.liha.review/`);
    const csp = response.headers.get('content-security-policy') ?? '';

    // The artifact is a sibling origin, so 'self' does not cover it.
    expect(csp).toContain('frame-src https://*.liha.review');
    expect(csp).toContain('img-src ');
    expect(csp).toMatch(/img-src[^;]*https:\/\/\*\.liha\.review/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/livepreview\.liha\.dev/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.liha\.review/);
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('does not answer for another service on the same domain', async () => {
    const { server, asked } = serverWithAssets();
    await createPreview(server);

    for (const host of ['https://cms-abc123.liha.review', 'https://docs.liha.review']) {
      const response = await server.fetchAbsolute(`${host}/`);
      expect(response.status, host).not.toBe(200);
    }
    expect(asked, 'the app was served to a host that is not ours').toEqual([]);
  });

  it('still serves the artifact on its own hostname', async () => {
    const { server } = serverWithAssets();
    const created = await createPreview(server);

    const response = await server.fetchAbsolute(
      `https://lp-${created.preview.slug}--1.liha.review/index.html`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Hi');
  });

  it('leaves the old path-based link working', async () => {
    const { server } = serverWithAssets();
    const created = await createPreview(server);

    const response = await server.fetch(`/api/previews/${created.preview.slug}`);
    expect(response.status).toBe(200);
  });
});
