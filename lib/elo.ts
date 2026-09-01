import { getSqlite } from "../db";
import { replayResult } from "../talishar-local-history/replay-state.js";
import {
  calculateEloChange,
  ELO_INITIAL_RATING,
  extractEloCandidate,
} from "./elo-core.js";
import type { ReplayDocument } from "./replays";

type SqliteDatabase = import("better-sqlite3").Database;

type EloIdentity = {
  displayName: string;
  normalizedName: string;
};

type EligibleCandidate = {
  eligible: true;
  gameGuid: string;
  format: string;
  player: EloIdentity;
  opponent: EloIdentity;
  winner: EloIdentity;
  loser: EloIdentity;
};

export type EloRankingEntry = {
  position: number;
  playerId: number;
  nickname: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
};

export type EloConflict = {
  gameGuid: string;
  conflictAt: number;
  reason: string;
};

export type EloAdminData = {
  formats: string[];
  selectedFormat: string | null;
  ranking: EloRankingEntry[];
  conflicts: EloConflict[];
};

export function applyEloUploadInTransaction(
  userId: number,
  sourceMatchId: string,
  document: ReplayDocument,
) {
  return applyEloUpload(getSqlite(), userId, sourceMatchId, document);
}

export function recordEloUpload(
  userId: number,
  sourceMatchId: string,
  document: ReplayDocument,
) {
  const transaction = getSqlite().transaction(() => (
    applyEloUpload(getSqlite(), userId, sourceMatchId, document)
  ));
  return transaction.immediate();
}

export function getEloAdminData(requestedFormat?: string | null): EloAdminData {
  const database = getSqlite();
  const formats = database.prepare(`
    SELECT DISTINCT format
    FROM elo_ratings
    ORDER BY format COLLATE NOCASE ASC
  `).all().map((row) => (row as { format: string }).format);
  const selectedFormat = requestedFormat && formats.includes(requestedFormat)
    ? requestedFormat
    : formats[0] ?? null;
  const ranking = selectedFormat
    ? database.prepare(`
        SELECT p.id AS playerId, p.display_name AS nickname, r.rating,
          r.games, r.wins, r.losses
        FROM elo_ratings r
        INNER JOIN talishar_players p ON p.id = r.player_id
        WHERE r.format = ?
        ORDER BY r.rating DESC, r.wins DESC, r.games DESC,
          p.display_name COLLATE NOCASE ASC, p.id ASC
      `).all(selectedFormat).map((row, index) => ({
        ...(row as Omit<EloRankingEntry, "position">),
        position: index + 1,
      }))
    : [];
  const conflicts = database.prepare(`
    SELECT game_guid AS gameGuid, conflict_at AS conflictAt,
      conflict_reason AS reason
    FROM elo_matches
    WHERE status = 'conflict'
    ORDER BY conflict_at DESC, id DESC
    LIMIT 50
  `).all() as EloConflict[];

  return { formats, selectedFormat, ranking, conflicts };
}

