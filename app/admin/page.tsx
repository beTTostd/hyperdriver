import type { Metadata } from "next";
import AuthenticatedHeader from "../components/authenticated-header";
import { listAdminUsers, requireAdmin } from "../../lib/auth";
import AdminPanel from "./admin-panel";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "admin",
};

export default async function AdminPage() {
  const currentUser = await requireAdmin();
  const initialUsers = listAdminUsers();
  return (
    <main className={styles.adminPage}>
      <div className={styles.adminShell}>
        <AuthenticatedHeader username={currentUser.username} avatarCardId={currentUser.avatarCardId} isAdmin />
        <AdminPanel initialUsers={initialUsers} currentUserId={currentUser.id} />
      </div>
    </main>
  );
}
