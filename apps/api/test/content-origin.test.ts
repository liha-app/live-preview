import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CreatePreviewResult } from '@liha/shared';
import {
  contentBaseUrl,
  matchHostname,
  matchReviewHost,
  originWildcard,
  parseTemplate,
} from '../src/content-origin.js';
import { assertProductionConfig, resolveConfig } from '../src/env.js';
import { createTestServer, uploadBody } from './harness.js';

const configFor = (template: string | undefined) =>
  resolveConfig(
    { DB: null as never, BUCKET: null as never, CONTENT_ORIGIN_TEMPLATE: template },
    new URL('https://api.example.com/api/previews'),
  );

const urlFor = (template: string, slug = 'ab12cd', version = 3) =>
  contentBaseUrl(configFor(template), slug, version, new URL('https://api.example.com/'));

describe('the content origin template', () => {
  it('puts each version on its own host', () => {
    expect(urlFor('https://{label}.example.net')).toBe('https://ab12cd--3.example.net/');
  });

  it('accepts a prefix in front of the label', () => {
    expect(urlFor('https://lp-{label}.example.net')).toBe('https://lp-ab12cd--3.example.net/');
  });

  /*
   * A shared domain may already have a convention. This one puts the service's
   * own id between the slug and the version, so two services can hold hostnames
   * one level under the same apex without ever colliding.
   */
  it('places the parts wherever the template puts them', () => {
    expect(urlFor('https://{slug}-lp-v{version}.liha.review')).toBe(
      'https://ab12cd-lp-v3.liha.review/',
    );
  });

  it('keeps the port from the template', () => {
    expect(urlFor('http://{label}.localhost:8787')).toBe('http://ab12cd--3.localhost:8787/');
  });

  it('rejects a template that does not put a placeholder in the hostname', () => {
    // A path mount gives every version the same origin, which defeats the point.
    expect(parseTemplate('https://example.net/{label}/')).toBeNull();
    expect(parseTemplate('https://example.net')).toBeNull();
    expect(parseTemplate(null)).toBeNull();
  });
});

describe('reading a hostname back', () => {
  it.each([
    ['https://{label}.example.net', 'ab12cd--3.example.net'],
    ['https://lp-{label}.example.net', 'lp-ab12cd--3.example.net'],
    ['https://{slug}-lp-v{version}.liha.review', 'ab12cd-lp-v3.liha.review'],
  ])('%s resolves %s', (template, hostname) => {
    expect(matchHostname(template, hostname)).toEqual({ slug: 'ab12cd', versionNumber: 3 });
  });

  it('round-trips whatever it builds', () => {
    for (const template of [
      'https://{label}.example.net',
      'https://lp-{label}.example.net',
      'https://{slug}-lp-v{version}.liha.review',
    ]) {
      const base = urlFor(template, 'zx99', 12);
      expect(matchHostname(template, new URL(base).hostname)).toEqual({
        slug: 'zx99',
        versionNumber: 12,
      });
    }
  });

  /*
   * The domain is shared with other services, so anything this does not
   * recognise has to be left alone rather than claimed and 404ed.
   */
  it('does not claim hosts that only look similar', () => {
    const template = 'https://{slug}-lp-v{version}.liha.review';
    for (const hostname of [
      'ab12cd-lp.liha.review', // the review screen, not content
      'ab12cd-xy-v3.liha.review', // another service's id
      'ab12cd-lp-v3.example.com', // another domain
      'ab12cd-lp-vx.liha.review', // no version number
      'lp-v3.liha.review', // no slug
      'extra.ab12cd-lp-v3.liha.review', // a deeper host
    ]) {
      expect(matchHostname(template, hostname), hostname).toBeNull();
    }
  });

  it('refuses a version number that is not one', () => {
    expect(matchHostname('https://{slug}-lp-v{version}.liha.review', 'ab-lp-v0.liha.review')).toBe(
      null,
    );
  });
});

