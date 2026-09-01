/** Upload limits. Deliberately conservative for a public MVP deployment. */
export const LIMITS = {
  /**
   * Total bytes of a single version (uncompressed).
   *
   * A Worker isolate has 128 MB of memory and this path holds the multipart
   * body, the expanded entries and the manifest at once, so the ceiling is set
   * by the runtime rather than by taste. 30 MB is also roomy for a static
   * site: the median page weight is around 2.5 MB.
   */
  maxVersionBytes: 30 * 1024 * 1024,
  /** Bytes of a single file within a version. */
  maxFileBytes: 25 * 1024 * 1024,
  /**
   * Number of files within a version.
   *
   * Every file is one R2 write, and writes count against the Workers
   * subrequest budget: 10,000 on the paid plan, 50 on the free one. A free-plan
   * deployment cannot store more than about 45 files in one version whatever
   * this says.
   */
  maxFiles: 2_000,
  /** Versions kept per preview, so one share URL cannot grow without bound. */
  maxVersionsPerPreview: 50,
  /** Total stored bytes across every version of one preview. */
  maxPreviewBytes: 300 * 1024 * 1024,
  /**
   * Default ceiling on everything an instance stores.
   *
   * Rate limits slow an abuser down but do not bound the bill: 20 uploads every
   * five minutes is still hundreds of gigabytes a day. This is the number that
   * actually stops. Half of R2's free tier, so a default deployment stays free.
   * Override with `MAX_TOTAL_BYTES`, or `0` to remove it.
   */
  maxTotalBytes: 5 * 1024 * 1024 * 1024,
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
  /**
   * New previews allowed per client in the same window. Creating one needs no
   * credential, so this is the only thing standing between a public deployment
   * and someone filling its bucket.
   */
  previewsPerWindow: 20,
  /**
   * How long a sample preview lasts.
   *
   * "Open a sample" mints a real preview that the visitor owns — which is the
   * point, and also means one accumulates per curious visitor, forever, for
   * something nobody comes back to. A day is long enough to finish looking.
   * Uploads have no lifetime; they are somebody's work.
   */
  sampleLifetimeMs: 24 * 60 * 60 * 1000,
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
