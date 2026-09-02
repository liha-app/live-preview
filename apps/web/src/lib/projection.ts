import type { Point } from '@liha-cli/shared';
import type { BridgeMetrics } from './bridge-client.js';

/**
 * Maps between normalized annotation coordinates (0..1) and on-screen pixels.
 *
 * Annotations are stored normalized so they stay anchored across zoom levels,
 * viewport sizes and device pixel ratios — the projection is what re-anchors
 * them for the surface currently being rendered.
 */
export interface Projection {
  toPx(point: Point): { x: number; y: number };
  fromPx(x: number, y: number): Point;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** For artifacts rendered at a fixed size: images, PDF pages, screenshots. */
export function boxProjection(width: number, height: number): Projection {
  return {
    toPx: (point) => ({ x: point.x * width, y: point.y * height }),
    fromPx: (x, y) => ({ x: clamp01(width ? x / width : 0), y: clamp01(height ? y / height : 0) }),
  };
}

/**
 * For scrollable HTML documents: coordinates are normalized against the full
 * document, then offset by the iframe's current scroll position so an
 * annotation stays glued to the content rather than to the viewport.
 */
export function documentProjection(metrics: BridgeMetrics): Projection {
  const width = Math.max(1, metrics.scrollWidth);
  const height = Math.max(1, metrics.scrollHeight);
  return {
    toPx: (point) => ({
      x: point.x * width - metrics.scrollX,
      y: point.y * height - metrics.scrollY,
    }),
    fromPx: (x, y) => ({
      x: clamp01((x + metrics.scrollX) / width),
      y: clamp01((y + metrics.scrollY) / height),
    }),
  };
}
