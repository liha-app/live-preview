-- A retried tool call must not leave two comments.
--
-- An agent that calls `add_comment` twice — a dropped response, a model that
-- repeats itself — used to post the comment twice, and the reviewer had to
-- clean up after it. The key is derived from the call's own content by the
-- tool layer, so a retry of the same call carries the same key and collapses
-- into the first comment.
--
-- Nullable, and unique only where present: the web app sends no key, because a
-- person typing the same sentence twice means it. This is the one place the
-- product treats an agent and a human differently on purpose.
ALTER TABLE comments ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX idx_comments_idempotency
  ON comments (preview_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
