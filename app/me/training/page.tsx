import Link from "next/link";
import AuthenticatedHeader from "../../components/authenticated-header";
import { requireUser } from "../../../lib/auth";
import { listPracticeExercises } from "../../../lib/decision-practice";
import TrainingClient from "./training-client";
import styles from "../../replays/workspace-panel.module.css";

export default async function TrainingPage() {
  const user = await requireUser("/me/training");
  const practice = listPracticeExercises(user.id);
  return <main><AuthenticatedHeader username={user.username} avatarCardId={user.avatarCardId} isAdmin={user.role === "admin"} />
    <section className={styles.panel}><header className={styles.header}><div><p>Treinamento / decisões</p><h1>Treinar decisões</h1>
      <p>Revisite situações das suas partidas e compare sequências com as cartas conhecidas.</p></div><Link href="/me/goals" className={styles.linkButton}>Metas de treinamento</Link></header>
      <p className={styles.muted}>{practice.evaluatedMatches} partidas e {practice.evaluatedOpportunities} oportunidades avaliáveis nos últimos 50 replays analisados. {practice.practiced} exercícios praticados nesta versão.</p>
      <p className={styles.muted}>A comparação usa pontos heurísticos e cobertura limitada de efeitos. Praticar aqui não mede evolução nas próximas partidas.</p>
    </section><TrainingClient exercises={practice.exercises} /></main>;
}
