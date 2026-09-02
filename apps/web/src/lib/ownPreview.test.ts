import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * On a deployment that gives each preview its own host, every path is that
 * preview's review screen — so a link to "/" arrives back where it started.
 * That is a dead end at exactly the moment somebody needs a way out, and the
 * link under "preview not found" was one.
 *
 * The module reads the stamps once, so each case needs a fresh import.
 */
async function withDocument(html: string) {
  document.head.innerHTML = html;
  vi.resetModules();
  return import('./ownPreview.js');
}

describe('a host dedicated to one preview', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('knows which preview it is', async () => {
    const { ownPreviewSlug } = await withDocument('<meta name="liha:slug" content="ab12cd34ef56">');
    expect(ownPreviewSlug()).toBe('ab12cd34ef56');
  });

  it('names somewhere else to go', async () => {
    const { appHome } = await withDocument(
      '<meta name="liha:slug" content="ab12cd34ef56"><meta name="liha:app" content="https://app.example.com">',
    );
    expect(appHome()).toBe('https://app.example.com');
  });

  /*
   * Where the app serves itself, "/" is the landing page and is the right
   * answer. The stamps are what a preview host adds.
   */
  it('falls back to the root where there is no stamp', async () => {
    const { ownPreviewSlug, appHome } = await withDocument('<title>Liha</title>');
    expect(ownPreviewSlug()).toBeNull();
    expect(appHome()).toBe('/');
  });

  it('ignores an empty stamp rather than trusting it', async () => {
    const { appHome } = await withDocument('<meta name="liha:app" content="   ">');
    expect(appHome()).toBe('/');
  });
});
