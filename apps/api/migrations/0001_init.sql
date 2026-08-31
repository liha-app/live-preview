-- Liha Live Preview: initial schema.

CREATE TABLE previews (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('image', 'html', 'pdf', 'url')),
  current_version_id TEXT,
  -- Only ever a SHA-256 digest; the token itself is shown once at creation.
  owner_token_hash   TEXT NOT NULL,
  -- Encoded PBKDF2 record (algorithm$iterations$salt$hash), NULL when public.
  password_hash      TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);

CREATE INDEX idx_previews_owner ON previews (owner_token_hash);

CREATE TABLE versions (
  id          TEXT PRIMARY KEY,
  preview_id  TEXT NOT NULL,
  number      INTEGER NOT NULL,
  label       TEXT,
  entry_path  TEXT NOT NULL,
  manifest    TEXT NOT NULL,
  file_count  INTEGER NOT NULL DEFAULT 0,
  byte_size   INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'api',
  created_at  TEXT NOT NULL,
  UNIQUE (preview_id, number)
);

CREATE INDEX idx_versions_preview ON versions (preview_id, number DESC);

CREATE TABLE comments (
  id           TEXT PRIMARY KEY,
  preview_id   TEXT NOT NULL,
  -- The version the reviewer was actually looking at; never rewritten.
  version_id   TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  -- Serialized CommentTarget: annotation, page, path, DOM context, viewport.
  target       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  TEXT
);

CREATE INDEX idx_comments_preview ON comments (preview_id, status, created_at);
CREATE INDEX idx_comments_version ON comments (version_id);

-- Short-lived proof that a reviewer entered the correct password.
CREATE TABLE review_sessions (
  id         TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_review_sessions_expiry ON review_sessions (expires_at);

-- Sliding-window counter behind the password brute-force limiter.
CREATE TABLE auth_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  preview_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  success    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_auth_attempts_window ON auth_attempts (preview_id, client_key, created_at);
