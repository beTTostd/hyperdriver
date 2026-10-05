-- Existing values retain their original semantics and model version.
ALTER TABLE hand_analyses ADD COLUMN score_unit TEXT NOT NULL DEFAULT 'legacy_win_probability';
CREATE INDEX hand_analyses_unit_model_idx ON hand_analyses(score_unit, model_version_id);
ALTER TABLE training_goals ADD COLUMN model_version_id TEXT REFERENCES analysis_model_versions(id);
-- Freeze historical automatic goals to the source analysis methodology.
UPDATE training_goals SET model_version_id = (
  SELECT model_version_id FROM replay_analyses WHERE replay_id = training_goals.source_replay_id
) WHERE origin = 'analysis_pattern';
-- Keep observations and analyses from previous methodologies during recalculation.
ALTER TABLE decision_observations ADD COLUMN model_version_id TEXT REFERENCES analysis_model_versions(id);
UPDATE decision_observations SET model_version_id = COALESCE(
  (SELECT model_version_id FROM hand_analyses WHERE observation_id = decision_observations.id LIMIT 1),
  (SELECT model_version_id FROM replay_analyses WHERE replay_id = decision_observations.replay_id)
);
DROP INDEX decision_observations_replay_ordinal_unique;
CREATE UNIQUE INDEX decision_observations_replay_ordinal_model_unique ON decision_observations(replay_id, ordinal, model_version_id);
ALTER TABLE training_goals ADD COLUMN metric_version TEXT NOT NULL DEFAULT 'all_decisions_v1';
