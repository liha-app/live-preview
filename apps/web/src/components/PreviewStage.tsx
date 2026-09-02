import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, Comment, ElementContext, Preview, Version } from '@liha-cli/shared';
import {
  DEFAULT_METRICS,
  isBridgeMessage,
  postToBridge,
  type BridgeMetrics,
} from '../lib/bridge-client.js';
import { boxProjection, documentProjection, type Projection } from '../lib/projection.js';
import { AnnotationLayer, type PlacedAnnotation, type Tool } from './AnnotationLayer.js';
import { PdfStage } from './PdfStage.js';

export interface DraftTarget {
  annotation: Annotation | null;
  element: ElementContext | null;
  path: string | null;
  page: number | null;
  viewport: { width: number; height: number; devicePixelRatio?: number } | null;
}

export const EMPTY_DRAFT: DraftTarget = {
  annotation: null,
  element: null,
  path: null,
  page: null,
  viewport: null,
};

export const VIEWPORTS = [
  { id: 'fit', label: 'Fit', width: null },
  { id: 'desktop', label: '1280', width: 1280 },
  { id: 'tablet', label: '768', width: 768 },
  { id: 'mobile', label: '390', width: 390 },
] as const;

export type ViewportId = (typeof VIEWPORTS)[number]['id'];

interface StageProps {
  preview: Preview;
  version: Version | null;
  comments: Comment[];
  tool: Tool;
  viewportId: ViewportId;
  selectedCommentId: string | null;
  draft: DraftTarget;
  page: number;
  onPageCountChange(count: number): void;
  onSelectComment(id: string | null): void;
  onDraftChange(draft: DraftTarget): void;
  onDraftAnchor?(anchor: { x: number; y: number } | null): void;
}

/** Comments that carry geometry, numbered the way the sidebar numbers them. */
function placedAnnotations(comments: Comment[], page: number | null): PlacedAnnotation[] {
  const placed: PlacedAnnotation[] = [];
  comments.forEach((comment, index) => {
    const annotation = comment.target.annotation;
    if (!annotation) return;
    if (page !== null && (comment.target.page ?? 1) !== page) return;
    placed.push({ id: comment.id, annotation, status: comment.status, index: index + 1 });
  });
  return placed;
}

export function PreviewStage(props: StageProps) {
  const { preview, version } = props;
  if (!version) {
    return (
      <div className="center-pane">
        <p className="muted">This preview has no version yet.</p>
      </div>
    );
  }
  if (preview.type === 'image') return <ImageStage {...props} version={version} />;
  if (preview.type === 'pdf') return <PdfStage {...props} version={version} />;
  return <HtmlStage {...props} version={version} />;
}

// ------------------------------------------------------------------- images

function ImageStage({
  version,
  comments,
  tool,
  selectedCommentId,
  draft,
  onSelectComment,
  onDraftChange,
  onDraftAnchor,
}: StageProps & { version: Version }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const element = imageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [version.id]);

  const projection = useMemo(() => boxProjection(size.width, size.height), [size]);

  return (
    <div className="stage__scroll">
      <div className="stage__frame">
        <img
          ref={imageRef}
          src={version.contentUrl ?? ''}
          alt={version.entryPath}
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.clientWidth,
              height: event.currentTarget.clientHeight,
            })
          }
        />
        <AnnotationLayer
          annotations={placedAnnotations(comments, null)}
          projection={projection}
          tool={tool}
          selectedId={selectedCommentId}
          draft={draft.annotation}
          onSelect={onSelectComment}
          onDraft={(annotation) => onDraftChange({ ...EMPTY_DRAFT, annotation })}
          onDraftAnchor={onDraftAnchor}
        />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- html

function HtmlStage({
  version,
  comments,
  tool,
  viewportId,
  selectedCommentId,
  draft,
  onSelectComment,
  onDraftChange,
  onDraftAnchor,
}: StageProps & { version: Version }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [metrics, setMetrics] = useState<BridgeMetrics>(DEFAULT_METRICS);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isBridgeMessage(event, frameRef.current)) return;
      const message = event.data;
      if (message.type === 'ready') {
        setConnected(true);
        setMetrics(message.metrics);
      } else if (message.type === 'metrics') {
        setMetrics(message.metrics);
      } else if (message.type === 'element-picked') {
        onDraftChange({
          annotation: { type: 'pin', point: message.point },
          element: message.element,
          path: message.metrics.path,
          page: null,
          viewport: {
            width: message.metrics.innerWidth,
            height: message.metrics.innerHeight,
            devicePixelRatio: message.metrics.devicePixelRatio,
          },
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onDraftChange]);

  // The bridge only intercepts clicks while the cursor tool is active; the
  // drawing tools need those clicks for the overlay instead.
  useEffect(() => {
    postToBridge(frameRef.current, {
      type: 'set-mode',
      mode: tool === 'cursor' ? 'review' : 'browse',
    });
  }, [tool, connected]);

  useEffect(() => {
    if (!selectedCommentId) return;
    const selector = comments.find((c) => c.id === selectedCommentId)?.target.element?.selector;
    if (selector) postToBridge(frameRef.current, { type: 'highlight', selector });
  }, [selectedCommentId, comments]);

  const projection = useMemo(() => documentProjection(metrics), [metrics]);
  const viewportWidth = VIEWPORTS.find((v) => v.id === viewportId)?.width ?? null;

  return (
    <div className="stage__scroll" style={viewportWidth ? undefined : { padding: 0 }}>
      <div
        className={`stage__frame${viewportWidth ? '' : ' stage__frame--fill'}`}
        style={
          viewportWidth
            ? { width: viewportWidth, maxWidth: '100%', height: '100%' }
            : { borderRadius: 0, border: 0, boxShadow: 'none' }
        }
      >
        <iframe
          ref={frameRef}
          key={version.id}
          title="Preview content"
          src={version.contentUrl ?? 'about:blank'}
          style={{ width: '100%', height: '100%', minHeight: 400 }}
          /*
           * No `allow-same-origin`: uploaded HTML gets an opaque origin and can
           * neither read this app's storage nor reach the owner token. The
           * server sends an equivalent CSP sandbox header as defence in depth.
           */
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="no-referrer"
        />
        <AnnotationLayer
          annotations={placedAnnotations(comments, null)}
          projection={projection}
          tool={tool}
          selectedId={selectedCommentId}
          draft={draft.annotation}
          onSelect={onSelectComment}
          onDraft={(annotation) =>
            onDraftChange({
              ...EMPTY_DRAFT,
              annotation,
              path: metrics.path,
              viewport: { width: metrics.innerWidth, height: metrics.innerHeight },
            })
          }
          onDraftAnchor={onDraftAnchor}
        />
      </div>
    </div>
  );
}
