import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { notFound } from "next/navigation";
import AuthenticatedHeader from "../components/authenticated-header";
import { requireUser } from "../../lib/auth";
import { calculateReplayTelemetry } from "../../lib/replay-telemetry";
import { readUserReplay, type ReplayDocument } from "../../lib/replays";
import styles from "./page.module.css";

type PageProps = { searchParams: Promise<{ replay?: string }> };

export default async function TurnValuePage({ searchParams }: PageProps) {
  const currentUser = await requireUser("/valor");
  const { replay: replayId } = await searchParams;
  let raw: string;
  if (replayId) {
    if (!/^\d+$/.test(replayId)) notFound();
    const stored = await readUserReplay(currentUser.id, Number(replayId));
    if (!stored) notFound();
    raw = stored.raw;
  } else {
    raw = await readFile(resolve("public/replays/recorded-match.json"), "utf8");
  }

  const turns = calculateReplayTelemetry(JSON.parse(raw) as ReplayDocument);
  const attack = turns.reduce((total, turn) => total + turn.attack, 0);
  const defense = turns.reduce((total, turn) => total + turn.defense, 0);
  const total = attack + defense;
  const best = turns.reduce<(typeof turns)[number] | null>(
    (current, turn) => !current || turn.value > current.value ? turn : current,
    null,
  );
  const scale = Math.max(1, ...turns.map((turn) => turn.value));

  return <main className={styles.page}><div className={styles.shell}>
    <AuthenticatedHeader username={currentUser.username} avatarCardId={currentUser.avatarCardId} isAdmin={currentUser.role === "admin"} />
    <header className={styles.analysisHeader}><p><span>02</span> Análise da partida</p><h1>Valor por<br /><em>turno</em></h1><span>Valor = poder final dos ataques + defesa total registrada pelo Talishar, incluindo mão e equipamentos.</span></header>
    <section className={styles.summary}><article><small>Valor total</small><strong>{total}</strong><span>{turns.length} turnos efetivos</span></article><article><small>Ataque</small><strong className={styles.attack}>{attack}</strong><span>{total ? Math.round(attack / total * 100) : 0}% do valor</span></article><article><small>Defesa total</small><strong className={styles.block}>{defense}</strong><span>Mão e equipamentos</span></article><article><small>Melhor turno</small><strong>{best?.value ?? 0}</strong><span>{best ? `T${best.turn} · ${best.player}` : "Sem ataques"}</span></article></section>
    <section className={styles.panel}><div className={styles.panelHeader}><div><p>Comparação</p><h2>Produção de cada turno</h2></div><aside><i /> Ataque <b /> Defesa total</aside></div><div className={styles.chart}>{turns.map((turn) => <div className={styles.row} key={turn.key}><label><strong>T{turn.turn}</strong><span className={turn.player === "Você" ? styles.you : styles.opponent}>{turn.player}</span></label><div className={styles.track}><i style={{width:`${turn.attack / scale * 100}%`}} /><b style={{width:`${turn.defense / scale * 100}%`}} /></div><strong>{turn.value}</strong></div>)}</div></section>
    <section className={styles.panel}><div className={styles.panelHeader}><div><p>Detalhamento</p><h2>Números por turno</h2></div></div><div className={styles.tableWrap}><table><thead><tr><th>Turno</th><th>Jogador ativo</th><th>Ataque</th><th>Defesa total</th><th>Valor</th></tr></thead><tbody>{turns.map((turn) => <tr key={turn.key}><td>T{turn.turn}</td><td><span className={turn.player === "Você" ? styles.you : styles.opponent}>{turn.player}</span></td><td className={styles.attack}>{turn.attack}</td><td className={styles.block}>{turn.defense}</td><td><strong>{turn.value}</strong></td></tr>)}</tbody></table></div></section>
    <footer><strong>Como calculamos</strong><span>Cada ataque usa os últimos valores de poder e defesa observados antes da combat chain encerrar. Os ataques são somados por turno e jogador ativo.</span></footer>
  </div></main>;
}
