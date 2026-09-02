import { unzipSync } from 'fflate';
import {
  LIMITS,
  contentTypeForPath,
  detectArtifactKind,
  formatBytes,
  sanitizeRelativePath,
  sniffContentType,
  stripCommonPrefix,
  versionFileKey,
  type ArtifactKind,
  type VersionFile,
  type VersionManifest,
} from '@liha-cli/shared';
import { ApiError, badRequest, tooLarge } from './errors.js';
import type { ObjectStore } from './ports.js';

export interface UploadEntry {
  path: string;
  bytes: Uint8Array;
}

export interface PreparedUpload {
  kind: ArtifactKind;
  entryPath: string;
  entries: UploadEntry[];
  totalBytes: number;
}

const ZIP_SIGNATURE = [0x50, 0x4b];

function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Expands a zipped static site.
 *
 * Limits are enforced through fflate's filter callback, i.e. *before* the data
 * is decompressed, so a zip bomb is rejected rather than expanded.
 */
function expandZip(bytes: Uint8Array, maxTotalBytes: number): UploadEntry[] {
  let declaredTotal = 0;
  let count = 0;

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith('/')) return false;
        count += 1;
        if (count > LIMITS.maxFiles) {
          throw tooLarge(`Archive contains more than ${LIMITS.maxFiles} files.`);
        }
        declaredTotal += file.originalSize ?? 0;
        if (declaredTotal > maxTotalBytes) {
          throw tooLarge(`Archive expands to more than ${formatBytes(maxTotalBytes)}.`);
        }
        if ((file.originalSize ?? 0) > LIMITS.maxFileBytes) {
          throw tooLarge(
            `"${file.name}" exceeds the ${formatBytes(LIMITS.maxFileBytes)} file limit.`,
          );
        }
        // Reject traversal entries up front so a malicious archive never reaches storage.
        try {
          sanitizeRelativePath(file.name);
        } catch {
          throw badRequest(`Archive contains an unsafe path: "${file.name}".`);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw badRequest('Could not read the zip archive.');
  }

  const entries: UploadEntry[] = [];
  for (const [name, data] of Object.entries(unzipped)) {
    if (data.length === 0 && name.endsWith('/')) continue;
    entries.push({ path: sanitizeRelativePath(name), bytes: data });
  }
  if (entries.length === 0) throw badRequest('The archive is empty.');
  return entries;
}

const INDEX_CANDIDATES = ['index.html', 'index.htm'];

function pickEntryPath(paths: string[]): string {
  for (const candidate of INDEX_CANDIDATES) {
    if (paths.includes(candidate)) return candidate;
  }
  const nestedIndex = paths.find((p) => p.endsWith('/index.html'));
  if (nestedIndex) return nestedIndex;
  const anyHtml = paths.find((p) => p.endsWith('.html') || p.endsWith('.htm'));
  if (anyHtml) return anyHtml;
  throw badRequest('No HTML entry point found. Include an index.html at the root of the upload.', {
    paths: paths.slice(0, 20),
  });
}

export interface PrepareOptions {
  maxVersionBytes: number;
  declaredKind?: ArtifactKind;
}

/**
 * Turns raw uploaded files into a validated, ready-to-store version.
 *
 * Content type is decided by sniffing magic numbers, never by trusting the
 * client-declared MIME type or the file extension alone.
 */
export function prepareUpload(rawEntries: UploadEntry[], options: PrepareOptions): PreparedUpload {
  if (rawEntries.length === 0) throw badRequest('No files were uploaded.');

  let entries = rawEntries;
  const single = entries.length === 1 ? entries[0]! : null;

  if (single && looksLikeZip(single.bytes)) {
    entries = expandZip(single.bytes, options.maxVersionBytes);
  }

  const sanitized = entries.map((entry) => ({
    path: sanitizeRelativePath(entry.path),
    bytes: entry.bytes,
  }));
  const lifted = stripCommonPrefix(sanitized.map((e) => e.path));
  const finalEntries: UploadEntry[] = sanitized.map((entry, index) => ({
    path: lifted[index]!,
    bytes: entry.bytes,
  }));

  const seen = new Set<string>();
  for (const entry of finalEntries) {
    if (seen.has(entry.path)) throw badRequest(`Duplicate path in upload: "${entry.path}".`);
    seen.add(entry.path);
  }

  if (finalEntries.length > LIMITS.maxFiles) {
    throw tooLarge(`Upload contains more than ${LIMITS.maxFiles} files.`);
  }
  let totalBytes = 0;
  for (const entry of finalEntries) {
    if (entry.bytes.length > LIMITS.maxFileBytes) {
      throw tooLarge(`"${entry.path}" exceeds the ${formatBytes(LIMITS.maxFileBytes)} file limit.`);
    }
    totalBytes += entry.bytes.length;
  }
  if (totalBytes > options.maxVersionBytes) {
    throw tooLarge(`Upload exceeds the ${formatBytes(options.maxVersionBytes)} limit per version.`);
  }

  const primary = finalEntries.length === 1 ? finalEntries[0]! : null;
  const kind: ArtifactKind =
    options.declaredKind ??
    (primary ? (detectArtifactKind(primary.path, primary.bytes) ?? 'html') : 'html');

  if (kind === 'image' || kind === 'pdf') {
    if (!primary) {
      throw badRequest(`A ${kind} preview must be a single file.`);
    }
    const sniffed = sniffContentType(primary.bytes);
    if (kind === 'image' && (!sniffed || !sniffed.startsWith('image/'))) {
      throw new ApiError('unsupported_media_type', 'That file is not a supported image format.');
    }
    if (kind === 'pdf' && sniffed !== 'application/pdf') {
      throw new ApiError('unsupported_media_type', 'That file is not a valid PDF.');
    }
    return { kind, entryPath: primary.path, entries: finalEntries, totalBytes };
  }

  return {
    kind,
    entryPath: pickEntryPath(finalEntries.map((e) => e.path)),
    entries: finalEntries,
    totalBytes,
  };
}

