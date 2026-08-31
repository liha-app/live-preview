import { base64UrlToBytes, bytesToBase64Url, timingSafeEqualStrings, utf8 } from './bytes.js';

/**
 * Stateless, short-lived, scope-limited grants.
 *
 * An `<iframe src>` cannot carry an Authorization header, so protected preview
 * content is unlocked with a signed token in the query string instead. The token
 * is scoped to one preview + one version and grants *only* content reads — it is
 * never accepted by the JSON API.
 */
export interface ContentGrant {
  previewId: string;
  versionId: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

const PREFIX = 'v1';

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    utf8.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await importKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, utf8.encode(payload) as BufferSource);
  return bytesToBase64Url(new Uint8Array(mac));
}

export async function createContentToken(secret: string, grant: ContentGrant): Promise<string> {
  const payload = bytesToBase64Url(utf8.encode(JSON.stringify(grant)));
  const signature = await sign(secret, `${PREFIX}.${payload}`);
  return `${PREFIX}.${payload}.${signature}`;
}

export async function verifyContentToken(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<ContentGrant | null> {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const expected = await sign(secret, `${PREFIX}.${parts[1]}`);
  if (!timingSafeEqualStrings(expected, parts[2]!)) return null;
  try {
    const grant = JSON.parse(utf8.decode(base64UrlToBytes(parts[1]!))) as ContentGrant;
    if (typeof grant.exp !== 'number' || grant.exp < now) return null;
    if (typeof grant.previewId !== 'string' || typeof grant.versionId !== 'string') return null;
    return grant;
  } catch {
    return null;
  }
}
