"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, jsonRequest } from "../../lib/client-api";
import styles from "./workspace-panel.module.css";

export default function WorkspaceActions({ replayId, favorite }: { replayId: string; favorite: boolean }) {
  const [pending, setPending] = useState(false); const router = useRouter();
  const [status, setStatus] = useState("");
  async function patch(value: Record<string, unknown>) {
    if (pending) return;
    setPending(true); setStatus("");
    try {
      await apiRequest(`/api/replays/${replayId}/workspace`, jsonRequest("PATCH", value));
      setStatus("Favorito atualizado."); router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível atualizar o favorito.");
    } finally { setPending(false); }
  }
  return <div className={styles.cardActions} aria-label="Ações do caderno"><button className={styles.favoriteButton} disabled={pending} type="button" aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-pressed={favorite} title={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={() => patch({ isFavorite: !favorite })}><span aria-hidden="true">{favorite ? "★" : "☆"}</span></button><span className={styles.visuallyHidden} role="status">{status}</span></div>;
}
