import { LIMITS } from '@liha-cli/shared';
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
  /** When this preview stops existing, or null if it does not. */
  expires_at: string | null;
  /** The account that made it, if it was made through the app. */
  account_id: string | null;
  /** When it was last read or written; retention counts from here. */
  last_used_at: string | null;
  /** Samples keep a flat 24 hours and do not slide. */
  is_sample: number;
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
  author_kind: string;
  body: string;
  target: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  /** Who left it, when they were signed in to anything — including anonymously. */
  account_id: string | null;
}

export const nowIso = (): string => new Date().toISOString();

export async function insertPreview(db: Database, row: PreviewRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO previews (id, slug, title, type, current_version_id, owner_token_hash,
        password_hash, created_at, updated_at, deleted_at, expires_at,
        account_id, last_used_at, is_sample)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
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
      row.expires_at,
      row.account_id,
      row.last_used_at,
      row.is_sample,
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
      `INSERT INTO comments (id, preview_id, version_id, parent_id, author_name, author_kind,
        body, target, status, created_at, resolved_at, resolved_by, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .bind(
      row.id,
      row.preview_id,
      row.version_id,
      row.parent_id,
      row.author_name,
      row.author_kind,
      row.body,
      row.target,
      row.status,
      row.created_at,
      row.account_id,
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

/**
 * Previews whose time is up.
 *
 * Only ones that were given a time; an upload is somebody's work and has none.
 * Returns rows rather than deleting, because the caller has to clear R2 too and
 * a half-deleted preview is worse than an expired one.
 */
export async function expiredPreviews(db: Database, limit = 100): Promise<PreviewRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM previews
        WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
        ORDER BY expires_at LIMIT ?`,
    )
    .bind(nowIso(), limit)
    .all<PreviewRow>();
  return results;
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

// ------------------------------------------------------------------- push

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  created_at: string;
  last_seen_at: string;
}

/**
 * Records a subscription, or finds the one this browser already has.
 *
 * A browser keeps one subscription per origin and hands back the same endpoint
 * every time, so subscribing to a second preview must not mint a second row —
 * it would mean two pushes for one comment.
 */
export async function upsertPushSubscription(
  db: Database,
  id: string,
  endpoint: string,
): Promise<PushSubscriptionRow> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, endpoint, created_at, last_seen_at)
         VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(id, endpoint, now, now)
    .run();

  const row = await db
    .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .first<PushSubscriptionRow>();
  if (!row) throw new Error('subscription vanished immediately after being written');
  return row;
}

export function findPushSubscription(db: Database, id: string) {
  return db
    .prepare('SELECT * FROM push_subscriptions WHERE id = ?')
    .bind(id)
    .first<PushSubscriptionRow>();
}

export async function deletePushSubscription(db: Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM push_watches WHERE subscription_id = ?').bind(id).run();
  await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id).run();
}

export async function addPushWatch(
  db: Database,
  subscriptionId: string,
  previewId: string,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO push_watches (subscription_id, preview_id, created_at, notified_at)
         VALUES (?, ?, ?, ?)
       ON CONFLICT (subscription_id, preview_id) DO NOTHING`,
    )
    .bind(subscriptionId, previewId, now, now)
    .run();
}

export async function removePushWatch(
  db: Database,
  subscriptionId: string,
  previewId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM push_watches WHERE subscription_id = ? AND preview_id = ?')
    .bind(subscriptionId, previewId)
    .run();
}

/** Every subscription watching this preview. */
export async function watchersOf(db: Database, previewId: string): Promise<PushSubscriptionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.* FROM push_subscriptions s
         JOIN push_watches w ON w.subscription_id = s.id
        WHERE w.preview_id = ?`,
    )
    .bind(previewId)
    .all<PushSubscriptionRow>();
  return results;
}

export interface WatchedPreview {
  preview_id: string;
  created_at: string;
  notified_at: string;
}

export async function watchesOf(db: Database, subscriptionId: string): Promise<WatchedPreview[]> {
  const { results } = await db
    .prepare(
      'SELECT preview_id, created_at, notified_at FROM push_watches WHERE subscription_id = ?',
    )
    .bind(subscriptionId)
    .all<WatchedPreview>();
  return results;
}

export async function markWatchNotified(
  db: Database,
  subscriptionId: string,
  previewId: string,
  at: string,
): Promise<void> {
  await db
    .prepare('UPDATE push_watches SET notified_at = ? WHERE subscription_id = ? AND preview_id = ?')
    .bind(at, subscriptionId, previewId)
    .run();
}

export async function deleteWatchesFor(db: Database, previewId: string): Promise<void> {
  await db.prepare('DELETE FROM push_watches WHERE preview_id = ?').bind(previewId).run();
}

/**
 * Comments left on a preview since a moment.
 *
 * Strictly after, so the mark written when a worker was last told cannot cause
 * the same comment to be announced twice.
 */
