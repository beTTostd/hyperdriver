import type { CSSProperties } from "react";
import Link from "next/link";
import AuthenticatedHeader from "../../components/authenticated-header";
import Icon from "../../components/ui-icons";
import CardImage from "../../components/card-image";
import { requireUser } from "../../../lib/auth";
import { cardArtImageUrl } from "../../../lib/card-avatars";
import { decisionAnalysisVisibleTo } from "../../../lib/decision-analysis";
import { getUserStats, type UserStatsFilters } from "../../../lib/user-stats";
import { activeGoalSummary } from "../../../lib/training-goals";
import styles from "./page.module.css";

type PageProps = {
  searchParams?: Promise<{
    period?: string | string[];
    mode?: string | string[];
  }>;
};

const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "365", label: "Últimos 12 meses" },
  { value: "all", label: "Todo o histórico" },
];

const MODE_LABELS: Record<string, string> = {
  blitz: "Blitz",
  cc: "Classic Constructed",
  commoner: "Commoner",
  draft: "Booster Draft",
  ll: "Living Legend",
  sealed: "Sealed Deck",
  upf: "Ultimate Pit Fight",
};

const TELEMETRY_METRICS = [
  { key: "offeredDamage", label: "Dano oferecido", className: "offered" },
  { key: "receivedDamage", label: "Dano recebido", className: "received" },
  { key: "equipmentBlocked", label: "Bloqueio por equipamento", className: "equipment" },
  { key: "cardBlocked", label: "Bloqueio por cartas", className: "card" },
  { key: "lifeGained", label: "Vida ganha", className: "life" },
] as const;

