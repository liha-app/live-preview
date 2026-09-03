import { useLayoutEffect, useRef, useState } from 'react';
import { Modal } from './Dialogs.js';
import { sampleShareUrl } from '../lib/sampleUrl.js';
import { useT, type Translate } from '../i18n/index.js';

/**
 * Three sketches explaining the loop: hand over a URL, mark it up, get the fix
 * back at the same URL.
 *
 * The drawings are ornament — `aria-hidden`, and every one of them repeats what
 * the heading underneath already says. Someone who never sees them loses
 * nothing, which is the test any illustration has to pass.
 */

const STEPS = [1, 2, 3] as const;
type Step = (typeof STEPS)[number];

/*
 * The illustrations are drawn at one size and scaled, rather than laid out
 * responsively. They are pictures: the arrow has to land on the window it
 * points at, and the only way to keep that true at every width is to scale the
 * whole composition. Laid out in pixels they collide — below about 540px of
 * stage the right-hand window slides left and covers the document.
 */
const FRAME_WIDTH = 500;
const FRAME_HEIGHT = 236;

function StepOne({ t }: { t: Translate }) {
  return (
    <div className="ob" aria-hidden="true">
      <div className="ob-doc">
        <div className="decor-file">index.html</div>
        <div className="decor-lines" style={{ marginTop: 10, gap: 7 }}>
          <s />
          <s style={{ width: '74%' }} />
          <s style={{ width: '58%' }} />
        </div>
      </div>
      <svg
        className="ob-arrow"
        viewBox="0 0 200 100"
        style={{ left: 150, top: 96, width: 150, height: 80 }}
        focusable="false"
      >
        <path className="ink--1" strokeWidth={3.2} d="M6 74 C 60 70, 110 50, 168 20" />
        <path className="ink--2" strokeWidth={3.2} d="M148 26 L 172 16 L 176 40" />
      </svg>
      <div
        className="ob-window"
        style={{ right: 26, top: 52, width: 210, transform: 'rotate(2deg)' }}
      >
        <div className="decor-dots" style={{ gap: 5, marginBottom: 10 }}>
          <i />
          <i />
          <i />
        </div>
        {/* An address bar with nothing to put in it stays an address bar. */}
        <div className="ob-url">{sampleShareUrl() ?? <i className="ob-url__blank" />}</div>
      </div>
    </div>
  );
}

function StepTwo({ t }: { t: Translate }) {
  return (
    <div className="ob" aria-hidden="true">
      <div
        className="ob-window"
        style={{
          left: 70,
          top: 34,
          width: 290,
          transform: 'rotate(-1.6deg)',
          padding: '16px 18px',
        }}
      >
        <div className="decor-lines">
          <b style={{ height: 11, width: '52%' }} />
          <s />
          <s style={{ width: '72%' }} />
          <div className="decor-cta" style={{ height: 26, width: '44%', marginTop: 8 }} />
        </div>
      </div>
      <div
        className="decor-label"
        style={{ left: 236, bottom: 26, top: 'auto', fontSize: 15, transform: 'rotate(-4deg)' }}
      >
        {t('onboard.fix')}
      </div>
      <div className="decor-pencil" style={{ left: 'auto', right: 36, top: 150 }} />
    </div>
  );
}

function StepThree({ t }: { t: Translate }) {
  return (
    <div className="ob" aria-hidden="true">
      <div
        className="ob-json"
        style={{ left: 30, top: 44, width: 180, transform: 'rotate(-2deg)' }}
      >
        {'{ "comment": "…",'}
        <br />
        &nbsp;&nbsp;{'"selector": "button" }'}
      </div>
      <svg
        className="ob-arrow"
        viewBox="0 0 160 90"
        style={{ left: 196, top: 92, width: 130, height: 70 }}
        focusable="false"
      >
        <path className="ink--1" strokeWidth={3} d="M6 60 C 52 56, 96 40, 138 16" />
        <path className="ink--2" strokeWidth={3} d="M118 22 L 142 12 L 146 34" />
      </svg>
      <div
        className="ob-window"
        style={{
          right: 28,
          top: 44,
          width: 190,
          transform: 'rotate(2.2deg)',
          padding: '14px 16px',
        }}
      >
        <div className="decor-lines" style={{ gap: 8 }}>
          <b style={{ height: 9, width: '58%' }} />
          <s />
          <div
            style={{
              height: 22,
              width: '46%',
              marginTop: 6,
              background: 'var(--paper-sticky)',
              border: '1.5px solid var(--paper-ink)',
              borderRadius: 4,
            }}
          />
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: 'var(--hand)',
            fontSize: 12.5,
            color: 'var(--paper-blue)',
          }}
        >
          {t('onboard.sameUrl')}
        </div>
      </div>
    </div>
  );
}

export function Onboarding({ onClose, onSample }: { onClose(): void; onSample(): void }) {
  const t = useT();
  const [step, setStep] = useState<Step>(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const last = step === 3;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => setScale(Math.min(1, stage.clientWidth / FRAME_WIDTH));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <Modal title={t('onboard.title')} onClose={onClose} bare>
      <div className="paper-tokens paper-sheet onboard">
        <div className="onboard__head">
          <div className="onboard__step">
            {t('onboard.step', { current: `0${step}`, total: '03' })}
          </div>
          <button type="button" className="paper-link" onClick={onClose}>
            {t('onboard.close')}
          </button>
        </div>

        <div
          ref={stageRef}
          className="onboard__stage"
          style={{ height: Math.round(FRAME_HEIGHT * scale) }}
        >
          <div className="ob__frame" style={{ transform: `scale(${scale})` }}>
            {step === 1 && <StepOne t={t} />}
            {step === 2 && <StepTwo t={t} />}
            {step === 3 && <StepThree t={t} />}
          </div>
        </div>

        <div className="onboard__copy">
          <h2 className="onboard__heading">{t(`onboard.${step}.title` as 'onboard.1.title')}</h2>
          <p className="onboard__sub">{t(`onboard.${step}.body` as 'onboard.1.body')}</p>
        </div>

        <div className="onboard__foot">
          <div className="onboard__dots">
            {STEPS.map((value) => (
              <button
                key={value}
                type="button"
                className="onboard__dot"
                aria-current={value === step}
                aria-label={t('onboard.goTo', { step: value })}
                onClick={() => setStep(value)}
              />
            ))}
          </div>
          <div className="onboard__actions">
            <button type="button" className="paper-link" onClick={onClose}>
              {t('onboard.skip')}
            </button>
            {last ? (
              <button type="button" className="paper-btn paper-btn--ink" onClick={onSample}>
                ▷ {t('onboard.openSample')}
              </button>
            ) : (
              <button
                type="button"
                className="paper-btn"
                onClick={() => setStep((current) => (current + 1) as Step)}
              >
                {t('onboard.next')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
