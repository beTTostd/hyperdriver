import Link from "next/link";
import styles from "./page.module.css";

const heroImage = "https://images.talishar.net/public/cardimages/english/dash_io.webp";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Talishar History — início">
          <span className={styles.brandMark}>TH</span>
          <span><strong>Talishar History</strong><small>Biblioteca de partidas</small></span>
        </Link>
        <button className={styles.uploadButton} type="button" disabled title="Disponível em breve">
          <span aria-hidden="true">↑</span> Upload de replay <small>Em breve</small>
        </button>
      </header>

      <section className={styles.intro}>
        <p>Histórico de partidas</p>
        <h1>Seus replays</h1>
        <span>Revise cada decisão, turno e combat chain das suas partidas no Talishar.</span>
      </section>

      <section className={styles.library} aria-labelledby="replay-list-title">
        <div className={styles.libraryHeader}>
          <div><h2 id="replay-list-title">Partidas salvas</h2><p>1 replay disponível</p></div>
          <span className={styles.count}>1</span>
        </div>
        <article className={styles.replayCard}>
          <div className={styles.matchArt} aria-label="Dash I/O contra Dash I/O">
            <figure className={styles.heroCard}><img src={heroImage} alt="Dash I/O" /></figure>
            <span className={styles.versus}>VS</span>
            <figure className={`${styles.heroCard} ${styles.opponentCard}`}><img src={heroImage} alt="Dash I/O do oponente" /></figure>
          </div>
          <div className={styles.replayInfo}>
            <div className={styles.statusRow}><span className={styles.finished}>Encerrada</span><time dateTime="2026-08-16T21:25:30.937Z">16 ago 2026 · 18:25</time></div>
            <h3>Dash I/O vs. Dash I/O</h3>
            <p>Você <strong>0</strong> <span>—</span> <strong>2</strong> Oponente</p>
            <dl className={styles.metadata}>
              <div><dt>Snapshots</dt><dd>275</dd></div><div><dt>Turno final</dt><dd>4</dd></div><div><dt>Origem</dt><dd>Talishar</dd></div>
            </dl>
          </div>
          <div className={styles.replayActions}>
            <Link className={styles.analyseReplay} href="/valor">Valor por turno <span aria-hidden="true">↗</span></Link>
            <Link className={styles.openReplay} href="/mesa">Ver replay <span aria-hidden="true">→</span></Link>
          </div>
        </article>
      </section>
    </main>
  );
}
