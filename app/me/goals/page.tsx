import AuthenticatedHeader from "../../components/authenticated-header";
import { requireUser } from "../../../lib/auth";
import { listGoals } from "../../../lib/training-goals";
import GoalsClient from "./goals-client";
import styles from "../../replays/workspace-panel.module.css";

export default async function GoalsPage() {
  const user = await requireUser("/me/goals");
  const goals = listGoals(user.id);
  return <main><AuthenticatedHeader username={user.username} avatarCardId={user.avatarCardId} isAdmin={user.role === "admin"} /><div className={styles.panel}><header className={styles.header}><div><p>Treinamento / ciclo contínuo</p><h1>Metas de treinamento</h1><p>Transforme feedback em foco e acompanhe as próximas partidas sem misturar o resultado ao win rate.</p></div></header></div><GoalsClient goals={goals} /></main>;
}
