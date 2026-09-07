import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AuthenticatedHeader from "../../components/authenticated-header";
import CardImage from "../../components/card-image";
import { requireUser } from "../../../lib/auth";
import { cardArtImageUrl } from "../../../lib/card-avatars";
import {
  decisionAnalysisVisibleTo,
  getReplayDecisionAnalysis,
  type HandAnalysis,
  type ReplayDecisionAnalysis,
} from "../../../lib/decision-analysis";
import { calculateReplayTelemetry, type TelemetryCycle } from "../../../lib/replay-telemetry";
import { readAdminReplay, readUserReplay, type ReplayDocument } from "../../../lib/replays";
import AnalysisFeedback from "./analysis-feedback";
import AnalysisTabs from "./analysis-tabs";
import { CreatePatternGoalButton } from "../../replays/workspace-panel";
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

const confidenceLabels = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
} as const;

const markerLabels = {
  good: "Boa decisão",
  opportunity: "Oportunidade de melhoria",
  high_impact_error: "Erro de alto impacto",
} as const;

const improvementLabels: Record<string, string> = {
  "early-blue-pitch": "pitch de blues cedo demais",
  overblock: "overblock",
  "lost-arsenal": "arsenal perdido",
  "weak-arsenal": "arsenal de baixo impacto",
  "interrupted-line": "linha interrompida sem necessidade",
  "incompatible-hand": "mão incompatível",
  "insufficient-pitch": "pitch insuficiente",
  "equipment-efficiency": "equipamento pouco eficiente",
};

