// Only observations on the canonical replay path enter this ledger. Counts are
// lower bounds on physical copies, never a sum of repeated sightings.
export function createOpponentKnowledge() {
  return { format: null, lowerBoundCounts: Object.create(null), previousPitch: {}, pitchHistory: [], previousTurn: null };
}

const count = (cards) => cards.reduce((counts, card) => {
  if (card?.identifier) counts[card.identifier] = (counts[card.identifier] ?? 0) + 1;
  return counts;
}, Object.create(null));

export function observeOpponentKnowledge(ledger, state, payload) {
  const format = payload.initialLoad?.gameFormat;
  if (typeof format === "string") ledger.format = format.toLowerCase().slice(0, 32);
  const zones = state.publicZones;
  const outside = [...zones.opponentDiscard, ...zones.opponentPitch, ...zones.opponentBanish];
  const visibleArsenal = (Array.isArray(payload.opponentArse) ? payload.opponentArse : [])
    .filter((card) => card.facing?.toUpperCase() !== "DOWN" && card.cardNumber && !["CardBack", "NONE00", "blank"].includes(card.cardNumber))
    .map((card) => ({ identifier: card.cardNumber }));
  const visibleCounts = count([...outside, ...visibleArsenal]);
  // A chain card may also be present in a displayed zone. Without a physical ID,
  // a separate sighting establishes at least one copy, not one extra copy.
  const chain = state.chain?.controller === String(payload.otherPlayer) ? state.chain.attacker : null;
  const simultaneous = { ...visibleCounts };
  if (chain) simultaneous[chain] = Math.max(1, simultaneous[chain] ?? 0);
  for (const [identifier, copies] of Object.entries(simultaneous)) {
    ledger.lowerBoundCounts[identifier] = Math.max(copies, ledger.lowerBoundCounts[identifier] ?? 0);
  }
  const pitch = count(zones.opponentPitch);
  const returned = Object.entries(ledger.previousPitch).map(([identifier, copies]) => ({
    identifier, count: Math.max(0, copies - (pitch[identifier] ?? 0)),
  })).filter((card) => card.count);
  if (returned.length) ledger.pitchHistory.push({
    observedAtFrame: state.frameSequence, turn: ledger.previousTurn, cards: returned,
    destination: "not_reconstructed", orderKnown: false,
  });
  ledger.pitchHistory = ledger.pitchHistory.slice(-64);
  ledger.previousPitch = pitch;
  ledger.previousTurn = state.turn;
  return structuredClone({
    format: ledger.format, lowerBoundCounts: ledger.lowerBoundCounts,
    outsideHiddenZones: count(outside), visibleArsenal: visibleArsenal.map((card) => card.identifier),
    currentPitch: pitch, returnedPitchHistory: ledger.pitchHistory,
    unknownPublicCards: (Array.isArray(payload.opponentBanish) ? payload.opponentBanish : [])
      .filter((card) => card.facing?.toUpperCase() === "DOWN" || ["CardBack", "NONE00", "blank"].includes(card.cardNumber)).length,
    copyIdentity: "simultaneous_lower_bounds", pitchOrderKnown: false,
  });
}
