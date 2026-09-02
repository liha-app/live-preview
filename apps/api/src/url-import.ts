import {
  UrlValidationError,
  contentTypeForPath,
  safeFetch,
  type VersionManifest,
} from '@liha-cli/shared';
import { ApiError, badRequest } from './errors.js';

/** Cap on the fetched document; a review snapshot does not need more than this. */
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

export interface ImportedFile {
  path: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ImportedUrlPreview {
  title: string;
  files: ImportedFile[];
  manifest: VersionManifest;
}

/**
 * Optional screenshot backend.
 *
 * Kept behind an interface because the two realistic implementations —
 * Cloudflare Browser Rendering in production and Playwright locally — have
 * nothing in common beyond "give me a PNG of this URL".
 */
export interface ScreenshotProvider {
  readonly name: string;
  capture(url: string): Promise<Uint8Array | null>;
}

export const NULL_SCREENSHOT_PROVIDER: ScreenshotProvider = {
  name: 'none',
  async capture() {
    return null;
  },
};

/** Wraps a Cloudflare Browser Rendering binding, when one is configured. */
export function browserRenderingProvider(binding: unknown): ScreenshotProvider {
  return {
    name: 'cloudflare-browser-rendering',
    async capture(url: string) {
      const fetcher = binding as { fetch?: (request: Request) => Promise<Response> } | undefined;
      if (!fetcher?.fetch) return null;
      const response = await fetcher.fetch(
        new Request('https://browser.local/screenshot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, screenshotOptions: { fullPage: true, type: 'png' } }),
        }),
      );
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function extractTitle(html: string, fallback: string): string {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title && title.length > 0 ? title : fallback;
}

/**
 * A page's own Content-Security-Policy, delivered in its markup.
 *
 * It has to go, and not because policies are inconvenient. Such a policy is
 * written in terms of `'self'`, and `'self'` means the origin the document is
 * served from. Moving the document to a snapshot host silently redefines every
 * one of those rules: the site's own stylesheets, scripts and images become
 * third-party to it and it blocks them, so the snapshot renders as bare text.
 * The review bridge is inline, so it blocks that too — feedback on an imported
 * page would quietly lose the DOM context that is the point of it.
 *
 * Nothing is given up by dropping it. What keeps a snapshot harmless is this
 * server's own `Content-Security-Policy: sandbox` header and the iframe it is
 * shown in — neither of which the snapshot can reach.
 */
const POLICY_META =
  /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy(?:-report-only)?["']?[^>]*>/gi;

/**
 * Rewrites the snapshot so relative assets keep resolving against the original
 * site, and drops the policy that would stop them.
 */
function prepareSnapshot(html: string, baseUrl: string): string {
  const stripped = html.replace(POLICY_META, '');
  const baseTag = `<base href="${baseUrl.replace(/"/g, '&quot;')}"><meta name="referrer" content="no-referrer">`;
  const headOpen = /<head[^>]*>/i.exec(stripped);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return stripped.slice(0, at) + baseTag + stripped.slice(at);
  }
  return `<!doctype html><head>${baseTag}</head>${stripped}`;
}

/**
 * Imports a public URL as a reviewable snapshot.
 *
 * The document is stored on the isolated content origin, which means the review
 * bridge is injected into it like any other HTML preview and reviewers get real
 * DOM context. It is a static snapshot: scripts that fetch cross-origin data may
 * not run, and this deliberately never renders the page server-side.
 */
export async function importUrlPreview(
  rawUrl: string,
  options: { screenshots?: ScreenshotProvider } = {},
): Promise<ImportedUrlPreview> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let result: Awaited<ReturnType<typeof safeFetch>>;
  try {
    result = await safeFetch(rawUrl, {
      signal: controller.signal,
      init: {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'LihaLivePreview/0.1 (+https://github.com/liha/live-preview)',
        },
      },
    });
  } catch (error) {
    if (error instanceof UrlValidationError) throw error;
    throw badRequest('Could not fetch that URL.');
  } finally {
    clearTimeout(timer);
  }

  const { response, finalUrl } = result;
  if (!response.ok) {
    throw badRequest(`The URL responded with HTTP ${response.status}.`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new ApiError('unsupported_media_type', 'URL previews currently support HTML pages only.');
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new ApiError('payload_too_large', 'That page is too large to snapshot.');
  }

  const html = new TextDecoder().decode(buffer);
  const title = extractTitle(html, finalUrl.hostname);
  const snapshot = new TextEncoder().encode(prepareSnapshot(html, finalUrl.toString()));

  const files: ImportedFile[] = [
    { path: 'index.html', bytes: snapshot, contentType: 'text/html; charset=utf-8' },
  ];

  const screenshot = await (options.screenshots ?? NULL_SCREENSHOT_PROVIDER).capture(
    finalUrl.toString(),
  );
  if (screenshot) {
    files.push({ path: 'screenshot.png', bytes: screenshot, contentType: 'image/png' });
  }

  const frameable = !/(^|[,\s])(deny|sameorigin)([,\s]|$)/i.test(
    response.headers.get('x-frame-options') ?? '',
  );

  return {
    title,
    files,
    manifest: {
      entryPath: 'index.html',
      files: files.map((file) => ({
        path: file.path,
        size: file.bytes.length,
        contentType: file.contentType || contentTypeForPath(file.path),
      })),
      totalBytes: files.reduce((total, file) => total + file.bytes.length, 0),
      sourceUrl: finalUrl.toString(),
      frameable,
      screenshotPath: screenshot ? 'screenshot.png' : null,
    },
  };
}
