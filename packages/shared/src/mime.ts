import { LIMITS } from './limits.js';

const EXTENSION_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  webmanifest: 'application/manifest+json',
  zip: 'application/zip',
};

/**
 * SVG is intentionally absent: it can carry scripts and would execute on the
 * preview origin. See docs/security.md.
 */
export const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
]);

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function contentTypeForPath(path: string): string {
  return EXTENSION_TYPES[extensionOf(path)] ?? 'application/octet-stream';
}

/** Magic-number sniffing. Extensions and client-declared MIME types are hints, not proof. */
export function sniffContentType(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06))
    return 'application/zip';
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // ISO-BMFF: "ftyp" at offset 4, then a brand such as "avif".
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

export type ArtifactKind = 'image' | 'html' | 'pdf' | 'url';

/** Chooses the preview renderer from the sniffed bytes of the primary upload. */
export function detectArtifactKind(
  fileName: string,
  bytes: Uint8Array | null,
): ArtifactKind | null {
  const sniffed = bytes ? sniffContentType(bytes) : null;
  if (sniffed && IMAGE_MIME_TYPES.has(sniffed)) return 'image';
  if (sniffed === 'application/pdf') return 'pdf';
  if (sniffed === 'application/zip') return 'html';
  const ext = extensionOf(fileName);
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'zip') return 'html';
  if (IMAGE_MIME_TYPES.has(EXTENSION_TYPES[ext] ?? '')) return 'image';
  return null;
}

export function assertFileSize(path: string, size: number): void {
  if (size > LIMITS.maxFileBytes) {
    throw new Error(`File "${path}" exceeds the ${LIMITS.maxFileBytes} byte per-file limit.`);
  }
}
