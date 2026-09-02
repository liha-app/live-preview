import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, utf8 } from '@liha-cli/shared';
import { generateVapidKeys, sendPush, vapidHeader } from '../src/push.js';

/*
 * The VAPID JWT is the one place here that can be wrong without looking wrong:
 * a malformed signature is a 401 from every push service at once and nothing
 * else to see. So these tests verify the signature the way a push service does,
 * rather than checking the string has three dots in it.
 */

const SUBJECT = 'mailto:ops@example.com';

const parse = (header: string) => {
  const found = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
  if (!found) throw new Error(`not a vapid header: ${header}`);
  const [head, claims, signature] = found[1]!.split('.') as [string, string, string];
  return {
    key: found[2]!,
    head: JSON.parse(utf8.decode(base64UrlToBytes(head))) as Record<string, string>,
    claims: JSON.parse(utf8.decode(base64UrlToBytes(claims))) as Record<string, unknown>,
    signingInput: `${head}.${claims}`,
    signature: base64UrlToBytes(signature),
  };
};

async function verifies(header: string): Promise<boolean> {
  const token = parse(header);
  const key = await crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(token.key) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    token.signature as BufferSource,
    utf8.encode(token.signingInput) as BufferSource,
  );
}

describe('the VAPID header', () => {
  it('carries a signature the advertised key actually verifies', async () => {
    const keys = await generateVapidKeys();
    expect(await verifies(await vapidHeader(keys, 'https://fcm.googleapis.com', SUBJECT))).toBe(
      true,
    );
  });

  it('says ES256, and is signed over exactly what it publishes', async () => {
    const keys = await generateVapidKeys();
    const token = parse(
      await vapidHeader(keys, 'https://push.example', SUBJECT, 1_700_000_000_000),
    );

    expect(token.head).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(token.claims.aud).toBe('https://push.example');
    expect(token.claims.sub).toBe(SUBJECT);
    // Twelve hours out, in seconds — a push service rejects a token good for
    // longer than a day.
    expect(token.claims.exp).toBe(1_700_000_000 + 12 * 60 * 60);
  });

  it('is scoped to one push service, so it cannot be replayed at another', async () => {
    const keys = await generateVapidKeys();
    const mine = parse(await vapidHeader(keys, 'https://push.example', SUBJECT));
    const theirs = parse(await vapidHeader(keys, 'https://other.example', SUBJECT));

    expect(mine.claims.aud).not.toBe(theirs.claims.aud);
    expect(mine.signature).not.toEqual(theirs.signature);
  });

  it('does not verify under a different key', async () => {
    const header = await vapidHeader(await generateVapidKeys(), 'https://push.example', SUBJECT);
    const impostor = await generateVapidKeys();
    const swapped = header.replace(/k=[\w-]+$/, `k=${impostor.publicKey}`);

    expect(await verifies(swapped)).toBe(false);
  });
});

describe('sending a push', () => {
  const calls: Request[] = [];
  const withFetch = async (reply: Response | Error, endpoint = 'https://push.example/s/abc') => {
    const keys = await generateVapidKeys();
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      calls.push(new Request(input as string, init));
      if (reply instanceof Error) throw reply;
      return reply;
    }) as typeof fetch;
    try {
      return await sendPush(endpoint, keys, SUBJECT);
    } finally {
      globalThis.fetch = original;
    }
  };

  it('posts an empty body with a TTL and the authorization', async () => {
    expect(await withFetch(new Response(null, { status: 201 }))).toBe('sent');

    const request = calls.at(-1)!;
    expect(request.method).toBe('POST');
    expect(request.headers.get('ttl')).toBe(String(12 * 60 * 60));
    expect(request.headers.get('authorization')).toMatch(/^vapid t=/);
    expect(await request.text()).toBe('');
  });

  it('reports a subscription the push service has forgotten', async () => {
    expect(await withFetch(new Response(null, { status: 410 }))).toBe('gone');
    expect(await withFetch(new Response(null, { status: 404 }))).toBe('gone');
    expect(await withFetch('not a url' as never, 'not a url')).toBe('gone');
  });

  /*
   * A push service having a bad minute must not cost someone their
   * notifications, so only 404/410 mean "forget this".
   */
  it('does not confuse a bad minute with a dead subscription', async () => {
    expect(await withFetch(new Response(null, { status: 500 }))).toBe('failed');
    expect(await withFetch(new Response(null, { status: 429 }))).toBe('failed');
    expect(await withFetch(new Error('network'))).toBe('failed');
  });
});
