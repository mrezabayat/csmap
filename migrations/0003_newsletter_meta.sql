-- Small key/value store for newsletter bookkeeping.
-- Currently holds 'last_digest_at' = epoch ms of the last digest run, used to
-- find topics published/updated since then so the digest never repeats items.
CREATE TABLE IF NOT EXISTS newsletter_meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