/** Content type actually used when serving. Sniffed bytes win over the extension. */
export function resolveContentType(path: string, bytes: Uint8Array): string {
  const byExtension = contentTypeForPath(path);
  const sniffed = sniffContentType(bytes);
  if (!sniffed) return byExtension;
  // HTML/CSS/JS have no magic numbers; keep the extension-based type for them.
  if (byExtension.startsWith('text/') || byExtension.startsWith('application/json')) {
    // ...unless the bytes are unmistakably binary, which would be a mislabelled file.
    return sniffed.startsWith('image/') || sniffed === 'application/pdf' ? sniffed : byExtension;
  }
  return sniffed;
}

/**
 * How many objects to write at once.
 *
 * Each put is a round trip, and measured against the real bucket that trip is
 * about a second — so a 169-file site written one file at a time took three
 * minutes. The same site takes 30 seconds written this way. Nothing about the
 * work needs ordering; only the manifest does, and it is rebuilt by index.
 *
 * The real ceiling is the platform's, not this number: a Worker holds about
 * six connections open at once, and 169 files took the same 30 seconds at 16
 * as at 48. So this is a bound, not a target — high enough not to be the
 * limit, low enough that a big upload cannot monopolise the isolate. The bytes
 * are already in memory either way, so concurrency costs nothing there.
 */
const WRITE_CONCURRENCY = 16;

/** Runs `worker` over `items` at most `limit` at a time, keeping input order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const run = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await worker(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function storeVersionFiles(
  bucket: ObjectStore,
  previewId: string,
  versionId: string,
  upload: PreparedUpload,
): Promise<VersionManifest> {
  const files = await mapLimit(
    upload.entries,
    WRITE_CONCURRENCY,
    async (entry): Promise<VersionFile> => {
      const contentType = resolveContentType(entry.path, entry.bytes);
      await bucket.put(versionFileKey(previewId, versionId, entry.path), entry.bytes, {
        httpMetadata: { contentType },
      });
      return { path: entry.path, size: entry.bytes.length, contentType };
    },
  );

  const manifest: VersionManifest = {
    entryPath: upload.entryPath,
    files,
    totalBytes: upload.totalBytes,
  };
  await bucket.put(
    `previews/${previewId}/versions/${versionId}/manifest.json`,
    JSON.stringify(manifest),
    { httpMetadata: { contentType: 'application/json' } },
  );
  return manifest;
}

/**
 * Reads uploaded files out of a multipart body.
 *
 * `paths` carries the relative path of each file (directory uploads and CLI
 * bundles need this, since `File.name` is only a basename).
 */
interface FileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * `@cloudflare/workers-types` declares `FormData.getAll` as `string[]`, but the
 * runtime hands back File objects for file parts. Narrow structurally so this
 * works under Workers and Node alike.
 */
function isFileLike(value: unknown): value is FileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileLike).arrayBuffer === 'function'
  );
}

export async function entriesFromFormData(form: FormData): Promise<UploadEntry[]> {
  const files = (form.getAll('files') as unknown[]).filter(isFileLike);
  if (files.length === 0) return [];

  let paths: string[] = [];
  const rawPaths = form.get('paths');
  if (typeof rawPaths === 'string' && rawPaths.length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawPaths);
      if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== 'string')) {
        throw new Error('bad paths');
      }
      paths = parsed as string[];
    } catch {
      throw badRequest('"paths" must be a JSON array of strings.');
    }
    if (paths.length !== files.length) {
      throw badRequest('"paths" must have one entry per uploaded file.');
    }
  }

  const entries: UploadEntry[] = [];
  for (const [index, file] of files.entries()) {
    entries.push({
      path: paths[index] ?? file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return entries;
}
