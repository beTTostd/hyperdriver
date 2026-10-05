// Audited printed properties and the exact effects implemented by the turn engine.
export const DECISION_CARD_CATALOG_VERSION = "audited-turn-effects-2026-09-30-v2";

const vanilla = {
  wounding_blow_red: [0, 4, 3, 1, "https://cards.fabtcg.com/card/wounding-blow-1/MST215/"],
  wounding_blow_blue: [0, 2, 3, 3, "https://cards.fabtcg.com/card/wounding-blow-3/"],
  critical_strike_red: [1, 5, 3, 1, "https://cards.fabtcg.com/card/critical-strike-1/DRO023/"],
  brutal_assault_yellow: [2, 5, 3, 2, "https://cards.fabtcg.com/card/brutal-assault-2/"],
};

const effects = {
  nimblism_red: { cost: 0, attack: 0, defense: 2, pitch: 1, type: "action", goAgain: true, effects: [{ kind: "next_attack_bonus", maxCost: 1, amount: 3 }], source: "https://cards.fabtcg.com/card/nimblism-1/MST221/" },
  nimblism_yellow: { cost: 0, attack: 0, defense: 2, pitch: 2, type: "action", goAgain: true, effects: [{ kind: "next_attack_bonus", maxCost: 1, amount: 2 }], source: "https://cards.fabtcg.com/card/nimblism-2/MST222/" },
  nimblism_blue: { cost: 0, attack: 0, defense: 2, pitch: 3, type: "action", goAgain: true, effects: [{ kind: "next_attack_bonus", maxCost: 1, amount: 1 }], source: "https://cards.fabtcg.com/card/nimblism-3/MST223/" },
  goliath_gauntlet: { cost: 0, attack: 0, defense: 0, pitch: 0, type: "equipment", goAgain: true, destroyOnActivate: true, effects: [{ kind: "next_attack_bonus", minCost: 2, amount: 2 }], source: "https://cards.fabtcg.com/card/goliath-gauntlet/1HD005/" },
  quick_clicks: { cost: 0, attack: 0, defense: 0, pitch: 0, type: "equipment", goAgain: true, destroyOnActivate: true, requires: "played_nimblism", effects: [{ kind: "next_attack_go_again" }], source: "https://cards.fabtcg.com/card/quick-clicks/FR_SEA186/" },
};

export function decisionCardProfile(identifier) {
  if (Object.hasOwn(effects, identifier)) return structuredClone(effects[identifier]);
  const entry = Object.hasOwn(vanilla, identifier) ? vanilla[identifier] : null;
  if (!entry) return null;
  const [cost, attack, defense, pitch, source] = entry;
  return { cost, attack, defense, pitch, type: "attack_action", effects: [], goAgain: false, source };
}
