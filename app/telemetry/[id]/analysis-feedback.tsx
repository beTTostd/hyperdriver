"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function AnalysisFeedback({
  replayId,
  analysisFingerprint,
}: {
  replayId: string;
  analysisFingerprint: string;
}) {
  const [selection, setSelection] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(helpful: boolean) {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/replays/${replayId}/analysis/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysisFingerprint, helpful }),
      });
      if (!response.ok) throw new Error("Não foi possível registrar agora.");
      setSelection(helpful);
      setMessage("Feedback registrado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível registrar agora.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.analysisFeedback}>
      <span>Esta leitura foi útil?</span>
      <button
        aria-pressed={selection === true}
        disabled={submitting}
        type="button"
        onClick={() => submit(true)}
      >Útil</button>
      <button
        aria-pressed={selection === false}
        disabled={submitting}
        type="button"
        onClick={() => submit(false)}
      >Não útil</button>
      <small aria-live="polite">{message}</small>
    </div>
  );
}
