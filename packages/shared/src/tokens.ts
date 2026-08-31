import {
  bytesToBase64Url,
  bytesToHex,
  randomBytes,
  timingSafeEqualStrings,
  utf8,
} from './bytes.js';

export const OWNER_TOKEN_PREFIX = 'liha_ot_';
export const REVIEW_TOKEN_PREFIX = 'liha_rs_';

/** 32 bytes of CSPRNG output; brute force is infeasible, so a plain SHA-256 digest is enough. */
const TOKEN_BYTES = 32;

function generateToken(prefix: string): string {
  return prefix + bytesToBase64Url(randomBytes(TOKEN_BYTES));
}

export function generateOwnerToken(): string {
  return generateToken(OWNER_TOKEN_PREFIX);
}

export function generateReviewToken(): string {
  return generateToken(REVIEW_TOKEN_PREFIX);
}

export function looksLikeOwnerToken(value: string): boolean {
  return value.startsWith(OWNER_TOKEN_PREFIX) && value.length >= OWNER_TOKEN_PREFIX.length + 40;
}

/**
 * Hashes a bearer token for storage. Tokens are high-entropy random values, so
 * a single SHA-256 pass is appropriate — unlike passwords, they are not
 * guessable and do not need a slow KDF.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(token) as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  if (!token || !storedHash) return false;
  return timingSafeEqualStrings(await hashToken(token), storedHash);
}
