"use client";

import Link from "next/link";
import { useState } from "react";
import type { PracticeExercise, PracticeResult } from "../../../lib/decision-practice";
import styles from "../../replays/workspace-panel.module.css";
import practiceStyles from "./training.module.css";

const termLabels: Record<string, string> = { lethal_endpoint: "Dano letal recebido", power_offered: "Poder oferecido", life_preserved: "Vida preservada",
  known_arsenal_potential: "Potencial do arsenal conhecido", cards_consumed: "Cartas consumidas", equipment_spent: "Equipamento gasto", resources_lost_at_end: "Recursos ao encerrar" };

function Exercise({ exercise }: { exercise: PracticeExercise }) {
  const [selection, setSelection] = useState("");
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function send(helpful?: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/training/exercises/${exercise.id}/attempt`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(helpful === undefined ? { actionKey: selection } : { helpful }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      if (helpful === undefined) setResult(data); else setMessage("Feedback salvo.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  const state = exercise.situation;
  return <section className={styles.panel} aria-labelledby={`exercise-${exercise.id}`}>
    <header className={styles.header}><div><p>Turno {exercise.turn ?? "—"} · {exercise.practiced ? "Já praticado" : "Novo exercício"}</p>
      <h2 id={`exercise-${exercise.id}`}>{exercise.title}</h2><p>{exercise.recurrence.occurrences} ocorrências em {exercise.recurrence.opportunities} oportunidades, em {exercise.recurrence.distinctMatches} partidas com oportunidade de melhoria.</p></div></header>
    <p>Vida: você {state.ownLife ?? "—"} / adversário {state.opponentLife ?? "—"}. Recursos {state.resources ?? "—"}; pontos de ação {state.actionPoints ?? "—"}.</p>
    <p>Horizonte: {exercise.kind === "defense" ? "defesa e turno de resposta com a mão conhecida" : "até o fim do turno"}.</p>
    {exercise.kind === "defense" && <p>Poder recebido {state.incomingPower}; defesa atual {state.currentDefense}.</p>}
    <ul className={styles.list}>{state.hand.map((card: { identifier: string; profile: { attack: number; defense: number; pitch: number; cost: number } | null }, index: number) =>
      <li key={`${card.identifier}-${index}`}>{card.identifier.replaceAll("_", " ")}{card.profile && <small>Ataque {card.profile.attack} · defesa {card.profile.defense} · pitch {card.profile.pitch} · custo {card.profile.cost}</small>}</li>)}</ul>
    {state.arsenal.length > 0 && <p>Arsenal: {state.arsenal.map((card: { identifier: string }) => card.identifier.replaceAll("_", " ")).join(", ")}</p>}
    {state.equipment.length > 0 && <p>Equipamentos cobertos: {state.equipment.map((card: { identifier: string; unavailable: boolean }) => `${card.identifier.replaceAll("_", " ")}${card.unavailable ? " (indisponível)" : ""}`).join(", ")}</p>}
    <fieldset className={practiceStyles.choices} disabled={busy}><legend>Qual escolha inicia seu plano?</legend>
      {exercise.actions.map((action: { key: string; label: string }) => <label key={action.key}><input type="radio" name={exercise.id} value={action.key} checked={selection === action.key}
        onChange={() => { setSelection(action.key); setResult(null); }} />{action.label}</label>)}
    </fieldset><div className={styles.actions}><button type="button" disabled={busy || !selection} onClick={() => void send()}>Comparar minha linha</button></div>
    {result && <div className={practiceStyles.result}><h3>{result.withinTolerance ? "Linha próxima da melhor pontuação" : "Compare a alternativa"}</h3>
      <p>{result.explanation}</p>{[result.selected, result.best].map((line, index) => <div key={index}><strong>{index === 0 ? "Sua linha" : "Melhor linha encontrada"}: {line.label} · {line.score.toFixed(2)} pts.</strong>
        <ol>{line.sequence.map((step: { label: string; resourcesBefore?: number; resourcesAfter?: number }, stepIndex: number) => <li key={stepIndex}>{step.label}
          {step.resourcesBefore !== undefined && ` · recursos ${step.resourcesBefore} → ${step.resourcesAfter}`}</li>)}</ol>
        <details><summary>Como a pontuação foi calculada</summary><ul>{line.scoreTrace?.map((term: { term: string; value: number; weight: number; contribution: number }) =>
          <li key={term.term}>{termLabels[term.term] ?? term.term}: {term.value} × {term.weight} = {term.contribution.toFixed(2)} pts.</li>)}</ul></details></div>)}
      <p className={styles.muted}>{result.conditions}</p><div className={styles.actions}><span>O exercício foi útil?</span>
        <button type="button" disabled={busy} onClick={() => void send(true)}>Sim</button><button type="button" disabled={busy} onClick={() => void send(false)}>Não</button>
        <Link href={`/replays/${exercise.sourceMatchId}`}>Rever partida</Link></div></div>}
    <p role="status" className={styles.status}>{message}</p>
  </section>;
}

export default function TrainingClient({ exercises }: { exercises: PracticeExercise[] }) {
  return exercises.length ? <div>{exercises.map((exercise) => <Exercise key={exercise.id} exercise={exercise} />)}</div>
    : <section className={styles.panel}><h2>Nenhum exercício avaliável por enquanto</h2><p>Os exercícios aparecem quando suas decisões capturadas têm linhas completas com cartas e efeitos cobertos e uma diferença relevante entre as escolhas.</p><Link href="/replays">Abrir replays</Link></section>;
}