function applyEloUpload(
  database: SqliteDatabase,
  userId: number,
  sourceMatchId: string,
  document: ReplayDocument,
) {
  const extracted = extractEloCandidate(document, replayResult(document.match));
  if (!extracted.eligible) {
    insertReport(database, {
      gameGuid: extracted.gameGuid,
      sourceMatchId,
      userId,
      status: "ignored",
      reason: extracted.reason,
    });
    return { status: "ignored" as const, reason: extracted.reason };
  }

  const candidate = extracted as EligibleCandidate;
  const existing = database.prepare(`
    SELECT m.id, m.format, m.status, m.first_uploader_user_id AS firstUploaderUserId,
      winner.normalized_name AS winnerName, loser.normalized_name AS loserName
    FROM elo_matches m
    INNER JOIN talishar_players winner ON winner.id = m.winner_player_id
    INNER JOIN talishar_players loser ON loser.id = m.loser_player_id
    WHERE m.game_guid = ?
  `).get(candidate.gameGuid) as {
    id: number;
    format: string;
    status: "unconfirmed" | "confirmed" | "conflict";
    firstUploaderUserId: number;
    winnerName: string;
    loserName: string;
  } | undefined;

  if (existing) {
    return reconcileExisting(database, existing, candidate, userId, sourceMatchId);
  }

  const winnerId = upsertPlayer(database, candidate.winner);
  const loserId = upsertPlayer(database, candidate.loser);
  const winnerRating = ensureRating(database, winnerId, candidate.format);
  const loserRating = ensureRating(database, loserId, candidate.format);
  const calculated = calculateEloChange(winnerRating, loserRating);
  const now = Date.now();

  database.prepare(`
    UPDATE elo_ratings
    SET rating = ?, games = games + 1, wins = wins + 1, updated_at = ?
    WHERE player_id = ? AND format = ?
  `).run(calculated.winnerRating, now, winnerId, candidate.format);
  database.prepare(`
    UPDATE elo_ratings
    SET rating = ?, games = games + 1, losses = losses + 1, updated_at = ?
    WHERE player_id = ? AND format = ?
  `).run(calculated.loserRating, now, loserId, candidate.format);
  const match = database.prepare(`
    INSERT INTO elo_matches (
      game_guid, format, winner_player_id, loser_player_id,
      winner_rating_before, loser_rating_before, rating_change,
      first_uploader_user_id, first_source_match_id, scored_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    candidate.gameGuid,
    candidate.format,
    winnerId,
    loserId,
    winnerRating,
    loserRating,
    calculated.change,
    userId,
    sourceMatchId,
    now,
  ) as { id: number };
  insertReport(database, reportFromCandidate(match.id, candidate, userId, sourceMatchId, "applied"));
  return { status: "applied" as const, matchId: match.id };
}

function reconcileExisting(
  database: SqliteDatabase,
  existing: {
    id: number;
    format: string;
    status: "unconfirmed" | "confirmed" | "conflict";
    firstUploaderUserId: number;
    winnerName: string;
    loserName: string;
  },
  candidate: EligibleCandidate,
  userId: number,
  sourceMatchId: string,
) {
  const reasons: string[] = [];
  if (existing.format !== candidate.format) reasons.push("formato divergente");
  const existingParticipants = [existing.winnerName, existing.loserName].sort();
  const reportedParticipants = [candidate.winner.normalizedName, candidate.loser.normalizedName].sort();
  if (existingParticipants.join("\u0000") !== reportedParticipants.join("\u0000")) {
    reasons.push("participantes divergentes");
  } else if (existing.winnerName !== candidate.winner.normalizedName) {
    reasons.push("vencedor divergente");
  }

  if (reasons.length) {
    const reason = `${reasons.join(", ")}.`;
    database.prepare(`
      UPDATE elo_matches
      SET status = 'conflict',
        conflict_reason = COALESCE(conflict_reason, ?),
        conflict_at = COALESCE(conflict_at, ?)
      WHERE id = ?
    `).run(reason, Date.now(), existing.id);
    insertReport(database, reportFromCandidate(
      existing.id,
      candidate,
      userId,
      sourceMatchId,
      "conflict",
      reason,
    ));
    return { status: "conflict" as const, matchId: existing.id, reason };
  }

  upsertPlayer(database, candidate.winner);
  upsertPlayer(database, candidate.loser);
  const distinctAccount = existing.firstUploaderUserId !== userId;
  const status = distinctAccount && existing.status !== "conflict" ? "confirmed" : "duplicate";
  if (status === "confirmed" && existing.status === "unconfirmed") {
    database.prepare(`
      UPDATE elo_matches
      SET status = 'confirmed', confirmed_at = ?
      WHERE id = ?
    `).run(Date.now(), existing.id);
  }
  const reason = existing.status === "conflict" ? "Conflito anterior permanente." : null;
  insertReport(database, reportFromCandidate(
    existing.id,
    candidate,
    userId,
    sourceMatchId,
    status,
    reason,
  ));
  return { status, matchId: existing.id };
}

function upsertPlayer(database: SqliteDatabase, identity: EloIdentity): number {
  const row = database.prepare(`
    INSERT INTO talishar_players (normalized_name, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
    RETURNING id
  `).get(identity.normalizedName, identity.displayName, Date.now(), Date.now()) as { id: number };
  return row.id;
}

function ensureRating(database: SqliteDatabase, playerId: number, format: string): number {
  database.prepare(`
    INSERT INTO elo_ratings (player_id, format, rating)
    VALUES (?, ?, ?)
    ON CONFLICT(player_id, format) DO NOTHING
  `).run(playerId, format, ELO_INITIAL_RATING);
  return (database.prepare(`
    SELECT rating FROM elo_ratings WHERE player_id = ? AND format = ?
  `).get(playerId, format) as { rating: number }).rating;
}

type Report = {
  matchId?: number | null;
  gameGuid?: string | null;
  sourceMatchId: string;
  userId: number;
  status: "applied" | "confirmed" | "duplicate" | "conflict" | "ignored";
  reason?: string | null;
  format?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  winnerName?: string | null;
};

function reportFromCandidate(
  matchId: number,
  candidate: EligibleCandidate,
  userId: number,
  sourceMatchId: string,
  status: Report["status"],
  reason: string | null = null,
): Report {
  return {
    matchId,
    gameGuid: candidate.gameGuid,
    sourceMatchId,
    userId,
    status,
    reason,
    format: candidate.format,
    playerName: candidate.player.displayName,
    opponentName: candidate.opponent.displayName,
    winnerName: candidate.winner.displayName,
  };
}

function insertReport(database: SqliteDatabase, report: Report) {
  database.prepare(`
    INSERT INTO elo_upload_reports (
      elo_match_id, game_guid, source_match_id, uploader_user_id,
      status, reason, format, player_name, opponent_name, winner_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.matchId ?? null,
    report.gameGuid ?? null,
    report.sourceMatchId,
    report.userId,
    report.status,
    report.reason ?? null,
    report.format ?? null,
    report.playerName ?? null,
    report.opponentName ?? null,
    report.winnerName ?? null,
  );
}
