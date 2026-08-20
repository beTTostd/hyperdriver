import AuthenticatedHeader from "../components/authenticated-header";
import { listAdminUsers, requireAdmin } from "../../lib/auth";
import AdminPanel from "./admin-panel";
import styles from "../auth.module.css";

export default async function AdminPage() {
  const currentUser = await requireAdmin();
  const initialUsers = listAdminUsers();
  return (
    <main className={styles.adminPage}>
      <div className={styles.adminShell}>
        <AuthenticatedHeader username={currentUser.username} avatarCardId={currentUser.avatarCardId} isAdmin />
        <header className={styles.adminHeader}>
          <p className={styles.eyebrow}>01 · Controle de acesso</p>
          <h1>Equipe<br /><em>de pista</em></h1>
          <p className={styles.description}>Crie acessos e entregue um link seguro para cada pessoa definir sua primeira senha.</p>
        </header>
        <AdminPanel initialUsers={initialUsers} />
      </div>
    </main>
  );
}
