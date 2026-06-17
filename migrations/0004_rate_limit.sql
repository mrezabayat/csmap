-- Fixed-window rate-limit counters, keyed by "<scope>:<client-ip>".
-- Rows are short-lived; reset_at is epoch ms when the current window expires.
CREATE TABLE IF NOT EXISTS rate_limit (
  key      TEXT PRIMARY KEY NOT NULL,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
