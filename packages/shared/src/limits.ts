/** Upload limits. Deliberately conservative for a public MVP deployment. */
export const LIMITS = {
  /** Total bytes of a single version (uncompressed). */
  maxVersionBytes: 50 * 1024 * 1024,
  /** Bytes of a single file within a version. */
  maxFileBytes: 25 * 1024 * 1024,
  /** Number of files within a version. */
  maxFiles: 2_000,
  /** Guards against zip bombs: refuse archives whose expansion ratio is absurd. */
  maxZipExpansionRatio: 200,
  maxTitleLength: 200,
  maxCommentBodyLength: 10_000,
  maxAuthorNameLength: 80,
  /** Password attempts allowed per preview within the window below. */
  passwordAttemptsPerWindow: 10,
  passwordAttemptWindowMs: 10 * 60 * 1000,
  /** Comments and replies allowed per client within the window below. */
  commentsPerWindow: 60,
  commentWindowMs: 5 * 60 * 1000,
  /** Sample previews allowed per client in the same window. */
  demosPerWindow: 60,
  /** Lifetime of the signed review session issued after a correct password. */
  reviewSessionTtlMs: 12 * 60 * 60 * 1000,
  /** Lifetime of the signed URL token that lets an iframe load protected content. */
  contentTokenTtlMs: 60 * 60 * 1000,
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
