import { useLayoutEffect, useRef, useState } from 'react';
import { CommentComposer, type ComposerSubmit } from './CommentComposer.js';

export interface AnchorPoint {
  x: number;
  y: number;
}

interface Props {
  anchor: AnchorPoint;
  value: string;
  authorName: string;
  targetLabel: string | null;
  submitting: boolean;
  onChange(body: string): void;
  onAuthorChange(name: string): void;
  onSubmit(input: ComposerSubmit): void;
  onCancel(): void;
}

const WIDTH = 316;
const MARGIN = 12;
const GAP = 14;

/**
 * The composer, floating next to the thing being commented on.
 *
 * Writing feedback should happen where you are looking, not in a panel on the
 * far side of the screen — so the box follows the pin. It is fixed-positioned
 * against viewport coordinates, which keeps it out of the stage's scroll and
 * overflow containers.
 */
export function InlineComposer({ anchor, ...composer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; above: boolean }>({
    left: anchor.x - WIDTH / 2,
    top: anchor.y + GAP,
    above: false,
  });

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 180;
    const maxLeft = window.innerWidth - WIDTH - MARGIN;
    const left = Math.min(Math.max(MARGIN, anchor.x - WIDTH / 2), Math.max(MARGIN, maxLeft));

    // Flip above the anchor when there is not enough room below it.
    const below = anchor.y + GAP + height <= window.innerHeight - MARGIN;
    const top = below
      ? anchor.y + GAP
      : Math.max(MARGIN, Math.min(anchor.y - GAP - height, window.innerHeight - height - MARGIN));

    setPlacement({ left, top, above: !below });
  }, [anchor.x, anchor.y, composer.value, composer.targetLabel]);

  return (
    <div
      ref={ref}
      className="inline-composer"
      style={{ left: placement.left, top: placement.top, width: WIDTH }}
      role="dialog"
      aria-label="Write a comment"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className="inline-composer__caret"
        data-above={placement.above}
        style={{ left: Math.min(Math.max(12, anchor.x - placement.left), WIDTH - 12) }}
        aria-hidden="true"
      />
      <CommentComposer {...composer} autoFocus compact submitLabel="Comment" />
    </div>
  );
}
