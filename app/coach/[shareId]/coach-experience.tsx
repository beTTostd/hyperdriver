"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import TalisharTable from "../../table/replay-table";
import styles from "../../replays/workspace-panel.module.css";

type ShareData = { permissions: { analysis: boolean } };

export default function CoachExperience({ shareId }: { shareId: string }) {
  const [token, setToken] = useState(""); const [data, setData] = useState<ShareData | null>(null); const [error, setError] = useState("");
  const load = useCallback(async (secret: string) => { const response = await fetch(`/api/coach/shares/${shareId}`, { headers: { "x-hyperdriver-coach-token": secret } }); if (!response.ok) { setError("Este link não existe, expirou ou foi revogado."); return; } setData(await response.json()); }, [shareId]);
  useEffect(() => { const timer = window.setTimeout(() => { const fragment = new URLSearchParams(location.hash.replace(/^#/, "")); const fromUrl = fragment.get("token"); const key = `hyperdriver.coach.${shareId}`; const secret = fromUrl || sessionStorage.getItem(key) || ""; if (fromUrl) { sessionStorage.setItem(key, fromUrl); history.replaceState(null, "", location.pathname + location.search); } if (!secret) { setError("Token do compartilhamento ausente."); return; } setToken(secret); void load(secret); }, 0); return () => window.clearTimeout(timer); }, [load, shareId]);
  const source = useMemo(() => token ? { replayEndpoint: `/api/coach/shares/${shareId}/replay`, analysisEndpoint: `/api/coach/shares/${shareId}`, token } : undefined, [shareId, token]);
  if (error) return <main className={styles.panel}><h1>Compartilhamento indisponível</h1><p>{error}</p></main>;
  if (!data || !source) return <main className={styles.panel}><p>Validando o link seguro…</p></main>;
  return <TalisharTable source={source} decisionAnalysisEnabled={data.permissions.analysis} backHref={`/coach/${shareId}`} />;
}
