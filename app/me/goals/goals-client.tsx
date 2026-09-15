"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, jsonRequest } from "../../../lib/client-api";
import styles from "../../replays/workspace-panel.module.css";

type Goal = { id: number; title: string; description: string; origin: "manual" | "analysis_pattern"; status: "active" | "achieved" | "not_achieved" | "cancelled"; progressMatches: number; targetMatches: number; baselineRate: number | null; currentRate: number | null; resultReduction: number | null };
type RecentReplay = { id: string; playerHeroId: string | null; opponentHeroId: string | null; startedAt: number };
const labels = { active: "Ativas", achieved: "Alcançadas", not_achieved: "Não alcançadas", cancelled: "Canceladas" };

function cardName(value: string | null) {
  if (!value) return "Herói desconhecido";
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function replayLabel(replay: RecentReplay) {
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(replay.startedAt));
  return `${cardName(replay.playerHeroId)} vs. ${cardName(replay.opponentHeroId)} · ${date}`;
}

export default function GoalsClient({ goals, recentReplays }: { goals: Goal[]; recentReplays: RecentReplay[] }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState(10);
  const [status, setStatus] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const router = useRouter();

  async function mutate(key: string, action: () => Promise<unknown>, success: string) {
    if (pendingAction) return;
    setPendingAction(key); setStatus("");
    try {
      await action(); setStatus(success); router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível concluir a ação.");
    } finally { setPendingAction(null); }
  }

  async function create() {
    await mutate("create", async () => {
      await apiRequest("/api/goals", jsonRequest("POST", { origin: "manual", title, description, targetMatches: target }));
      setTitle(""); setDescription("");
    }, "Meta criada.");
  }

  async function change(id: number, value: string) {
    await mutate(`goal-${id}`, () => apiRequest(`/api/goals/${id}`, jsonRequest("PATCH", { status: value })), "Meta atualizada.");
  }

  async function checkin(id: number, replayId: string, state: string, note: string) {
    await mutate(`checkin-${id}`, () => apiRequest(`/api/goals/${id}/checkins`, jsonRequest("POST", { replayId, state, note })), "Check-in registrado.");
  }

  return <>
    <section className={styles.panel}><h2>Nova meta manual</h2><div className={styles.grid}><label className={styles.field}><span>Título</span><input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label><label className={styles.field}><span>Partidas-alvo (1–50)</span><input type="number" min={1} max={50} value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label></div><label className={styles.field}><span>Descrição</span><textarea value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} /></label><div className={styles.actions}><button type="button" disabled={pendingAction !== null || !title.trim()} onClick={create}>{pendingAction === "create" ? "Criando…" : "Criar meta"}</button></div><p className={styles.status} role="status">{status}</p></section>
    {(Object.keys(labels) as Array<keyof typeof labels>).map((group) => <section className={styles.panel} key={group}><h2>{labels[group]}</h2><ul className={styles.list}>{goals.filter((goal) => goal.status === group).map((goal) => <li key={goal.id}><strong>{goal.title}</strong><small>{goal.origin === "analysis_pattern" ? "Sugerida pela análise" : "Manual"} · {goal.progressMatches}/{goal.targetMatches} partidas</small>{goal.description && <p>{goal.description}</p>}{goal.baselineRate !== null && <p>Linha de base: {goal.baselineRate.toFixed(1)} ocorrências por 100 decisões. Agora: {(goal.currentRate ?? 0).toFixed(1)} por 100.</p>}{group === "active" && <><div className={styles.actions}><button className={styles.secondary} disabled={pendingAction !== null} type="button" onClick={() => change(goal.id, "cancelled")}>Cancelar</button>{goal.origin === "manual" && <><button disabled={pendingAction !== null} type="button" onClick={() => change(goal.id, "achieved")}>Encerrar como alcançada</button><button className={styles.secondary} disabled={pendingAction !== null} type="button" onClick={() => change(goal.id, "not_achieved")}>Encerrar como não alcançada</button></>}</div>{goal.origin === "manual" && <Checkin recentReplays={recentReplays} pending={pendingAction !== null} onSubmit={(replayId, state, note) => checkin(goal.id, replayId, state, note)} />}</>}</li>)}</ul>{!goals.some((goal) => goal.status === group) && <p className={styles.muted}>Nenhuma meta neste estado.</p>}</section>)}
  </>;
}

function Checkin({ recentReplays, pending, onSubmit }: { recentReplays: RecentReplay[]; pending: boolean; onSubmit: (replayId: string, state: string, note: string) => void }) {
  const [replayId, setReplayId] = useState(recentReplays[0]?.id ?? "");
  const [state, setState] = useState("met");
  const [note, setNote] = useState("");
  return <div className={styles.thread}><h3>Check-in</h3><div className={styles.grid}><label className={styles.field}><span>Replay recente</span><select value={replayId} onChange={(event) => setReplayId(event.target.value)}><option value="">Selecione uma partida</option>{recentReplays.map((replay) => <option value={replay.id} key={replay.id}>{replayLabel(replay)}</option>)}</select></label><label className={styles.field}><span>Como foi</span><select value={state} onChange={(event) => setState(event.target.value)}><option value="met">Apliquei o foco nesta partida</option><option value="not_met">Ainda não consegui aplicar</option></select></label></div><label className={styles.field}><span>O que mudou nesta partida?</span><input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Descreva a evolução com suas palavras" /></label><div className={styles.actions}><button disabled={pending || !replayId} type="button" onClick={() => onSubmit(replayId, state, note)}>Registrar evolução</button></div></div>;
}
