/** Queue a single recovery pass per evaluator version after database migrations. */
export function recoverOutdatedAnalyses(database, modelVersionId, now = Date.now()) {
  const key = `decision_analysis_recovery:${modelVersionId}`;
  return database.transaction(() => {
    if (database.prepare("SELECT 1 FROM maintenance_state WHERE key = ?").get(key)) return 0;

    const candidates = database.prepare(`
      SELECT a.replay_id
      FROM replay_analyses a
      JOIN replays r ON r.id = a.replay_id
      LEFT JOIN analysis_jobs j ON j.replay_id = a.replay_id
      WHERE r.participation <> 'watched'
        AND (j.status IS NULL OR j.status IN ('ready', 'failed'))
        AND (
          (a.status IN ('ready', 'insufficient_data') AND a.model_version_id IS NOT ?)
          OR (a.status = 'failed' AND j.last_error = 'no such column: decision_observations.model_version_id')
        )
    `).all(modelVersionId);
    const queue = database.prepare(`
      INSERT INTO analysis_jobs (replay_id, status, attempts, available_at, created_at, updated_at)
      VALUES (?, 'pending', 0, ?, ?, ?)
      ON CONFLICT(replay_id) DO UPDATE SET
        status = 'pending', attempts = 0, available_at = excluded.available_at,
        lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
        updated_at = excluded.updated_at, completed_at = NULL
    `);
    const markPending = database.prepare(`
      UPDATE replay_analyses SET status = 'pending', error_code = NULL, queued_at = ?, updated_at = ?
      WHERE replay_id = ?
    `);
    for (const { replay_id: replayId } of candidates) {
      queue.run(replayId, now, now, now);
      markPending.run(now, now, replayId);
    }
    database.prepare("INSERT INTO maintenance_state (key, value, updated_at) VALUES (?, 'complete', ?)").run(key, now);
    return candidates.length;
  }).immediate();
}
