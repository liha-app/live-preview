import { describe, expect, it } from 'vitest';
import { LIMITS, type CreatePreviewResult } from '@liha/shared';
import { APP_HEADER } from '../src/accounts.js';
import { safeReturn } from '../src/google.js';
import { resolveConfig } from '../src/env.js';
import { createTestServer, ownerHeaders, uploadBody, type TestServer } from './harness.js';

/*
 * Everything works without an account. One is minted the first time somebody
 * *acts*, never when they only read, and it is anonymous — no sign-up, nothing
 * asked for. What it buys is a list of what you are involved in and a feed of
 * what happened; signing in with Google is only what carries those to another
 * browser.
 */

/** A browser: keeps its cookies, and sends the header that makes them count. */
function browser(server: TestServer) {
  let cookie = '';

  const remember = (response: Response) => {
    const set = response.headers.get('set-cookie');
    if (set) {
      const pairs = new Map(
        cookie
          .split('; ')
          .filter(Boolean)
          .map((part) => [part.split('=')[0]!, part] as const),
      );
      for (const piece of set.split(/,(?=\s*liha_)/)) {
        const first = piece.trim().split(';')[0]!;
        pairs.set(first.split('=')[0]!, first);
      }
      cookie = [...pairs.values()].join('; ');
    }
    return response;
  };

  const send = async (path: string, init: RequestInit = {}, withHeader = true) =>
    remember(
      await server.fetch(path, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          ...(cookie ? { cookie } : {}),
          ...(withHeader ? { [APP_HEADER]: '1' } : {}),
        },
      }),
    );

  return {
    send,
    json: async <T>(path: string, init?: RequestInit) =>
      (await send(path, init)).json() as Promise<T>,
    /** The same browser, but forgetting to say it is the app. */
    withoutHeader: (path: string, init?: RequestInit) => send(path, init, false),
    get cookie() {
      return cookie;
    },
  };
}

const upload = (title = 'Acme') => ({
  method: 'POST' as const,
  ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }], { title }),
});

const comment = (body: string, extra: Record<string, string> = {}) => ({
  method: 'POST' as const,
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify({ authorName: 'Mika', body }),
});

describe('who is asking', () => {
  it('nobody, until they do something', async () => {
    const server = createTestServer();
    const me = browser(server);

    // Reading a shared link is not a reason to be given an identity.
    const before = await me.json<{ account: unknown }>('/api/me');
    expect(before.account).toBeNull();
    expect(me.cookie).toBe('');

    await me.send('/api/previews', upload());
    const after = await me.json<{ account: { id: string; signedIn: boolean } }>('/api/me');
    expect(after.account?.id).toMatch(/^ac_/);
    expect(after.account?.signedIn).toBe(false);
  });

  /*
   * The cookie has to be `SameSite=None` — review screens are on a different
   * site from the API — so it rides along on cross-site requests. A custom
   * header cannot be set by a cross-site form or image, so requiring one is
   * what makes a forged request just an anonymous one.
   */
  it('is nobody when the request could have been forged', async () => {
    const server = createTestServer();
    const me = browser(server);
    await me.send('/api/previews', upload());

    const forged = await me.withoutHeader('/api/me');
    expect(((await forged.json()) as { account: unknown }).account).toBeNull();
  });

  it('does not hand the same browser a second account', async () => {
    const server = createTestServer();
    const me = browser(server);

    await me.send('/api/previews', upload('One'));
    const first = await me.json<{ account: { id: string } }>('/api/me');
    await me.send('/api/previews', upload('Two'));
    const second = await me.json<{ account: { id: string } }>('/api/me');

    expect(second.account.id).toBe(first.account.id);
  });
});

describe('what I am involved in', () => {
  it('lists what I made and what I took part in, and says which', async () => {
    const server = createTestServer();
    const mine = browser(server);
    const theirs = browser(server);

    const made = (await (
      await mine.send('/api/previews', upload('Mine'))
    ).json()) as CreatePreviewResult;
    const other = (await (
      await theirs.send('/api/previews', upload('Theirs'))
    ).json()) as CreatePreviewResult;

    // I leave a comment on somebody else's preview.
    await mine.send(`/api/previews/${other.preview.slug}/comments`, comment('Looks off.'));

    const { previews } = await mine.json<{ previews: { title: string; role: string }[] }>(
      '/api/me/previews',
    );
    expect(previews.map((p) => [p.title, p.role]).sort()).toEqual([
      ['Mine', 'owner'],
      ['Theirs', 'reviewer'],
    ]);
    expect(made.preview.slug).toBeTruthy();
  });

  it('is empty for a browser that has done nothing', async () => {
    const server = createTestServer();
    expect((await browser(server).json<{ previews: [] }>('/api/me/previews')).previews).toEqual([]);
  });
});

describe('activity', () => {
  it('is what somebody else did, not what I did', async () => {
    const server = createTestServer();
    const mine = browser(server);
    const theirs = browser(server);

    const made = (await (
      await mine.send('/api/previews', upload('Mine'))
    ).json()) as CreatePreviewResult;

    await mine.send(`/api/previews/${made.preview.slug}/comments`, comment('Note to self.'));
    await theirs.send(`/api/previews/${made.preview.slug}/comments`, comment('The hero is tall.'));

    const { activity } = await mine.json<{ activity: { body: string; url: string }[] }>(
      '/api/me/activity',
    );
    expect(activity.map((item) => item.body)).toEqual(['The hero is tall.']);
    // The link goes to the comment, not just the preview.
    expect(activity[0]?.url).toContain(`comment=`);
  });

  it('says nothing about previews I have nothing to do with', async () => {
    const server = createTestServer();
    const mine = browser(server);
    const theirs = browser(server);

    await mine.send('/api/previews', upload('Mine'));
    const other = (await (
      await theirs.send('/api/previews', upload('Theirs'))
    ).json()) as CreatePreviewResult;
    await theirs.send(`/api/previews/${other.preview.slug}/comments`, comment('Only theirs.'));

    expect((await mine.json<{ activity: [] }>('/api/me/activity')).activity).toEqual([]);
  });
});

