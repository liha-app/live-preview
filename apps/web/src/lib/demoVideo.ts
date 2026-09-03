/**
 * The demo video on the landing page.
 *
 * Set `DEMO_VIDEO_ID` to the YouTube id once the video is public. While it is
 * empty the card does not render at all, so an unfinished upload never shows a
 * broken player.
 */
export const DEMO_VIDEO_ID = '';

/** Shown on the card so nobody has to press play to find out how long it is. */
export const DEMO_VIDEO_LENGTH = '2:29';

/**
 * `youtube-nocookie.com` rather than `youtube.com`: no request is made until
 * someone presses play, and the request that is finally made does not set the
 * tracking cookies the ordinary embed does.
 */
export function demoVideoEmbedUrl(id: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    cc_load_policy: '1',
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}

export function demoVideoWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}
