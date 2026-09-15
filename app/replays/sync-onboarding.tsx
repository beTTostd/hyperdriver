"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../page.module.css";

type Presence = { detected: boolean; pending: number | null; version: string | null; error: string | null };

export default function SyncOnboarding({ fallback }: { fallback: string }) {
  const [presence, setPresence] = useState<Presence>({ detected: false, pending: null, version: null, error: null });
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    function readPresence(event?: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const version = document.documentElement.dataset.hyperdriverExtensionVersion || detail?.version || null;
      setPresence({ detected: Boolean(version), version, pending: Number.isSafeInteger(detail?.pending) ? detail.pending : null, error: typeof detail?.error === "string" ? detail.error : null });
      setChecked(true);
    }
    window.addEventListener("hyperdriver-extension-presence", readPresence);
    const timer = window.setTimeout(() => readPresence(), 700);
    return () => { window.clearTimeout(timer); window.removeEventListener("hyperdriver-extension-presence", readPresence); };
  }, []);

  let title = "Preparando a primeira sincronização";
  let description = fallback;
  if (checked && !presence.detected) {
    title = "Instale a extensão do Hyperdriver";
    description = "Depois, jogue uma partida no Talishar e volte aqui autenticado. A captura será sincronizada automaticamente.";
  } else if (presence.detected && presence.error) {
    title = "A sincronização precisa de atenção";
    description = presence.error;
  } else if (presence.detected && presence.pending && presence.pending > 0) {
    title = `${presence.pending} ${presence.pending === 1 ? "captura pendente" : "capturas pendentes"}`;
    description = "A extensão está conectada e enviando suas partidas. Esta página será atualizada ao concluir.";
  } else if (presence.detected) {
    title = "Extensão conectada";
    description = "Abra o Talishar, jogue uma partida desde o turno inicial e volte ao Hyperdriver para abrir o replay e a análise.";
  }

  return <div className={styles.emptyLibrary}>
    <strong>{title}</strong>
    <p>{description}</p>
    {checked && !presence.detected && <Link className={styles.openReplay} href="/downloads/hyperdriver-extension-v1.6.0.zip">Baixar extensão</Link>}
    {presence.version && <small>Extensão {presence.version} detectada</small>}
  </div>;
}
