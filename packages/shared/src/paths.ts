export class PathValidationError extends Error {
  readonly code = 'invalid_path';
}

export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;

/** Files that must never end up inside a preview, even if a bundler emits them. */
const DENIED_SEGMENTS = new Set(['.git', '.svn', '.hg', '.env', '.DS_Store', '__MACOSX']);

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function fail(message: string): never {
  throw new PathValidationError(message);
}

/**
 * Normalizes an untrusted archive/upload path into a safe relative POSIX path.
 *
 * Rejects (rather than silently repairs) anything that could escape the preview
 * prefix: absolute paths, `..` segments, Windows drive letters, UNC paths,
 * NUL/control characters and backslash separators.
 */
export function sanitizeRelativePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) fail('Path is empty.');
  if (input.length > MAX_PATH_LENGTH) fail('Path is too long.');
  if (hasControlChars(input)) fail('Path contains control characters.');
  if (input.includes('\\')) fail('Path contains a backslash separator.');
  if (/^[a-zA-Z]:/.test(input)) fail('Path contains a drive letter.');
  if (input.startsWith('/')) fail('Path must be relative.');

  const segments: string[] = [];
  for (const raw of input.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') fail('Path escapes the preview root.');
    if (raw.length > MAX_SEGMENT_LENGTH) fail('Path segment is too long.');
    if (DENIED_SEGMENTS.has(raw)) fail(`Path segment "${raw}" is not allowed.`);
    segments.push(raw);
  }
  if (segments.length === 0) fail('Path is empty after normalization.');
  return segments.join('/');
}

export function isSafeRelativePath(input: string): boolean {
  try {
    sanitizeRelativePath(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes a percent-encoded request path exactly once and then sanitizes it, so
 * `..%2f..%2fetc` cannot smuggle traversal past the checks above.
 */
export function decodeAndSanitizePath(input: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    fail('Path is not valid percent-encoding.');
  }
  // Double-encoded traversal attempt; refuse rather than decode a second time.
  if (/%2e|%2f|%5c/i.test(decoded)) fail('Path contains double-encoded separators.');
  return sanitizeRelativePath(decoded);
}

/** R2 object key for one file inside an immutable version. */
export function versionFileKey(previewId: string, versionId: string, path: string): string {
  return `previews/${previewId}/versions/${versionId}/files/${sanitizeRelativePath(path)}`;
}

export function versionPrefix(previewId: string, versionId: string): string {
  return `previews/${previewId}/versions/${versionId}/`;
}

export function previewPrefix(previewId: string): string {
  return `previews/${previewId}/`;
}

/**
 * Strips the leading directory shared by every path, so a `pnpm build` output
 * uploaded as `dist/index.html` + `dist/assets/x.js` becomes a site root.
 */
export function stripCommonPrefix(paths: string[]): string[] {
  if (paths.length === 0) return paths;
  const split = paths.map((p) => p.split('/'));
  if (split.some((s) => s.length < 2)) return paths;
  const first = split[0]!;
  let depth = 0;
  while (depth < first.length - 1) {
    const segment = first[depth]!;
    if (!split.every((s) => s.length > depth + 1 && s[depth] === segment)) break;
    depth += 1;
  }
  return depth === 0 ? paths : split.map((s) => s.slice(depth).join('/'));
}
