"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace-panel.module.css";

export default function WorkspaceActions({ replayId, favorite }: { replayId: string; favorite: boolean }) {
  const [pending, setPending] = useState(false); const router = useRouter();
  async function patch(value: Record<string, unknown>) { setPending(true); await fetch(`/api/replays/${replayId}/workspace`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); setPending(false); router.refresh(); }
  return <div className={styles.cardActions} aria-label="Ações do caderno"><button className={styles.favoriteButton} disabled={pending} type="button" aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-pressed={favorite} title={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={() => patch({ isFavorite: !favorite })}><span aria-hidden="true">{favorite ? "★" : "☆"}</span></button></div>;
}
