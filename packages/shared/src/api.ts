import { z } from 'zod';
import { CommentTargetSchema } from './annotations.js';
import { LIMITS } from './limits.js';

export const ARTIFACT_KINDS = ['image', 'html', 'pdf', 'url'] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);

export const CommentAuthorKindSchema = z.enum(['human', 'agent']);
export type CommentAuthorKind = z.infer<typeof CommentAuthorKindSchema>;

export const CommentStatusSchema = z.enum(['open', 'resolved']);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

export const CommentFilterSchema = z.enum(['open', 'resolved', 'all']).default('open');
export type CommentFilter = z.infer<typeof CommentFilterSchema>;

export const VersionFileSchema = z.object({
  path: z.string(),
  size: z.number().int().min(0),
  contentType: z.string(),
});
export type VersionFile = z.infer<typeof VersionFileSchema>;

export const VersionManifestSchema = z.object({
  entryPath: z.string(),
  files: z.array(VersionFileSchema),
  totalBytes: z.number().int().min(0),
  /** Present only for `url` previews. */
  sourceUrl: z.string().nullish(),
  frameable: z.boolean().nullish(),
  screenshotPath: z.string().nullish(),
});
export type VersionManifest = z.infer<typeof VersionManifestSchema>;

export const VersionSchema = z.object({
  id: z.string(),
  previewId: z.string(),
  number: z.number().int().min(1),
  label: z.string().nullable(),
  entryPath: z.string(),
  fileCount: z.number().int().min(0),
  byteSize: z.number().int().min(0),
  source: z.string(),
  createdAt: z.string(),
  isCurrent: z.boolean(),
  /** Absolute URL of this version's entry file on the isolated content origin. */
  contentUrl: z.string().nullable(),
});
export type Version = z.infer<typeof VersionSchema>;

export const PreviewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  type: ArtifactKindSchema,
  currentVersionId: z.string().nullable(),
  currentVersionNumber: z.number().int().nullable(),
  versionCount: z.number().int().min(0),
  passwordProtected: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * When this preview is deleted on its own, or `null` to keep it.
   *
   * Only samples get one. The CLI is installed globally and may be talking to
   * an older deployment, so a missing field reads as "kept" rather than an
   * error.
   */
  expiresAt: z.string().nullable().default(null),
  shareUrl: z.string(),
  contentUrl: z.string().nullable(),
  openCommentCount: z.number().int().min(0),
  resolvedCommentCount: z.number().int().min(0),
  manifest: VersionManifestSchema.nullable(),
});
export type Preview = z.infer<typeof PreviewSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  previewId: z.string(),
  versionId: z.string(),
  /** `null` for a top-level comment; the thread root for a reply. */
  parentId: z.string().nullable(),
  /** Replies on this thread. Always 0 on a reply — threads are one level deep. */
  replyCount: z.number().int().min(0),
  versionNumber: z.number().int().nullable(),
  authorName: z.string(),
  /** Whether a person wrote this or an agent did, as declared by the caller. */
  authorKind: CommentAuthorKindSchema,
  body: z.string(),
  target: CommentTargetSchema,
  targetDescription: z.string(),
  status: CommentStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  /** True when the comment was left against an older version than the current one. */
  stale: z.boolean(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CreatePreviewResultSchema = z.object({
  preview: PreviewSchema,
  version: VersionSchema,
  ownerToken: z.string(),
  ownerUrl: z.string(),
});
export type CreatePreviewResult = z.infer<typeof CreatePreviewResultSchema>;

export const CreateCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(LIMITS.maxCommentBodyLength),
  authorName: z.string().trim().min(1).max(LIMITS.maxAuthorNameLength).default('Anonymous'),
  /**
   * Set by the tool layers — WebMCP and the MCP server — so an agent's
   * contribution reads as one. A label the caller supplies, like the name
   * beside it, and shown on that footing.
   */
  authorKind: CommentAuthorKindSchema.default('human'),
  target: CommentTargetSchema.optional(),
  versionId: z.string().optional(),
  /** Reply to this comment instead of starting a new thread. */
  parentId: z.string().optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;

export const UpdatePreviewInputSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.maxTitleLength).optional(),
  /** `null` removes the password; a string sets or replaces it. */
  password: z.string().nullable().optional(),
});
export type UpdatePreviewInput = z.infer<typeof UpdatePreviewInputSchema>;

export const SetCurrentVersionInputSchema = z.object({ versionId: z.string() });

export const CreateUrlPreviewInputSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().max(LIMITS.maxTitleLength).optional(),
  password: z.string().optional(),
});

export const ReviewSummarySchema = z.object({
  preview: PreviewSchema,
  currentVersion: VersionSchema.nullable(),
  versions: z.array(VersionSchema),
  openComments: z.array(CommentSchema),
  counts: z.object({
    open: z.number().int().min(0),
    resolved: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export const ShareInfoSchema = z.object({
  title: z.string(),
  shareUrl: z.string(),
  previewId: z.string(),
  slug: z.string(),
  type: ArtifactKindSchema,
  currentVersionNumber: z.number().int().nullable(),
  versionCount: z.number().int().min(0),
  passwordProtected: z.boolean(),
  openCommentCount: z.number().int().min(0),
  updatedAt: z.string(),
  /** Ready-to-paste one-liner for chat tools. */
  summaryText: z.string(),
});
export type ShareInfo = z.infer<typeof ShareInfoSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'password_required',
  'invalid_password',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'conflict',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
