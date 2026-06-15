-- Gamification G4 — checkpoint quizzes, "two-tier" model.
--
-- "Completed" (learning_progress) means "marked read" and is tracked PER PATH:
-- the same topic can be completed as part of several paths. "Mastered" means
-- "passed the topic's quiz" and is a property of the TOPIC ITSELF, independent
-- of any path — so it gets its own table keyed (user_id, topic_id), not a column
-- on the per-path learning_progress row (which would force a path and let mastery
-- desync across paths).
--
-- mastered_at uses earliest-wins on conflict (see /api/mastery): re-passing a
-- quiz never moves the timestamp forward, preserving authentic history and the
-- future anonymous -> signed-in merge.
CREATE TABLE IF NOT EXISTS topic_mastery (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  mastered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, topic_id)
);

CREATE INDEX IF NOT EXISTS topic_mastery_user_idx ON topic_mastery (user_id);
