import { getCurrentUser } from "../../lib/auth";
import AuthenticatedHeader from "../components/authenticated-header";
import AdminSidebar from "./admin-sidebar";
import styles from "./admin-layout.module.css";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const currentUser = await getCurrentUser();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        {currentUser && (
          <AuthenticatedHeader
            username={currentUser.username}
            avatarCardId={currentUser.avatarCardId}
            isAdmin
          />
        )}
        <div className={styles.layout}>
          <AdminSidebar />
          <section className={styles.content}>{children}</section>
        </div>
      </div>
    </main>
  );
}
