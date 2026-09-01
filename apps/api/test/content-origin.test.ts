import { describe, expect, it } from 'vitest';
import type { CreatePreviewResult } from '@liha/shared';
import { contentBaseUrl, matchContentHost, parseTemplate } from '../src/content-origin.js';
import { assertProductionConfig, resolveConfig } from '../src/env.js';
import { createTestServer, uploadBody } from './harness.js';

const configFor = (template: string | undefined) =>
  resolveConfig(
    { DB: null as never, BUCKET: null as never, CONTENT_ORIGIN_TEMPLATE: template },
    new URL('https://api.example.com/api/previews'),
  );

describe('the content origin template', () => {
  it('puts each version on its own host', () => {
    const config = configFor('https://{label}.example.net');
    expect(contentBaseUrl(config, 'ab12cd', 3, new URL('https://api.example.com/'))).toBe(
      'https://ab12cd--3.example.net/',
    );
  });

  it('accepts a prefix in front of the label', () => {
    const config = configFor('https://lp-{label}.example.net');
    expect(contentBaseUrl(config, 'ab12cd', 3, new URL('https://api.example.com/'))).toBe(
      'https://lp-ab12cd--3.example.net/',
    );
  });

  it('resolves a prefixed host back to the version it came from', () => {
    const config = configFor('https://lp-{label}.example.net');
    expect(
      matchContentHost(config, new URL('https://lp-ab12cd--3.example.net/index.html')),
    ).toEqual({ slug: 'ab12cd', versionNumber: 3 });
  });

  it('does not claim hosts that lack the prefix', () => {
    const config = configFor('https://lp-{label}.example.net');
    expect(matchContentHost(config, new URL('https://ab12cd--3.example.net/'))).toBeNull();
    expect(matchContentHost(config, new URL('https://lp-.example.net/'))).toBeNull();
  });

  it('round-trips whatever it builds', () => {
    for (const template of ['https://{label}.example.net', 'https://lp-{label}.example.net']) {
      const config = configFor(template);
      const base = contentBaseUrl(config, 'zx99', 12, new URL('https://api.example.com/'));
      expect(matchContentHost(config, new URL(base))).toEqual({ slug: 'zx99', versionNumber: 12 });
    }
  });

  it('rejects a template that does not put the label in the hostname', () => {
    // A path mount gives every version the same origin, which defeats the point.
    expect(parseTemplate('https://example.net/{label}/')).toBeNull();
    expect(parseTemplate('https://example.net')).toBeNull();
    expect(parseTemplate(null)).toBeNull();
  });
});

describe('a template that cannot be used', () => {
  it('is reported rather than silently downgraded', () => {
    // Falling back to a path on the API origin looks like a working deployment
    // until someone checks whether uploads are actually isolated.
    const warnings = assertProductionConfig({
      DB: null as never,
      BUCKET: null as never,
      APP_ORIGIN: 'https://app.example.com',
      CONTENT_SIGNING_KEY: 'x',
      CONTENT_ORIGIN_TEMPLATE: 'https://example.net/{label}/',
    });

    expect(warnings.join(' ')).toContain('NOT origin-isolated');
  });

  it('says nothing when the template works', () => {
    expect(
      assertProductionConfig({
        DB: null as never,
        BUCKET: null as never,
        APP_ORIGIN: 'https://app.example.com',
        CONTENT_SIGNING_KEY: 'x',
        CONTENT_ORIGIN_TEMPLATE: 'https://lp-{label}.example.net',
      }),
    ).toEqual([]);
  });
});

describe('a preview created against a prefixed template', () => {
  it('is served from the prefixed host, not from a path on the API', async () => {
    const server = createTestServer({ CONTENT_ORIGIN_TEMPLATE: 'https://lp-{label}.content.test' });

    const response = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }]),
    });
    const created = (await response.json()) as CreatePreviewResult;

    expect(created.preview.contentUrl).toBe(
      `https://lp-${created.preview.slug}--1.content.test/index.html`,
    );
  });
});
