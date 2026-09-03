import { useState } from 'react';
import { useI18n } from '../i18n/index.js';
import {
  DEMO_VIDEO_LENGTH,
  demoVideoEmbedUrl,
  demoVideoId,
  demoVideoWatchUrl,
} from '../lib/demoVideo.js';

/**
 * The demo video, as a card that costs nothing until it is wanted.
 *
 * Nothing is requested from YouTube — not even a thumbnail — until someone
 * presses play. The poster is drawn here in the same ink as the rest of the
 * page, so the card carries no third-party request, no cookie and no frame
 * while it sits unplayed, which is most of the time for most visitors.
 */
export function DemoVideo() {
  const { t, locale } = useI18n();
  const [playing, setPlaying] = useState(false);
  const id = demoVideoId(locale);

  // No id for this language means no card. Better absent than broken.
  if (!id) return null;

  return (
    <section className="paper-film" aria-labelledby="paper-film-title">
      <h2 className="paper-film__title" id="paper-film-title">
        {t('home.watch')}
      </h2>

      <div className="paper-film__frame">
        {playing ? (
          <iframe
            key={id}
            className="paper-film__player"
            src={demoVideoEmbedUrl(id)}
            title={t('home.watch')}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" className="paper-film__poster" onClick={() => setPlaying(true)}>
            {/* The poster is a drawing of the product, not a screenshot of it. */}
            <span className="paper-film__chrome" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="paper-film__sketch" aria-hidden="true">
              <b />
              <s />
              <s style={{ width: '62%' }} />
              <em />
            </span>
            <span className="paper-film__play" aria-hidden="true" />
            <span className="paper-film__label">
              {t('home.watchCta')}
              <span className="paper-film__len">{DEMO_VIDEO_LENGTH}</span>
            </span>
          </button>
        )}
      </div>

      <p className="paper-film__note">
        {t('home.watchHint')}{' '}
        <a className="paper-link" href={demoVideoWatchUrl(id)} target="_blank" rel="noreferrer">
          {t('home.watchOnYouTube')}
        </a>
      </p>
    </section>
  );
}
