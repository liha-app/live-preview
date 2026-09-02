import { randomBytes } from './bytes.js';

/** Base58: no 0/O/I/l, so ids survive being read aloud or copied by hand. */
const ID_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Slugs appear in preview *hostnames* (`<slug>--<version>.preview.example.com`),
 * and hostnames are case-insensitive — so the slug alphabet has to be too.
 * Lowercase base32 minus visually ambiguous characters.
 */
const SLUG_ALPHABET = '23456789abcdefghijkmnopqrstuvwxyz';

/**
 * Preview slugs are the only thing standing between an unlisted preview and the
 * public, so they carry ~60 bits of entropy rather than the bare minimum.
 */
export const SLUG_LENGTH = 12;

/** Uniform selection over `alphabet` using rejection sampling (no modulo bias). */
export function randomString(length: number, alphabet = ID_ALPHABET): string {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < length) {
    const chunk = randomBytes(Math.max(16, (length - out.length) * 2));
    for (const byte of chunk) {
      if (byte >= max) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateSlug(): string {
  return randomString(SLUG_LENGTH, SLUG_ALPHABET);
}

export const ID_PREFIXES = {
  preview: 'pv',
  version: 'vr',
  comment: 'cm',
  session: 'rs',
  /**
   * A push subscription. This id is also what the service worker presents to
   * ask what it missed, so it is a credential as much as a name — which is why
   * every id here is 22 random base58 characters rather than a counter.
   */
  push: 'ps',
  account: 'ac',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function generateId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomString(22)}`;
}

const ID_PATTERN = /^(pv|vr|cm|rs|ps|ac)_[1-9A-HJ-NP-Za-km-z]{22}$/;

export function isValidId(value: string, kind?: IdKind): boolean {
  if (!ID_PATTERN.test(value)) return false;
  return kind ? value.startsWith(`${ID_PREFIXES[kind]}_`) : true;
}

export function isValidSlug(value: string): boolean {
  return new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`).test(value);
}
