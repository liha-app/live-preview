import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sampleShareUrl } from '../lib/sampleUrl.js';
import { useT } from '../i18n/index.js';

/**
 * The margin notes around the landing page.
 *
 * All of it is ornament: the layer is `aria-hidden` and untouchable, so a
 * screen reader gets the page without it and the mouse passes straight through
 * to what is underneath. Nothing here carries meaning the copy does not.
 *
 * The two red arrows are measured rather than drawn: they start at a card and
 * end at the drop target, wherever those land at this window size. A fixed path
 * would only be right at one width, and the whole point of a pen mark is that
 * it points at something.
 */

interface Point {
  x: number;
  y: number;
}

interface Geometry {
  width: number;
  height: number;
  left: { body: string; head: string };
  right: { body: string; head: string };
  leftLabel: Point;
  rightLabel: Point;
}

/**
 * A curve from `start` to `end`, plus the two strokes of an arrowhead. The head
 * is angled off the tangent at the end so it reads as one gesture.
 */
function curve(start: Point, end: Point, c1: Point, c2: Point) {
  const angle = Math.atan2(end.y - c2.y, end.x - c2.x);
  const barb = (spread: number) =>
    `${end.x - 15 * Math.cos(angle + spread)} ${end.y - 15 * Math.sin(angle + spread)}`;

  return {
    body: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    head: `M ${barb(-0.42)} L ${end.x} ${end.y} L ${barb(0.42)}`,
  };
}

export function PaperDecor({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const specRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : innerWidth));
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  const showExtras = width >= 1100;

  const measure = useCallback(() => {
    const root = rootRef.current;
    const target = targetRef.current;
    if (!root || !target) return;

    const origin = root.getBoundingClientRect();
    const local = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      if (!box.width) return null;
      return {
        left: box.left - origin.left,
        right: box.right - origin.left,
        top: box.top - origin.top,
        bottom: box.bottom - origin.top,
      };
    };

    const drop = local(target);
    if (!drop) {
      setGeometry(null);
      return;
    }
    const spec = local(specRef.current);
    const comments = local(commentsRef.current);

    const leftStart = spec
      ? { x: spec.right + 14, y: spec.top + 18 }
      : { x: Math.max(24, drop.left - 190), y: drop.bottom + 120 };
    const leftEnd = { x: drop.left - 26, y: drop.bottom + 2 };
    const left = curve(
      leftStart,
      leftEnd,
      { x: leftStart.x + 70, y: leftStart.y - 20 },
      { x: leftEnd.x - 60, y: leftEnd.y + 70 },
    );

    const room = (comments ? comments.left : origin.width) - drop.right;
    const span = Math.min(150, Math.max(70, room - 40));
    const rightStart = {
      x: drop.right + 24,
      y: comments ? Math.min(drop.bottom - 26, comments.top - 24) : drop.bottom - 26,
    };
    const rightEnd = { x: drop.right + 24 + span, y: drop.top - 14 };
    const right = curve(
      rightStart,
      rightEnd,
      { x: rightStart.x + span * 0.55, y: rightStart.y - 10 },
      { x: rightEnd.x - span * 0.25, y: rightEnd.y + 50 },
    );

    const next: Geometry = {
      width: origin.width,
      height: origin.height,
      left,
      right,
      leftLabel: { x: Math.max(14, drop.left - 158), y: drop.bottom + 44 },
      rightLabel: { x: drop.right + 34, y: drop.top - 52 },
    };
    setGeometry((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, [targetRef]);

  useLayoutEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
      measure();
    };
    onResize();

    window.addEventListener('resize', onResize);
    // The drop target changes size when the mode switches, and the cards move
    // with it. A resize of the window is not the only thing that invalidates a
    // measurement.
    const observer = new ResizeObserver(() => measure());
    if (targetRef.current) observer.observe(targetRef.current);
    if (rootRef.current) observer.observe(rootRef.current);

    // Handwriting is a webfont; the boxes settle only once it has arrived.
    void document.fonts?.ready.then(measure).catch(() => {});

    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
  }, [measure, targetRef]);

  // Below this the page is a single column and there is no margin to write in.
  if (width < 860) return <div ref={rootRef} className="paper__decor" aria-hidden="true" />;

  const lines = (key: 'decor.sticky' | 'decor.comments') =>
    t(key)
      .split('\n')
      .map((line, index) => (
        <span key={line}>
          {index > 0 && <br />}
          {line}
        </span>
      ));

  return (
    <div ref={rootRef} className="paper__decor" aria-hidden="true">
      <div className="decor-card decor-browser">
        <div className="decor-dots">
          <i />
          <i />
          <i />
        </div>
        <div className="decor-lines">
          <b />
          <s />
          <s style={{ width: '70%' }} />
          <div className="decor-tiles">
            <i />
            <i />
          </div>
          <div className="decor-cta" />
        </div>
        <div className="decor-scrawl">{t('decor.scrawl')}</div>
      </div>

      {showExtras && (
        <div ref={specRef} className="decor-card decor-spec">
          <div className="decor-file">spec.pdf</div>
          <div className="decor-lines" style={{ marginTop: 8, gap: 6 }}>
            <s />
            <s style={{ width: '76%' }} />
            <s style={{ width: '60%' }} />
          </div>
          <div className="decor-scrawl" style={{ marginTop: 10, fontSize: 12.5 }}>
            ✓ {t('decor.specOk')}
          </div>
        </div>
      )}

      <div className="decor-card decor-sticky">{lines('decor.sticky')}</div>

      <div ref={commentsRef} className="decor-card decor-comments">
        <div className="decor-file" style={{ marginBottom: 7 }}>
          comments.json
        </div>
        {lines('decor.comments')}
      </div>

      {showExtras && (
        <>
          <div
            className="decor-note"
            style={{ right: '8%', top: '42%', transform: 'rotate(2deg)' }}
          >
            {t('decor.password')}
          </div>
          {sampleShareUrl() && <div className="decor-path">{sampleShareUrl()}</div>}
          <div className="decor-pencil" />
        </>
      )}

      {geometry && (
        <>
          <svg
            className="decor-arrows"
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            focusable="false"
          >
            <path className="ink ink--1" strokeWidth={3.2} d={geometry.left.body} />
            <path className="ink ink--2" strokeWidth={3.2} d={geometry.left.head} />
            <path className="ink ink--3" strokeWidth={3} d={geometry.right.body} />
            <path className="ink ink--4" strokeWidth={3} d={geometry.right.head} />
          </svg>
          <div
            className="decor-label"
            style={{
              left: geometry.leftLabel.x,
              top: geometry.leftLabel.y,
              transform: 'rotate(-6deg)',
            }}
          >
            {t('decor.dropLabel')}
          </div>
          <div
            className="decor-label"
            style={{
              left: geometry.rightLabel.x,
              top: geometry.rightLabel.y,
              transform: 'rotate(6deg)',
            }}
          >
            {t('decor.urlLabel')}
          </div>
        </>
      )}
    </div>
  );
}
