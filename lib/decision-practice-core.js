import { createHash } from "node:crypto";
import { decisionCardProfile } from "./decision-card-catalog.js";

export const DECISION_PRACTICE_VERSION = "verified-line-practice-1.0.0";
const kindLabels = { action: "Sequências de ataque", defense: "Bloqueio e mão preservada", pitch: "Uso de recursos", arsenal: "Plano de arsenal" };
const label = (action) => {
  const members = action.members ?? [action];
  return members.map((member) => `${member.label}${/_red$/.test(member.identifier) ? " (vermelho)" : /_yellow$/.test(member.identifier) ? " (amarelo)" : /_blue$/.test(member.identifier) ? " (azul)" : ""}`).join(" + ");
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Only fully enumerated, captured baseline lines become exercises. The hidden
// information experiment and observed outcome never supply an answer key.
export function buildPracticeExercises(rows, modelVersionId) {
  const seenObservations = new Set();
  const eligible = rows.filter(({ observation, analysis }) => observation?.dataQuality === "captured"
    && kindLabels[observation.kind] && analysis?.scoreUnit === "heuristic_points"
    && analysis.confidence !== "low" && analysis.coverage?.supported && analysis.search?.complete
    && !analysis.search.budgetExhausted && analysis.horizon !== "current_decision"
    && analysis.candidateSequences?.length >= 2 && analysis.candidateSequences.length <= 32
    && analysis.candidateSequences.every((candidate) => Number.isFinite(candidate.score) && candidate.sequence?.length)
    && analysis.candidateSequences.every((candidate) => observation.legalActions.some((action) => action.key === candidate.actionKey)))
    .filter((row) => {
      const key = JSON.stringify([row.replayId, row.observation.handFingerprint, row.observation.kind]);
      if (seenObservations.has(key)) return false;
      seenObservations.add(key); return true;
    });
  const groups = new Map();
  for (const row of eligible) {
    const kind = row.observation.kind;
    const group = groups.get(kind) ?? { opportunities: 0, occurrences: 0, matches: new Set() };
    group.opportunities += 1;
    if (row.analysis.regretScore > 1.5) { group.occurrences += 1; group.matches.add(row.replayId); }
    groups.set(kind, group);
  }
  const seenHands = new Set();
  const exercises = [];
  for (const row of [...eligible].sort((a, b) => groups.get(b.observation.kind).matches.size - groups.get(a.observation.kind).matches.size
    || b.analysis.regretScore - a.analysis.regretScore || b.startedAt - a.startedAt)) {
    if (row.analysis.regretScore <= 1.5) continue;
    const groupKey = JSON.stringify([row.replayId, row.observation.handFingerprint]);
    if (seenHands.has(groupKey)) continue;
    seenHands.add(groupKey);
    const { observation, analysis } = row;
    const id = hash([DECISION_PRACTICE_VERSION, modelVersionId, row.replayId, observation.stateFingerprint]);
    const group = groups.get(observation.kind);
    const state = observation.state;
    const exercise = {
      id, replayId: row.replayId, sourceMatchId: row.sourceMatchId, title: kindLabels[observation.kind],
      turn: observation.turn, kind: observation.kind, horizon: analysis.horizon,
      recurrence: { occurrences: group.occurrences, opportunities: group.opportunities, distinctMatches: group.matches.size },
      situation: { ownLife: state.own.life, opponentLife: state.opponent.life, resources: state.own.resources,
        actionPoints: state.own.actionPoints, incomingPower: state.chain?.power ?? 0, currentDefense: state.chain?.defense ?? 0,
        hand: state.own.hand.map((card) => ({ identifier: card.identifier, profile: decisionCardProfile(card.identifier) })),
        arsenal: state.own.arsenal.map((card) => ({ identifier: card.identifier, profile: decisionCardProfile(card.identifier) })),
        equipment: state.own.equipment.filter((card) => decisionCardProfile(card.identifier)).map((card) => ({ identifier: card.identifier, unavailable: Boolean(card.unavailable) })) },
      actions: observation.legalActions.filter((action) => analysis.candidateSequences.some((candidate) => candidate.actionKey === action.key))
        .map((action) => ({ key: action.key, label: label(action) })).sort((a, b) => a.key.localeCompare(b.key)),
    };
    exercises.push({ exercise, analysis, modelVersionId });
    if (exercises.length === 12) break;
  }
  return { exercises, evaluatedOpportunities: eligible.length, evaluatedMatches: new Set(eligible.map((row) => row.replayId)).size };
}

export function gradePracticeExercise(item, actionKey) {
  const candidate = item.analysis.candidateSequences.find((line) => line.actionKey === actionKey);
  if (!candidate || !item.exercise.actions.some((action) => action.key === actionKey)) return null;
  const best = [...item.analysis.candidateSequences].sort((a, b) => b.score - a.score || a.actionKey.localeCompare(b.actionKey))[0];
  const gap = Math.round(Math.max(0, best.score - candidate.score) * 100) / 100;
  return { withinTolerance: gap <= 1.5, tolerancePoints: 1.5, scoreGap: gap, scoreUnit: "heuristic_points",
    selected: { label: item.exercise.actions.find((action) => action.key === actionKey).label, ...candidate },
    best: { label: item.exercise.actions.find((action) => action.key === best.actionKey).label, ...best },
    conditions: "Comparação até o fim do turno com cartas e efeitos conhecidos. Reações adversárias, habilidades de herói e próximas compras podem mudar a preferência.",
    explanation: gap <= 1.5 ? "Sua escolha está próxima da linha com maior pontuação neste cenário." : `A outra linha oferece ${gap.toFixed(2)} pontos heurísticos a mais neste cenário. Compare os custos, o poder e as cartas preservadas nas sequências.`,
    strategicallyValidated: false, modelVersionId: item.modelVersionId };
}
