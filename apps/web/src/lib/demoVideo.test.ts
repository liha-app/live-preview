import { describe, expect, it } from 'vitest';
import { LOCALES } from '../i18n/index.js';
import { DEMO_VIDEO_IDS, demoVideoEmbedUrl, demoVideoId, demoVideoWatchUrl } from './demoVideo.js';

describe('the demo video embed', () => {
  /*
   * `youtube.com` sets its tracking cookies the moment the frame loads.
   * `youtube-nocookie.com` is the whole reason this page can carry a video at
   * all, so it is worth a test rather than a comment.
   */
  it('is framed from the nocookie host', () => {
    const url = new URL(demoVideoEmbedUrl('abc123'));
    expect(url.hostname).toBe('www.youtube-nocookie.com');
    expect(url.pathname).toBe('/embed/abc123');
  });

  it('asks for captions and skips the related-video shelf', () => {
    const url = new URL(demoVideoEmbedUrl('abc123'));
    expect(url.searchParams.get('cc_load_policy')).toBe('1');
    expect(url.searchParams.get('rel')).toBe('0');
    // Only reached by a click, so autoplay is the behaviour someone asked for.
    expect(url.searchParams.get('autoplay')).toBe('1');
  });

  it('escapes an id rather than letting it build the URL', () => {
    const url = demoVideoEmbedUrl('../../evil?x=1');
    expect(url).not.toContain('../..');
    expect(new URL(url).hostname).toBe('www.youtube-nocookie.com');
    expect(new URL(demoVideoWatchUrl('../../evil')).hostname).toBe('www.youtube.com');
  });
});

describe('one video per language', () => {
  it('has one for every locale the interface offers', () => {
    for (const locale of LOCALES) {
      expect(demoVideoId(locale), `no demo video for ${locale}`).not.toBe('');
    }
  });

  /*
   * YouTube ids may begin with a hyphen — the Japanese cut's does. A naive
   * template or an id passed to something that reads a leading `-` as a flag
   * turns that into a broken URL, so it is pinned rather than assumed.
   */
  it('keeps an id that starts with a hyphen intact', () => {
    expect(DEMO_VIDEO_IDS.ja.startsWith('-')).toBe(true);
    const url = new URL(demoVideoEmbedUrl(DEMO_VIDEO_IDS.ja));
    expect(url.pathname).toBe(`/embed/${DEMO_VIDEO_IDS.ja}`);
  });

  it('gives the two languages different videos', () => {
    expect(DEMO_VIDEO_IDS.en).not.toBe(DEMO_VIDEO_IDS.ja);
  });
});
