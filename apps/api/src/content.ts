import { decodeAndSanitizePath, verifyContentToken } from '@liha/shared';
import { injectBridge } from './bridge.js';
import type { ResolvedConfig } from './env.js';
import { notFound } from './errors.js';
import type { Database, ObjectStore } from './ports.js';
import { findPreviewBySlug, findVersionByNumber } from './repo.js';
import { parseManifest } from './serialize.js';
import type { ContentLocation } from './content-origin.js';

/**
 * Headers applied to every byte of uploaded content.
 *
 * `CSP: sandbox` without `allow-same-origin` means the document runs in an
 * opaque origin even when opened directly in a tab, so uploaded HTML has no
 * storage, no cookies and no reachable parent. `nosniff` stops a text file from
 * being reinterpreted as HTML.
 */
const CONTENT_SANDBOX =
  'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals';

function securityHeaders(contentType: string, cacheable: boolean, reader: string): HeadersInit {
  return {
    'content-type': contentType,
    'content-security-policy': CONTENT_SANDBOX,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    // The app needs to read these bytes with fetch(): pdf.js renders a PDF from
    // them, and read_artifact_file hands source to an agent. Only the screen
    // this artifact belongs to is allowed, and content is served without
    // cookies.
    'access-control-allow-origin': reader,
    'cross-origin-resource-policy': 'cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // Versions are immutable, so public content can be cached hard. Protected
    // content is bound to a short-lived token and must not be shared.
    'cache-control': cacheable
      ? 'public, max-age=31536000, immutable'
      : 'private, no-store, max-age=0',
  };
}

export interface ServeContentOptions {
  db: Database;
  bucket: ObjectStore;
  config: ResolvedConfig;
  location: ContentLocation;
  /** Path within the version, already stripped of any mount prefix. */
  requestedPath: string;
  token: string | null;
  /** The `Origin` of the page asking, when a page is asking. */
  origin?: string | null;
}

export async function serveVersionFile(options: ServeContentOptions): Promise<Response> {
  const { db, bucket, config, location } = options;

  /*
   * Who may read these bytes with fetch(): pdf.js renders a PDF from them, and
   * read_artifact_file hands source to an agent.
   *
   * Two screens can legitimately ask — the app at `/p/<slug>`, and this
   * preview's own review screen when the deployment gives previews their own
   * hostnames. Only one origin can be named in the header, so the asker is
   * echoed when it is one of those two. Every other preview's review screen is
   * refused: an artifact is nobody else's business.
   */
  const ownReviewScreen = config.reviewOriginTemplate?.replace('{slug}', location.slug) ?? null;
  const reader =
    options.origin && (options.origin === ownReviewScreen || options.origin === config.appOrigin)
      ? options.origin
      : config.appOrigin;

  const preview = await findPreviewBySlug(db, location.slug);
  if (!preview) throw notFound('Preview not found.');
  const version = await findVersionByNumber(db, preview.id, location.versionNumber);
  if (!version) throw notFound('Version not found.');

  if (preview.password_hash !== null) {
    const grant = options.token
      ? await verifyContentToken(config.contentSigningKey, options.token)
      : null;
    if (!grant || grant.previewId !== preview.id || grant.versionId !== version.id) {
      return new Response('This preview is password protected.', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  }

  const manifest = parseManifest(version.manifest);
  const known = new Set(manifest.files.map((file) => file.path));

  let path: string;
  try {
    const raw = options.requestedPath.replace(/^\/+/, '');
    path = raw === '' ? version.entry_path : decodeAndSanitizePath(raw);
  } catch {
    return new Response('Invalid path.', { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  if (!known.has(path)) {
    // Directory-style URL, then client-side routing fallback for SPAs.
    const asIndex = `${path.replace(/\/$/, '')}/index.html`;
    if (known.has(asIndex)) {
      path = asIndex;
    } else if (!path.includes('.') && known.has(version.entry_path)) {
      path = version.entry_path;
    } else {
      return new Response('Not found.', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  }

  const key = `previews/${preview.id}/versions/${version.id}/files/${path}`;
  const object = await bucket.get(key);
  if (!object) {
    return new Response('Not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const declared = manifest.files.find((file) => file.path === path);
  const contentType =
    declared?.contentType ?? object.httpMetadata?.contentType ?? 'application/octet-stream';
  const cacheable = preview.password_hash === null;
  const body = await object.arrayBuffer();

  if (contentType.startsWith('text/html')) {
    const html = injectBridge(new TextDecoder().decode(body));
    return new Response(html, {
      headers: securityHeaders(contentType, cacheable, reader),
    });
  }
  return new Response(body, { headers: securityHeaders(contentType, cacheable, reader) });
}

const PATH_MOUNT = /^\/content\/([^/]+)\/(\d+)(\/.*)?$/;

/** Parses the path-mounted fallback route `/content/:slug/:versionNumber/*`. */
export function matchContentPath(
  pathname: string,
): { location: ContentLocation; requestedPath: string } | null {
  const match = PATH_MOUNT.exec(pathname);
  if (!match) return null;
  return {
    location: { slug: match[1]!, versionNumber: Number.parseInt(match[2]!, 10) },
    requestedPath: match[3] ?? '/',
  };
}

/**
 * On the path-mounted fallback, a bundler's root-absolute asset (`/assets/x.js`)
 * arrives without the mount prefix. The Referer tells us which preview it came
 * from, so the asset can still be resolved.
 */
export function resolveViaReferer(
  pathname: string,
  referer: string | null,
): { location: ContentLocation; requestedPath: string } | null {
  if (!referer) return null;
  let refererPath: string;
  try {
    refererPath = new URL(referer).pathname;
  } catch {
    return null;
  }
  const match = PATH_MOUNT.exec(refererPath);
  if (!match) return null;
  return {
    location: { slug: match[1]!, versionNumber: Number.parseInt(match[2]!, 10) },
    requestedPath: pathname,
  };
}
