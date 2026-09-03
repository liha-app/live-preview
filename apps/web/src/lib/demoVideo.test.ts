import { describe, expect, it } from 'vitest';
import { demoVideoEmbedUrl, demoVideoWatchUrl } from './demoVideo.js';

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
