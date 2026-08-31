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

export function shareUrl(config: ResolvedConfig, slug: string): string {
  return `${config.appOrigin}/p/${slug}`;
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
