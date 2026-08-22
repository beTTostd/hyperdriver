import type { CSSProperties } from "react";
import { notFound, redirect } from "next/navigation";
import AuthenticatedHeader from "../../components/authenticated-header";
import { requireUser } from "../../../lib/auth";
import { cardArtImageUrl } from "../../../lib/card-avatars";
import { calculateReplayTelemetry, type TelemetryCycle } from "../../../lib/replay-telemetry";
import { readAdminReplay, readUserReplay, type ReplayDocument } from "../../../lib/replays";
import styles from "./page.module.css";

type PageProps = { params: Promise<{ id: string }> };
type Metric = {
  key: keyof Pick<TelemetryCycle, "receivedDamage" | "equipmentBlocked" | "cardBlocked" | "offeredDamage" | "lifeGained">;
  label: string;
  className: string;
};

const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;
const metrics: Metric[] = [
  { key: "receivedDamage", label: "Dano recebido", className: "received" },
  { key: "equipmentBlocked", label: "Bloqueado por equipamento", className: "equipment" },
  { key: "cardBlocked", label: "Bloqueado por carta", className: "card" },
  { key: "lifeGained", label: "Vida ganha", className: "life" },
  { key: "offeredDamage", label: "Dano oferecido", className: "offered" },
];

function total(cycle: TelemetryCycle) {
  return metrics.reduce((sum, metric) => sum + cycle[metric.key], 0);
}

