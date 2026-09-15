import Link from "next/link";
import AuthenticatedHeader from "../components/authenticated-header";
import Icon from "../components/ui-icons";
import CardImage from "../components/card-image";
import { requireUser, type AuthUser } from "../../lib/auth";
import { cardArtImageUrl } from "../../lib/card-avatars";
import { listUserReplays, type AdminReplayMetadata, type ReplayMetadata } from "../../lib/replays";
import { workspaceSummaries } from "../../lib/player-workspace";
import WorkspaceActions from "./workspace-actions";
import ParticipationControl from "./participation-control";
import SyncOnboarding from "./sync-onboarding";
import styles from "../page.module.css";

type WorkspaceSummary = { isFavorite: boolean; reviewedAt: number | null; hasNote: boolean; tags: string[] };
type ReplayListItem = (ReplayMetadata | AdminReplayMetadata) & { workspace?: WorkspaceSummary };

type ReplayLibraryProps = {
  currentUser: AuthUser;
  replayList: ReplayListItem[];
  title: string;
  emptyDescription?: string;
  nextCursor?: string | null;
  paginationPath?: string;
  embedded?: boolean;
  workspaceFilter?: "all" | "favorites" | "reviewed" | "unreviewed";
  tagFilter?: string;
};

function cardName(cardId: string | null) {
  if (!cardId) return "Herói desconhecido";
  return cardId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0];
}

function resultLabel(result: string) {
  if (result === "victory") return "Vitória";
  if (result === "defeat") return "Derrota";
  return "Encerrada";
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

export function ReplayLibrary({
  currentUser,
  replayList,
  title,
  emptyDescription = "Grave uma partida no Talishar e abra o Hyperdriver para enviar o histórico automaticamente.",
  nextCursor = null,
  paginationPath = "/replays",
  embedded = false,
  workspaceFilter = "all",
  tagFilter = "",
}: ReplayLibraryProps) {
  const hasActiveFilters = workspaceFilter !== "all" || Boolean(tagFilter);
  const paginationQuery = new URLSearchParams();
  if (nextCursor) paginationQuery.set("cursor", nextCursor);
  if (!embedded && workspaceFilter !== "all") paginationQuery.set("workspace", workspaceFilter);
  if (!embedded && tagFilter) paginationQuery.set("tag", tagFilter);
  const content = (
    <section className={styles.library} aria-labelledby="replay-list-title">
        <div className={styles.libraryHeader}>
          <div><h2 id="replay-list-title">{title}</h2></div>
          <div className={styles.sectorBars} aria-hidden="true"><i /><i /><i /></div>
        </div>
        {!embedded && (
          <form action="/replays" method="get" className={styles.libraryFilters} aria-label="Filtros do caderno">
            <div className={styles.filterHeading}>
              <span>Filtros</span>
              <strong>Refinar replays</strong>
            </div>
            <label className={styles.filterField}>
              <span>Estado</span>
              <span className={styles.filterControl}>
                <select name="workspace" defaultValue={workspaceFilter}>
                  <option value="all">Todos os replays</option>
                  <option value="favorites">Favoritos</option>
                  <option value="reviewed">Revisados</option>
                  <option value="unreviewed">Não revisados</option>
                </select>
                <Icon name="chevronDown" size={14} />
              </span>
            </label>
            <label className={styles.filterField}>
              <span>Tag</span>
              <span className={`${styles.filterControl} ${styles.tagFilterControl}`}>
                <Icon name="search" size={15} />
                <input name="tag" maxLength={24} defaultValue={tagFilter} placeholder="Buscar por tag" />
              </span>
            </label>
            <div className={styles.filterActions}>
              <button className={styles.filterSubmit} type="submit">Aplicar <Icon name="arrowRight" size={15} /></button>
              {hasActiveFilters && <Link className={styles.clearFilters} href="/replays"><Icon name="x" size={14} /> Limpar</Link>}
            </div>
          </form>
        )}
        {!replayList.length ? (
          embedded
            ? <div className={styles.emptyLibrary}><strong>Nenhum replay sincronizado</strong><p>{emptyDescription}</p></div>
            : <SyncOnboarding fallback={emptyDescription} />
        ) : (
          <div className={styles.replayList}>
            {replayList.map((replay, index) => {
              const playerHero = cardName(replay.playerHeroId);
              const opponentHero = cardName(replay.opponentHeroId);
              const playerHeroFirstName = firstName(playerHero);
              const opponentHeroFirstName = firstName(opponentHero);
              const startedAt = new Date(replay.startedAt);
              return (
                <article className={`${styles.replayCard} ${styles[replay.result] ?? ""} ${replay.workspace ? styles.withWorkspace : ""}`} key={replay.id}>
                  <span className={styles.cardIndex}>RPL / {String(index + 1).padStart(3, "0")}</span>
                  <div className={styles.matchArt} aria-label={`${playerHero} contra ${opponentHero}`}>
                    <figure className={styles.heroCard}>
                      {replay.playerHeroId ? <CardImage src={cardArtImageUrl(replay.playerHeroId)} alt={playerHero} width={320} height={320} /> : <Icon name="imageOff" size={24} />}
                    </figure>
                    <span className={styles.versus}>VS</span>
                    <figure className={`${styles.heroCard} ${styles.opponentCard}`}>
                      {replay.opponentHeroId ? <CardImage src={cardArtImageUrl(replay.opponentHeroId)} alt={opponentHero} width={320} height={320} /> : <Icon name="imageOff" size={24} />}
                    </figure>
                  </div>
                  <div className={styles.replayInfo}>
                    <div className={styles.statusRow}>
                      <span className={styles.finished}>{resultLabel(replay.result)}</span>
                      <time dateTime={startedAt.toISOString()}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(startedAt)}</time>
                    </div>
                    <h3>{playerHeroFirstName} <span>vs.</span> {opponentHeroFirstName}</h3>
                    <dl className={styles.metadata}>
                      {"username" in replay && <div className={styles.metadataOwner}><dt>Usuário</dt><dd>{replay.username}</dd></div>}
                      <div><dt>Turno final</dt><dd>{replay.finalTurn ?? "—"}</dd></div>
                      <div><dt>Modo de jogo</dt><dd>{gameModeLabel(replay.gameMode)}</dd></div>
                      <ParticipationControl
                        replayId={replay.sourceMatchId}
                        participation={replay.participation}
                        source={replay.participationSource}
                      />
                    </dl>
                    {replay.workspace && (replay.workspace.hasNote || replay.workspace.tags.length > 0) && (
                      <div className={styles.replayTags} aria-label="Marcadores do caderno">
                        {replay.workspace.hasNote && <span className={styles.finished}>Tem notas</span>}
                        {replay.workspace.tags.map((tag) => <span className={styles.finished} key={tag}>{tag}</span>)}
                      </div>
                    )}
                  </div>
                  <div className={styles.replayActions}>
                    <Link className={styles.openReplay} href={`/replays/${replay.sourceMatchId}/table`}>Abrir replay <Icon name="arrowRight" size={15} /></Link>
                    <Link className={styles.analyseReplay} href={`/replays/${replay.sourceMatchId}`}>Análise <Icon name="chart" size={15} /></Link>
                  </div>
                  {replay.workspace && <WorkspaceActions replayId={replay.sourceMatchId} favorite={replay.workspace.isFavorite} />}
                </article>
              );
            })}
          </div>
        )}
        {nextCursor && (
          <Link className={styles.openReplay} href={`${paginationPath}?${paginationQuery.toString()}`}>
            Carregar mais replays <Icon name="arrowRight" size={15} />
          </Link>
        )}
    </section>
  );

  if (embedded) return content;

  return (
    <main className={styles.page}>
      <AuthenticatedHeader
        username={currentUser.username}
        avatarCardId={currentUser.avatarCardId}
        isAdmin={currentUser.role === "admin"}
      />
      {content}
    </main>
  );
}

