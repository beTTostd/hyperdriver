"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReplayParticipation, ReplayParticipationSource } from "../../lib/replays";
import styles from "../page.module.css";

const labels: Record<ReplayParticipation, string> = {
  played: "Jogada",
  watched: "Assistida",
  unknown: "Não identificado",
};

export default function ParticipationControl({
  replayId,
  participation: initialParticipation,
  source,
}: {
  replayId: string;
  participation: ReplayParticipation;
  source: ReplayParticipationSource;
}) {
  const router = useRouter();
  const [participation, setParticipation] = useState(initialParticipation);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function changeParticipation(next: ReplayParticipation) {
    const previous = participation;
    setParticipation(next);
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/replays/${encodeURIComponent(replayId)}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participation: next }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error || "Não foi possível atualizar.");
        router.refresh();
      } catch (caught) {
        setParticipation(previous);
        setError(caught instanceof Error ? caught.message : "Não foi possível atualizar.");
      }
    });
  }

  return (
    <div className={styles.participationMetadata}>
      <dt>Participação</dt>
      <dd>
        <select
          aria-label={`Participação no replay: ${labels[participation]}`}
          title={source === "automatic" ? "Classificação automática; você pode corrigi-la." : source === "manual" ? "Classificação corrigida manualmente." : "Participação ainda não identificada."}
          value={participation}
          disabled={pending}
          onChange={(event) => changeParticipation(event.target.value as ReplayParticipation)}
        >
          <option value="played">Jogada</option>
          <option value="watched">Assistida</option>
          <option value="unknown">Não identificado</option>
        </select>
        {error && <span className={styles.participationError} role="alert">{error}</span>}
      </dd>
    </div>
  );
}
