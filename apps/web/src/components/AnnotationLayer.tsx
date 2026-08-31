import { useCallback, useEffect, useRef, useState } from 'react';
import { annotationBounds, type Annotation, type Comment, type Point } from '@liha/shared';
import type { Projection } from '../lib/projection.js';

export type Tool = 'cursor' | 'pin' | 'rect' | 'freehand' | 'arrow';

export interface PlacedAnnotation {
  id: string;
  annotation: Annotation;
  status: Comment['status'];
  index: number;
}

interface Props {
  annotations: PlacedAnnotation[];
  projection: Projection;
  tool: Tool;
  selectedId: string | null;
  draft: Annotation | null;
  onSelect(id: string | null): void;
  onDraft(annotation: Annotation | null): void;
  /** Viewport position of the draft, so the composer can float beside it. */
  onDraftAnchor?(anchor: { x: number; y: number } | null): void;
}

const STROKE = { open: 'var(--mark)', resolved: 'var(--ok)' } as const;

export function AnnotationLayer({
  annotations,
  projection,
  tool,
  selectedId,
  draft,
  onSelect,
  onDraft,
  onDraftAnchor,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ start: Point; points: Point[] } | null>(null);

  const drawing = tool !== 'cursor';

  /*
   * Report where the draft sits on screen. Scroll is listened for in the capture
   * phase because the artifact scrolls inside its own container, not the window.
   */
  useEffect(() => {
    if (!onDraftAnchor) return;
    if (!draft || dragging) {
      onDraftAnchor(null);
      return;
    }
    const update = () => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const bounds = annotationBounds(draft);
      const point = projection.toPx({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h });
      onDraftAnchor({
        x: rect.left + Math.min(Math.max(point.x, 0), rect.width),
        y: rect.top + Math.min(Math.max(point.y, 0), rect.height),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [draft, dragging, projection, onDraftAnchor]);

  const pointFromEvent = useCallback(
    (event: React.PointerEvent): Point => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return projection.fromPx(event.clientX - rect.left, event.clientY - rect.top);
    },
    [projection],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!drawing) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (tool === 'pin') {
      onDraft({ type: 'pin', point });
      return;
    }
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDragging({ start: point, points: [point] });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    const point = pointFromEvent(event);
    if (tool === 'freehand') {
      setDragging((current) =>
        current ? { ...current, points: [...current.points, point] } : current,
      );
      onDraft({ type: 'freehand', points: [...dragging.points, point] });
    } else if (tool === 'rect') {
      onDraft({ type: 'rect', rect: rectBetween(dragging.start, point) });
    } else if (tool === 'arrow') {
      onDraft({ type: 'arrow', from: dragging.start, to: point });
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!dragging) return;
    const point = pointFromEvent(event);
    const moved = distance(dragging.start, point) > 0.005;
    if (tool === 'freehand') {
      const points = [...dragging.points, point];
      onDraft(points.length >= 2 && moved ? { type: 'freehand', points } : null);
    } else if (tool === 'rect') {
      onDraft(moved ? { type: 'rect', rect: rectBetween(dragging.start, point) } : null);
    } else if (tool === 'arrow') {
      onDraft(moved ? { type: 'arrow', from: dragging.start, to: point } : null);
    }
    setDragging(null);
  };

  const items: PlacedAnnotation[] = draft
    ? [...annotations, { id: '__draft__', annotation: draft, status: 'open', index: 0 }]
    : annotations;

  return (
    <div
      ref={surfaceRef}
      className={`annotation-layer${drawing ? ' annotation-layer--drawing' : ' annotation-layer--inactive'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg className="annotation-svg" aria-hidden="true">
        {items.map((item) => (
          <AnnotationShape
            key={item.id}
            item={item}
            projection={projection}
            selected={item.id === selectedId}
          />
        ))}
      </svg>
      {items
        .filter((item) => item.annotation.type === 'pin')
        .map((item) => {
          const point = projection.toPx((item.annotation as { point: Point }).point);
          return (
            <button
              key={item.id}
              type="button"
              className="annotation-pin"
              data-status={item.status}
              data-selected={item.id === selectedId}
              style={{ left: point.x, top: point.y, pointerEvents: 'auto' }}
              title={item.id === '__draft__' ? 'New comment' : `Comment ${item.index}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (item.id !== '__draft__') onSelect(item.id);
              }}
            >
              <span>{item.id === '__draft__' ? '+' : item.index}</span>
            </button>
          );
        })}
    </div>
  );
}

function AnnotationShape({
  item,
  projection,
  selected,
}: {
  item: PlacedAnnotation;
  projection: Projection;
  selected: boolean;
}) {
  const color = STROKE[item.status];
  const width = selected ? 3 : 2;
  const { annotation } = item;

  if (annotation.type === 'rect' || annotation.type === 'highlight') {
    const topLeft = projection.toPx({ x: annotation.rect.x, y: annotation.rect.y });
    const bottomRight = projection.toPx({
      x: annotation.rect.x + annotation.rect.w,
      y: annotation.rect.y + annotation.rect.h,
    });
    return (
      <rect
        x={topLeft.x}
        y={topLeft.y}
        width={Math.max(0, bottomRight.x - topLeft.x)}
        height={Math.max(0, bottomRight.y - topLeft.y)}
        fill={annotation.type === 'highlight' ? color : 'none'}
        fillOpacity={annotation.type === 'highlight' ? 0.18 : 0}
        stroke={color}
        strokeWidth={width}
        rx={2}
      />
    );
  }

  if (annotation.type === 'freehand') {
    const d = annotation.points
      .map((point, index) => {
        const px = projection.toPx(point);
        return `${index === 0 ? 'M' : 'L'}${px.x.toFixed(1)},${px.y.toFixed(1)}`;
      })
      .join(' ');
    return (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width + 1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  if (annotation.type === 'arrow') {
    const from = projection.toPx(annotation.from);
    const to = projection.toPx(annotation.to);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = 10;
    return (
      <g stroke={color} strokeWidth={width} fill="none" strokeLinecap="round">
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        <path
          d={`M${to.x},${to.y} L${to.x - head * Math.cos(angle - 0.4)},${to.y - head * Math.sin(angle - 0.4)} M${to.x},${to.y} L${to.x - head * Math.cos(angle + 0.4)},${to.y - head * Math.sin(angle + 0.4)}`}
        />
      </g>
    );
  }
  return null;
}

function rectBetween(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
