import { describe, expect, it } from 'vitest';
import { boxProjection, documentProjection } from './projection.js';
import { DEFAULT_METRICS, isBridgeMessage } from './bridge-client.js';

describe('boxProjection', () => {
  const projection = boxProjection(800, 400);

  it('round-trips normalized coordinates through pixels', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
      { x: 1, y: 1 },
    ]) {
      const px = projection.toPx(point);
      expect(projection.fromPx(px.x, px.y)).toEqual(point);
    }
  });

  it('places an annotation at the same fraction whatever the rendered size', () => {
    const small = boxProjection(400, 200);
    const large = boxProjection(1600, 800);
    const point = { x: 0.25, y: 0.75 };
    expect(small.toPx(point)).toEqual({ x: 100, y: 150 });
    expect(large.toPx(point)).toEqual({ x: 400, y: 600 });
  });

  it('clamps clicks outside the box into range', () => {
    expect(projection.fromPx(-50, -50)).toEqual({ x: 0, y: 0 });
    expect(projection.fromPx(9999, 9999)).toEqual({ x: 1, y: 1 });
  });

  it('survives a zero-sized box before the image has loaded', () => {
    expect(boxProjection(0, 0).fromPx(10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('documentProjection', () => {
  const metrics = {
    ...DEFAULT_METRICS,
    scrollWidth: 1000,
    scrollHeight: 4000,
    innerWidth: 1000,
    innerHeight: 800,
  };

  it('anchors annotations to the document, not the viewport', () => {
    const atTop = documentProjection({ ...metrics, scrollY: 0 });
    const scrolled = documentProjection({ ...metrics, scrollY: 1000 });
    const point = { x: 0.5, y: 0.5 };

    // The same point moves up the screen by exactly the scroll distance.
    expect(atTop.toPx(point).y - scrolled.toPx(point).y).toBe(1000);
    expect(atTop.toPx(point).x).toBe(scrolled.toPx(point).x);
  });

  it('converts a click into document-relative coordinates', () => {
    const projection = documentProjection({ ...metrics, scrollY: 2000 });
    expect(projection.fromPx(500, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('never divides by zero on an empty document', () => {
    const projection = documentProjection({ ...DEFAULT_METRICS, scrollWidth: 0, scrollHeight: 0 });
    expect(projection.fromPx(10, 10)).toEqual({ x: 1, y: 1 });
  });
});

describe('isBridgeMessage', () => {
  const frame = { contentWindow: { id: 'preview' } } as unknown as HTMLIFrameElement;
  const message = (source: unknown, data: unknown) => ({ source, data }) as unknown as MessageEvent;

  it('accepts messages from the frame it created', () => {
    expect(
      isBridgeMessage(
        message(frame.contentWindow, { source: 'liha-bridge', type: 'ready' }),
        frame,
      ),
    ).toBe(true);
  });

  it('rejects messages from any other window', () => {
    // Preview content runs on an opaque origin, so event.origin is useless for
    // authentication — identity comes from the window reference alone.
    expect(
      isBridgeMessage(message({ id: 'attacker' }, { source: 'liha-bridge', type: 'ready' }), frame),
    ).toBe(false);
  });

  it('rejects messages that are not from the bridge', () => {
    expect(isBridgeMessage(message(frame.contentWindow, { type: 'ready' }), frame)).toBe(false);
    expect(isBridgeMessage(message(frame.contentWindow, null), frame)).toBe(false);
    expect(isBridgeMessage(message(frame.contentWindow, { source: 'liha-bridge' }), frame)).toBe(
      false,
    );
  });

  it('rejects everything when there is no frame yet', () => {
    expect(isBridgeMessage(message(null, { source: 'liha-bridge', type: 'ready' }), null)).toBe(
      false,
    );
  });
});