export async function listCommentsSince(
  db: Database,
  previewId: string,
  since: string,
): Promise<CommentRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM comments
         WHERE preview_id = ? AND created_at > ?
         ORDER BY created_at`,
    )
    .bind(previewId, since)
    .all<CommentRow>();
  return results;
}

export async function countWatchers(db: Database, previewId: string): Promise<number> {
  const row = await db
    .prepare('SELECT count(*) AS n FROM push_watches WHERE preview_id = ?')
    .bind(previewId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

// --------------------------------------------------------------- accounts

export interface AccountRow {
  id: string;
  google_sub: string | null;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface SessionRow {
  token_hash: string;
  account_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export async function insertAccount(db: Database, row: AccountRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO accounts (id, google_sub, email, display_name, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.google_sub, row.email, row.display_name, row.created_at, row.last_seen_at)
    .run();
}

export function findAccount(db: Database, id: string): Promise<AccountRow | null> {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
}

export function findAccountByGoogleSub(db: Database, sub: string): Promise<AccountRow | null> {
  return db.prepare('SELECT * FROM accounts WHERE google_sub = ?').bind(sub).first<AccountRow>();
}

export async function linkGoogleAccount(
  db: Database,
  id: string,
  profile: { sub: string; email: string | null; name: string | null },
): Promise<void> {
  await db
    .prepare(
      'UPDATE accounts SET google_sub = ?, email = ?, display_name = ?, last_seen_at = ? WHERE id = ?',
    )
    .bind(profile.sub, profile.email, profile.name, nowIso(), id)
    .run();
}

export async function touchAccount(db: Database, id: string): Promise<void> {
  await db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(nowIso(), id).run();
}

export async function insertSession(db: Database, row: SessionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(row.token_hash, row.account_id, row.created_at, row.last_seen_at, row.expires_at)
    .run();
}

export async function findSession(db: Database, tokenHash: string): Promise<SessionRow | null> {
  return db
    .prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, nowIso())
    .first<SessionRow>();
}

export async function touchSession(db: Database, tokenHash: string): Promise<void> {
  const now = nowIso();
  await db
    .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
    .bind(now, new Date(Date.now() + LIMITS.sessionLifetimeMs).toISOString(), tokenHash)
    .run();
}

export async function deleteSession(db: Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/**
 * Moves everything one account holds onto another.
 *
 * Signing in on a second browser must not strand what the first one made, so
 * the anonymous account being signed in from is emptied into the Google one
 * rather than left as a second owner of the same things.
 */
export async function mergeAccounts(db: Database, from: string, into: string): Promise<void> {
  await db
    .prepare('UPDATE previews SET account_id = ? WHERE account_id = ?')
    .bind(into, from)
    .run();
  await db
    .prepare('UPDATE comments SET account_id = ? WHERE account_id = ?')
    .bind(into, from)
    .run();
  // A row for each already exists on the target when both took part in the
  // same preview, so the conflict is expected rather than an error.
  await db
    .prepare(`UPDATE OR IGNORE account_previews SET account_id = ? WHERE account_id = ?`)
    .bind(into, from)
    .run();
  await db.prepare('DELETE FROM account_previews WHERE account_id = ?').bind(from).run();
  await db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(from).run();
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(from).run();
}

/** Records that an account has something to do with a preview. */
export async function recordInvolvement(
  db: Database,
  accountId: string,
  previewId: string,
  role: 'owner' | 'reviewer',
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO account_previews (account_id, preview_id, role, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id, preview_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         role = CASE WHEN account_previews.role = 'owner' THEN 'owner' ELSE excluded.role END`,
    )
    .bind(accountId, previewId, role, now, now)
    .run();
}

export interface InvolvedPreviewRow extends PreviewRow {
  role: string;
  involved_at: string;
}

export async function previewsFor(
  db: Database,
  accountId: string,
  limit = 100,
): Promise<InvolvedPreviewRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, ap.role AS role, ap.last_seen_at AS involved_at
         FROM previews p
         JOIN account_previews ap ON ap.preview_id = p.id
        WHERE ap.account_id = ? AND p.deleted_at IS NULL
        ORDER BY p.updated_at DESC
        LIMIT ?`,
    )
    .bind(accountId, limit)
    .all<InvolvedPreviewRow>();
  return results;
}

export interface ActivityRow extends CommentRow {
  slug: string;
  preview_title: string;
}

/**
 * What has happened on the previews an account takes part in.
 *
 * Its own comments are left out: activity is for what somebody else did.
 */
export async function activityFor(
  db: Database,
  accountId: string,
  limit = 50,
): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, p.slug AS slug, p.title AS preview_title
         FROM comments c
         JOIN account_previews ap ON ap.preview_id = c.preview_id
         JOIN previews p ON p.id = c.preview_id
        WHERE ap.account_id = ?
          AND p.deleted_at IS NULL
          AND (c.account_id IS NULL OR c.account_id != ?)
        ORDER BY c.created_at DESC
        LIMIT ?`,
    )
    .bind(accountId, accountId, limit)
    .all<ActivityRow>();
  return results;
}

export async function setPreviewExpiry(
  db: Database,
  id: string,
  lastUsedAt: string,
  expiresAt: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE previews SET last_used_at = ?, expires_at = ? WHERE id = ?')
    .bind(lastUsedAt, expiresAt, id)
    .run();
}

export async function setPreviewAccount(
  db: Database,
  id: string,
  accountId: string,
): Promise<void> {
  await db
    .prepare('UPDATE previews SET account_id = ? WHERE id = ? AND account_id IS NULL')
    .bind(accountId, id)
    .run();
}
