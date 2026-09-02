-- Accounts.
--
-- Everything still works without one: an account is minted for a browser the
-- first time it does anything, with no sign-in and nothing asked for. Signing
-- in with Google links that same account rather than making a second one, so
-- the previews and comments already attached to it come along.
--
-- `google_sub` is Google's stable subject id. Email is stored to show it back;
-- it is not the key, because a Google account's email can change.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Sessions. The cookie carries a random token; only its hash is stored, for
-- the same reason owner tokens are only stored hashed.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_account ON sessions (account_id);

-- What an account has to do with a preview: the one it made, and the ones it
-- has taken part in. The owner appears here too, so one query answers "what am
-- I involved in".
CREATE TABLE account_previews (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  preview_id TEXT NOT NULL REFERENCES previews (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (account_id, preview_id)
);
CREATE INDEX idx_account_previews_preview ON account_previews (preview_id);

-- Who owns a preview, and when it was last touched.
--
-- Retention slides on use rather than counting from upload: a review that is
-- still being read must not disappear in the middle of it. `expires_at` stays
-- the one column the sweep reads, recomputed whenever `last_used_at` moves.
ALTER TABLE previews ADD COLUMN account_id TEXT REFERENCES accounts (id);
ALTER TABLE previews ADD COLUMN last_used_at TEXT;

-- A sample is a sample: it keeps its flat 24 hours and does not slide.
ALTER TABLE previews ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;

-- So activity can tell your own comments from everyone else's.
ALTER TABLE comments ADD COLUMN account_id TEXT REFERENCES accounts (id);

CREATE INDEX idx_previews_account ON previews (account_id);
CREATE INDEX idx_comments_account ON comments (account_id);
