import type { ReplayDocument, ReplayFrame } from "./replays";

export type TurnTelemetry = {
  key: string;
  turn: string;
  player: "Você" | "Oponente";
  attack: number;
  defense: number;
  value: number;
};

function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function turnKey(frame: ReplayFrame) {
  return `${String(frame.payload.turnNo ?? "?")}-${String(frame.payload.turnPlayer ?? "?")}`;
}

export function calculateReplayTelemetry(document: ReplayDocument): TurnTelemetry[] {
  const totals = new Map<string, TurnTelemetry>();
  let active: { key: string; turn: string; player: "Você" | "Oponente"; attack: number; defense: number } | null = null;

  const commit = () => {
    if (!active) return;
    const current = totals.get(active.key) ?? {
      key: active.key,
      turn: active.turn,
      player: active.player,
      attack: 0,
      defense: 0,
      value: 0,
    };
    current.attack += active.attack;
    current.defense += active.defense;
    current.value = current.attack + current.defense;
    totals.set(active.key, current);
    active = null;
  };

  for (const frame of document.match.frames) {
    const chain = frame.payload.activeChainLink;
    if (!chain?.attackingCard?.cardNumber) {
      commit();
      continue;
    }
    const key = turnKey(frame);
    if (!active || active.key !== key) {
      commit();
      active = {
        key,
        turn: String(frame.payload.turnNo ?? "?"),
        player: String(frame.payload.turnPlayer) === "1" ? "Você" : "Oponente",
        attack: 0,
        defense: 0,
      };
    }
    active.attack = amount(chain.totalPower);
    active.defense = amount(chain.totalDefense);
  }
  commit();
  return [...totals.values()];
}