describe('how long a preview lasts', () => {
  const daysFrom = (iso: string) => (Date.parse(iso) - Date.now()) / 86_400_000;

  it('is a week for an upload, and a day for a sample', async () => {
    const server = createTestServer();
    const me = browser(server);

    const made = (await (await me.send('/api/previews', upload())).json()) as CreatePreviewResult;
    // Nothing has been used yet, so the clock starts on first use.
    await me.send(`/api/previews/${made.preview.slug}`);
    const preview = await me.json<{ preview: { expiresAt: string } }>(
      `/api/previews/${made.preview.slug}`,
    );
    expect(daysFrom(preview.preview.expiresAt)).toBeGreaterThan(6.9);
    expect(daysFrom(preview.preview.expiresAt)).toBeLessThanOrEqual(7);

    const sample = (await (
      await me.send('/api/previews/demo', { method: 'POST' })
    ).json()) as CreatePreviewResult;
    expect(daysFrom(sample.preview.expiresAt!)).toBeLessThanOrEqual(1);
  });

  /*
   * A review that is still being read must not disappear in the middle of it,
   * which is the whole reason retention counts from use rather than upload.
   */
  it('starts again when somebody uses it', async () => {
    const server = createTestServer();
    const me = browser(server);
    const made = (await (await me.send('/api/previews', upload())).json()) as CreatePreviewResult;

    // Six days pass with nobody looking.
    await server.env.DB.prepare(
      'UPDATE previews SET last_used_at = ?, expires_at = ? WHERE slug = ?',
    )
      .bind(
        new Date(Date.now() - 6 * 86_400_000).toISOString(),
        new Date(Date.now() + 86_400_000).toISOString(),
        made.preview.slug,
      )
      .run();

    const reopened = await me.json<{ preview: { expiresAt: string } }>(
      `/api/previews/${made.preview.slug}`,
    );
    expect(daysFrom(reopened.preview.expiresAt)).toBeGreaterThan(6.9);
  });

  it('does not write on every read', async () => {
    const server = createTestServer();
    const me = browser(server);
    const made = (await (await me.send('/api/previews', upload())).json()) as CreatePreviewResult;

    await me.send(`/api/previews/${made.preview.slug}`);
    const first = await me.json<{ preview: { expiresAt: string } }>(
      `/api/previews/${made.preview.slug}`,
    );
    await me.send(`/api/previews/${made.preview.slug}`);
    const second = await me.json<{ preview: { expiresAt: string } }>(
      `/api/previews/${made.preview.slug}`,
    );

    // Sliding retention would otherwise be one database write per page load.
    expect(second.preview.expiresAt).toBe(first.preview.expiresAt);
  });

  it('can be pushed out by the owner, and by nobody else', async () => {
    const server = createTestServer();
    const me = browser(server);
    const made = (await (await me.send('/api/previews', upload())).json()) as CreatePreviewResult;

    expect(
      (await me.send(`/api/previews/${made.preview.slug}/extend`, { method: 'POST' })).status,
    ).toBe(401);

    const extended = await me.json<{ expiresAt: string }>(
      `/api/previews/${made.preview.slug}/extend`,
      { method: 'POST', headers: ownerHeaders(made.ownerToken) },
    );
    expect(daysFrom(extended.expiresAt)).toBeGreaterThan(6.9);
  });

  it('gives a signed-in owner a month', async () => {
    const server = createTestServer();
    const me = browser(server);
    const made = (await (await me.send('/api/previews', upload())).json()) as CreatePreviewResult;

    // Standing in for the Google callback, which needs a browser.
    await server.env.DB.prepare("UPDATE accounts SET google_sub = 'g-123'").run();

    const extended = await me.json<{ expiresAt: string }>(
      `/api/previews/${made.preview.slug}/extend`,
      { method: 'POST', headers: ownerHeaders(made.ownerToken) },
    );
    expect(daysFrom(extended.expiresAt)).toBeGreaterThan(29.9);
    expect(LIMITS.signedInLifetimeMs).toBe(30 * 86_400_000);
  });
});

describe('coming back from Google', () => {
  const config = resolveConfig(
    {
      DB: null as never,
      BUCKET: null as never,
      APP_ORIGIN: 'https://app.example.com',
      REVIEW_ORIGIN_TEMPLATE: 'https://lp-{slug}.liha.review',
    },
    new URL('https://api.example.com/'),
  );

  /*
   * A return URL is attacker-supplied until proven otherwise, and an open
   * redirect on a sign-in endpoint is how a phishing page borrows somebody
   * else's domain.
   */
  it('only goes back somewhere this deployment serves', () => {
    expect(safeReturn('https://lp-abc123.liha.review/', config)).toBe(
      'https://lp-abc123.liha.review/',
    );
    expect(safeReturn('https://app.example.com/p/x', config)).toBe('https://app.example.com/p/x');

    for (const hostile of [
      'https://evil.example/',
      'https://app.example.com.evil.example/',
      'javascript:alert(1)',
      '//evil.example',
      null,
    ]) {
      expect(safeReturn(hostile, config), String(hostile)).toBe('https://app.example.com');
    }
  });
});
