import type { ReplayCard, ReplayDocument, ReplayFrame } from "./replays";

export type TelemetryCycle = {
  key: string;
  turn: string;
  partial: "initial" | "final" | null;
  receivedDamage: number;
  equipmentBlocked: number;
  cardBlocked: number;
  offeredDamage: number;
  lifeGained: number;
};

type DamageKind = "equipment" | "card";
type DefenseEvent = { kind: DamageKind; amount: number };
type TurnSegment = Omit<TelemetryCycle, "key" | "partial"> & { player: "1" | "2" };
type ActiveAttack = {
  identity: string;
  turnKey: string;
  player: "1" | "2";
  power: number;
  defense: number;
  previousDefense: number;
  previousReactions: string[];
  defenseEvents: DefenseEvent[];
};

function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function health(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function playerNumber(frame: ReplayFrame): "1" | "2" {
  return String(frame.payload.turnPlayer) === "2" ? "2" : "1";
}

function turnKey(frame: ReplayFrame) {
  return `${String(frame.payload.turnNo ?? "?")}-${playerNumber(frame)}`;
}

function cardNumber(card: ReplayCard | undefined) {
  return typeof card?.cardNumber === "string" ? card.cardNumber : "";
}

function visibleCardNumber(card: ReplayCard | undefined) {
  const value = cardNumber(card);
  return value && value !== "CardBack" && value !== "NONE00" ? value : "";
}

function payloadSignature(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(payloadSignature).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${payloadSignature(entry)}`)
      .join(",")}}`;
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

function canonicalFrames(frames: ReplayFrame[]) {
  const canonical: ReplayFrame[] = [];
  const signatures: string[] = [];
  const positions = new Map<string, number>();

  for (const frame of frames) {
    const signature = payloadSignature(frame.payload);
    const previousIndex = positions.get(signature);
    if (previousIndex !== undefined) {
      for (const removed of signatures.splice(previousIndex + 1)) {
        positions.delete(removed);
      }
      canonical.splice(previousIndex + 1);
      continue;
    }

    positions.set(signature, canonical.length);
    signatures.push(signature);
    canonical.push(frame);
  }

  return canonical;
}

function equipmentCardNumbers(frames: ReplayFrame[]) {
  const cards = new Set<string>();
  for (const frame of frames) {
    for (const card of frame.payload.playerEquipment ?? []) {
      const value = visibleCardNumber(card);
      if (value && card.slot !== "Hero") cards.add(value);
    }
  }
  return cards;
}

function trimDefenseEvents(events: DefenseEvent[], decrease: number) {
  let remaining = decrease;
  for (let index = events.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const event = events[index];
    const removed = Math.min(event.amount, remaining);
    event.amount -= removed;
    remaining -= removed;
    if (event.amount === 0) events.splice(index, 1);
  }
}

function blockedDamage(events: DefenseEvent[], power: number, defense: number) {
  const classified = events.reduce((total, event) => total + event.amount, 0);
  if (classified < defense) events.push({ kind: "card", amount: defense - classified });
  if (classified > defense) trimDefenseEvents(events, classified - defense);

  let remaining = Math.min(power, defense);
  let equipmentBlocked = 0;
  let cardBlocked = 0;
  for (const event of events) {
    const blocked = Math.min(event.amount, remaining);
    if (event.kind === "equipment") equipmentBlocked += blocked;
    else cardBlocked += blocked;
    remaining -= blocked;
    if (remaining === 0) break;
  }
  return { equipmentBlocked, cardBlocked };
}

function emptySegment(frame: ReplayFrame): TurnSegment {
  return {
    turn: String(frame.payload.turnNo ?? "?"),
    player: playerNumber(frame),
    receivedDamage: 0,
    equipmentBlocked: 0,
    cardBlocked: 0,
    offeredDamage: 0,
    lifeGained: 0,
  };
}

function emptyCycle(turn: string, partial: TelemetryCycle["partial"]): TelemetryCycle {
  return {
    key: "",
    turn,
    partial,
    receivedDamage: 0,
    equipmentBlocked: 0,
    cardBlocked: 0,
    offeredDamage: 0,
    lifeGained: 0,
  };
}

function mergeSegment(cycle: TelemetryCycle, segment: TurnSegment) {
  cycle.receivedDamage += segment.receivedDamage;
  cycle.equipmentBlocked += segment.equipmentBlocked;
  cycle.cardBlocked += segment.cardBlocked;
  cycle.offeredDamage += segment.offeredDamage;
  cycle.lifeGained += segment.lifeGained;
}

export function calculateReplayTelemetry(document: ReplayDocument): TelemetryCycle[] {
  const frames = canonicalFrames(document.match.frames);
  const segments: TurnSegment[] = [];
  const segmentByKey = new Map<string, TurnSegment>();
  const playerEquipment = equipmentCardNumbers(frames);
  let active: ActiveAttack | null = null;
  let previousPlayerHealth: number | null = null;

  const commitAttack = () => {
    if (!active) return;
    const segment = segmentByKey.get(active.turnKey)!;
    if (active.player === "1") {
      segment.offeredDamage += active.power;
    } else {
      segment.receivedDamage += Math.max(0, active.power - active.defense);
      const blocked = blockedDamage(active.defenseEvents, active.power, active.defense);
      segment.equipmentBlocked += blocked.equipmentBlocked;
      segment.cardBlocked += blocked.cardBlocked;
    }
    active = null;
  };

  for (const frame of frames) {
    const key = turnKey(frame);
    if (!segmentByKey.has(key)) {
      const segment = emptySegment(frame);
      segments.push(segment);
      segmentByKey.set(key, segment);
    }

    const currentPlayerHealth = health(frame.payload.playerHealth);
    if (currentPlayerHealth !== null) {
      if (previousPlayerHealth !== null && currentPlayerHealth > previousPlayerHealth) {
        segmentByKey.get(key)!.lifeGained += currentPlayerHealth - previousPlayerHealth;
      }
      previousPlayerHealth = currentPlayerHealth;
    }

    const chain = frame.payload.activeChainLink;
    const attackingCard = visibleCardNumber(chain?.attackingCard);
    if (!attackingCard) {
      commitAttack();
      continue;
    }

    const player = String(chain?.attackingCard?.controller ?? playerNumber(frame)) === "2" ? "2" : "1";
    const identity = `${key}-${player}-${attackingCard}`;
    if (active && active.identity !== identity) commitAttack();
    if (!active) {
      active = {
        identity,
        turnKey: key,
        player,
        power: 0,
        defense: 0,
        previousDefense: 0,
        previousReactions: [],
        defenseEvents: [],
      };
    }

    const defense = amount(chain?.totalDefense);
    const reactions = chain?.reactions ?? [];
    const reactionNumbers = reactions.map((card) => cardNumber(card));
    const defenseChange = defense - active.previousDefense;
    if (defenseChange > 0) {
      const newlyVisible = reactions
        .map((card, index) => ({
          current: visibleCardNumber(card),
          previous: active?.previousReactions[index] ?? "",
        }))
        .filter(({ current, previous }) => current && current !== previous)
        .map(({ current }) => current);
      const equipmentOnly = newlyVisible.length > 0
        && newlyVisible.every((value) => playerEquipment.has(value));
      active.defenseEvents.push({
        kind: equipmentOnly ? "equipment" : "card",
        amount: defenseChange,
      });
    } else if (defenseChange < 0) {
      trimDefenseEvents(active.defenseEvents, -defenseChange);
    }

    active.power = amount(chain?.totalPower);
    active.defense = defense;
    active.previousDefense = defense;
    active.previousReactions = reactionNumbers;
  }
  commitAttack();

  const cycles: TelemetryCycle[] = [];
  let cycle: TelemetryCycle | null = null;
  const commitCycle = () => {
    if (!cycle) return;
    cycle.key = `${cycle.turn}-${cycles.length}`;
    cycles.push(cycle);
    cycle = null;
  };

  for (const segment of segments) {
    if (segment.player === "2") {
      if (cycle) commitCycle();
      cycle = emptyCycle(segment.turn, "final");
      mergeSegment(cycle, segment);
      continue;
    }
    if (!cycle) cycle = emptyCycle(segment.turn, "initial");
    cycle.turn = segment.turn;
    mergeSegment(cycle, segment);
    if (cycle.partial === "final") cycle.partial = null;
    commitCycle();
  }
  commitCycle();
  return cycles;
}
