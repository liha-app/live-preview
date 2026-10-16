-- Password changes revoke delegated access in the same write as the new policy.
ALTER TABLE previews ADD COLUMN access_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE review_sessions ADD COLUMN access_generation INTEGER NOT NULL DEFAULT -1;
ALTER TABLE push_watches ADD COLUMN access_generation INTEGER NOT NULL DEFAULT -1;

-- Keep policy changes made by the compatibility API atomic with revocation.
-- The final API already increments the generation in its UPDATE, so do not
-- increment it a second time. Install this before migrating public watches.
CREATE TRIGGER previews_password_access_generation
AFTER UPDATE OF password_hash ON previews
WHEN NEW.access_generation = OLD.access_generation
BEGIN
  UPDATE previews SET access_generation = OLD.access_generation + 1 WHERE id = NEW.id;
END;

-- Public watches can keep working. Older protected watches and review sessions
-- have no proof of the current password and must be authorized again.
UPDATE push_watches SET access_generation = 0
WHERE preview_id IN (SELECT id FROM previews WHERE password_hash IS NULL);
