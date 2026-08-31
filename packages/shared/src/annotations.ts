import { z } from 'zod';

/**
 * All annotation geometry is stored in normalized coordinates (0..1) relative to
 * the rendered artifact box, so a comment stays anchored when the same artifact
 * is viewed at a different zoom level, viewport width or device pixel ratio.
 */
const unit = z.number().min(0).max(1);
const loose = z.number().min(-0.5).max(1.5);

export const PointSchema = z.object({ x: unit, y: unit });
export const RectSchema = z.object({
  x: loose,
  y: loose,
  w: z.number().min(0).max(2),
  h: z.number().min(0).max(2),
});

export const AnnotationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pin'), point: PointSchema }),
  z.object({ type: z.literal('rect'), rect: RectSchema }),
  z.object({
    type: z.literal('freehand'),
    points: z.array(PointSchema).min(2).max(2000),
    strokeWidth: z.number().min(0.0005).max(0.05).optional(),
  }),
  z.object({ type: z.literal('arrow'), from: PointSchema, to: PointSchema }),
  z.object({ type: z.literal('highlight'), rect: RectSchema }),
]);

export type Point = z.infer<typeof PointSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type AnnotationType = Annotation['type'];

export const ANNOTATION_TYPES: AnnotationType[] = ['pin', 'rect', 'freehand', 'arrow', 'highlight'];

/**
 * What a reviewer clicked inside an HTML preview. Captured by the bridge script
 * so an agent can map a comment back to source without guessing from pixels.
 */
export const ElementContextSchema = z.object({
  selector: z.string().max(2000),
  tagName: z.string().max(64),
  id: z.string().max(256).optional(),
  classList: z.array(z.string().max(128)).max(50).optional(),
  textContent: z.string().max(2000).optional(),
  htmlSnippet: z.string().max(4000).optional(),
  attributes: z.record(z.string().max(2000)).optional(),
  /** Ancestor chain from `<body>` down to the element, for fuzzy re-matching. */
  path: z.array(z.string().max(200)).max(64).optional(),
  boundingRect: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
});

export type ElementContext = z.infer<typeof ElementContextSchema>;

export const ViewportSchema = z.object({
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
  devicePixelRatio: z.number().min(0.1).max(10).optional(),
  scrollY: z.number().optional(),
});

export type Viewport = z.infer<typeof ViewportSchema>;

/**
 * Everything a comment is attached to. Every field is optional so a plain
 * "general note on this version" comment is representable too.
 */
export const CommentTargetSchema = z.object({
  annotation: AnnotationSchema.nullish(),
  /** 1-based page number for PDF previews. */
  page: z.number().int().min(1).max(10_000).nullish(),
  /** Route within a multi-page HTML preview, e.g. `/about/index.html`. */
  path: z.string().max(1024).nullish(),
  element: ElementContextSchema.nullish(),
  viewport: ViewportSchema.nullish(),
});

export type CommentTarget = z.infer<typeof CommentTargetSchema>;

export const EMPTY_TARGET: CommentTarget = {};

export function serializeTarget(target: CommentTarget | null | undefined): string {
  return JSON.stringify(CommentTargetSchema.parse(target ?? EMPTY_TARGET));
}

export function deserializeTarget(raw: string | null | undefined): CommentTarget {
  if (!raw) return EMPTY_TARGET;
  try {
    const parsed = CommentTargetSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_TARGET;
  } catch {
    return EMPTY_TARGET;
  }
}

/** Short human/agent-readable description of where a comment points. */
export function describeTarget(target: CommentTarget): string {
  const parts: string[] = [];
  if (target.page != null) parts.push(`page ${target.page}`);
  if (target.path) parts.push(target.path);
  if (target.element?.selector) parts.push(target.element.selector);
  const annotation = target.annotation;
  if (annotation) {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    if (annotation.type === 'pin')
      parts.push(`pin at ${pct(annotation.point.x)},${pct(annotation.point.y)}`);
    else if (annotation.type === 'rect' || annotation.type === 'highlight')
      parts.push(`${annotation.type} at ${pct(annotation.rect.x)},${pct(annotation.rect.y)}`);
    else if (annotation.type === 'arrow')
      parts.push(`arrow to ${pct(annotation.to.x)},${pct(annotation.to.y)}`);
    else parts.push(`freehand (${annotation.points.length} points)`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'whole artifact';
}

/** Bounding box of an annotation in normalized coordinates, for hit-testing and list previews. */
export function annotationBounds(annotation: Annotation): Rect {
  switch (annotation.type) {
    case 'pin':
      return { x: annotation.point.x, y: annotation.point.y, w: 0, h: 0 };
    case 'rect':
    case 'highlight':
      return annotation.rect;
    case 'arrow': {
      const x = Math.min(annotation.from.x, annotation.to.x);
      const y = Math.min(annotation.from.y, annotation.to.y);
      return {
        x,
        y,
        w: Math.abs(annotation.to.x - annotation.from.x),
        h: Math.abs(annotation.to.y - annotation.from.y),
      };
    }
    case 'freehand': {
      const xs = annotation.points.map((p) => p.x);
      const ys = annotation.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
}
