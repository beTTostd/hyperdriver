export const REPLAY_FRAME_INTERVAL_MS = 480;
export const REPLAY_FINAL_FRAME_HOLD_MS = 720;
export const LONG_REPLAY_THRESHOLD_MS = 30 * 60 * 1000;

export const REPLAY_VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function preferredReplayVideoMimeType(mediaRecorder = globalThis.MediaRecorder) {
  if (!mediaRecorder || typeof mediaRecorder.isTypeSupported !== "function") return "";
  return REPLAY_VIDEO_MIME_TYPES.find((mimeType) => {
    try {
      return mediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  }) ?? "";
}

export function estimateReplayRecordingDurationMs(frameCount) {
  const safeFrameCount = Number.isFinite(frameCount) ? Math.max(0, Math.floor(frameCount)) : 0;
  if (!safeFrameCount) return 0;
  return Math.max(0, safeFrameCount - 1) * REPLAY_FRAME_INTERVAL_MS + REPLAY_FINAL_FRAME_HOLD_MS;
}

export function needsLongReplayConfirmation(frameCount) {
  return estimateReplayRecordingDurationMs(frameCount) > LONG_REPLAY_THRESHOLD_MS;
}

export function sanitizeReplayVideoIdentifier(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "replay";
}

export function replayVideoFilename(matchId, date = new Date()) {
  const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date(0);
  const timestamp = safeDate.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
  return `hyperdriver-replay-${sanitizeReplayVideoIdentifier(matchId)}-${timestamp}.webm`;
}

export function replayCaptureErrorMessage(reason) {
  if (reason && ["AbortError", "NotAllowedError"].includes(reason.name)) {
    return "A captura da aba foi cancelada. Nenhum vídeo foi gravado.";
  }
  return reason instanceof Error && reason.message
    ? `Não foi possível iniciar a gravação: ${reason.message}`
    : "Não foi possível iniciar a gravação da aba.";
}
