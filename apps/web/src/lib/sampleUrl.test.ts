import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * This drawing used to invent `<app host>/p/8fa2c1`, a shape this service has
 * never served — reviews live on a host of their own, not on a path under the
 * app. It is now rendered from the deployment's own template, so the test that
 * matters is that it never goes back to guessing.
 */

const load = async (template?: string) => {
  vi.resetModules();
  vi.stubEnv('VITE_REVIEW_ORIGIN_TEMPLATE', template as string);
  return (await import('./sampleUrl.js')).sampleShareUrl;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the share URL in the illustrations', () => {
  it('takes the shape this deployment actually serves', async () => {
    const url = await load('https://lp-{slug}.liha.review');
    expect(url()).toBe('lp-8fa2c1.liha.review');
  });

  it('follows a template that puts the slug somewhere else', async () => {
    const url = await load('https://{slug}-preview.example.net');
    expect(url()).toBe('8fa2c1-preview.example.net');
  });

  it('keeps a port, since a dev deployment has one', async () => {
    const url = await load('http://{slug}.localhost:8787');
    expect(url()).toBe('8fa2c1.localhost:8787');
  });

  it('draws nothing rather than inventing a host', async () => {
    // `pnpm dev`, or any build that did not go through the deploy script.
    expect((await load(undefined))()).toBeNull();
    expect((await load(''))()).toBeNull();
    expect((await load('not a url'))()).toBeNull();
    // A template with no slug in it cannot produce a preview's address.
    expect((await load('https://example.com'))()).toBeNull();
  });

  it('never shows a path, because previews are not served from one', async () => {
    const url = await load('https://lp-{slug}.liha.review');
    expect(url()).not.toContain('/');
  });
});