function cardName(cardId: string | null) {
  if (!cardId) return "Herói desconhecido";
  return cardId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function gameModeLabel(gameMode: string | null) {
  const labels: Record<string, string> = {
    blitz: "Blitz",
    cc: "Classic Constructed",
    commoner: "Commoner",
    draft: "Booster Draft",
    ll: "Living Legend",
    sealed: "Sealed Deck",
    upf: "Ultimate Pit Fight",
  };
  if (!gameMode) return "Não informado";
  return labels[gameMode.toLowerCase()] ?? gameMode.toUpperCase();
}

function resultLabel(result: string) {
  if (result === "victory") return "Vitória";
  if (result === "defeat") return "Derrota";
  return "Encerrada";
}

export async function ReplayTelemetryPage({ params }: PageProps) {
  const { id } = await params;
  const currentUser = await requireUser(`/replays/${id}`);
  if (!REPLAY_ID_PATTERN.test(id)) notFound();
  const stored = currentUser.role === "admin"
    ? await readAdminReplay(id)
    : await readUserReplay(currentUser.id, id);
  if (!stored) notFound();

  const replay = JSON.parse(stored.raw) as ReplayDocument;
  const cycles = calculateReplayTelemetry(replay);
  const metadata = stored.metadata;
  const playerHero = cardName(metadata.playerHeroId);
  const opponentHero = cardName(metadata.opponentHeroId);
  const firstTurnPlayer = replay.match.frames.find((frame) => ["1", "2"].includes(String(frame.payload.turnPlayer)))?.payload.turnPlayer;
  const firstPlayer = String(firstTurnPlayer) === "2" ? "Oponente" : "Você";
  const startedAt = new Date(metadata.startedAt);
  const totals = Object.fromEntries(
    metrics.map((metric) => [
      metric.key,
      cycles.reduce((sum, cycle) => sum + cycle[metric.key], 0),
    ]),
  ) as Record<Metric["key"], number>;
  const scale = Math.max(1, ...cycles.map(total));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <AuthenticatedHeader
          username={currentUser.username}
          avatarCardId={currentUser.avatarCardId}
          isAdmin={currentUser.role === "admin"}
        />
        <header className={styles.analysisHeader}>
          <p>Relatório de combate</p>
          <h1>Análise da<br /><em>partida</em></h1>
        </header>

        <section className={`${styles.matchBriefing} ${styles[metadata.result] ?? ""}`} aria-labelledby="match-briefing-title">
          <h2 className={styles.srOnly} id="match-briefing-title">Resumo da partida</h2>
          <article className={styles.heroProfile}>
            <div className={styles.heroArt}>
              {metadata.playerHeroId
                ? <img src={cardArtImageUrl(metadata.playerHeroId)} alt={playerHero} />
                : <span aria-hidden="true">?</span>}
            </div>
            <div className={styles.heroIdentity}>
              <small>Você</small>
              <strong>{playerHero}</strong>
            </div>
          </article>

          <div className={styles.matchResult}>
            <span>{resultLabel(metadata.result)}</span>
            <strong>VS</strong>
            <i aria-hidden="true"><b /><b /><b /></i>
          </div>

          <article className={`${styles.heroProfile} ${styles.opponentProfile}`}>
            <div className={styles.heroArt}>
              {metadata.opponentHeroId
                ? <img src={cardArtImageUrl(metadata.opponentHeroId)} alt={opponentHero} />
                : <span aria-hidden="true">?</span>}
            </div>
            <div className={styles.heroIdentity}>
              <small>Oponente</small>
              <strong>{opponentHero}</strong>
            </div>
          </article>

          <dl className={styles.matchFacts}>
            <div><dt>Modo de jogo</dt><dd>{gameModeLabel(metadata.gameMode)}</dd></div>
            <div><dt>Data da partida</dt><dd><time dateTime={startedAt.toISOString()}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(startedAt)}</time></dd></div>
            <div><dt>Iniciativa</dt><dd>{firstPlayer} começou</dd></div>
          </dl>
        </section>

        <section className={styles.summary} aria-label="Resumo da telemetria">
          {metrics.map((metric) => (
            <article className={styles[metric.className]} key={metric.key}>
              <small>{metric.label}</small>
              <strong>{totals[metric.key]}</strong>
              <span>{cycles.length} {cycles.length === 1 ? "ciclo registrado" : "ciclos registrados"}</span>
            </article>
          ))}
        </section>

        <section className={styles.panel} aria-labelledby="cycle-chart-title">
          <div className={styles.panelHeader}>
            <div><p>Comparação</p><h2 id="cycle-chart-title">Dano por ciclo</h2></div>
            <aside className={styles.legend} aria-label="Legenda">
              {metrics.map((metric) => (
                <span key={metric.key}><i className={styles[metric.className]} />{metric.label}</span>
              ))}
            </aside>
          </div>
          <div className={styles.chart}>
            {cycles.map((cycle, rowIndex) => (
              <div className={styles.row} key={cycle.key}>
                <div className={styles.cycleLabel}>
                  <strong>T{cycle.turn}</strong>
                </div>
                <div className={styles.track}>
                  {metrics.map((metric, metricIndex) => {
                    const value = cycle[metric.key];
                    if (!value) return null;
                    const style = {
                      "--segment-width": `${value / scale * 100}%`,
                      "--segment-delay": `${rowIndex * 70 + metricIndex * 45}ms`,
                    } as CSSProperties;
                    return (
                      <span
                        aria-label={`${metric.label}: ${value}`}
                        className={`${styles.segment} ${styles[metric.className]}`}
                        data-tooltip={`${metric.label}: ${value}`}
                        key={metric.key}
                        role="img"
                        style={style}
                        tabIndex={0}
                      />
                    );
                  })}
                </div>
                <strong className={styles.cycleTotal}>{total(cycle)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="cycle-table-title">
          <div className={styles.panelHeader}>
            <div><p>Detalhamento</p><h2 id="cycle-table-title">Números por ciclo</h2></div>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Ciclo</th>{metrics.map((metric) => <th key={metric.key}>{metric.label}</th>)}</tr></thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr key={cycle.key}>
                    <td><strong>T{cycle.turn}</strong></td>
                    {metrics.map((metric) => <td className={styles[metric.className]} key={metric.key}>{cycle[metric.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer>
          <strong>Como calculamos</strong>
          <span>O dano recebido considera o poder que passou pelos bloqueios. O dano oferecido soma o poder final dos seus ataques. A vida ganha soma os aumentos de vida registrados nos snapshots. Defesa acima do poder do ataque não é contabilizada.</span>
        </footer>
      </div>
    </main>
  );
}

export default async function LegacyTelemetryPage({ params }: PageProps) {
  const { id } = await params;
  if (!REPLAY_ID_PATTERN.test(id)) notFound();
  redirect(`/replays/${id}`);
}
