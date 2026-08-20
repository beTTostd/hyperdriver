import Link from "next/link";
import Brand from "../components/brand";
import AuthControls from "../components/auth-controls";
import { listAdminUsers, requireAdmin } from "../../lib/auth";
import AdminPanel from "./admin-panel";
import styles from "../auth.module.css";

export default async function AdminPage() {
  const currentUser = await requireAdmin();
  const initialUsers = listAdminUsers();
  return (
    <main className={styles.adminPage}>
      <div className={styles.adminShell}>
        <nav className={styles.adminNav}>
          <Brand subtitle="User control" />
          <div>
            <Link href="/me">Replays</Link>
            <AuthControls username={currentUser.username} avatarCardId={currentUser.avatarCardId} isAdmin />
          </div>
        </nav>
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
