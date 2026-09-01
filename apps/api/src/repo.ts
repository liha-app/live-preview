import type { Database } from './ports.js';

export interface PreviewRow {
  id: string;
  slug: string;
  title: string;
  type: string;
  current_version_id: string | null;
  owner_token_hash: string;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface VersionRow {
  id: string;
  preview_id: string;
  number: number;
  label: string | null;
  entry_path: string;
  manifest: string;
  file_count: number;
  byte_size: number;
  source: string;
  created_at: string;
}

export interface CommentRow {
  id: string;
  preview_id: string;
  version_id: string;
  parent_id: string | null;
  author_name: string;
  body: string;
  target: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export const nowIso = (): string => new Date().toISOString();

export async function insertPreview(db: Database, row: PreviewRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO previews (id, slug, title, type, current_version_id, owner_token_hash,
        password_hash, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      row.id,
      row.slug,
      row.title,
      row.type,
      row.current_version_id,
      row.owner_token_hash,
      row.password_hash,
      row.created_at,
      row.updated_at,
    )
    .run();
}

export function findPreviewBySlug(db: Database, slug: string): Promise<PreviewRow | null> {
  return db
    .prepare('SELECT * FROM previews WHERE slug = ? AND deleted_at IS NULL')
    .bind(slug)
    .first<PreviewRow>();
}

export function findPreviewById(db: Database, id: string): Promise<PreviewRow | null> {
  return db
    .prepare('SELECT * FROM previews WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<PreviewRow>();
}

export async function updatePreviewFields(
  db: Database,
  id: string,
  fields: Partial<Pick<PreviewRow, 'title' | 'password_hash' | 'current_version_id'>>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(nowIso(), id);
  await db
    .prepare(`UPDATE previews SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function softDeletePreview(db: Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE previews SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(nowIso(), nowIso(), id)
    .run();
}

export async function insertVersion(db: Database, row: VersionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO versions (id, preview_id, number, label, entry_path, manifest,
        file_count, byte_size, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.preview_id,
      row.number,
      row.label,
      row.entry_path,
      row.manifest,
      row.file_count,
      row.byte_size,
      row.source,
      row.created_at,
    )
    .run();
}

export async function nextVersionNumber(db: Database, previewId: string): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(number) AS max_number FROM versions WHERE preview_id = ?')
    .bind(previewId)
    .first<{ max_number: number | null }>();
  return (row?.max_number ?? 0) + 1;
}

/**
 * Bytes held in R2 by every preview that still exists.
 *
 * Deleting a preview removes its objects, so soft-deleted rows are excluded.
 * This runs on writes only, and the versions table stays small for the size of
 * instance the ceiling is meant to protect.
 */
export async function totalStoredBytes(db: Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT SUM(versions.byte_size) AS total FROM versions
         JOIN previews ON previews.id = versions.preview_id
        WHERE previews.deleted_at IS NULL`,
    )
    .first<{ total: number | null }>();
  return Number(row?.total ?? 0);
}

export async function listVersions(db: Database, previewId: string): Promise<VersionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM versions WHERE preview_id = ? ORDER BY number DESC')
    .bind(previewId)
    .all<VersionRow>();
  return results;
}

export function findVersion(db: Database, previewId: string, versionId: string) {
  return db
    .prepare('SELECT * FROM versions WHERE preview_id = ? AND id = ?')
    .bind(previewId, versionId)
    .first<VersionRow>();
}

export function findVersionByNumber(db: Database, previewId: string, number: number) {
  return db
    .prepare('SELECT * FROM versions WHERE preview_id = ? AND number = ?')
    .bind(previewId, number)
    .first<VersionRow>();
}

export async function insertComment(db: Database, row: CommentRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO comments (id, preview_id, version_id, parent_id, author_name, body,
        target, status, created_at, resolved_at, resolved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(
      row.id,
      row.preview_id,
      row.version_id,
      row.parent_id,
      row.author_name,
      row.body,
      row.target,
      row.status,
      row.created_at,
    )
    .run();
}

/**
 * Lists comments as whole threads.
 *
 * The status filter applies to the thread root only: a resolved thread hides
 * with its replies, and an open thread brings its replies along whatever their
 * own status. Results are ordered so each reply directly follows its parent.
 */
export async function listComments(
  db: Database,
  previewId: string,
  filter: 'open' | 'resolved' | 'all',
  versionId?: string,
): Promise<CommentRow[]> {
  const conditions = ['preview_id = ?', 'parent_id IS NULL'];
  const values: unknown[] = [previewId];
  if (filter !== 'all') {
    conditions.push('status = ?');
    values.push(filter);
  }
  if (versionId) {
    conditions.push('version_id = ?');
    values.push(versionId);
  }
  const { results: roots } = await db
    .prepare(`SELECT * FROM comments WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`)
    .bind(...values)
    .all<CommentRow>();
  if (roots.length === 0) return [];

  const { results: replies } = await db
    .prepare(
      'SELECT * FROM comments WHERE preview_id = ? AND parent_id IS NOT NULL ORDER BY created_at ASC',
    )
    .bind(previewId)
    .all<CommentRow>();

  const byParent = new Map<string, CommentRow[]>();
  for (const reply of replies) {
    const list = byParent.get(reply.parent_id!) ?? [];
    list.push(reply);
    byParent.set(reply.parent_id!, list);
  }
  return roots.flatMap((root) => [root, ...(byParent.get(root.id) ?? [])]);
}

export async function countReplies(db: Database, previewId: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT parent_id, COUNT(*) AS count FROM comments
       WHERE preview_id = ? AND parent_id IS NOT NULL GROUP BY parent_id`,
    )
    .bind(previewId)
    .all<{ parent_id: string; count: number }>();
  return new Map(results.map((row) => [row.parent_id, Number(row.count)]));
}

export function findComment(db: Database, previewId: string, commentId: string) {
  return db
    .prepare('SELECT * FROM comments WHERE preview_id = ? AND id = ?')
    .bind(previewId, commentId)
    .first<CommentRow>();
}

/** Status belongs to the thread, so replies move with their parent. */
export async function setCommentStatus(
  db: Database,
  commentId: string,
  status: 'open' | 'resolved',
  resolvedBy: string | null,
): Promise<void> {
  await db
    .prepare(
      'UPDATE comments SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? OR parent_id = ?',
    )
    .bind(status, status === 'resolved' ? nowIso() : null, resolvedBy, commentId, commentId)
    .run();
}

/** Counts threads, not messages: a thread with five replies is still one item. */
export async function countComments(
  db: Database,
  previewId: string,
): Promise<{ open: number; resolved: number; total: number }> {
  const { results } = await db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM comments
       WHERE preview_id = ? AND parent_id IS NULL GROUP BY status`,
    )
    .bind(previewId)
    .all<{ status: string; count: number }>();
  const counts = { open: 0, resolved: 0, total: 0 };
  for (const row of results) {
    if (row.status === 'open') counts.open = Number(row.count);
    if (row.status === 'resolved') counts.resolved = Number(row.count);
  }
  counts.total = counts.open + counts.resolved;
  return counts;
}

export async function createReviewSession(
  db: Database,
  row: { id: string; preview_id: string; token_hash: string; expires_at: string },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO review_sessions (id, preview_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(row.id, row.preview_id, row.token_hash, nowIso(), row.expires_at)
    .run();
}

export async function findValidReviewSession(
  db: Database,
  previewId: string,
  tokenHash: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT id FROM review_sessions WHERE preview_id = ? AND token_hash = ? AND expires_at > ?',
    )
    .bind(previewId, tokenHash, nowIso())
    .first<{ id: string }>();
  return row !== null;
}

export async function deleteReviewSessions(db: Database, previewId: string): Promise<void> {
  await db.prepare('DELETE FROM review_sessions WHERE preview_id = ?').bind(previewId).run();
}

export async function recordAuthAttempt(
  db: Database,
  previewId: string,
  clientKey: string,
  success: boolean,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO auth_attempts (preview_id, client_key, created_at, success) VALUES (?, ?, ?, ?)',
    )
    .bind(previewId, clientKey, Date.now(), success ? 1 : 0)
    .run();
}

export async function countRecentFailures(
  db: Database,
  previewId: string,
  clientKey: string,
  windowMs: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM auth_attempts
       WHERE preview_id = ? AND client_key = ? AND success = 0 AND created_at > ?`,
    )
    .bind(previewId, clientKey, Date.now() - windowMs)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** Generic sliding-window limiter for write endpoints open to anyone with the link. */
export async function recordRateEvent(
  db: Database,
  bucket: string,
  clientKey: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO rate_events (bucket, client_key, created_at) VALUES (?, ?, ?)')
    .bind(bucket, clientKey, Date.now())
    .run();
}

export async function countRateEvents(
  db: Database,
  bucket: string,
  clientKey: string,
  windowMs: number,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ? AND client_key = ? AND created_at > ?',
    )
    .bind(bucket, clientKey, Date.now() - windowMs)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** Opportunistic cleanup so the limiter and session tables do not grow forever. */
export async function pruneExpired(db: Database, windowMs: number): Promise<void> {
  await db.prepare('DELETE FROM review_sessions WHERE expires_at < ?').bind(nowIso()).run();
  await db
    .prepare('DELETE FROM auth_attempts WHERE created_at < ?')
    .bind(Date.now() - windowMs * 4)
    .run();
  await db
    .prepare('DELETE FROM rate_events WHERE created_at < ?')
    .bind(Date.now() - windowMs * 4)
    .run();
}
