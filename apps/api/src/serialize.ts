import {
  VersionManifestSchema,
  describeTarget,
  deserializeTarget,
  type Comment,
  type Preview,
  type ShareInfo,
  type Version,
  type VersionManifest,
} from '@liha/shared';
import type { ResolvedConfig } from './env.js';
import { contentBaseUrl } from './content-origin.js';
import type { CommentRow, PreviewRow, VersionRow } from './repo.js';

export function parseManifest(raw: string): VersionManifest {
  const parsed = VersionManifestSchema.safeParse(JSON.parse(raw));
  if (parsed.success) return parsed.data;
  return { entryPath: 'index.html', files: [], totalBytes: 0 };
}

/**
 * The link a reviewer is sent.
 *
 * With a review template each preview gets its own hostname, so the link is the
 * whole origin and any path under it belongs to that preview. Without one it
 * stays a path on the app.
 */
export function shareUrl(config: ResolvedConfig, slug: string): string {
  if (config.reviewOriginTemplate) {
    return config.reviewOriginTemplate.replace('{slug}', slug);
  }
  return `${config.appOrigin}/p/${slug}`;
}

/**
 * The link that makes whoever opens it the owner.
 *
 * Built from the share URL, not the app, because the token it carries is kept
 * in `localStorage` — which is scoped to an origin. Pointing this somewhere
 * other than where the preview lives would leave the token on one origin and
 * the preview on another, and its own creator would not be its owner.
 */
export function ownerUrl(config: ResolvedConfig, slug: string, token: string): string {
  return `${shareUrl(config, slug)}#owner=${token}`;
}

export function toVersion(
  row: VersionRow,
  currentVersionId: string | null,
): Omit<Version, 'contentUrl'> {
  return {
    id: row.id,
    previewId: row.preview_id,
    number: Number(row.number),
    label: row.label,
    entryPath: row.entry_path,
    fileCount: Number(row.file_count),
    byteSize: Number(row.byte_size),
    source: row.source,
    createdAt: row.created_at,
    isCurrent: row.id === currentVersionId,
  };
}

export interface PreviewViewOptions {
  config: ResolvedConfig;
  requestUrl: URL;
  currentVersion: VersionRow | null;
  versionCount: number;
  counts: { open: number; resolved: number };
}

export function toPreview(row: PreviewRow, options: PreviewViewOptions): Preview {
  const { config, requestUrl, currentVersion } = options;
  const manifest = currentVersion ? parseManifest(currentVersion.manifest) : null;
  const contentUrl = currentVersion
    ? contentBaseUrl(config, row.slug, Number(currentVersion.number), requestUrl) +
      currentVersion.entry_path
    : null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type as Preview['type'],
    currentVersionId: row.current_version_id,
    currentVersionNumber: currentVersion ? Number(currentVersion.number) : null,
    versionCount: options.versionCount,
    passwordProtected: row.password_hash !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    shareUrl: shareUrl(config, row.slug),
    contentUrl,
    openCommentCount: options.counts.open,
    resolvedCommentCount: options.counts.resolved,
    manifest,
  };
}

export function toComment(
  row: CommentRow,
  versionNumbers: Map<string, number>,
  currentVersionId: string | null,
  replyCounts?: Map<string, number>,
): Comment {
  const target = deserializeTarget(row.target);
  return {
    id: row.id,
    previewId: row.preview_id,
    versionId: row.version_id,
    parentId: row.parent_id ?? null,
    replyCount: row.parent_id ? 0 : (replyCounts?.get(row.id) ?? 0),
    versionNumber: versionNumbers.get(row.version_id) ?? null,
    authorName: row.author_name,
    authorKind: row.author_kind === 'agent' ? 'agent' : 'human',
    body: row.body,
    target,
    targetDescription: describeTarget(target),
    status: row.status as Comment['status'],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    stale: currentVersionId !== null && row.version_id !== currentVersionId,
  };
}

export function toShareInfo(preview: Preview): ShareInfo {
  const version =
    preview.currentVersionNumber !== null ? `v${preview.currentVersionNumber}` : 'no version';
  const open = preview.openCommentCount;
  const summaryText =
    `${preview.title} — ${version} · ${open} open comment${open === 1 ? '' : 's'}` +
    `${preview.passwordProtected ? ' · password protected' : ''}\n${preview.shareUrl}`;

  return {
    title: preview.title,
    shareUrl: preview.shareUrl,
    previewId: preview.id,
    slug: preview.slug,
    type: preview.type,
    currentVersionNumber: preview.currentVersionNumber,
    versionCount: preview.versionCount,
    passwordProtected: preview.passwordProtected,
    openCommentCount: preview.openCommentCount,
    updatedAt: preview.updatedAt,
    summaryText,
  };
}
