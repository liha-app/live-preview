import { describe, expect, it } from 'vitest';
import type {
  Comment,
  CreatePreviewResult,
  Preview,
  ReviewSummary,
  Version,
} from '@liha-cli/shared';
import { TINY_PNG, createTestServer, ownerHeaders, uploadBody } from './harness.js';

const SITE = [
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><title>Landing</title></head><body>' +
      '<section class="hero"><button class="cta">Get started</button></section></body></html>',
    type: 'text/html',
  },
  { path: 'assets/app.js', content: 'console.log("hi")', type: 'text/javascript' },
];

async function createSite(server: ReturnType<typeof createTestServer>, fields = {}) {
  const response = await server.fetch('/api/previews', {
    method: 'POST',
    ...uploadBody(SITE, { title: 'Marketing site', ...fields }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatePreviewResult;
}

describe('the review loop', () => {
  it('carries a preview from upload through comment, new version and resolve', async () => {
    const server = createTestServer();

    // 1. Upload a static site.
    const created = await createSite(server);
    expect(created.preview.type).toBe('html');
    expect(created.preview.versionCount).toBe(1);
    expect(created.version.number).toBe(1);
    expect(created.ownerToken).toMatch(/^liha_ot_/);
    expect(created.ownerUrl).toContain('#owner=');

    const { slug } = created.preview;
    const shareUrl = created.preview.shareUrl;
    expect(shareUrl).toBe(`http://app.test/p/${slug}`);

    // 2. The content lives on its own origin, keyed by version.
    expect(created.preview.contentUrl).toBe(`http://${slug}--1.content.test/index.html`);

    const page = await server.fetchAbsolute(`http://${slug}--1.content.test/index.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Get started');
    expect(html).toContain('data-liha-bridge');
    expect(page.headers.get('content-security-policy')).toContain('sandbox');
    expect(page.headers.get('content-security-policy')).not.toContain('allow-same-origin');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');

    // Root-absolute assets resolve, which is what bundler output needs.
    const asset = await server.fetchAbsolute(`http://${slug}--1.content.test/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('console.log');

    // 3. A reviewer comments on a DOM element, with no owner token.
    const commentResponse = await server.fetch(`/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authorName: 'Reviewer',
        body: 'Make this button smaller.',
        target: {
          annotation: { type: 'pin', point: { x: 0.5, y: 0.25 } },
          path: '/index.html',
          element: {
            selector: 'section.hero > button.cta',
            tagName: 'BUTTON',
            textContent: 'Get started',
          },
          viewport: { width: 1280, height: 800 },
        },
      }),
    });
    expect(commentResponse.status).toBe(201);
    const { comment } = (await commentResponse.json()) as { comment: Comment };
    expect(comment.status).toBe('open');
    expect(comment.stale).toBe(false);
    expect(comment.target.element?.selector).toBe('section.hero > button.cta');
    expect(comment.targetDescription).toContain('button.cta');

    // 4. The owner ships a new version to the SAME share URL.
    const updated = await server.fetch(`/api/previews/${slug}/versions`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
      ...uploadBody(
        [{ ...SITE[0]!, content: SITE[0]!.content.replace('Get started', 'Start') }, SITE[1]!],
        { source: 'cli' },
      ),
    });
    expect(updated.status).toBe(201);
    const { preview: afterUpdate, version: v2 } = (await updated.json()) as {
      preview: Preview;
      version: Version;
    };
    expect(v2.number).toBe(2);
    expect(afterUpdate.shareUrl).toBe(shareUrl);
    expect(afterUpdate.slug).toBe(slug);
    expect(afterUpdate.versionCount).toBe(2);
    expect(afterUpdate.currentVersionId).toBe(v2.id);

    // The old version stays reachable and immutable.
    const v1Page = await server.fetchAbsolute(`http://${slug}--1.content.test/index.html`);
    expect(await v1Page.text()).toContain('Get started');
    const v2Page = await server.fetchAbsolute(`http://${slug}--2.content.test/index.html`);
    expect(await v2Page.text()).toContain('Start');

    // 5. The earlier comment is now marked stale but still readable.
    const listed = (await server.json(`/api/previews/${slug}/comments?status=all`)) as {
      comments: Comment[];
    };
    expect(listed.comments).toHaveLength(1);
    expect(listed.comments[0]!.stale).toBe(true);
    expect(listed.comments[0]!.versionNumber).toBe(1);

    // 6. Only the owner can resolve.
    const forbidden = await server.fetch(`/api/previews/${slug}/comments/${comment.id}/resolve`, {
      method: 'POST',
    });
    expect(forbidden.status).toBe(401);

    const resolved = await server.fetch(`/api/previews/${slug}/comments/${comment.id}/resolve`, {
      method: 'POST',
      headers: { ...ownerHeaders(created.ownerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ resolvedBy: 'agent' }),
    });
    expect(resolved.status).toBe(200);
    const resolvedComment = ((await resolved.json()) as { comment: Comment }).comment;
    expect(resolvedComment.status).toBe('resolved');
    expect(resolvedComment.resolvedBy).toBe('agent');
    expect(resolvedComment.resolvedAt).not.toBeNull();

    const summary = (await server.json(`/api/previews/${slug}/summary`)) as ReviewSummary;
    expect(summary.counts).toEqual({ open: 0, resolved: 1, total: 1 });
    expect(summary.versions).toHaveLength(2);
    expect(summary.currentVersion?.number).toBe(2);
  });

  it('switches and restores versions on the owner request only', async () => {
    const server = createTestServer();
    const created = await createSite(server);
    const { slug } = created.preview;

    await server.fetch(`/api/previews/${slug}/versions`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
      ...uploadBody([{ ...SITE[0]!, content: '<html><body>v2</body></html>' }]),
    });

    const versions = (
      (await server.json(`/api/previews/${slug}/versions`)) as {
        versions: Version[];
      }
    ).versions;
    expect(versions.map((v) => v.number)).toEqual([2, 1]);
    const v1 = versions.find((v) => v.number === 1)!;

    const denied = await server.fetch(`/api/previews/${slug}/current-version`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ versionId: v1.id }),
    });
    expect(denied.status).toBe(401);

    const restored = await server.fetch(`/api/previews/${slug}/current-version`, {
      method: 'POST',
      headers: { ...ownerHeaders(created.ownerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ versionId: v1.id }),
    });
    expect(restored.status).toBe(200);
    const preview = ((await restored.json()) as { preview: Preview }).preview;
    expect(preview.currentVersionNumber).toBe(1);
    expect(preview.shareUrl).toBe(created.preview.shareUrl);

    // A version from another preview cannot be adopted.
    const other = await createSite(server);
    const otherVersions = (
      (await server.json(`/api/previews/${other.preview.slug}/versions`)) as {
        versions: Version[];
      }
    ).versions;
    const cross = await server.fetch(`/api/previews/${slug}/current-version`, {
      method: 'POST',
      headers: { ...ownerHeaders(created.ownerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ versionId: otherVersions[0]!.id }),
    });
    expect(cross.status).toBe(404);
  });

  it('detects images and PDFs from their bytes, not their names', async () => {
    const server = createTestServer();
    const image = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'shot.png', content: TINY_PNG, type: 'image/png' }]),
    });
    expect(((await image.json()) as CreatePreviewResult).preview.type).toBe('image');

    const pdf = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'doc.pdf', content: '%PDF-1.4\nbody', type: 'application/pdf' }]),
    });
    expect(((await pdf.json()) as CreatePreviewResult).preview.type).toBe('pdf');

    // A file claiming to be an image but carrying HTML is refused.
    const liar = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([
        { path: 'evil.png', content: '<script>alert(1)</script>', type: 'image/png' },
      ]),
    });
    expect(liar.status).toBe(415);
  });
});