/*
 * liha.review is shared with other services, so this one has to claim an
 * unmistakable slice of it and leave everything else alone. The review screen
 * and the artifact sit side by side, one level under the apex — a single
 * wildcard certificate covers both — but they are different origins, which is
 * what keeps uploaded HTML away from the owner token.
 */
describe('the review screen host', () => {
  const REVIEW = 'https://{slug}-lp.liha.review';
  const CONTENT = 'https://{slug}-lp-v{version}.liha.review';

  it('resolves to the preview it belongs to', () => {
    expect(matchReviewHost(REVIEW, 'ab12cd-lp.liha.review')).toBe('ab12cd');
  });

  it('is not confused with a content host, nor the other way round', () => {
    expect(matchReviewHost(REVIEW, 'ab12cd-lp-v3.liha.review')).toBeNull();
    expect(matchHostname(CONTENT, 'ab12cd-lp.liha.review')).toBeNull();
  });

  it('leaves another service’s hostnames alone', () => {
    for (const hostname of ['ab12cd-xy.liha.review', 'docs.liha.review', 'ab12cd-lp.example.com']) {
      expect(matchReviewHost(REVIEW, hostname), hostname).toBeNull();
    }
  });
});

describe('the wildcard a policy can name', () => {
  it('collapses the varying label', () => {
    expect(originWildcard('https://{slug}-lp-v{version}.liha.review')).toBe(
      'https://*.liha.review',
    );
    expect(originWildcard('https://{label}.example.net')).toBe('https://*.example.net');
    expect(originWildcard('http://{label}.localhost:8787')).toBe('http://*.localhost:8787');
  });

  it('gives up when the variation is not confined to one label', () => {
    // A Content-Security-Policy cannot express a wildcard anywhere else.
    expect(originWildcard('https://app.{slug}.example.net')).toBeNull();
    expect(originWildcard(null)).toBeNull();
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

  /*
   * The development keypair is committed so `pnpm dev` works out of the box.
   * Its private half is therefore public, and deploying it would let anyone
   * send notifications to this deployment's subscribers.
   */
  it('refuses to be quiet about the development notification key', () => {
    // Read from the config rather than repeated here: a key rotated in one
    // place and not the other would turn this guard off without failing.
    const toml = readFileSync(join(import.meta.dirname, '..', 'wrangler.toml'), 'utf8');
    const devKey = /^VAPID_PUBLIC_KEY = "([\w-]+)"$/m.exec(toml)?.[1];
    expect(devKey, 'wrangler.toml should carry a development VAPID key').toBeTruthy();

    const warnings = assertProductionConfig({
      DB: null as never,
      BUCKET: null as never,
      APP_ORIGIN: 'https://app.example.com',
      CONTENT_SIGNING_KEY: 'x',
      CONTENT_ORIGIN_TEMPLATE: 'https://{slug}-lp-v{version}.liha.review',
      VAPID_PUBLIC_KEY: devKey!,
    });

    expect(warnings.join(' ')).toContain('development keypair');
  });

  it('says nothing when the template works', () => {
    expect(
      assertProductionConfig({
        DB: null as never,
        BUCKET: null as never,
        APP_ORIGIN: 'https://app.example.com',
        CONTENT_SIGNING_KEY: 'x',
        CONTENT_ORIGIN_TEMPLATE: 'https://{slug}-lp-v{version}.liha.review',
      }),
    ).toEqual([]);
  });
});

describe('a preview created against a template', () => {
  it('is served from the host the template describes, not a path on the API', async () => {
    const server = createTestServer({
      CONTENT_ORIGIN_TEMPLATE: 'https://{slug}-lp-v{version}.content.test',
    });

    const response = await server.fetch('/api/previews', {
      method: 'POST',
      ...uploadBody([{ path: 'index.html', content: '<h1>Hi</h1>', type: 'text/html' }]),
    });
    const created = (await response.json()) as CreatePreviewResult;

    expect(created.preview.contentUrl).toBe(
      `https://${created.preview.slug}-lp-v1.content.test/index.html`,
    );
  });
});
