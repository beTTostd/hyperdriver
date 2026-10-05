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
  type HiddenInformationAnalysis,
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
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/100`;
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

function uncertaintyLabel(reason: string) {
  const labels: Record<string, string> = {
    card_not_in_catalog: "carta fora do catálogo auditado",
    unsupported_modifier: "modificador sem cobertura",
    unsupported_attacker_effects: "efeitos do atacante sem cobertura",
    unsupported_reactions: "reações sem cobertura",
    missing_combat_values: "valores de combate ausentes",
    unknown_payment_cost: "custo de pagamento desconhecido",
    payment_sequence_not_evaluated: "sequência de pagamento não avaliada",
    unsupported_public_effects: "efeitos públicos sem cobertura",
    inferred_decision: "escolha inferida",
    search_budget_exhausted: "orçamento da busca esgotado",
    search_hand_limit: "mão acima do limite da busca",
    active_chain_not_simulated: "cadeia ativa fora da cobertura",
    missing_search_resources: "recursos ou pontos de ação ausentes",
    unobserved_turn_effects: "bônus anteriores do turno não reconstruídos",
    captured_restrictions_not_simulated: "restrição capturada sem transição validada",
    no_supported_complete_line: "não foi encontrada continuação completa suportada",
    first_turn_response_requires_unknown_draw: "a resposta no primeiro turno depende de compras desconhecidas",
    opponent_continuation_not_simulated: "continuação adversária fora da cobertura",
    candidate_budget_exhausted: "limite de candidatas atingido",
    opponent_format_not_supported: "formato adversário fora da cobertura",
    opponent_zone_counts_missing: "contagens das zonas adversárias ausentes",
    opponent_zone_counts_out_of_range: "contagens adversárias fora do limite",
    unlocated_public_opponent_cards: "cartas públicas ocultas sem localização reconstruída",
    opponent_copy_count_conflict: "contagem de cópias incompatível com o formato",
    opponent_model_not_available_at_decision: "lista adversária fornecida depois desta decisão",
    opponent_model_context_mismatch: "lista incompatível com herói ou formato",
    opponent_model_size_conflict: "lista incompatível com o tamanho observado",
    opponent_model_public_count_conflict: "lista incompatível com cartas públicas",
    opponent_model_contains_equipment: "a lista de cartas de deck inclui equipamento",
    information_search_window_not_supported: "busca de informação oculta disponível apenas no início de ações",
    opponent_equipment_not_supported: "equipamento adversário sem cobertura",
    information_line_library_incomplete: "enumeração das linhas experimentais incompleta",
    information_line_library_truncated: "limite de linhas experimentais atingido",
    information_actions_under_sampled: "alternativas com amostragem insuficiente",
    no_covered_opponent_samples: "nenhuma mão adversária amostrada com cobertura",
    opponent_scenario_coverage_incomplete: "parte dos cenários adversários sem cobertura",
    opponent_model_has_unmodeled_mass: "a distribuição admite cartas adversárias sem cobertura",
    information_validation_budget_exhausted: "orçamento da comparação experimental esgotado",
    opponent_scenarios_change_ranking: "a melhor alternativa muda entre hipóteses adversárias",
  };
  return labels[reason] ?? "regra ou efeito sem cobertura";
}

const scoreTermLabels: Record<string, string> = {
  lethal_endpoint: "Dano letal recebido", power_offered: "Poder oferecido", life_preserved: "Vida preservada",
  known_arsenal_potential: "Potencial do arsenal com cartas conhecidas", cards_consumed: "Cartas consumidas",
  equipment_spent: "Equipamentos gastos", resources_lost_at_end: "Recursos perdidos no fim",
};

function DecisionLine({ sequence }: { sequence: Array<{ label: string; resourcesAfter?: number; actionPointsAfter?: number }> }) {
  return <div className={styles.alternatives}>
    <strong>Sequência calculada com cartas conhecidas</strong>
    <ol>{sequence.map((step, index) => <li key={index}>
      <span>{step.label}</span>
      {step.resourcesAfter !== undefined && <small>{step.resourcesAfter} recursos · {step.actionPointsAfter} AP</small>}
    </li>)}</ol>
  </div>;
}

function horizonLabel(horizon: string) {
  return horizon === "end_of_turn" ? "fim do turno" : horizon === "known_hand_response_turn" ? "defesa e turno de resposta com mão conhecida" : "decisão atual";
}

function InformationSearchDetails({ analysis }: { analysis: HiddenInformationAnalysis }) {
  const policyLabel = (policy: string) => policy === "protect_life" ? "Preservar vida" : "Preservar mão";
  return <details className={styles.alternatives}>
    <summary>Informação oculta — experimento</summary>
    <p>Os resultados abaixo não alteram os marcadores. As mãos simuladas são hipóteses; não representam cartas reveladas depois da decisão nem probabilidades de vitória.</p>
    <p>{analysis.belief.source === "explicit_model_known_at_decision"
      ? analysis.belief.supported ? "Lista fornecida e disponível no instante da decisão." : "A lista fornecida não passou pelas verificações de contexto e informação disponível."
      : analysis.belief.source === "assumed_partial_generic_mixture"
        ? "Mistura parcial de cartas genéricas, com espaço para cartas sem cobertura. Os pesos são hipóteses sem calibração."
        : "Não foi possível construir uma distribuição compatível com os dados capturados."}</p>
    {analysis.belief.archetypes.length > 0 && <ul>{analysis.belief.archetypes.map((model) => <li key={model.id}>
      <span>{model.label} · peso da hipótese {(model.weight * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
      <small>{model.unknownCount} cartas fora da cobertura no conjunto ainda oculto</small>
    </li>)}</ul>}
    <p>{Object.values(analysis.belief.constraints.currentPitch).reduce((sum, copies) => sum + copies, 0)} cartas conhecidas no pitch atual · {analysis.belief.constraints.returnedPitchHistory.length} saídas de pitch registradas. A ordem e a localização posterior não foram reconstruídas.</p>
    {analysis.comparison && <p>Diferença para a busca da etapa 2: {analysis.comparison.meanGain.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} pontos heurísticos nos {analysis.comparison.pairedScenarios} cenários pareados cobertos. {analysis.comparison.conditionalOnCoveredScenarios && "Resultado condicionado aos cenários com cobertura; não representa toda a distribuição."} A melhoria estratégica ainda precisa de validação independente.</p>}
    {analysis.stability && <p>{analysis.stability.stableAcrossCoveredGroups ? "A linha escolhida ficou entre as melhores em todos os grupos cobertos." : "A preferência mudou entre modelos ou políticas adversárias."} {analysis.stability.complete ? "Todos os grupos tiveram cenários cobertos." : "Há grupos ou amostras sem cobertura."}</p>}
    {analysis.validation.groups.length > 0 && <div className={styles.tableWrap}><table>
      <caption>Comparação por hipótese e política adversária</caption>
      <thead><tr><th>Hipótese</th><th>Política</th><th>Cenários cobertos</th><th>Diferença média</th></tr></thead>
      <tbody>{analysis.validation.groups.map((group) => <tr key={`${group.archetype}-${group.policy}`}>
        <td>{analysis.belief.archetypes.find((model) => model.id === group.archetype)?.label ?? group.archetype}</td>
        <td>{policyLabel(group.policy)}</td><td>{group.covered}/{group.attempted}</td>
        <td>{group.meanGainOverBaseline === null ? "—" : `${group.meanGainOverBaseline.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} pts.`}</td>
      </tr>)}</tbody>
    </table></div>}
    {analysis.candidates[0] && <DecisionLine sequence={analysis.candidates[0].sequence} />}
    {analysis.reasons.length > 0 && <p>Cobertura e incerteza: {analysis.reasons.map(uncertaintyLabel).join("; ")}.</p>}
    <p>Habilidades de herói, reações, compras e turnos adversários seguintes não simulados. Semente {analysis.seed} · busca {analysis.search.workUnits}/{analysis.search.budget} unidades de trabalho · comparação {analysis.validation.workUnits}/{analysis.validation.budget}.</p>
  </details>;
}

function DecisionCoach({
  replayId,
  analysis,
}: {
  replayId: string;
  analysis: ReplayDecisionAnalysis;
}) {
  const seenHands = new Set<string>();
  const relevant = analysis.handAnalyses.filter((item) => item.marker && item.confidence !== "low")
    .sort((left, right) => right.regretScore - left.regretScore)
    .filter((item) => {
      if (seenHands.has(item.handFingerprint)) return false;
      seenHands.add(item.handFingerprint);
      return true;
    }).slice(0, 3);
  const uncertain = analysis.handAnalyses.filter((item) => item.confidence === "low");
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
      {analysis.reason === "legacy_analysis_methodology" && <p className={styles.analysisNotice}>Análise histórica preservada na versão original. Suas métricas não entram na metodologia atual.</p>}
      {uncertain.length > 0 && <details className={styles.analysisNotice}>
        <summary>{uncertain.length} decisões com cobertura insuficiente</summary>
        <ul>{uncertain.map((item) => <li key={item.stateFingerprint}>Turno {item.turn ?? "—"} · {item.decisionLabel}: {item.uncertaintyReasons.map(uncertaintyLabel).join("; ")}
          <InformationSearchDetails analysis={item.hiddenInformation} />
        </li>)}</ul>
      </details>}

      {analysis.status === "ready" && !analysis.shadowMode && analysis.summary && (
        <>
          <div className={styles.coachSummary}>
            <article><small>Potencial médio das mãos</small><strong>{analysis.summary.averageHandPotential === null ? "—" : score(analysis.summary.averageHandPotential)}</strong><span>índice heurístico de 0 a 100</span></article>
            <article><small>Qualidade da execução</small><strong>{analysis.summary.averageExecutionQuality === null ? "—" : score(analysis.summary.averageExecutionQuality)}</strong><span>distância da melhor alternativa encontrada</span></article>
            <article><small>Limitadas pelo draw</small><strong>{analysis.summary.varianceLimitedHands}</strong><span>boa execução com potencial baixo</span></article>
            <article><small>Abaixo do potencial</small><strong>{analysis.summary.executionBelowPotential}</strong><span>decisões com arrependimento estimado relevante</span></article>
          </div>

          <div className={styles.markerGuide}>
            <div>
              <strong>Como usar os marcadores</strong>
              <p>Clique ou toque em um cartão para abrir a comparação. “pts.” significa pontos heurísticos experimentais. A pontuação não foi calibrada como probabilidade de vitória.</p>
            </div>
            <ul>
              <li className={styles.good}><i /><span><b>Boa decisão</b><small>diferença de até 1,5 pts.</small></span></li>
              <li className={styles.opportunity}><i /><span><b>Oportunidade de melhoria</b><small>alternativa mais de 1,5 e menos de 5 pts. melhor</small></span></li>
              <li className={styles.high_impact_error}><i /><span><b>Erro de alto impacto</b><small>alternativa 5 pts. ou mais melhor</small></span></li>
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
                  <small>Turno {item.turn ?? "—"} · confiança {confidenceLabels[item.confidence]} · execução {item.executionQuality.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/100 · {item.regretScore.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pts.</small>
                </summary>
                <div className={styles.decisionBody}>
                  {item.marker !== "good" && <p className={styles.decisionMeaning}><strong>Por que este marcador apareceu:</strong> o avaliador comparou a ação realizada com as alternativas disponíveis naquele instante. A diferença abaixo é uma estimativa, não a revelação de uma jogada obrigatória.</p>}
                  <div className={`${styles.decisionComparison} ${item.marker === "good" ? styles.singleDecisionComparison : ""}`}>
                    <article>
                      <small>Ação realizada</small>
                      <strong>{actionLabel(item.chosenAction)}</strong>
                      <span>{item.chosenActionValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pontos heurísticos</span>
                      <DecisionLine sequence={item.chosenSequence} />
                    </article>
                    {item.marker !== "good" && (
                      <article>
                        <small>Melhor linha encontrada</small>
                        <strong>{actionLabel(item.bestAction)}</strong>
                        <span>{item.bestActionValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pontos heurísticos</span>
                        <DecisionLine sequence={item.bestAction.sequence ?? []} />
                      </article>
                    )}
                  </div>
                  <p>{item.explanation}</p>
                  <p>Horizonte: {horizonLabel(item.horizon)} · {item.search.nodesVisited}/{item.search.budget} estados explorados · {item.search.nodesPruned} repetições podadas. A continuação após a escolha capturada é calculada; habilidades de herói, compras e resposta adversária não simuladas.</p>
                  <InformationSearchDetails analysis={item.hiddenInformation} />
                  {item.chosenAction.scoreTrace && <details className={styles.alternatives}>
                    <summary>Decomposição da pontuação</summary>
                    {[item.chosenAction, ...(item.marker === "good" ? [] : [item.bestAction])].map((action) => <div key={action.key}>
                      <strong>{actionLabel(action)}</strong>
                      <ul>{action.scoreTrace?.map((term) => <li key={term.term}><span>{scoreTermLabels[term.term] ?? term.term}: {term.value} × {term.weight}</span><b>{term.contribution.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} pts.</b></li>)}</ul>
                    </div>)}
                  </details>}
                  {item.alternatives.length > 0 && (
                    <div className={styles.alternatives}>
                      <strong>Outras alternativas comparadas</strong>
                      <ol>{item.alternatives.slice(0, 2).map((alternative) => (
                        <li key={alternative.key}><span>{actionLabel(alternative)}</span><b>{alternative.heuristicScore.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pts.</b></li>
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

          <p className={styles.methodologyNote}><strong>Como ler:</strong> a pontuação é heurística e experimental. O motor compara sequências até o fim do turno e, em defesa, uma resposta usando a mão conhecida preservada. Compras futuras, habilidades de herói e respostas adversárias não são simuladas. Potencial e execução são índices de 0 a 100, não percentuais de vitória. Só entram informações disponíveis no instante da escolha. “Melhor” significa a melhor linha encontrada pelo avaliador dentro de sua cobertura e orçamento, não certeza absoluta.</p>
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
