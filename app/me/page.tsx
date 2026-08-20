import Link from "next/link";
import AuthenticatedHeader from "../components/authenticated-header";
import { requireUser } from "../../lib/auth";
import { cardImageUrl } from "../../lib/card-avatars";
import { listUserReplays } from "../../lib/replays";
import styles from "../page.module.css";

function cardName(cardId: string | null) {
  if (!cardId) return "Herói desconhecido";
  return cardId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resultLabel(result: string) {
  if (result === "victory") return "Vitória";
  if (result === "defeat") return "Derrota";
  return "Encerrada";
}

export default async function ProfilePage() {
  const currentUser = await requireUser("/me");
  const replayList = listUserReplays(currentUser.id);
  return (
    <main className={styles.page}>
      <AuthenticatedHeader username={currentUser.username} avatarCardId={currentUser.avatarCardId} />
      <section className={styles.library} aria-labelledby="replay-list-title">
        <div className={styles.libraryHeader}>
          <div><h2 id="replay-list-title">Replays recentes</h2></div>
          <div className={styles.sectorBars} aria-hidden="true"><i /><i /><i /></div>
        </div>
        {!replayList.length ? (
          <div className={styles.emptyLibrary}>
            <strong>Nenhum replay sincronizado</strong>
            <p>Grave uma partida no Talishar e abra o Hyperdriver para enviar o histórico automaticamente.</p>
          </div>
        ) : (
          <div className={styles.replayList}>
            {replayList.map((replay, index) => {
              const playerHero = cardName(replay.playerHeroId);
              const opponentHero = cardName(replay.opponentHeroId);
              const startedAt = new Date(replay.startedAt);
              return (
                <article className={`${styles.replayCard} ${styles[replay.result] ?? ""}`} key={replay.id}>
                  <span className={styles.cardIndex}>RPL / {String(index + 1).padStart(3, "0")}</span>
                  <div className={styles.matchArt} aria-label={`${playerHero} contra ${opponentHero}`}>
                    <figure className={styles.heroCard}>
                      {replay.playerHeroId ? <img src={cardImageUrl(replay.playerHeroId)} alt={playerHero} /> : <span>?</span>}
                    </figure>
                    <span className={styles.versus}>VS</span>
                    <figure className={`${styles.heroCard} ${styles.opponentCard}`}>
                      {replay.opponentHeroId ? <img src={cardImageUrl(replay.opponentHeroId)} alt={opponentHero} /> : <span>?</span>}
                    </figure>
                  </div>
                  <div className={styles.replayInfo}>
                    <div className={styles.statusRow}>
                      <span className={styles.finished}>{resultLabel(replay.result)}</span>
                      <time dateTime={startedAt.toISOString()}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(startedAt)}</time>
                    </div>
                    <h3>{playerHero} <span>vs.</span> {opponentHero}</h3>
                    <dl className={styles.metadata}>
                      <div><dt>Turno final</dt><dd>{replay.finalTurn ?? "—"}</dd></div>
                      <div><dt>Snapshots</dt><dd>{replay.frameCount}</dd></div>
                      <div><dt>Origem</dt><dd>Talishar</dd></div>
                    </dl>
                  </div>
                  <div className={styles.replayActions}>
                    <Link className={styles.openReplay} href={`/mesa?replay=${replay.id}`}>Abrir replay <span aria-hidden="true">→</span></Link>
                    <Link className={styles.analyseReplay} href={`/valor?replay=${replay.id}`}>Ver telemetria <span aria-hidden="true">↗</span></Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
