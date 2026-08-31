-- Threaded replies, so feedback can be discussed rather than only recorded.
--
-- Threads are exactly one level deep: a reply always points at a top-level
-- comment, never at another reply. Status lives on the thread — resolving a
-- parent resolves its replies with it.
ALTER TABLE comments ADD COLUMN parent_id TEXT;

CREATE INDEX idx_comments_parent ON comments (parent_id);

-- Generic sliding-window counter for write endpoints that are open to anyone
-- holding a share link (comments, replies).
CREATE TABLE rate_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket     TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_rate_events_window ON rate_events (bucket, client_key, created_at);
