import {
  LIMITS,
  createContentToken,
  type Comment,
  type Preview,
  type ReviewSummary,
  type Version,
} from '@liha-cli/shared';
import { contentBaseUrl } from './content-origin.js';
import type { ResolvedConfig } from './env.js';
import type { Database } from './ports.js';
import {
  countComments,
  countReplies,
  findVersion,
  listComments,
  listVersions,
  type CommentRow,
  type PreviewRow,
  type VersionRow,
} from './repo.js';
import { toComment, toPreview, toVersion } from './serialize.js';

export interface ViewContext {
  db: Database;
  config: ResolvedConfig;
  requestUrl: URL;
  /** True when the caller proved they may see this preview (owner or review session). */
  authorized: boolean;
}

/**
 * Builds the absolute URL an iframe loads for one version.
 *
 * A protected preview gets a short-lived, single-version signed token appended,
 * because an `<iframe src>` cannot carry an Authorization header. The token
 * grants content reads only and is rejected by the JSON API.
 */
async function contentUrlFor(
  ctx: ViewContext,
  preview: PreviewRow,
  version: VersionRow,
): Promise<string> {
  const base =
    contentBaseUrl(ctx.config, preview.slug, Number(version.number), ctx.requestUrl) +
    version.entry_path;
  if (preview.password_hash === null || !ctx.authorized) return base;
  const token = await createContentToken(ctx.config.contentSigningKey, {
    previewId: preview.id,
    versionId: version.id,
    exp: Date.now() + LIMITS.contentTokenTtlMs,
  });
  return `${base}${base.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

export async function versionView(
  ctx: ViewContext,
  preview: PreviewRow,
  version: VersionRow,
): Promise<Version> {
  return {
    ...toVersion(version, preview.current_version_id),
    contentUrl: await contentUrlFor(ctx, preview, version),
  };
}

export async function previewView(ctx: ViewContext, preview: PreviewRow): Promise<Preview> {
  const versions = await listVersions(ctx.db, preview.id);
  const current = preview.current_version_id
    ? (versions.find((v) => v.id === preview.current_version_id) ?? null)
    : null;
  const counts = await countComments(ctx.db, preview.id);

  const view = toPreview(preview, {
    config: ctx.config,
    requestUrl: ctx.requestUrl,
    currentVersion: current,
    versionCount: versions.length,
    counts,
  });
  view.contentUrl = current ? await contentUrlFor(ctx, preview, current) : null;
  return view;
}

export async function versionsView(ctx: ViewContext, preview: PreviewRow): Promise<Version[]> {
  const versions = await listVersions(ctx.db, preview.id);
  return Promise.all(versions.map((version) => versionView(ctx, preview, version)));
}

export async function commentsView(
  ctx: ViewContext,
  preview: PreviewRow,
  rows: CommentRow[],
): Promise<Comment[]> {
  const [versions, replyCounts] = await Promise.all([
    listVersions(ctx.db, preview.id),
    countReplies(ctx.db, preview.id),
  ]);
  const numbers = new Map(versions.map((v) => [v.id, Number(v.number)]));
  return rows.map((row) => toComment(row, numbers, preview.current_version_id, replyCounts));
}

export async function commentView(
  ctx: ViewContext,
  preview: PreviewRow,
  row: CommentRow,
): Promise<Comment> {
  return (await commentsView(ctx, preview, [row]))[0]!;
}

export async function reviewSummaryView(
  ctx: ViewContext,
  preview: PreviewRow,
): Promise<ReviewSummary> {
  const [view, versions, openRows, counts] = await Promise.all([
    previewView(ctx, preview),
    versionsView(ctx, preview),
    listComments(ctx.db, preview.id, 'open'),
    countComments(ctx.db, preview.id),
  ]);
  const currentVersion = versions.find((version) => version.isCurrent) ?? null;
  return {
    preview: view,
    currentVersion,
    versions,
    openComments: await commentsView(ctx, preview, openRows),
    counts,
  };
}

export async function requireVersion(
  db: Database,
  previewId: string,
  versionId: string,
): Promise<VersionRow | null> {
  return findVersion(db, previewId, versionId);
}