describe('the sample preview', () => {
  it('creates a real, immediately reviewable preview with seeded threads', async () => {
    const server = createTestServer();
    const response = await server.fetch('/api/previews/demo', { method: 'POST' });
    expect(response.status).toBe(201);

    const created = (await response.json()) as CreatePreviewResult;
    expect(created.preview.type).toBe('html');
    expect(created.ownerToken).toMatch(/^liha_ot_/);
    // Two threads, one of which has a reply.
    expect(created.preview.openCommentCount).toBe(2);

    // The artifact really is served, assets and all.
    const page = await server.fetchAbsolute(
      `http://${created.preview.slug}--1.content.test/index.html`,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Get started now');
    const css = await server.fetchAbsolute(
      `http://${created.preview.slug}--1.content.test/assets/site.css`,
    );
    expect(css.status).toBe(200);

    // An agent asking "what is open here?" gets DOM context straight away.
    const listed = (await server.json(
      `/api/previews/${created.preview.slug}/comments?status=open`,
    )) as { comments: Comment[] };
    const root = listed.comments.find((comment) => comment.parentId === null)!;
    expect(root.target.element?.selector).toBe('#cta');
    expect(root.target.element?.htmlSnippet).toContain('<button');
    expect(root.replyCount).toBe(1);
    expect(listed.comments.some((comment) => comment.parentId === root.id)).toBe(true);

    // And the owner token works, so a visitor can finish the loop.
    const resolved = await server.fetch(
      `/api/previews/${created.preview.slug}/comments/${root.id}/resolve`,
      { method: 'POST', headers: ownerHeaders(created.ownerToken) },
    );
    expect(resolved.status).toBe(200);
  });

  it('gives every visitor their own copy', async () => {
    const server = createTestServer();
    const a = (await (
      await server.fetch('/api/previews/demo', { method: 'POST' })
    ).json()) as CreatePreviewResult;
    const b = (await (
      await server.fetch('/api/previews/demo', { method: 'POST' })
    ).json()) as CreatePreviewResult;
    expect(a.preview.slug).not.toBe(b.preview.slug);
    expect(a.ownerToken).not.toBe(b.ownerToken);
  });

  it('seeds the sample in the past, so a real reply sorts after it', async () => {
    const server = createTestServer();
    const created = (await (
      await server.fetch('/api/previews/demo', { method: 'POST' })
    ).json()) as CreatePreviewResult;
    const { slug } = created.preview;

    const before = (await server.json(`/api/previews/${slug}/comments?status=all`)) as {
      comments: Comment[];
    };
    const root = before.comments.find((comment) => comment.parentId === null)!;
    for (const comment of before.comments) {
      expect(new Date(comment.createdAt).getTime(), comment.id).toBeLessThanOrEqual(Date.now());
    }

    await server.fetch(`/api/previews/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorName: 'AI agent', body: 'Fixed it.', parentId: root.id }),
    });

    const after = (await server.json(`/api/previews/${slug}/comments?status=all`)) as {
      comments: Comment[];
    };
    const replies = after.comments.filter((comment) => comment.parentId === root.id);
    expect(replies.map((reply) => reply.authorName)).toEqual(['Mika (product)', 'AI agent']);
  });
});
