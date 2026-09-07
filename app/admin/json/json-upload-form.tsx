"use client";

import { FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function JsonUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ kind: "error", text: "Selecione um arquivo JSON." });
      return;
    }
    const data = new FormData();
    data.set("file", file);
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/json", { method: "POST", body: data });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error || "Não foi possível enviar o arquivo.");
        if (inputRef.current) inputRef.current.value = "";
        setMessage({ kind: "success", text: "Arquivo armazenado com sucesso." });
        router.refresh();
      } catch (error) {
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Não foi possível enviar o arquivo.",
        });
      }
    });
  }

  return (
    <form className={styles.uploadForm} onSubmit={submit}>
      <label>
        <span>Arquivo .json</span>
        <input ref={inputRef} name="file" type="file" accept=".json,application/json" disabled={pending} />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Enviando…" : "Armazenar arquivo"}</button>
      {message && (
        <p className={message.kind === "success" ? styles.success : styles.error} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </form>
  );
}
