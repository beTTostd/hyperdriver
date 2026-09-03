"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./workspace-panel.module.css";

export default function WorkspaceActions({ replayId, favorite, reviewed, hasNote }: { replayId: string; favorite: boolean; reviewed: boolean; hasNote: boolean }) {
  const [pending, setPending] = useState(false); const router = useRouter();
  async function patch(value: Record<string, unknown>) { setPending(true); await fetch(`/api/replays/${replayId}/workspace`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); setPending(false); router.refresh(); }
  return <div className={styles.actions} aria-label="Ações do caderno"><button className={styles.secondary} disabled={pending} type="button" onClick={() => patch({ isFavorite: !favorite })}>{favorite ? "★ Favorito" : "☆ Favoritar"}</button><button className={styles.secondary} disabled={pending} type="button" onClick={() => patch({ reviewed: !reviewed })}>{reviewed ? "Revisado ✓" : "Marcar revisado"}</button>{hasNote && <span className={styles.badge}>Tem notas</span>}</div>;
}
