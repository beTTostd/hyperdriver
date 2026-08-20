import Link from "next/link";
import Brand from "../components/brand";
import AuthControls from "../components/auth-controls";
import { requireUser } from "../../lib/auth";
import styles from "../page.module.css";

const heroImage = "https://images.talishar.net/public/cardimages/english/dash_io.webp";

export default async function ProfilePage() {
  const currentUser = await requireUser("/me");
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Brand subtitle={null} />
          <a
            className={styles.installButton}
            href="https://github.com/beTTostd/hyperdriver/tree/main/talishar-local-history"
            target="_blank"
            rel="noreferrer"
          >
            Instalar extensão <span aria-hidden="true">↗</span>
          </a>
        </div>
        <AuthControls username={currentUser.username} avatarCardId={currentUser.avatarCardId} />
      </header>
      <section className={styles.intro}>
        <div className={styles.introCopy}>
          <p><span>01</span> Central de telemetria</p>
          <h1>Leia a corrida.<br /><em>Domine o turno.</em></h1>
          <span>Reveja cada decisão, turno e combat chain com a precisão de uma equipe de pista.</span>
        </div>
        <aside className={styles.sessionStatus} aria-label="Status da sessão">
          <span>Sessão local</span><strong>1 replay</strong><small>Dados processados no navegador</small>
        </aside>
      </section>
      <section className={styles.library} aria-labelledby="replay-list-title">
        <div className={styles.libraryHeader}>
          <div><p>Última sessão</p><h2 id="replay-list-title">Replays recentes</h2></div>
          <div className={styles.sectorBars} aria-hidden="true"><i /><i /><i /></div>
        </div>
        <article className={styles.replayCard}>
          <span className={styles.cardIndex}>RPL / 001</span>
          <div className={styles.matchArt} aria-label="Dash I/O contra Dash I/O">
            <figure className={styles.heroCard}><img src={heroImage} alt="Dash I/O" /></figure>
            <span className={styles.versus}>VS</span>
            <figure className={`${styles.heroCard} ${styles.opponentCard}`}><img src={heroImage} alt="Dash I/O do oponente" /></figure>
          </div>
          <div className={styles.replayInfo}>
            <div className={styles.statusRow}><span className={styles.finished}>Encerrada</span><time dateTime="2026-08-16T21:25:30.937Z">16 ago 2026 · 18:25</time></div>
            <h3>Dash I/O <span>vs.</span> Dash I/O</h3>
            <p className={styles.score}><small>Você</small><strong>00</strong><span>:</span><strong>02</strong><small>Oponente</small></p>
            <dl className={styles.metadata}><div><dt>Snapshots</dt><dd>275</dd></div><div><dt>Turno final</dt><dd>4</dd></div><div><dt>Origem</dt><dd>Talishar</dd></div></dl>
          </div>
          <div className={styles.replayActions}>
            <Link className={styles.openReplay} href="/mesa">Abrir replay <span aria-hidden="true">→</span></Link>
            <Link className={styles.analyseReplay} href="/valor">Ver telemetria <span aria-hidden="true">↗</span></Link>
          </div>
        </article>
      </section>
    </main>
  );
}