const DECISION_PATTERN_LABELS: Record<string, string> = {
  "early-blue-pitch": "Pitch de blues cedo demais",
  overblock: "Overblock",
  "lost-arsenal": "Arsenal perdido",
  "weak-arsenal": "Arsenal de baixo impacto",
  "interrupted-line": "Linha interrompida sem necessidade",
  "incompatible-hand": "Mãos incompatíveis",
  "insufficient-pitch": "Pitch insuficiente",
  "equipment-efficiency": "Equipamento pouco eficiente",
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cardName(cardId: string | null) {
  if (!cardId) return "Não informado";
  return cardId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modeLabel(mode: string | null) {
  if (!mode) return "Não informado";
  return MODE_LABELS[mode.toLowerCase()] ?? mode.toUpperCase();
}

function resultLabel(result: string) {
  if (result === "victory") return "Vitória";
  if (result === "defeat") return "Derrota";
  return "Não informado";
}

function formatMetric(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatWeek(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function sectionHeading(index: string, eyebrow: string, title: string, id: string) {
  return (
    <div className={styles.panelHeader}>
      <div>
        <p className={styles.eyebrow}><span>{index}</span>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
    </div>
  );
}

export default async function UserStatsPage({ searchParams }: PageProps) {
  const currentUser = await requireUser("/me/stats");
  const query = searchParams ? await searchParams : {};
  const filters: UserStatsFilters = {
    period: firstQueryValue(query.period),
    mode: firstQueryValue(query.mode),
  };
  const stats = await getUserStats(currentUser.id, filters);
  const maxEvolutionMatches = Math.max(1, ...stats.evolution.map((point) => point.matches));
  const decisionAnalysisVisible = decisionAnalysisVisibleTo(currentUser.role);
  const activeGoals = activeGoalSummary(currentUser.id);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <AuthenticatedHeader
          username={currentUser.username}
          avatarCardId={currentUser.avatarCardId}
          isAdmin={currentUser.role === "admin"}
        />

        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}><span>03</span> Perfil / inteligência de jogo</p>
            <h1>Estatísticas<br /><em>do jogador</em></h1>
            <p className={styles.lead}>Uma leitura direta do seu histórico, dos seus confrontos e da telemetria registrada.</p>
          </div>
          <div className={styles.headerSignal} aria-hidden="true"><i /><i /><i /></div>
        </header>

        <form className={styles.filters} action="/me/stats" method="get" aria-label="Filtros das estatísticas">
          <label>
            <span>Período</span>
            <select name="period" defaultValue={stats.filters.period}>
              {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Modo de jogo</span>
            <select name="mode" defaultValue={stats.filters.mode}>
              <option value="all">Todos os modos</option>
              {stats.availableModes.map((mode: string) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
            </select>
          </label>
          <button type="submit">Aplicar filtros <Icon name="arrowRight" size={15} /></button>
          <span className={styles.filterNote}>URL compartilhável / dados derivados dos seus replays</span>
        </form>

        <section className={styles.summary} aria-label="Resumo da performance">
          <article className={styles.summaryHighlight}>
            <small>Win rate</small>
            <strong>{formatPercent(stats.summary.winRate)}</strong>
            <span>{stats.summary.wins} vitórias em {stats.summary.matches} partidas</span>
          </article>
          <article>
            <small>Partidas</small>
            <strong>{stats.summary.matches}</strong>
            <span>no recorte atual</span>
          </article>
          <article>
            <small>Vitórias</small>
            <strong>{stats.summary.wins}</strong>
            <span>resultado confirmado</span>
          </article>
          <article>
            <small>Derrotas</small>
            <strong>{stats.summary.losses}</strong>
            <span>resultado confirmado</span>
          </article>
          <article>
            <small>Turnos médios</small>
            <strong>{formatMetric(stats.summary.averageTurns)}</strong>
            <span>quando informado</span>
          </article>
        </section>

        {stats.summary.matches === 0 && (
          <section className={styles.emptyState} aria-live="polite">
            <strong>Nenhum replay no período</strong>
            <p>Não encontramos partidas para os filtros atuais. Grave um jogo no Talishar ou amplie o período para começar a acompanhar sua evolução.</p>
          </section>
        )}

        <section className={styles.panel} aria-labelledby="evolution-title">
          {sectionHeading("01", "Evolução / semanal", "Performance ao longo do tempo", "evolution-title")}
          {stats.evolution.length ? (
            <>
              <div className={styles.legend} aria-hidden="true"><span><i className={styles.redLegend} /> Partidas</span><span><i className={styles.blueLegend} /> Win rate</span></div>
              <div className={styles.evolution}>
                {stats.evolution.map((point: { weekStart: string; matches: number; wins: number; winRate: number }) => {
                  const barStyle = { "--bar-width": `${Math.max(5, (point.matches / maxEvolutionMatches) * 100)}%`, "--win-width": `${Math.max(2, point.winRate)}%` } as CSSProperties;
                  return (
                    <div className={styles.evolutionRow} key={point.weekStart}>
                      <time dateTime={point.weekStart}>{formatWeek(point.weekStart)}</time>
                      <div className={styles.evolutionTrack} style={barStyle} tabIndex={0} aria-label={`${formatWeek(point.weekStart)}: ${point.matches} partidas, ${formatPercent(point.winRate)} de win rate`}>
                        <span className={styles.matchesBar} />
                        <span className={styles.winRateMarker} />
                      </div>
                      <strong>{point.matches}</strong>
                      <small>{formatPercent(point.winRate)}</small>
                    </div>
                  );
                })}
              </div>
            </>
          ) : <div className={styles.inlineEmpty}>Sem partidas para desenhar a evolução neste recorte.</div>}
        </section>

        <div className={styles.splitPanels}>
          <section className={styles.panel} aria-labelledby="heroes-title">
            {sectionHeading("02", "Heróis / escolha", "Heróis mais usados", "heroes-title")}
            {stats.heroes.length ? (
              <div className={styles.heroRanking}>
                {stats.heroes.map((hero: { heroId: string; hero: string; matches: number; wins: number; winRate: number; participation: number }, index: number) => (
                  <article className={styles.heroRow} key={hero.heroId}>
                    <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                    <figure>
                      <CardImage src={cardArtImageUrl(hero.heroId)} alt="" width={160} height={160} />
                    </figure>
                    <div className={styles.heroRowMain}>
                      <strong>{cardName(hero.heroId)}</strong>
                      <span>{hero.matches} partidas · {hero.wins} vitórias</span>
                      <div className={styles.progressTrack}><i style={{ width: `${hero.participation}%` }} /></div>
                    </div>
                    <b>{formatPercent(hero.winRate)}</b>
                  </article>
                ))}
              </div>
            ) : <div className={styles.inlineEmpty}>Os replays deste recorte não informam o herói do jogador.</div>}
          </section>

          <section className={styles.panel} aria-labelledby="matchups-title">
            {sectionHeading("03", "Matchups / amostra", "Confrontos recorrentes", "matchups-title")}
            {stats.matchups.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <caption className={styles.srOnly}>Desempenho contra heróis adversários com pelo menos duas partidas</caption>
                  <thead><tr><th>Adversário</th><th>Jogos</th><th>V / D</th><th>Win rate</th></tr></thead>
                  <tbody>
                    {stats.matchups.map((matchup: { opponentHeroId: string; matches: number; wins: number; losses: number; winRate: number }) => (
                      <tr key={matchup.opponentHeroId}>
                        <th scope="row"><CardImage src={cardArtImageUrl(matchup.opponentHeroId)} alt="" width={96} height={96} />{cardName(matchup.opponentHeroId)}</th>
                        <td>{matchup.matches}</td>
                        <td>{matchup.wins} / {matchup.losses}</td>
                        <td className={styles.tableMetric}>{formatPercent(matchup.winRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={styles.inlineEmpty}>Nenhum matchup tem duas partidas no recorte atual.</div>}
          </section>
        </div>

        <section className={styles.panel} aria-labelledby="telemetry-title">
          {sectionHeading("04", "Telemetria / dados", "O que aconteceu nas partidas", "telemetry-title")}
          {stats.telemetry.validReplayCount ? (
            <>
              <p className={styles.panelNote}>{stats.telemetry.validReplayCount} replay{stats.telemetry.validReplayCount === 1 ? "" : "s"} com telemetria válida · valores totais e média por replay</p>
              <div className={styles.telemetryGrid}>
                {TELEMETRY_METRICS.map((metric) => (
                  <article className={`${styles.telemetryCard} ${styles[metric.className]}`} key={metric.key}>
                    <small>{metric.label}</small>
                    <strong>{formatMetric(stats.telemetry.averages[metric.key])}</strong>
                    <span>média</span>
                    <b>{formatMetric(stats.telemetry.totals[metric.key])} total</b>
                  </article>
                ))}
              </div>
            </>
          ) : <div className={styles.inlineEmpty}>Telemetria indisponível para os replays filtrados.</div>}
        </section>

        {decisionAnalysisVisible && (
          <section className={`${styles.panel} ${styles.decisionPanel}`} aria-labelledby="decision-analysis-title">
            {sectionHeading("05", "Decisões / pós-partida", "Potencial, execução e sinais de deck", "decision-analysis-title")}
            {stats.decisionAnalysis.analyzedDecisions > 0 ? (
              <>
                <p className={styles.panelNote}>{stats.decisionAnalysis.analyzedDecisions} decisões com confiança média ou alta · avaliação no estado conhecido de cada escolha</p>
                <div className={styles.decisionSummary}>
                  <article><small>Potencial das mãos</small><strong>{stats.decisionAnalysis.averageHandPotential === null ? "—" : formatPercent(stats.decisionAnalysis.averageHandPotential)}</strong><span>máximo médio estimado</span></article>
                  <article><small>Qualidade da execução</small><strong>{stats.decisionAnalysis.averageExecutionQuality === null ? "—" : formatPercent(stats.decisionAnalysis.averageExecutionQuality)}</strong><span>linha escolhida vs. melhor encontrada</span></article>
                  <article><small>Variância do draw</small><strong>{stats.decisionAnalysis.varianceLimitedHands}</strong><span>baixo potencial com boa execução</span></article>
                  <article><small>Abaixo do potencial</small><strong>{stats.decisionAnalysis.executionBelowPotential}</strong><span>arrependimento estimado ≥ 2 p.p.</span></article>
                </div>

                <div className={styles.decisionInsights}>
                  <article>
                    <small>Padrões controláveis</small>
                    <h3>Execução recorrente</h3>
                    {stats.decisionAnalysis.patterns.length ? <ul>{stats.decisionAnalysis.patterns.map((pattern) => (
                      <li key={pattern.tag}><span>{DECISION_PATTERN_LABELS[pattern.tag] ?? pattern.tag}</span><b>{pattern.occurrences}×</b></li>
                    ))}</ul> : <p>Nenhum erro controlável se repetiu no recorte.</p>}
                  </article>
                  <article>
                    <small>Cobertura estatística</small>
                    <h3>Sinais de deck</h3>
                    {stats.decisionAnalysis.deckSignals.length ? <ul>{stats.decisionAnalysis.deckSignals.map((signal) => (
                      <li key={signal.tag}><span>{DECISION_PATTERN_LABELS[signal.tag] ?? signal.tag}</span><b>{signal.occurrences}×</b></li>
                    ))}</ul> : <p>Nenhum padrão repetido teve intervalo de confiança que excluísse efeito neutro.</p>}
                  </article>
                </div>

                {stats.decisionAnalysis.byHeroMatchup.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table>
                      <caption className={styles.srOnly}>Análise de decisões por herói e matchup</caption>
                      <thead><tr><th>Herói / matchup</th><th>Decisões</th><th>Potencial</th><th>Execução</th><th>Arrependimento</th></tr></thead>
                      <tbody>{stats.decisionAnalysis.byHeroMatchup.map((matchup) => (
                        <tr key={`${matchup.playerHeroId}-${matchup.opponentHeroId}`}>
                          <th scope="row">{cardName(matchup.playerHeroId)} <span>vs.</span> {cardName(matchup.opponentHeroId)}</th>
                          <td>{matchup.decisions}</td>
                          <td>{formatPercent(matchup.averagePotential)}</td>
                          <td>{formatPercent(matchup.averageExecution)}</td>
                          <td className={styles.tableMetric}>{formatMetric(matchup.averageRegretPp)} p.p.</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <p className={styles.decisionCaveat}>Um sinal de deck não é uma recomendação de troca. Alterações só devem ser consideradas após repetição suficiente; uma única derrota nunca gera sugestão de carta.</p>
              </>
            ) : <div className={styles.inlineEmpty}>Ainda não há decisões com confiança suficiente nos replays filtrados.</div>}
          </section>
        )}

        <section className={styles.panel} aria-labelledby="goals-title">
          {sectionHeading("06", "Treinamento / foco", "Metas ativas", "goals-title")}
          {activeGoals.length ? <div className={styles.recentList}>{activeGoals.map((goal) => <article className={styles.recentMatch} key={goal.id}><div className={styles.recentInfo}><strong>{goal.title}</strong><small>{goal.progressMatches} de {goal.targetMatches} partidas acompanhadas</small></div><Link href="/me/goals">Abrir metas</Link></article>)}</div> : <div className={styles.inlineEmpty}>Nenhuma meta ativa. <Link href="/me/goals">Criar uma meta</Link></div>}
        </section>

        <section className={styles.panel} aria-labelledby="recent-title">
          {sectionHeading(decisionAnalysisVisible ? "06" : "05", "Histórico / recente", "Últimas partidas", "recent-title")}
          {stats.recentMatches.length ? (
            <div className={styles.recentList}>
              {stats.recentMatches.map((match: { id: number; sourceMatchId: string; result: string; playerHeroId: string | null; opponentHeroId: string | null; gameMode: string | null; startedAt: number; finalTurn: number | null }, index: number) => (
                <article className={`${styles.recentMatch} ${styles[match.result] ?? ""}`} key={match.id}>
                  <span className={styles.recentIndex}>RPL / {String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.recentHeroes} aria-label={`${cardName(match.playerHeroId)} contra ${cardName(match.opponentHeroId)}`}>
                    {match.playerHeroId ? <CardImage src={cardArtImageUrl(match.playerHeroId)} alt={cardName(match.playerHeroId)} width={96} height={96} /> : <span>?</span>}
                    <b>VS</b>
                    {match.opponentHeroId ? <CardImage src={cardArtImageUrl(match.opponentHeroId)} alt={cardName(match.opponentHeroId)} width={96} height={96} /> : <span>?</span>}
                  </div>
                  <div className={styles.recentInfo}>
                    <strong>{cardName(match.playerHeroId)} <span>vs.</span> {cardName(match.opponentHeroId)}</strong>
                    <small><time dateTime={new Date(match.startedAt).toISOString()}>{formatDate(match.startedAt)}</time> · {modeLabel(match.gameMode)} · turno {match.finalTurn ?? "Não informado"}</small>
                  </div>
                  <span className={styles.recentResult}>{resultLabel(match.result)}</span>
                  <div className={styles.recentActions}>
                    <Link href={`/replays/${match.sourceMatchId}`} aria-label={`Abrir análise de ${cardName(match.playerHeroId)} contra ${cardName(match.opponentHeroId)}`}><Icon name="chart" size={15} /> <span>Análise</span></Link>
                    <Link href={`/replays/${match.sourceMatchId}/table`} aria-label="Abrir mesa do replay"><Icon name="arrowRight" size={15} /> <span>Mesa</span></Link>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.inlineEmpty}>Nenhuma partida recente para os filtros atuais.</div>}
        </section>

        <footer className={styles.footer}><strong>Privado por padrão</strong><span>As estatísticas são derivadas apenas dos replays associados à sua conta e recalculadas a cada carregamento.</span></footer>
      </div>
    </main>
  );
}
