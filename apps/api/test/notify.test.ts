import { describe, expect, it, vi } from 'vitest';
import { LIMITS, type CreatePreviewResult } from '@liha/shared';
import { generateVapidKeys } from '../src/push.js';
import { createTestServer, ownerHeaders, uploadBody, type TestServer } from './harness.js';

/*
 * Notification permission is per origin and every preview has its own, so the
 * review screen sends people to one notification origin instead of asking for
 * each preview. What crosses that boundary is a grant good for one thing —
 * watching one preview — and never the owner token.
 */

const KEYS = await generateVapidKeys();

async function serverWithPush(): Promise<TestServer> {
  return createTestServer({
    NOTIFICATION_ORIGIN: 'https://notification.test',
    VAPID_PUBLIC_KEY: KEYS.publicKey,
    VAPID_PRIVATE_KEY: KEYS.privateKeyJwk,
    CONTENT_SIGNING_KEY: 'test-signing-key',
  });
}

async function newPreview(server: TestServer): Promise<CreatePreviewResult> {
  return server.json<CreatePreviewResult>('/api/previews', {
    method: 'POST',
    ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }]),
  });
}

const watchToken = (server: TestServer, created: CreatePreviewResult) =>
  server.json<{ token: string; notificationOrigin: string }>(
    `/api/previews/${created.preview.slug}/watch-token`,
    { method: 'POST', headers: ownerHeaders(created.ownerToken) },
  );

const subscribe = (server: TestServer, token: string, endpoint: string) =>
  server.fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, watchToken: token }),
  });

/** Catches the pushes that would have gone out, without sending any. */
function captureSends() {
  const sent: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo) => {
    sent.push(typeof input === 'string' ? input : (input as Request).url);
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = original) };
}

