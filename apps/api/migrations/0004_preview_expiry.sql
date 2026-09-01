-- When a preview stops existing, for previews that were never meant to last.
--
-- The sample is minted fresh for every visitor who presses "open a sample" —
-- a real preview, with real feedback, that they own. Which is the point, and
-- also means one accumulates per curious visitor, forever, for a thing nobody
-- returns to. A day is long enough to finish looking.
--
-- NULL for everything else. An upload is somebody's work and expires when they
-- delete it.
ALTER TABLE previews ADD COLUMN expires_at TEXT;

CREATE INDEX idx_previews_expiry ON previews (expires_at) WHERE expires_at IS NOT NULL;
