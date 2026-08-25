import Link from "next/link";
import AuthenticatedHeader from "../components/authenticated-header";
import Icon from "../components/ui-icons";
import CardImage from "../components/card-image";
import { requireUser, type AuthUser } from "../../lib/auth";
import { cardArtImageUrl } from "../../lib/card-avatars";
import { listUserReplays, type AdminReplayMetadata, type ReplayMetadata } from "../../lib/replays";
import styles from "../page.module.css";

type ReplayListItem = ReplayMetadata | AdminReplayMetadata;

type ReplayLibraryProps = {
  currentUser: AuthUser;
  replayList: ReplayListItem[];
  title: string;
  emptyDescription?: string;
  nextCursor?: string | null;
  paginationPath?: string;
  embedded?: boolean;
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
}: ReplayLibraryProps) {
  const content = (
    <section className={styles.library} aria-labelledby="replay-list-title">
        <div className={styles.libraryHeader}>
          <div><h2 id="replay-list-title">{title}</h2></div>
          <div className={styles.sectorBars} aria-hidden="true"><i /><i /><i /></div>
        </div>
        {!replayList.length ? (
          <div className={styles.emptyLibrary}>
            <strong>Nenhum replay sincronizado</strong>
            <p>{emptyDescription}</p>
          </div>
        ) : (
          <div className={styles.replayList}>
            {replayList.map((replay, index) => {
              const playerHero = cardName(replay.playerHeroId);
              const opponentHero = cardName(replay.opponentHeroId);
              const playerHeroFirstName = firstName(playerHero);
              const opponentHeroFirstName = firstName(opponentHero);
              const startedAt = new Date(replay.startedAt);
              return (
                <article className={`${styles.replayCard} ${styles[replay.result] ?? ""}`} key={replay.id}>
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
                    </dl>
                  </div>
                  <div className={styles.replayActions}>
                    <Link className={styles.openReplay} href={`/replays/${replay.sourceMatchId}/table`}>Abrir replay <Icon name="arrowRight" size={15} /></Link>
                    <Link className={styles.analyseReplay} href={`/replays/${replay.sourceMatchId}`}>Análise <Icon name="chart" size={15} /></Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {nextCursor && (
          <Link className={styles.openReplay} href={`${paginationPath}?cursor=${encodeURIComponent(nextCursor)}`}>
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
  searchParams?: Promise<{ cursor?: string | string[] }>;
}) {
  const currentUser = await requireUser("/replays");
  const query = searchParams ? await searchParams : {};
  const cursor = Array.isArray(query.cursor) ? query.cursor[0] : query.cursor;
  const replayPage = await listUserReplays(currentUser.id, cursor);
  return (
    <ReplayLibrary
      currentUser={currentUser}
      replayList={replayPage.items}
      nextCursor={replayPage.nextCursor}
      title="Replays recentes"
    />
  );
}