describe('asking to be notified', () => {
  /*
   * Being told is not an owner's privilege: it is the reviewers who are waiting
   * on a reply. Whoever can read the feedback can ask to be told about it.
   */
  it('hands out a grant to anyone who can read the preview', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);

    const anyone = await server.fetch(`/api/previews/${created.preview.slug}/watch-token`, {
      method: 'POST',
    });
    expect(anyone.status).toBe(200);

    const granted = await watchToken(server, created);
    expect(granted.notificationOrigin).toBe('https://notification.test');
    // Its own prefix, so a content grant can never be spent as this one.
    expect(granted.token.startsWith('w1.')).toBe(true);
  });

  it('says so plainly when the deployment cannot send push', async () => {
    const server = createTestServer({ NOTIFICATION_ORIGIN: 'https://notification.test' });
    const created = await newPreview(server);

    const response = await server.fetch(`/api/previews/${created.preview.slug}/watch-token`, {
      method: 'POST',
      headers: ownerHeaders(created.ownerToken),
    });
    expect(response.status).toBe(501);
  });

  it('still gates a password-protected preview', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);
    await server.fetch(`/api/previews/${created.preview.slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...ownerHeaders(created.ownerToken) },
      body: JSON.stringify({ password: 'a-good-enough-password' }),
    });

    const refused = await server.fetch(`/api/previews/${created.preview.slug}/watch-token`, {
      method: 'POST',
    });
    expect(refused.status).toBe(401);
  });

  /*
   * One comment wakes every watcher, so the number of watchers is the fan-out
   * of one request into requests at other people's servers. Anyone with the
   * link can add one, which is the point — and the reason for a ceiling.
   */
  it('stops one preview from becoming a fan-out', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);

    // Fifty watchers means fifty people, so each one is a different client —
    // otherwise the per-client rate limit stops this long before the ceiling
    // does, and the test would be measuring the wrong guard.
    const asPerson = (n: number) => ({ 'cf-connecting-ip': `203.0.113.${n}` });

    for (let i = 0; i < LIMITS.watchersPerPreview; i += 1) {
      const granted = await server.json<{ token: string }>(
        `/api/previews/${created.preview.slug}/watch-token`,
        { method: 'POST', headers: asPerson(i) },
      );
      const response = await subscribe(server, granted.token, `https://push.test/sub-${i}`);
      expect(response.status, `subscription ${i}`).toBe(200);
    }

    const refused = await server.fetch(`/api/previews/${created.preview.slug}/watch-token`, {
      method: 'POST',
      headers: asPerson(200),
    });
    expect(refused.status).toBe(429);
  });

  it('rate limits one client setting up over and over', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);
    const me = { 'cf-connecting-ip': '198.51.100.7' };

    for (let i = 0; i < LIMITS.watchesPerWindow; i += 1) {
      const response = await server.fetch(`/api/previews/${created.preview.slug}/watch-token`, {
        method: 'POST',
        headers: me,
      });
      expect(response.status, `attempt ${i}`).toBe(200);
    }

    const refused = await server.fetch(`/api/previews/${created.preview.slug}/watch-token`, {
      method: 'POST',
      headers: me,
    });
    expect(refused.status).toBe(429);
  });

  /*
   * The endpoint is a URL a client supplies and this server later fetches,
   * which is the shape of every SSRF.
   */
  it('refuses an endpoint pointed at this network', async () => {
    const server = await serverWithPush();
    const { token } = await watchToken(server, await newPreview(server));

    for (const endpoint of [
      'https://127.0.0.1/push',
      'https://localhost/push',
      'https://10.0.0.5/push',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/push',
      'file:///etc/passwd',
      // A push service does not answer over plaintext, so nothing that does is one.
      'http://push.example/s/abc',
    ]) {
      const response = await subscribe(server, token, endpoint);
      expect(response.status, endpoint).toBe(400);
    }
  });

  it('refuses a grant that has expired, and one that was never issued', async () => {
    const server = await serverWithPush();
    await newPreview(server);

    expect((await subscribe(server, 'w1.bogus.signature', 'https://push.test/a')).status).toBe(401);

    const { token } = await watchToken(server, await newPreview(server));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    try {
      expect((await subscribe(server, token, 'https://push.test/a')).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  /*
   * A browser keeps one subscription per origin and returns the same endpoint
   * every time, so watching a second preview must not mint a second row —
   * that would be two pushes for one comment.
   */
  it('keeps one subscription per browser, however many previews it watches', async () => {
    const server = await serverWithPush();
    const first = await newPreview(server);
    const second = await newPreview(server);

    const a = await subscribe(
      server,
      (await watchToken(server, first)).token,
      'https://push.test/x',
    );
    const b = await subscribe(
      server,
      (await watchToken(server, second)).token,
      'https://push.test/x',
    );

    const one = (await a.json()) as { subscriptionId: string };
    const two = (await b.json()) as { subscriptionId: string };
    expect(two.subscriptionId).toBe(one.subscriptionId);

    const { results } = await server.env.DB.prepare(
      'SELECT count(*) AS n FROM push_subscriptions',
    ).all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });
});

describe('being notified', () => {
  it('wakes the watchers when somebody else comments', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);
    await subscribe(server, (await watchToken(server, created)).token, 'https://push.test/abc');

    const capture = captureSends();
    try {
      await server.fetch(`/api/previews/${created.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName: 'Mika', body: 'The hero is too tall.' }),
      });
    } finally {
      capture.restore();
    }

    expect(capture.sent).toEqual(['https://push.test/abc']);
  });

  /*
   * Somebody's own comment buzzing their own phone is not a notification, it is
   * an echo.
   */
  it('says nothing about the owner’s own comment', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);
    await subscribe(server, (await watchToken(server, created)).token, 'https://push.test/abc');

    const capture = captureSends();
    try {
      await server.fetch(`/api/previews/${created.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ownerHeaders(created.ownerToken) },
        body: JSON.stringify({ authorName: 'Me', body: 'Noted.' }),
      });
    } finally {
      capture.restore();
    }

    expect(capture.sent).toEqual([]);
  });

  it('tells a worker what it missed, once', async () => {
    const server = await serverWithPush();
    const created = await newPreview(server);
    const response = await subscribe(
      server,
      (await watchToken(server, created)).token,
      'https://push.test/abc',
    );
    const { subscriptionId } = (await response.json()) as { subscriptionId: string };

    const pending = () =>
      server.json<{ items: { title: string; body: string; url: string }[] }>('/api/push/pending', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });

    expect((await pending()).items).toEqual([]);

    const capture = captureSends();
    try {
      await server.fetch(`/api/previews/${created.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName: 'Mika', body: 'The hero is too tall.' }),
      });
    } finally {
      capture.restore();
    }

    const first = await pending();
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.body).toBe('Mika: The hero is too tall.');
    expect(first.items[0]?.url).toContain(created.preview.slug);

    // Marked as told, so the same comment is not announced twice.
    expect((await pending()).items).toEqual([]);
  });

  it('says nothing for an id it does not know, rather than saying it is unknown', async () => {
    const server = await serverWithPush();
    const response = await server.fetch('/api/push/pending', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscriptionId: 'ps_ThisIsNotARealSubscri' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as { items: unknown[] }).toEqual({ items: [] });
  });
});

describe('stopping', () => {
  const watchesOfSubscription = (server: TestServer, subscriptionId: string) =>
    server.json<{ items: { previewId: string; title: string; url: string }[] }>(
      '/api/push/watches',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      },
    );

  const stop = (server: TestServer, payload: Record<string, string>) =>
    server.fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  async function watchingTwo(server: TestServer) {
    const first = await newPreview(server);
    const second = await newPreview(server);
    let id = '';
    for (const created of [first, second]) {
      const response = await subscribe(
        server,
        (await watchToken(server, created)).token,
        'https://push.test/one-browser',
      );
      id = ((await response.json()) as { subscriptionId: string }).subscriptionId;
    }
    return { id, first, second };
  }

  /*
   * The notification origin is the only place that knows a browser's
   * subscription, which makes it the only place that can show what it is
   * watching — and the only place that can offer to stop.
   */
  it('lists what this browser asked to be told about', async () => {
    const server = await serverWithPush();
    const { id, first, second } = await watchingTwo(server);

    const { items } = await watchesOfSubscription(server, id);
    expect(items.map((item) => item.title)).toEqual(['Untitled preview', 'Untitled preview']);
    expect(items.map((item) => item.previewId).sort()).toEqual(
      [first.preview.id, second.preview.id].sort(),
    );
    expect(items[0]?.url).toMatch(/^https?:\/\//);
  });

  it('stops one review without stopping the others', async () => {
    const server = await serverWithPush();
    const { id, first, second } = await watchingTwo(server);

    expect((await stop(server, { subscriptionId: id, previewId: first.preview.id })).status).toBe(
      200,
    );

    const { items } = await watchesOfSubscription(server, id);
    expect(items.map((item) => item.previewId)).toEqual([second.preview.id]);

    // And nothing is sent about the one that was stopped.
    const capture = captureSends();
    try {
      await server.fetch(`/api/previews/${first.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName: 'Mika', body: 'Still here?' }),
      });
    } finally {
      capture.restore();
    }
    expect(capture.sent).toEqual([]);
  });

  it('stops everything, and forgets the subscription', async () => {
    const server = await serverWithPush();
    const { id, second } = await watchingTwo(server);

    expect((await stop(server, { subscriptionId: id })).status).toBe(200);
    expect((await watchesOfSubscription(server, id)).items).toEqual([]);

    const capture = captureSends();
    try {
      await server.fetch(`/api/previews/${second.preview.slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName: 'Mika', body: 'Anyone?' }),
      });
    } finally {
      capture.restore();
    }
    expect(capture.sent).toEqual([]);

    const { results } = await server.env.DB.prepare(
      'SELECT count(*) AS n FROM push_subscriptions',
    ).all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it('says nothing for an id it does not know', async () => {
    const server = await serverWithPush();
    expect((await watchesOfSubscription(server, 'ps_NotARealSubscriptio')).items).toEqual([]);
  });
});

describe('the notification origin', () => {
  it('serves a page, its script and a worker at the root scope', async () => {
    const server = await serverWithPush();

    const page = await server.fetchAbsolute('https://notification.test/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    // The permission lives on this origin; inline script must not.
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await page.text()).not.toMatch(/<script>[^<]/);

    const worker = await server.fetchAbsolute('https://notification.test/sw.js');
    expect(worker.status).toBe(200);
    expect(worker.headers.get('content-type')).toContain('javascript');

    const script = await server.fetchAbsolute('https://notification.test/app.js');
    expect(await script.text()).toContain(KEYS.publicKey);
  });

  it('is allowed to call the API, since that is the whole point of it', async () => {
    const server = await serverWithPush();
    const response = await server.fetch('/api/health', {
      headers: { origin: 'https://notification.test' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://notification.test');
  });

  /*
   * The page's script and the worker are TypeScript template literals, so a
   * stray backtick in a comment ends the string and a stray ${…} interpolates
   * silently. Parsing them is the cheapest way to notice; the first one of
   * these shipped as a build error and the second would not have.
   */
  it('emits scripts that are actually JavaScript', async () => {
    const server = await serverWithPush();

    for (const path of ['/app.js', '/sw.js']) {
      const source = await (await server.fetchAbsolute(`https://notification.test${path}`)).text();
      expect(() => new Function(source), path).not.toThrow();
      // Nothing was interpolated where it should not have been.
      expect(source, path).not.toContain('[object Object]');
      expect(source, path).not.toContain('undefined"');
    }
  });

  it('is not there at all when the deployment cannot send push', async () => {
    const server = createTestServer({ NOTIFICATION_ORIGIN: 'https://notification.test' });
    expect((await server.fetchAbsolute('https://notification.test/sw.js')).status).toBe(404);
  });
});
