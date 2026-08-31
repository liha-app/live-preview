import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomBytes,
  timingSafeEqualStrings,
  utf8,
} from './bytes.js';

/**
 * PBKDF2-SHA256 is the strongest password KDF available from the Web Crypto API
 * on Cloudflare Workers (no scrypt/argon2), so it is what we use. The encoded
 * form carries its own parameters to allow raising the cost later without
 * invalidating existing previews.
 */
export const PASSWORD_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 256;

export class PasswordPolicyError extends Error {
  readonly code = 'invalid_password';
}

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2-sha256$<iterations>$<salt>$<hash>` with base64url fields. */
export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number.parseInt(parts[1]!, 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) return false;
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  let salt: Uint8Array;
  try {
    salt = base64UrlToBytes(parts[2]!);
  } catch {
    return false;
  }
  const actual = bytesToBase64Url(await derive(password, salt, iterations));
  return timingSafeEqualStrings(actual, parts[3]!);
}
