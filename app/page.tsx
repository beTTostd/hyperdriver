import Link from "next/link";
import { redirect } from "next/navigation";
import Brand from "./components/brand";
import Icon from "./components/ui-icons";
import { getCurrentUser } from "../lib/auth";
import styles from "./landing.module.css";

export default async function LandingPage() {
  const currentUser = await getCurrentUser();
  if (currentUser) redirect("/me");

  const appLink = "/login?returnTo=%2Fme";

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Brand subtitle="Game intelligence" />
        <div className={styles.navActions}>
          <Link className={styles.navCta} href={appLink}>Acessar plataforma <Icon name="arrowUpRight" size={14} /></Link>
        </div>
      </nav>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.liveBadge}><i aria-hidden="true" /> LIVE / GAME DATA</span>
          <p className={styles.eyebrow}><span>01</span> Clareza para cada jogo</p>
          <h1>Acompanhe<br />seus jogos.<br /><em>Evolua a cada partida.</em></h1>
          <p className={styles.lead}>Transforme suas sessões em decisões melhores com estatísticas claras, histórico organizado e uma visão precisa do seu desempenho.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href={appLink}>Acompanhar meus jogos <Icon name="arrowRight" size={16} /></Link>
            <Link className={styles.textCta} href="#recursos">Conheça a plataforma <Icon name="arrowDown" size={15} /></Link>
          </div>
        </div>
        <div className={styles.signalPanel} aria-label="Visão geral das estatísticas">
          <div className={styles.panelTop}><span>VISÃO GERAL / 001</span><i /></div>
          <div className={styles.scanLine} aria-hidden="true" />
          <div className={styles.signalMetric}><small>Desempenho</small><strong>+24%</strong><span>últimas sessões</span></div>
          <div className={styles.chart} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><b /></div>
          <div className={styles.panelBottom}><span>Dados em contexto</span><strong>03 áreas de evolução</strong></div>
        </div>
      </section>
      <section className={styles.features} id="recursos" aria-labelledby="features-title">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}><span>02</span> Tudo em um só lugar</p>
          <h2 id="features-title">Jogue mais.<br /><em>Entenda melhor.</em></h2>
        </div>
        <div className={styles.featureGrid}>
          <article><span>01</span><h3>Estatísticas claras</h3><p>Veja o que aconteceu em cada sessão sem perder tempo procurando respostas.</p></article>
          <article><span>02</span><h3>Histórico organizado</h3><p>Compare seus jogos, identifique padrões e acompanhe sua evolução.</p></article>
          <article><span>03</span><h3>Decisões melhores</h3><p>Use seus dados para transformar experiência em consistência.</p></article>
        </div>
      </section>
      <footer className={styles.footer}><Brand subtitle="Play with perspective" /><span>Estatísticas que ajudam você a jogar melhor.</span></footer>
    </main>
  );
}
