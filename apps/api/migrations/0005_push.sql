-- Push notifications.
--
-- Only the endpoint is stored. Payload encryption (RFC 8291) needs the
-- subscription's p256dh and auth keys; sending an empty push and letting the
-- service worker fetch what changed does not. So those keys are never asked
-- for and never held.
--
-- `id` doubles as the credential the service worker presents to ask what it
-- missed, so it is a random value, not a counter.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Which previews a subscription is watching. `notified_at` is how the service
-- worker's fetch knows what is new rather than what exists.
CREATE TABLE push_watches (
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE,
  preview_id TEXT NOT NULL REFERENCES previews (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, preview_id)
);

CREATE INDEX idx_push_watches_preview ON push_watches (preview_id);
