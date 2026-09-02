import { describe, expect, it } from 'vitest';
import { importUrlPreview } from '../src/url-import.js';

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
