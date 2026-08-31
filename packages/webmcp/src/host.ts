import type {
  Comment,
  CommentFilter,
  CommentTarget,
  Preview,
  ShareInfo,
  Version,
} from '@liha/shared';

export interface AddCommentInput {
  body: string;
  authorName?: string;
  target?: CommentTarget;
  /** Reply to this comment instead of starting a new thread. */
  parentId?: string;
}

export interface CreateUrlPreviewInput {
  url: string;
  title?: string;
  password?: string;
}

export interface CreatedPreview {
  previewId: string;
  slug: string;
  shareUrl: string;
  ownerToken: string;
}

export interface ArtifactFile {
  path: string;
  size: number;
  contentType: string;
}

export interface ArtifactSource {
  path: string;
  contentType: string;
  /** Truncated to a readable size; `truncated` says whether anything was cut. */
  text: string;
  truncated: boolean;
}

/** The review viewport widths the human's UI can be switched to. */
export type ViewportName = 'fit' | 'desktop' | 'tablet' | 'mobile';

/**
 * Everything the WebMCP tools need from the page.
 *
 * The tools are deliberately thin wrappers over this interface: the app owns
 * the data and the optimistic UI updates, so a tool call an agent makes shows
 * up on screen the same way a human action would.
 */
export interface LihaWebMcpHost {
  getPreview(): Preview | null;
  getShareInfo(): ShareInfo | null;
  getVersions(): Version[];
  getComments(): Comment[];
  isOwner(): boolean;
  addComment(input: AddCommentInput): Promise<Comment>;
  resolveComment(commentId: string): Promise<Comment>;
  createPreviewFromUrl?(input: CreateUrlPreviewInput): Promise<CreatedPreview>;

  /** Files in the version currently on screen. */
  listArtifactFiles(): ArtifactFile[];
  /** Source of one file in the current version, for text formats only. */
  readArtifactFile(path: string): Promise<ArtifactSource>;

  /**
   * Drives the human's own view. These exist so an agent can work the review
   * rather than only read it — switch to mobile width to check a layout, or
   * point the person at the comment being discussed.
   */
  setViewport(viewport: ViewportName): void;
  focusComment(commentId: string): boolean;

  /** Called after every tool invocation so the UI can surface agent activity. */
  onToolCall?(event: { name: string; ok: boolean; summary: string }): void;
}

export function filterComments(comments: Comment[], filter: CommentFilter): Comment[] {
  if (filter === 'all') return comments;
  return comments.filter((comment) => comment.status === filter);
}
