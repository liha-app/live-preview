import type { Locale } from '../i18n/index.js';

/**
 * The demo video on the landing page.
 *
 * There is one per language, because the narration is spoken rather than
 * subtitled-only — a Japanese visitor being handed the English cut would be
 * reading captions over a voice they did not ask for. An entry is left empty
 * when that language has no video yet, and the card then does not render at
 * all rather than showing a broken player.
 */
export const DEMO_VIDEO_IDS: Record<Locale, string> = {
  en: '42ETT6sLz9U',
  ja: '-6aOWhF1TPs',
};

/** Shown on the card so nobody has to press play to find out how long it is. */
export const DEMO_VIDEO_LENGTH = '2:29';

export function demoVideoId(locale: Locale): string {
  return DEMO_VIDEO_IDS[locale] ?? '';
}

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