export default async function ReplayLibraryPage({
  searchParams,
}: {
  searchParams?: Promise<{ cursor?: string | string[]; workspace?: string | string[]; tag?: string | string[] }>;
}) {
  const currentUser = await requireUser("/replays");
  const query = searchParams ? await searchParams : {};
  const cursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor;
  const requestedWorkspaceFilter = Array.isArray(query.workspace) ? query.workspace[0] : query.workspace;
  const workspaceFilter = requestedWorkspaceFilter === "favorites" || requestedWorkspaceFilter === "reviewed" || requestedWorkspaceFilter === "unreviewed"
    ? requestedWorkspaceFilter
    : "all";
  const tagFilter = (Array.isArray(query.tag) ? query.tag[0] : query.tag)?.trim() ?? "";
  const replayPage = await listUserReplays(currentUser.id, {
    cursor,
    workspace: workspaceFilter,
    tag: tagFilter,
  });
  const summaries = workspaceSummaries(currentUser.id, replayPage.items.map((replay) => replay.id));
  const decorated = replayPage.items.map((replay) => ({ ...replay, workspace: summaries.get(replay.id)! }));
  return (
    <ReplayLibrary
      currentUser={currentUser}
      replayList={decorated}
      nextCursor={replayPage.nextCursor}
      title="Replays recentes"
      workspaceFilter={workspaceFilter}
      tagFilter={tagFilter}
    />
  );
}
