export function findFirstByKey(value, keys, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstByKey(item, keys, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase()) && (typeof item === "string" || typeof item === "number" || typeof item === "boolean")) return item;
    const found = findFirstByKey(item, keys, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function indicators(payload) {
  return {
    turn: findFirstByKey(payload, ["turn", "turnno", "turnnumber", "currentturn"]),
    activePlayer: findFirstByKey(payload, ["activeplayer", "currentplayer", "playerturn"]),
    gameOver: findFirstByKey(payload, ["gameover", "gameended", "matchended"]),
    winner: findFirstByKey(payload, ["winner", "winningplayer"]),
    phase: findFirstByKey(payload, ["turnphase"])
  };
}

export function isFinished(indicator) {
  return indicator.gameOver === true || indicator.gameOver === "true" || indicator.gameOver === 1 || indicator.phase === "OVER";
}

export function isCompleteMatch(match) {
  if (match.status === "finished") return true;
  return match.frames.some((frame) => isFinished(frame.indicators || indicators(frame.payload)));
}

export function normalizeCompletion(match) {
  if (!isCompleteMatch(match) || match.status === "finished") return match;
  const finalFrame = [...match.frames].reverse().find((frame) => isFinished(frame.indicators || indicators(frame.payload)));
  match.status = "finished";
  match.endedAt = finalFrame?.receivedAt || match.updatedAt;
  match.result = match.summary?.winner ? "finished" : "unknown";
  return match;
}
