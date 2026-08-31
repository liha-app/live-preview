import { describe, expect, it } from 'vitest';
import {
  OWNER_TOKEN_PREFIX,
  generateOwnerToken,
  generateReviewToken,
  hashToken,
  looksLikeOwnerToken,
  verifyToken,
} from './tokens.js';
import { generateId, generateSlug, isValidId, isValidSlug, randomString } from './ids.js';
import { timingSafeEqualStrings } from './bytes.js';

describe('owner tokens', () => {
  it('mints prefixed, high-entropy tokens', () => {
    const token = generateOwnerToken();
    expect(token.startsWith(OWNER_TOKEN_PREFIX)).toBe(true);
    expect(looksLikeOwnerToken(token)).toBe(true);
    // 32 random bytes -> 43 base64url characters.
    expect(token.length).toBe(OWNER_TOKEN_PREFIX.length + 43);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateOwnerToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes to a stable 64-char hex digest that does not contain the token', async () => {
    const token = generateOwnerToken();
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashToken(token));
    expect(hash).not.toContain(token.slice(OWNER_TOKEN_PREFIX.length));
  });

  it('verifies only the matching token', async () => {
    const token = generateOwnerToken();
    const hash = await hashToken(token);
    expect(await verifyToken(token, hash)).toBe(true);
    expect(await verifyToken(generateOwnerToken(), hash)).toBe(false);
    expect(await verifyToken(`${token}x`, hash)).toBe(false);
    expect(await verifyToken('', hash)).toBe(false);
    expect(await verifyToken(token, '')).toBe(false);
  });

  it('distinguishes review tokens from owner tokens', () => {
    expect(looksLikeOwnerToken(generateReviewToken())).toBe(false);
  });
});

describe('timingSafeEqualStrings', () => {
  it('compares by value', () => {
    expect(timingSafeEqualStrings('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStrings('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStrings('abc', 'ab')).toBe(false);
  });
});

describe('ids and slugs', () => {
  it('generates valid, unique slugs', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateSlug()));
    expect(slugs.size).toBe(500);
    for (const slug of slugs) expect(isValidSlug(slug)).toBe(true);
  });

  it('omits visually ambiguous characters', () => {
    const sample = randomString(4000);
    expect(sample).not.toMatch(/[0OIl]/);
  });

  it('tags ids with their kind', () => {
    const id = generateId('preview');
    expect(isValidId(id, 'preview')).toBe(true);
    expect(isValidId(id, 'comment')).toBe(false);
    expect(isValidId('nope')).toBe(false);
  });
});
