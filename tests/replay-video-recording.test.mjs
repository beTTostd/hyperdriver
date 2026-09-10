import assert from "node:assert/strict";
import { test } from "node:test";
import {
  estimateReplayRecordingDurationMs,
  LONG_REPLAY_THRESHOLD_MS,
  needsLongReplayConfirmation,
  preferredReplayVideoMimeType,
  replayCaptureErrorMessage,
  replayVideoFilename,
  REPLAY_FINAL_FRAME_HOLD_MS,
  REPLAY_FRAME_INTERVAL_MS,
  sanitizeReplayVideoIdentifier,
} from "../lib/replay-video-recording.js";

test("prefers VP9 and falls back through VP8 and basic WebM", () => {
  const supporting = (...supported) => ({ isTypeSupported: (value) => supported.includes(value) });
  assert.equal(preferredReplayVideoMimeType(supporting("video/webm;codecs=vp9", "video/webm;codecs=vp8")), "video/webm;codecs=vp9");
  assert.equal(preferredReplayVideoMimeType(supporting("video/webm;codecs=vp8", "video/webm")), "video/webm;codecs=vp8");
  assert.equal(preferredReplayVideoMimeType(supporting("video/webm")), "video/webm");
  assert.equal(preferredReplayVideoMimeType(supporting()), "");
  assert.equal(preferredReplayVideoMimeType(undefined), "");
});

test("sanitizes replay identifiers and creates stable WebM filenames", () => {
  assert.equal(sanitizeReplayVideoIdentifier("  Partida / São Paulo #42  "), "Partida-Sao-Paulo-42");
  assert.equal(sanitizeReplayVideoIdentifier("<>:"), "replay");
  assert.equal(
    replayVideoFilename("match/id", new Date("2026-09-10T12:34:56.789Z")),
    "hyperdriver-replay-match-id-2026-09-10T12-34-56Z.webm",
  );
  assert.match(replayVideoFilename(undefined, new Date("2026-09-10T00:00:00Z")), /^hyperdriver-replay-replay-.+\.webm$/);
});

test("warns only when the estimated replay recording exceeds 30 minutes", () => {
  const frameCountAtThreshold = Math.floor((LONG_REPLAY_THRESHOLD_MS - REPLAY_FINAL_FRAME_HOLD_MS) / REPLAY_FRAME_INTERVAL_MS) + 1;
  assert.equal(estimateReplayRecordingDurationMs(1), REPLAY_FINAL_FRAME_HOLD_MS);
  assert.equal(needsLongReplayConfirmation(frameCountAtThreshold), false);
  assert.equal(needsLongReplayConfirmation(frameCountAtThreshold + 1), true);
});

test("uses a local message for permission cancellation and capture errors", () => {
  assert.match(replayCaptureErrorMessage({ name: "NotAllowedError" }), /cancelada/);
  assert.match(replayCaptureErrorMessage({ name: "AbortError" }), /cancelada/);
  assert.match(replayCaptureErrorMessage(new Error("sem faixa de vídeo")), /sem faixa de vídeo/);
});
