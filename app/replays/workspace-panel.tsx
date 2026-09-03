"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./workspace-panel.module.css";

type Bookmark = { id: number; frameIndex: number; title: string; note: string | null };
type Workspace = { note: string; isFavorite: boolean; reviewedAt: number | null; tags: Array<{ id: number; name: string }>; bookmarks: Bookmark[] };
type Message = { id: number; authorRole: "coach" | "player"; body: string; createdAt: number };
type Thread = { id: number; frameIndex: number; resolvedAt: number | null; messages: Message[] };
type Share = { id: string; coachName: string; expiresAt: number; revokedAt: number | null; threads?: Thread[] };
type Goal = { id: number; title: string; progressMatches: number; targetMatches: number; status: string };

export function CreatePatternGoalButton({ replayId, patternTag, label }: { replayId: string; patternTag: string; label: string }) {
  const [state, setState] = useState("");
  async function create() {
    setState("Criando…");
    const response = await fetch("/api/goals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: "analysis_pattern", sourceReplayId: replayId, patternTag, title: `Reduzir ${label}` }) });
    const body = await response.json();
    setState(response.ok ? "Meta criada" : body.error || "Não foi possível criar");
  }
  return <span><button className={styles.secondary} type="button" onClick={create}>Criar meta a partir deste padrão</button> <small>{state}</small></span>;
}

export default function WorkspacePanel({ replayId }: { replayId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [note, setNote] = useState("");
  const [tagText, setTagText] = useState("");
  const [status, setStatus] = useState("");
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkFrame, setBookmarkFrame] = useState(0);
  const [coachName, setCoachName] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [permissions, setPermissions] = useState({ includeAnalysis: false, includeNote: false, includeBookmarks: false, includeGoals: false });
  const [shareUrl, setShareUrl] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);

  const reload = useCallback(async () => {
    const [workspaceResponse, sharesResponse, goalsResponse] = await Promise.all([fetch(`/api/replays/${replayId}/workspace`), fetch(`/api/replays/${replayId}/shares`), fetch("/api/goals")]);
    if (workspaceResponse.ok) {
      const value = await workspaceResponse.json() as Workspace;
      setWorkspace(value); setNote(value.note); setTagText(value.tags.map((tag) => tag.name).join(", "));
    }
    if (sharesResponse.ok) setShares((await sharesResponse.json()).shares);
    if (goalsResponse.ok) setGoals((await goalsResponse.json()).goals.filter((goal: Goal) => goal.status === "active"));
  }, [replayId]);
  useEffect(() => { const timer = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(timer); }, [reload]);

  async function save(patch: Record<string, unknown>) {
    setStatus("Salvando…");
    const response = await fetch(`/api/replays/${replayId}/workspace`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const body = await response.json();
    if (response.ok) { setWorkspace(body); setStatus("Caderno salvo."); } else setStatus(body.error || "Não foi possível salvar.");
  }
  async function addBookmark() {
    const response = await fetch(`/api/replays/${replayId}/bookmarks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frameIndex: bookmarkFrame, title: bookmarkTitle }) });
    const body = await response.json(); setStatus(response.ok ? "Bookmark criado." : body.error); if (response.ok) { setBookmarkTitle(""); await reload(); }
  }
  async function removeBookmark(id: number) { await fetch(`/api/replays/${replayId}/bookmarks/${id}`, { method: "DELETE" }); await reload(); }
  async function createShare() {
    const response = await fetch(`/api/replays/${replayId}/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coachName, durationDays, ...permissions }) });
    const body = await response.json(); if (response.ok) { setShareUrl(`${location.origin}${body.url}`); setCoachName(""); await reload(); } else setStatus(body.error);
  }
  async function revokeShare(id: string) { await fetch(`/api/replays/${replayId}/shares/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ revoked: true }) }); await reload(); }
  async function reply(threadId: number, body: string) { if (!body.trim()) return; await fetch(`/api/replays/${replayId}/coaching/threads/${threadId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) }); await reload(); }
  async function resolve(threadId: number, resolved: boolean) { await fetch(`/api/replays/${replayId}/coaching/threads/${threadId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved }) }); await reload(); }

  return <section className={styles.panel} aria-labelledby="workspace-title">
    <header className={styles.header}><div><p>Pós-partida / privado</p><h2 id="workspace-title">Meu caderno</h2><p>Notas, momentos e feedback ligados a este replay.</p></div><div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => save({ isFavorite: !workspace?.isFavorite })}>{workspace?.isFavorite ? "★ Favorito" : "☆ Favoritar"}</button><button className={styles.secondary} type="button" onClick={() => save({ reviewed: !workspace?.reviewedAt })}>{workspace?.reviewedAt ? "Revisado ✓" : "Marcar revisado"}</button></div></header>
    <div className={styles.grid}>
      <div className={styles.block}>
        <label className={styles.field}><span>Nota livre ({note.length}/5000)</span><textarea maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <label className={styles.field}><span>Tags, separadas por vírgula</span><input value={tagText} maxLength={260} onChange={(event) => setTagText(event.target.value)} placeholder="pitch, defesa, arsenal" /></label>
        <div className={styles.actions}><button type="button" onClick={() => save({ note, tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean) })}>Salvar caderno</button></div>
        <h3>Bookmarks</h3>
        <div className={styles.composer}><label className={styles.field}><span>Frame</span><input type="number" min={0} value={bookmarkFrame} onChange={(event) => setBookmarkFrame(Number(event.target.value))} /></label><label className={styles.field}><span>Título</span><input maxLength={120} value={bookmarkTitle} onChange={(event) => setBookmarkTitle(event.target.value)} /></label><div className={styles.actions}><button type="button" onClick={addBookmark}>Adicionar momento</button></div></div>
        <ul className={styles.list}>{workspace?.bookmarks.map((bookmark) => <li key={bookmark.id}><Link href={`/replays/${replayId}/table?frame=${bookmark.frameIndex}`}>Frame {bookmark.frameIndex + 1} · {bookmark.title}</Link>{bookmark.note && <small>{bookmark.note}</small>}<div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => removeBookmark(bookmark.id)}>Remover</button></div></li>)}</ul>
        <h3>Metas ativas</h3><ul className={styles.list}>{goals.map((goal) => <li key={goal.id}><Link href="/me/goals">{goal.title}</Link><small>{goal.progressMatches}/{goal.targetMatches} partidas</small></li>)}</ul>{!goals.length && <p className={styles.muted}>Nenhuma meta ativa. <Link href="/me/goals">Criar meta</Link></p>}
      </div>
      <div className={styles.block}>
        <h3>Compartilhar com treinador</h3><p className={styles.muted}>O replay e os comentários são incluídos. Todo conteúdo privado começa desligado.</p>
        <label className={styles.field}><span>Nome do treinador</span><input maxLength={80} value={coachName} onChange={(event) => setCoachName(event.target.value)} /></label>
        <label className={styles.field}><span>Validade</span><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))}><option value={1}>24 horas</option><option value={7}>7 dias</option><option value={30}>30 dias</option></select></label>
        <div className={styles.checks}>{Object.entries({ includeAnalysis: "Análise", includeNote: "Nota", includeBookmarks: "Bookmarks", includeGoals: "Metas" }).map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions[key as keyof typeof permissions]} onChange={(event) => setPermissions((value) => ({ ...value, [key]: event.target.checked }))} />{label}</label>)}</div>
        <div className={styles.actions}><button type="button" onClick={createShare}>Criar link seguro</button></div>
        {shareUrl && <p className={styles.shareUrl}>Copie agora; o token não será exibido novamente: <a href={shareUrl}>{shareUrl}</a></p>}
        <ul className={styles.list}>{shares.map((share) => <li key={share.id}><strong>{share.coachName}</strong><small>{share.revokedAt ? "Revogado" : `Válido até ${new Date(share.expiresAt).toLocaleString("pt-BR")}`}</small>{!share.revokedAt && <div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => revokeShare(share.id)}>Revogar</button></div>}{share.threads?.map((thread) => <div className={styles.thread} key={thread.id}><Link href={`/replays/${replayId}/table?frame=${thread.frameIndex}`}>Conversa no frame {thread.frameIndex + 1}</Link>{thread.messages.map((message) => <p key={message.id}><b>{message.authorRole === "coach" ? share.coachName : "Jogador"}:</b> {message.body}</p>)}<Reply onSend={(body) => reply(thread.id, body)} /><div className={styles.actions}><button className={styles.secondary} type="button" onClick={() => resolve(thread.id, !thread.resolvedAt)}>{thread.resolvedAt ? "Reabrir" : "Resolver"}</button></div></div>)}</li>)}</ul>
      </div>
    </div><p className={styles.status} role="status">{status}</p>
  </section>;
}

function Reply({ onSend }: { onSend: (body: string) => void }) { const [body, setBody] = useState(""); return <div className={styles.composer}><label className={styles.field}><span>Responder</span><textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} /></label><div className={styles.actions}><button type="button" onClick={() => { onSend(body); setBody(""); }}>Enviar</button></div></div>; }
