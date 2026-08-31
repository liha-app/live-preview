import { useEffect, useMemo, useRef, useState } from 'react';
import type { Comment, Version } from '@liha/shared';
import { boxProjection } from '../lib/projection.js';
import { AnnotationLayer, type PlacedAnnotation, type Tool } from './AnnotationLayer.js';
import { EMPTY_DRAFT, type DraftTarget } from './PreviewStage.js';

interface Props {
  version: Version;
  comments: Comment[];
  tool: Tool;
  selectedCommentId: string | null;
  draft: DraftTarget;
  onSelectComment(id: string | null): void;
  onDraftChange(draft: DraftTarget): void;
  onDraftAnchor?(anchor: { x: number; y: number } | null): void;
  onPageCountChange(count: number): void;
}

interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_RENDER_WIDTH = 1000;

/**
 * Renders a PDF to images with pdf.js and overlays one annotation layer per
 * page, so a comment records the page number alongside its normalized position.
 */
export function PdfStage({
  version,
  comments,
  tool,
  selectedCommentId,
  draft,
  onSelectComment,
  onDraftChange,
  onDraftAnchor,
  onPageCountChange,
}: Props) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setPages([]);
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const response = await fetch(version.contentUrl ?? '');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const document_ = await pdfjs.getDocument({ data }).promise;
        if (cancelled.current) return;
        onPageCountChange(document_.numPages);

        const rendered: RenderedPage[] = [];
        for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
          const page = await document_.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, MAX_RENDER_WIDTH / base.width);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas is unavailable.');
          await page.render({ canvasContext: context, viewport }).promise;
          if (cancelled.current) return;
          rendered.push({
            pageNumber,
            dataUrl: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
          });
          setPages([...rendered]);
        }
      } catch (cause) {
        if (!cancelled.current) {
          setError(cause instanceof Error ? cause.message : 'Could not render this PDF.');
        }
      } finally {
        if (!cancelled.current) setLoading(false);
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [version.id, version.contentUrl, onPageCountChange]);

  if (error) {
    return (
      <div className="center-pane">
        <div className="notice notice--error">Could not render this PDF: {error}</div>
      </div>
    );
  }

  return (
    <div
      className="stage__scroll"
      style={{ flexDirection: 'column', gap: 14, alignItems: 'center' }}
    >
      {pages.map((page) => (
        <PdfPage
          key={page.pageNumber}
          page={page}
          comments={comments}
          tool={tool}
          selectedCommentId={selectedCommentId}
          draft={draft}
          onSelectComment={onSelectComment}
          onDraftChange={onDraftChange}
          onDraftAnchor={onDraftAnchor}
        />
      ))}
      {loading && (
        <div className="row muted">
          <span className="spinner" /> Rendering pages…
        </div>
      )}
    </div>
  );
}

function PdfPage({
  page,
  comments,
  tool,
  selectedCommentId,
  draft,
  onSelectComment,
  onDraftChange,
  onDraftAnchor,
}: {
  page: RenderedPage;
  comments: Comment[];
  tool: Tool;
  selectedCommentId: string | null;
  draft: DraftTarget;
  onSelectComment(id: string | null): void;
  onDraftChange(draft: DraftTarget): void;
  onDraftAnchor?(anchor: { x: number; y: number } | null): void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(() => boxProjection(size.width, size.height), [size]);

  const placed: PlacedAnnotation[] = [];
  comments.forEach((comment, index) => {
    if (!comment.target.annotation) return;
    if ((comment.target.page ?? 1) !== page.pageNumber) return;
    placed.push({
      id: comment.id,
      annotation: comment.target.annotation,
      status: comment.status,
      index: index + 1,
    });
  });

  const draftForPage = draft.page === page.pageNumber ? draft.annotation : null;

  return (
    <div className="stage__frame" style={{ maxWidth: '100%' }}>
      <img
        ref={ref}
        src={page.dataUrl}
        alt={`Page ${page.pageNumber}`}
        style={{ display: 'block', maxWidth: '100%' }}
        onLoad={(event) =>
          setSize({
            width: event.currentTarget.clientWidth,
            height: event.currentTarget.clientHeight,
          })
        }
      />
      <AnnotationLayer
        annotations={placed}
        projection={projection}
        tool={tool}
        selectedId={selectedCommentId}
        draft={draftForPage}
        onSelect={onSelectComment}
        onDraft={(annotation) =>
          onDraftChange({ ...EMPTY_DRAFT, annotation, page: page.pageNumber })
        }
        onDraftAnchor={onDraftAnchor}
      />
    </div>
  );
}
