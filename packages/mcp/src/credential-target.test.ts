import { describe, expect, it } from 'vitest';
import {
  apiRequestUrl,
  assertCredentialApi,
  credentialRequestApiUrl,
  normalizeApiUrl,
} from './credentials.js';

describe('credential API scope', () => {
  it('normalizes host casing, default ports and trailing slashes', () => {
    expect(normalizeApiUrl('https://API.example.test:443/service///')).toBe(
      'https://api.example.test/service',
    );
    expect(() =>
      assertCredentialApi(
        'https://API.example.test:443/service/',
        'https://api.example.test/service',
      ),
    ).not.toThrow();
  });

  it.each([
    ['https://api-a.example.test', 'https://api-b.example.test'],
    ['https://api.example.test/a', 'https://api.example.test/b'],
    ['http://localhost:8787', 'http://localhost:8788'],
  ])('rejects a credential for a different API base (%s)', (selected, saved) => {
    expect(() => assertCredentialApi(selected, saved)).toThrow();
  });

  it.each([
    'https://user:password@api.example.test',
    'https://api.example.test?key=value',
    'https://api.example.test#part',
    'file:///tmp/api',
  ])('rejects non-base API URLs', (url) => {
    expect(() => normalizeApiUrl(url)).toThrow();
  });

  it('allows HTTP for loopback credentials and requires TLS elsewhere', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() => credentialRequestApiUrl(`http://${host}:8787`, true)).not.toThrow();
    }
    expect(() => credentialRequestApiUrl('http://api.example.test', true)).toThrow();
    expect(credentialRequestApiUrl('http://api.example.test', false)).toBe(
      'http://api.example.test',
    );
  });

  it('checks the final request remains inside the bound API path', () => {
    const api = 'https://api.example.test/service';
    expect(apiRequestUrl(api, '/api/previews/fixture/summary')).toBe(
      `${api}/api/previews/fixture/summary`,
    );
    expect(() => apiRequestUrl(api, '/api/previews/../../../../outside')).toThrow();
  });
});
