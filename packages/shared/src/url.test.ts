import { describe, expect, it, vi } from 'vitest';
import { UrlValidationError, assertPublicHttpUrl, isPublicHttpUrl, safeFetch } from './url.js';

const BLOCKED = [
  'http://localhost/',
  'http://localhost:8080/x',
  'http://LOCALHOST/',
  'http://app.localhost/',
  'http://127.0.0.1/',
  'http://127.1/',
  'http://0.0.0.0/',
  'http://0/',
  'http://10.0.0.5/',
  'http://10.255.255.255/',
  'http://172.16.0.1/',
  'http://172.31.255.1/',
  'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://100.100.100.200/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://[::1]/',
  'http://[::]/',
  'http://[fe80::1]/',
  'http://[fc00::1]/',
  'http://[fd00::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:169.254.169.254]/',
  'http://[2002:7f00:1::]/',
  'file:///etc/passwd',
  'ftp://example.com/',
  'gopher://example.com/',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'http://user:pass@example.com/',
  'http://example.com:22/',
  'http://example.com:3306/',
  'http://internal/',
  'http://db.internal/',
  'http://printer.local/',
  'http://2130706433/',
  'http://0x7f000001/',
  'http://017700000001/',
  'not a url',
  '',
];

const ALLOWED = [
  'https://example.com/',
  'https://example.com/path?q=1#frag',
  'http://example.com:8080/',
  'https://sub.domain.example.co.jp/a/b',
  'https://93.184.216.34/',
];

describe('assertPublicHttpUrl', () => {
  it('blocks private, loopback, link-local and metadata targets', () => {
    for (const url of BLOCKED) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(UrlValidationError);
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });

  it('allows ordinary public URLs', () => {
    for (const url of ALLOWED) {
      expect(isPublicHttpUrl(url), url).toBe(true);
    }
  });

  it('reports why a URL was rejected', () => {
    const codes = (url: string) => {
      try {
        assertPublicHttpUrl(url);
        return 'allowed';
      } catch (error) {
        return (error as UrlValidationError).code;
      }
    };
    expect(codes('file:///etc/passwd')).toBe('blocked_scheme');
    expect(codes('http://user:pw@example.com/')).toBe('blocked_credentials');
    expect(codes('http://example.com:22/')).toBe('blocked_port');
    expect(codes('http://127.0.0.1/')).toBe('blocked_address');
    expect(codes('http://localhost/')).toBe('blocked_host');
    expect(codes('http://intranet/')).toBe('blocked_host');
    expect(codes('nonsense')).toBe('invalid_url');
  });

  it('normalizes a trailing dot so example.com. cannot bypass the host list', () => {
    expect(() => assertPublicHttpUrl('http://localhost./')).toThrow(UrlValidationError);
  });
});

describe('safeFetch', () => {
  const redirectTo = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  it('re-validates every redirect hop', async () => {
    const fetchImpl = vi.fn(async () => redirectTo('http://169.254.169.254/latest/meta-data/'));
    await expect(
      safeFetch('https://example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks a relative redirect that changes scheme or host', async () => {
    const fetchImpl = vi.fn(async () => redirectTo('//127.0.0.1/admin'));
    await expect(
      safeFetch('https://example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('follows public redirects and reports the final URL', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1 ? redirectTo('https://example.org/final') : new Response('ok');
    });
    const result = await safeFetch('https://example.com/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.finalUrl.toString()).toBe('https://example.org/final');
    expect(result.redirects).toEqual(['https://example.org/final']);
    expect(await result.response.text()).toBe('ok');
  });

  it('gives up after too many redirects', async () => {
    const fetchImpl = vi.fn(async () => redirectTo('https://example.com/loop'));
    await expect(
      safeFetch('https://example.com/', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxRedirects: 2,
      }),
    ).rejects.toMatchObject({ code: 'too_many_redirects' });
  });
});