function score(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function actionLabel(action: HandAnalysis["bestAction"]) {
  return action.label || action.identifier || `Ação ${action.actionCode}`;
}

function AnalysisStatus({ analysis }: { analysis: ReplayDecisionAnalysis }) {
  if (analysis.status === "pending") {
    return <p className={styles.analysisNotice}>A análise está sendo processada em segundo plano. O replay continua disponível normalmente.</p>;
  }
  if (analysis.status === "failed") {
    return <p className={styles.analysisNotice}>Não foi possível concluir esta análise. O replay original não foi alterado.</p>;
  }
  if (analysis.shadowMode) {
    return <p className={styles.analysisNotice}>O treinador está em validação controlada. As recomendações ficam visíveis apenas para administradores durante o shadow mode.</p>;
  }
  if (analysis.status === "insufficient_data") {
    return <p className={styles.analysisNotice}>Dados insuficientes para comparar escolhas e alternativas com segurança. Replays antigos permanecem acessíveis, mas não recebem uma recomendação especulativa.</p>;
  }
  return null;
}

function DecisionCoach({
  replayId,
  analysis,
}: {
  replayId: string;
  analysis: ReplayDecisionAnalysis;
}) {
  const relevant = analysis.handAnalyses.filter((item) => item.marker && item.confidence !== "low");
  return (
    <section className={`${styles.panel} ${styles.coachPanel}`} aria-labelledby="decision-coach-title">
      <div className={styles.panelHeader}>
        <div>
          <p>Treinador pós-partida</p>
          <h2 id="decision-coach-title">Melhor linha encontrada</h2>
        </div>
        {analysis.status === "ready" && !analysis.shadowMode && (
          <span className={styles.analysisCoverage}>{analysis.analysisCount} decisões avaliadas</span>
        )}
      </div>

      <AnalysisStatus analysis={analysis} />

      {analysis.status === "ready" && !analysis.shadowMode && analysis.summary && (
        <>
          <div className={styles.coachSummary}>
            <article><small>Potencial médio das mãos</small><strong>{analysis.summary.averageHandPotential === null ? "—" : score(analysis.summary.averageHandPotential)}</strong><span>qualidade máxima estimada no estado conhecido</span></article>
            <article><small>Qualidade da execução</small><strong>{analysis.summary.averageExecutionQuality === null ? "—" : score(analysis.summary.averageExecutionQuality)}</strong><span>distância da melhor alternativa encontrada</span></article>
            <article><small>Limitadas pelo draw</small><strong>{analysis.summary.varianceLimitedHands}</strong><span>boa execução com potencial baixo</span></article>
            <article><small>Abaixo do potencial</small><strong>{analysis.summary.executionBelowPotential}</strong><span>decisões com arrependimento estimado relevante</span></article>
          </div>

          <div className={styles.markerGuide}>
            <div>
              <strong>Como usar os marcadores</strong>
              <p>Clique ou toque em um cartão para abrir a comparação. “p.p.” significa pontos percentuais na probabilidade estimada de vitória, não dano nem resultado garantido.</p>
            </div>
            <ul>
              <li className={styles.good}><i /><span><b>Boa decisão</b><small>diferença de até 1,5 p.p.</small></span></li>
              <li className={styles.opportunity}><i /><span><b>Oportunidade de melhoria</b><small>alternativa mais de 1,5 e menos de 5 p.p. melhor</small></span></li>
              <li className={styles.high_impact_error}><i /><span><b>Erro de alto impacto</b><small>alternativa 5 p.p. ou mais melhor</small></span></li>
            </ul>
          </div>

          {analysis.summary.controllablePatterns.length > 0 && (
            <div className={styles.patternSummary}>
              <strong>Padrões controláveis</strong>
              <div>{analysis.summary.controllablePatterns.slice(0, 3).map((pattern) => (
                <span key={pattern.tag}>{pattern.label} · {pattern.occurrences}× <CreatePatternGoalButton replayId={replayId} patternTag={pattern.tag} label={pattern.label} /></span>
              ))}</div>
            </div>
          )}

          <div className={styles.decisionList}>
            {relevant.map((item) => (
              <details className={`${styles.decisionCard} ${item.marker ? styles[item.marker] : ""}`} key={`${item.stateFingerprint}-${item.frameSequence}`}>
                <summary>
                  <span>{item.marker ? markerLabels[item.marker] : "Decisão"}</span>
                  <strong>{item.decisionLabel}</strong>
                  <small>Turno {item.turn ?? "—"} · confiança {confidenceLabels[item.confidence]} · execução {score(item.executionQuality)} · {item.regretPp.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.</small>
                </summary>
                <div className={styles.decisionBody}>
                  {item.marker !== "good" && <p className={styles.decisionMeaning}><strong>Por que este marcador apareceu:</strong> o avaliador comparou a ação realizada com as alternativas disponíveis naquele instante. A diferença abaixo é uma estimativa, não a revelação de uma jogada obrigatória.</p>}
                  <div className={`${styles.decisionComparison} ${item.marker === "good" ? styles.singleDecisionComparison : ""}`}>
                    <article>
                      <small>Ação realizada</small>
                      <strong>{actionLabel(item.chosenAction)}</strong>
                      <span>{score(item.chosenActionValue)} de vitória estimada</span>
                    </article>
                    {item.marker !== "good" && (
                      <article>
                        <small>Melhor linha encontrada</small>
                        <strong>{actionLabel(item.bestAction)}</strong>
                        <span>{score(item.bestActionValue)} de vitória estimada</span>
                      </article>
                    )}
                  </div>
                  {item.marker !== "good" && <p>{item.explanation}</p>}
                  {item.alternatives.length > 0 && (
                    <div className={styles.alternatives}>
                      <strong>Outras alternativas comparadas</strong>
                      <ol>{item.alternatives.slice(0, 2).map((alternative) => (
                        <li key={alternative.key}><span>{actionLabel(alternative)}</span><b>{score(alternative.estimatedWinProbability)}</b></li>
                      ))}</ol>
                    </div>
                  )}
                  {item.improvementTags.length > 0 && <div className={styles.analysisTags}>{item.improvementTags.map((tag) => <span key={tag}>{improvementLabels[tag] ?? tag}</span>)}</div>}
                  <div className={styles.decisionActions}>
                    <Link href={`/replays/${replayId}/table?frame=${item.frameIndex}`}>Abrir decisão na mesa</Link>
                    <AnalysisFeedback replayId={replayId} analysisFingerprint={item.stateFingerprint} />
                  </div>
                </div>
              </details>
            ))}
            {relevant.length === 0 && <p className={styles.analysisNotice}>Nenhum ponto atingiu confiança suficiente para virar recomendação nesta partida.</p>}
          </div>

          <p className={styles.methodologyNote}><strong>Como ler:</strong> a função principal é a probabilidade estimada de vitória. Dano, vida, cartas, pitch, arsenal, action points e equipamento explicam a avaliação; o “valor” de telemetria não é o objetivo de otimização. Só entram informações disponíveis no instante da escolha. “Melhor” significa a melhor linha encontrada pelo avaliador dentro de sua cobertura e orçamento, não certeza absoluta.</p>
        </>
      )}
    </section>
  );
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
  const decisionAnalysis = decisionAnalysisVisibleTo(currentUser.role)
    ? getReplayDecisionAnalysis(metadata, currentUser.role)
    : null;
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
  const analysisTabs = [
    { id: "telemetry", label: "Telemetria", description: "Ciclos e números" },
    ...(decisionAnalysis ? [{ id: "coach", label: "Treinador", description: "Decisões e recomendações" }] : []),
  ];

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

        <div className={styles.tabSection}>
            <section className={`${styles.matchBriefing} ${styles[metadata.result] ?? ""}`} aria-labelledby="match-briefing-title">
          <h2 className={styles.srOnly} id="match-briefing-title">Resumo da partida</h2>
          <article className={styles.heroProfile}>
            <div className={styles.heroArt}>
              {metadata.playerHeroId
                ? <CardImage src={cardArtImageUrl(metadata.playerHeroId)} alt={playerHero} width={320} height={320} />
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
                ? <CardImage src={cardArtImageUrl(metadata.opponentHeroId)} alt={opponentHero} width={320} height={320} />
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
        </div>

        <AnalysisTabs items={analysisTabs}>
          <div className={styles.tabSection}>
            <section className={styles.panel} aria-labelledby="cycle-chart-title">
          <div className={styles.panelHeader}>
            <div><p>Comparação</p><h2 id="cycle-chart-title">Dano por ciclo</h2></div>
            <aside className={styles.legend} aria-label="Legenda">
              {metrics.map((metric) => (
                <span key={metric.key}><i className={styles[metric.className]} />{metric.label}</span>
              ))}
            </aside>
          </div>
          {cycles.length ? <div className={styles.chart}>
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
          </div> : <p className={styles.emptyState}>Este replay não contém ciclos de combate suficientes para desenhar o gráfico.</p>}
            </section>

            <section className={styles.panel} aria-labelledby="cycle-table-title">
          <div className={styles.panelHeader}>
            <div><p>Detalhamento</p><h2 id="cycle-table-title">Números por ciclo</h2></div>
          </div>
          {cycles.length ? <div className={styles.tableWrap} tabIndex={0} aria-label="Tabela rolável com os números por ciclo">
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
          </div> : <p className={styles.emptyState}>Os números por ciclo aparecerão quando houver telemetria de combate válida.</p>}
            </section>

            <footer>
              <strong>Como calculamos</strong>
              <span>O dano recebido considera o poder que passou pelos bloqueios. O dano oferecido soma o poder final dos seus ataques. A vida ganha soma os aumentos de vida registrados nos snapshots. Defesa acima do poder do ataque não é contabilizada.</span>
            </footer>
          </div>
          {decisionAnalysis && <div className={styles.tabSection}><DecisionCoach replayId={id} analysis={decisionAnalysis} /></div>}
        </AnalysisTabs>
      </div>
    </main>
  );
}

export default async function LegacyTelemetryPage({ params }: PageProps) {
  const { id } = await params;
  if (!REPLAY_ID_PATTERN.test(id)) notFound();
  redirect(`/replays/${id}`);
}
