import { useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n/index.js';
import { Modal } from './Dialogs.js';
import {
  DEMO_VIDEO_LENGTH,
  demoVideoEmbedUrl,
  demoVideoId,
  demoVideoWatchUrl,
} from '../lib/demoVideo.js';

/**
 * The demo, docked in the corner until someone wants it.
 *
 * Two things are being kept at once. The landing page fits on a screen without
 * scrolling, so the card cannot take a place in the flow — it sits over the
 * sheet like the notes around it, and the page below is exactly as tall as it
 * was. And a 260px player is not worth watching, so pressing play opens it
 * large instead of starting it small.
 *
 * Nothing is requested from YouTube — not even a thumbnail — until that press.
 * The poster is drawn here in the same ink as the rest of the page, and the
 * player only exists while the dialog is open, which is also what stops the
 * sound when it closes.
 */
export function DemoVideo() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const id = demoVideoId(locale);

  // No id for this language means no card. Better absent than broken.
  if (!id) return null;

  return (
    <>
      <div className="paper-film">
        <button type="button" className="paper-film__poster" onClick={() => setOpen(true)}>
          {/* A drawing of the product, not a screenshot of it. */}
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
        <p className="paper-film__note">{t('home.watchHint')}</p>
      </div>

      {open && (
        <Modal title={t('home.watch')} onClose={() => setOpen(false)} bare className="modal--film">
          {/*
            Outside the stage, and first in the DOM. Inside it, this button
            landed beside YouTube's own close control — two crosses in one
            corner — and the focus trap has to reach it before the player,
            since Escape inside a cross-origin frame never comes back to us.
          */}
          <button
            type="button"
            className="paper-film__close"
            onClick={() => setOpen(false)}
            aria-label={t('common.close')}
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className="paper-tokens paper-film__stage">
            <iframe
              key={id}
              className="paper-film__player"
              src={demoVideoEmbedUrl(id)}
              title={t('home.watch')}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
          <p className="paper-tokens paper-film__stage-note">
            <a className="paper-link" href={demoVideoWatchUrl(id)} target="_blank" rel="noreferrer">
              {t('home.watchOnYouTube')}
            </a>
          </p>
        </Modal>
      )}
    </>
  );
}
