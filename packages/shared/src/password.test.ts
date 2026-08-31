import { describe, expect, it } from 'vitest';
import { PasswordPolicyError, hashPassword, verifyPassword } from './password.js';
import { createContentToken, verifyContentToken } from './signing.js';

describe('password hashing', () => {
  it('produces a self-describing PBKDF2 record', async () => {
    const encoded = await hashPassword('correct horse battery', 1000);
    const [algorithm, iterations, salt, hash] = encoded.split('$');
    expect(algorithm).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBe(1000);
    expect(salt).toBeTruthy();
    expect(hash).toBeTruthy();
    expect(encoded).not.toContain('correct horse battery');
  });

  it('salts every hash, so identical passwords differ at rest', async () => {
    const a = await hashPassword('same-password', 1000);
    const b = await hashPassword('same-password', 1000);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('accepts the right password and rejects everything else', async () => {
    const encoded = await hashPassword('hunter2!', 1000);
    expect(await verifyPassword('hunter2!', encoded)).toBe(true);
    expect(await verifyPassword('hunter2', encoded)).toBe(false);
    expect(await verifyPassword('HUNTER2!', encoded)).toBe(false);
    expect(await verifyPassword('', encoded)).toBe(false);
  });

  it('rejects malformed records rather than throwing', async () => {
    for (const bad of [
      '',
      'garbage',
      'pbkdf2-sha256$x$y$z',
      'md5$1000$a$b',
      'pbkdf2-sha256$1000$a',
    ]) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('enforces the length policy', async () => {
    await expect(hashPassword('12345')).rejects.toBeInstanceOf(PasswordPolicyError);
    await expect(hashPassword('x'.repeat(300))).rejects.toBeInstanceOf(PasswordPolicyError);
  });
});

describe('signed content grants', () => {
  const secret = 'test-signing-secret';

  it('round-trips a scoped grant', async () => {
    const grant = { previewId: 'pv_1', versionId: 'vr_1', exp: Date.now() + 60_000 };
    const token = await createContentToken(secret, grant);
    expect(await verifyContentToken(secret, token)).toEqual(grant);
  });

  it('rejects tampering, wrong secrets and expiry', async () => {
    const token = await createContentToken(secret, {
      previewId: 'pv_1',
      versionId: 'vr_1',
      exp: Date.now() + 60_000,
    });
    expect(await verifyContentToken('other-secret', token)).toBeNull();
    expect(await verifyContentToken(secret, `${token}x`)).toBeNull();
    expect(await verifyContentToken(secret, 'v1.aaa.bbb')).toBeNull();
    expect(await verifyContentToken(secret, token, Date.now() + 120_000)).toBeNull();
  });

  it('binds the grant to one preview and version', async () => {
    const token = await createContentToken(secret, {
      previewId: 'pv_a',
      versionId: 'vr_a',
      exp: Date.now() + 60_000,
    });
    const grant = await verifyContentToken(secret, token);
    expect(grant?.previewId).toBe('pv_a');
    expect(grant?.versionId).toBe('vr_a');
  });
});
