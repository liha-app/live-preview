import { LIMITS } from '@liha-cli/shared';
import type { Database } from './ports.js';
import { findAccount, setPreviewExpiry, type PreviewRow } from './repo.js';

/**
 * How long a preview lasts, counted from when it was last used.
 *
 * A review that is still being read must not disappear in the middle of it, so
 * the clock restarts on use rather than running from upload. What differs is
 * only how long the window is:
 *
 *   sample     24 hours, flat — it is a sample, and sliding it would keep
 *              one alive for every visitor who ever opened it
 *   anonymous  a week
 *   signed in  a month
 *
 * Nothing here is a paywall. The owner can push any of them out by hand, and a
 * preview nobody has opened in a week is not one anybody is waiting on.
 */
export async function lifetimeFor(db: Database, preview: PreviewRow): Promise<number | null> {
  if (preview.is_sample) return null;
  if (!preview.account_id) return LIMITS.anonymousLifetimeMs;

  const owner = await findAccount(db, preview.account_id);
  return owner?.google_sub ? LIMITS.signedInLifetimeMs : LIMITS.anonymousLifetimeMs;
}

/**
 * Restarts a preview's clock, at most once an hour.
 *
 * Sliding retention means every read could be a write. At an hour's
 * granularity a week-long window is still a week-long window, and a preview
 * being read all afternoon costs a handful of writes rather than hundreds.
 */
export async function touchPreview(db: Database, preview: PreviewRow): Promise<void> {
  if (preview.is_sample) return;

  const last = preview.last_used_at ? Date.parse(preview.last_used_at) : 0;
  if (Number.isFinite(last) && Date.now() - last < LIMITS.useTouchIntervalMs) return;

  const lifetime = await lifetimeFor(db, preview);
  if (lifetime === null) return;

  const now = new Date();
  const lastUsedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + lifetime).toISOString();
  await setPreviewExpiry(db, preview.id, lastUsedAt, expiresAt);

  // The caller is holding this row and is about to serialize it. Leaving it
  // stale would show a countdown one request behind what the clock says.
  preview.last_used_at = lastUsedAt;
  preview.expires_at = expiresAt;
}

/** Pushes a preview's expiry out by a full window, on the owner's say-so. */
export async function extendPreview(db: Database, preview: PreviewRow): Promise<string | null> {
  const lifetime = await lifetimeFor(db, preview);
  if (lifetime === null) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + lifetime).toISOString();
  await setPreviewExpiry(db, preview.id, now.toISOString(), expiresAt);
  return expiresAt;
}
