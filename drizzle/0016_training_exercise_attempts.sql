CREATE TABLE training_exercise_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  replay_id INTEGER NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  exercise_key TEXT NOT NULL,
  model_version_id TEXT NOT NULL REFERENCES analysis_model_versions(id),
  chosen_action_key TEXT NOT NULL,
  within_tolerance INTEGER NOT NULL,
  score_gap REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  helpful INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX training_exercise_user_key_unique ON training_exercise_attempts(user_id, exercise_key);
