import { describe, expect, it } from 'vitest';
import {
  AnnotationSchema,
  CommentTargetSchema,
  annotationBounds,
  describeTarget,
  deserializeTarget,
  serializeTarget,
  type Annotation,
} from './annotations.js';
import { detectArtifactKind, sniffContentType, contentTypeForPath } from './mime.js';

const PIN: Annotation = { type: 'pin', point: { x: 0.25, y: 0.5 } };
const RECT: Annotation = { type: 'rect', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } };
const FREEHAND: Annotation = {
  type: 'freehand',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.2 },
    { x: 0.2, y: 0.6 },
  ],
};

describe('annotation serialization', () => {
  it('round-trips every annotation kind', () => {
    for (const annotation of [
      PIN,
      RECT,
      FREEHAND,
      { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } as Annotation,
      { type: 'highlight', rect: { x: 0, y: 0, w: 1, h: 0.1 } } as Annotation,
    ]) {
      const restored = deserializeTarget(serializeTarget({ annotation }));
      expect(restored.annotation).toEqual(annotation);
    }
  });

  it('round-trips element context and page targets', () => {
    const target = {
      annotation: PIN,
      page: 3,
      path: '/about/index.html',
      element: {
        selector: 'main > section.hero > button.cta',
        tagName: 'BUTTON',
        textContent: 'Get started',
        path: ['body', 'main', 'section.hero', 'button.cta'],
        boundingRect: { x: 10, y: 20, width: 120, height: 44 },
      },
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
    };
    expect(deserializeTarget(serializeTarget(target))).toEqual(target);
  });

  it('rejects out-of-range normalized coordinates', () => {
    expect(AnnotationSchema.safeParse({ type: 'pin', point: { x: 1.5, y: 0 } }).success).toBe(
      false,
    );
    expect(AnnotationSchema.safeParse({ type: 'pin', point: { x: -0.1, y: 0 } }).success).toBe(
      false,
    );
    expect(AnnotationSchema.safeParse({ type: 'freehand', points: [{ x: 0, y: 0 }] }).success).toBe(
      false,
    );
    expect(AnnotationSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });

  it('degrades to an empty target instead of throwing on corrupt input', () => {
    expect(deserializeTarget('{not json')).toEqual({});
    expect(deserializeTarget(null)).toEqual({});
    expect(deserializeTarget('{"annotation":{"type":"pin","point":{"x":9,"y":9}}}')).toEqual({});
  });

  it('caps unbounded strings so a hostile page cannot bloat a comment', () => {
    const result = CommentTargetSchema.safeParse({
      element: { selector: 'x'.repeat(5000), tagName: 'DIV' },
    });
    expect(result.success).toBe(false);
  });
});

describe('describeTarget', () => {
  it('summarizes targets for agents and list views', () => {
    expect(describeTarget({})).toBe('whole artifact');
    expect(describeTarget({ annotation: PIN })).toBe('pin at 25%,50%');
    expect(describeTarget({ page: 2, annotation: RECT })).toBe('page 2 · rect at 10%,20%');
    expect(
      describeTarget({
        path: '/index.html',
        element: { selector: 'button.cta', tagName: 'BUTTON' },
      }),
    ).toBe('/index.html · button.cta');
  });
});

describe('annotationBounds', () => {
  it('computes normalized bounding boxes', () => {
    expect(annotationBounds(PIN)).toEqual({ x: 0.25, y: 0.5, w: 0, h: 0 });
    expect(annotationBounds(RECT)).toEqual(RECT.rect);
    const bounds = annotationBounds(FREEHAND);
    expect(bounds.x).toBeCloseTo(0.1);
    expect(bounds.w).toBeCloseTo(0.3);
    expect(bounds.h).toBeCloseTo(0.5);
  });
});

describe('content sniffing', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);

  it('trusts magic numbers over the file extension', () => {
    expect(sniffContentType(png)).toBe('image/png');
    expect(detectArtifactKind('evil.html', png)).toBe('image');
    expect(detectArtifactKind('report.png', pdf)).toBe('pdf');
    expect(detectArtifactKind('site.png', zip)).toBe('html');
  });

  it('falls back to the extension when bytes are inconclusive', () => {
    expect(detectArtifactKind('index.html', new Uint8Array([0x3c, 0x21]))).toBe('html');
    expect(detectArtifactKind('notes.bin', null)).toBeNull();
  });

  it('never serves an uploaded file as SVG', () => {
    expect(contentTypeForPath('logo.svg')).toBe('application/octet-stream');
  });
});
