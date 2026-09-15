"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, jsonRequest } from "../../lib/client-api";
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
    if (state === "Criando…") return;
    setState("Criando…");
    try {
      await apiRequest("/api/goals", jsonRequest("POST", { origin: "analysis_pattern", sourceReplayId: replayId, patternTag, title: `Reduzir ${label}` }));
      setState("Meta criada");
    } catch (error) {
      setState(error instanceof Error ? error.message : "Não foi possível criar");
    }
  }
  return <span><button className={styles.secondary} disabled={state === "Criando…"} type="button" onClick={create}>Criar meta a partir deste padrão</button> <small>{state}</small></span>;
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
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [value, shareData, goalData] = await Promise.all([
        apiRequest<Workspace>(`/api/replays/${replayId}/workspace`),
        apiRequest<{ shares: Share[] }>(`/api/replays/${replayId}/shares`),
        apiRequest<{ goals: Goal[] }>("/api/goals"),
      ]);
      setWorkspace(value); setNote(value.note); setTagText(value.tags.map((tag) => tag.name).join(", "));
      setShares(shareData.shares);
      setGoals(goalData.goals.filter((goal) => goal.status === "active"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível carregar o caderno.");
    }
  }, [replayId]);
  useEffect(() => { const timer = window.setTimeout(() => { void reload(); }, 0); return () => window.clearTimeout(timer); }, [reload]);

  async function save(patch: Record<string, unknown>) {
    if (pendingAction) return;
    setPendingAction("save");
    setStatus("Salvando…");
    try {
      const body = await apiRequest<Workspace>(`/api/replays/${replayId}/workspace`, jsonRequest("PATCH", patch));
      setWorkspace(body); setStatus("Caderno salvo.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setPendingAction(null); }
  }
  async function addBookmark() {
    if (pendingAction) return; setPendingAction("bookmark");
    try { await apiRequest(`/api/replays/${replayId}/bookmarks`, jsonRequest("POST", { frameIndex: bookmarkFrame, title: bookmarkTitle })); setStatus("Momento criado."); setBookmarkTitle(""); await reload(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível criar o momento."); }
    finally { setPendingAction(null); }
  }
  async function removeBookmark(id: number) { if (pendingAction) return; setPendingAction(`bookmark-${id}`); try { await apiRequest(`/api/replays/${replayId}/bookmarks/${id}`, jsonRequest("DELETE")); setStatus("Momento removido."); await reload(); } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível remover."); } finally { setPendingAction(null); } }
  async function createShare() {
    if (pendingAction) return; setPendingAction("share");
    try { const body = await apiRequest<{ url: string }>(`/api/replays/${replayId}/shares`, jsonRequest("POST", { coachName, durationDays, ...permissions })); setShareUrl(`${location.origin}${body.url}`); setCoachName(""); setStatus("Link seguro criado."); await reload(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível compartilhar."); }
    finally { setPendingAction(null); }
  }
  async function revokeShare(id: string) { if (pendingAction) return; setPendingAction(`share-${id}`); try { await apiRequest(`/api/replays/${replayId}/shares/${id}`, jsonRequest("PATCH", { revoked: true })); setStatus("Compartilhamento revogado."); await reload(); } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível revogar."); } finally { setPendingAction(null); } }
  async function reply(threadId: number, body: string) { if (!body.trim() || pendingAction) return; setPendingAction(`reply-${threadId}`); try { await apiRequest(`/api/replays/${replayId}/coaching/threads/${threadId}/messages`, jsonRequest("POST", { body })); setStatus("Resposta enviada."); await reload(); } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível responder."); } finally { setPendingAction(null); } }
  async function resolve(threadId: number, resolved: boolean) { if (pendingAction) return; setPendingAction(`thread-${threadId}`); try { await apiRequest(`/api/replays/${replayId}/coaching/threads/${threadId}`, jsonRequest("PATCH", { resolved })); setStatus(resolved ? "Conversa resolvida." : "Conversa reaberta."); await reload(); } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível atualizar."); } finally { setPendingAction(null); } }

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
