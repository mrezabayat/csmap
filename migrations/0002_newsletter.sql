CREATE TABLE IF NOT EXISTS newsletter_subscriber (
  id           TEXT PRIMARY KEY NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  -- pending = signed up but not confirmed; confirmed = double opt-in done;
  -- unsubscribed = opted out (kept for suppression, never emailed again).
  status       TEXT NOT NULL DEFAULT 'pending',
  -- Random secret used for both the confirm and unsubscribe links.
  token        TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  confirmed_at INTEGER,
  -- Where the signup came from, e.g. 'footer', 'topic-page'.
  source       TEXT
);

CREATE INDEX IF NOT EXISTS newsletter_status_idx
ON newsletter_subscriber (status);
