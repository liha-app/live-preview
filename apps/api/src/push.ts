import { bytesToBase64Url, utf8 } from '@liha-cli/shared';

/**
 * Web Push, with nothing in the envelope.
 *
 * A push message may carry an encrypted payload (RFC 8291: ECDH against the
 * subscription's keys, HKDF, AES-GCM). This sends none. The service worker is
 * woken by an empty push and asks the API what it missed, which means:
 *
 *  - no payload encryption to implement or get subtly wrong;
 *  - the subscription's `p256dh` and `auth` keys are never requested or stored,
 *    so a copy of this database cannot be used to send anyone anything;
 *  - what is shown is fetched when it is shown, not when it was queued.
 *
 * The cost is one request from the worker per push, which is the right trade
 * at this size.
 *
 * What is still required is VAPID (RFC 8292): a JWT signed with a P-256 key,
 * proving to the push service that these messages come from this application.
 */

export interface VapidKeys {
  /** The public key, base64url of the uncompressed point. Also sent to browsers. */
  publicKey: string;
  /** The private key as a JWK, held as a secret. */
  privateKeyJwk: string;
}

const TWELVE_HOURS = 12 * 60 * 60;

async function importSigningKey(privateKeyJwk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    JSON.parse(privateKeyJwk) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * Builds the `Authorization: vapid …` header for one push service.
 *
 * The audience is the push service's origin, not the endpoint, and a token is
 * only good for that one service — which is why this is built per endpoint
 * rather than once per run.
 */
export async function vapidHeader(
  keys: VapidKeys,
  audience: string,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const header = bytesToBase64Url(utf8.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToBase64Url(
    utf8.encode(
      JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + TWELVE_HOURS, sub: subject }),
    ),
  );
  const signingInput = `${header}.${claims}`;

  // WebCrypto returns ECDSA signatures as raw r||s, which is exactly the form
  // JWS ES256 wants. A DER-wrapped signature here is the classic way to get a
  // 401 from every push service at once.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importSigningKey(keys.privateKeyJwk),
    utf8.encode(signingInput) as BufferSource,
  );

  return `vapid t=${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/**
 * Wakes one subscription.
 *
 * `gone` means the push service says this subscription no longer exists (404 or
 * 410); the caller should forget it. Anything else is `failed` and worth
 * retrying later, not deleting — a push service having a bad minute must not
 * cost someone their notifications.
 */
export async function sendPush(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  ttlSeconds = 12 * 60 * 60,
): Promise<PushOutcome> {
  let audience: string;
  try {
    audience = new URL(endpoint).origin;
  } catch {
    return 'gone';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidHeader(keys, audience, subject),
        ttl: String(ttlSeconds),
        'content-length': '0',
      },
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Generates a VAPID keypair.
 *
 * Used by the deploy script, not at request time. The public key is handed to
 * browsers when they subscribe, and changing it invalidates every existing
 * subscription — so it is generated once and kept.
 */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: bytesToBase64Url(raw),
    privateKeyJwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  };
}
