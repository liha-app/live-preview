import { LIMITS, hashToken, verifyToken } from '@liha-cli/shared';
import { ApiError, forbidden, unauthorized } from './errors.js';
import type { Database } from './ports.js';
import { countRecentFailures, findValidReviewSession, type PreviewRow } from './repo.js';

export const OWNER_TOKEN_HEADER = 'x-liha-owner-token';
export const REVIEW_SESSION_HEADER = 'x-liha-review-session';

/** Reads an owner token from either `Authorization: Bearer` or the dedicated header. */
export function extractOwnerToken(request: Request): string | null {
  const header = request.headers.get(OWNER_TOKEN_HEADER);
  if (header) return header.trim();
  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return null;
}

export async function isOwner(request: Request, preview: PreviewRow): Promise<boolean> {
  const token = extractOwnerToken(request);
  if (!token) return false;
  return verifyToken(token, preview.owner_token_hash);
}

export async function requireOwner(request: Request, preview: PreviewRow): Promise<void> {
  const token = extractOwnerToken(request);
  if (!token) {
    throw unauthorized('This action requires the preview owner token.');
  }
  if (!(await verifyToken(token, preview.owner_token_hash))) {
    throw forbidden('That owner token does not match this preview.');
  }
}

/**
 * Verifies that the caller may read a password-protected preview: either they
 * hold the owner token, or they exchanged the password for a review session.
 */
export async function requireReviewAccess(
  db: Database,
  request: Request,
  preview: PreviewRow,
): Promise<void> {
  if (preview.password_hash === null) return;
  if (await isOwner(request, preview)) return;

  const sessionToken = request.headers.get(REVIEW_SESSION_HEADER);
  if (sessionToken) {
    const tokenHash = await hashToken(sessionToken.trim());
    if (await findValidReviewSession(db, preview.id, tokenHash)) return;
  }
  throw new ApiError('password_required', 'This preview is password protected.');
}

/**
 * Coarse client identity for the password limiter. Cloudflare sets
 * `CF-Connecting-IP`; the value is hashed so raw addresses are not stored.
 */
export async function clientKey(request: Request): Promise<string> {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return (await hashToken(`client:${ip}`)).slice(0, 32);
}

export async function assertNotRateLimited(
  db: Database,
  previewId: string,
  key: string,
): Promise<void> {
  const failures = await countRecentFailures(db, previewId, key, LIMITS.passwordAttemptWindowMs);
  if (failures >= LIMITS.passwordAttemptsPerWindow) {
    throw new ApiError(
      'rate_limited',
      'Too many incorrect password attempts. Try again in a few minutes.',
    );
  }
}
