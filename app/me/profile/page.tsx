import AuthenticatedHeader from "../../components/authenticated-header";
import { requireUser } from "../../../lib/auth";
import ProfileEditor from "../../perfil/editar/profile-editor";
import styles from "../../perfil/editar/page.module.css";

export default async function ProfilePage() {
  const currentUser = await requireUser("/me/profile");

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <AuthenticatedHeader
          username={currentUser.username}
          avatarCardId={currentUser.avatarCardId}
          isAdmin={currentUser.role === "admin"}
        />
        <ProfileEditor
          username={currentUser.username}
          avatarCardId={currentUser.avatarCardId}
        />
      </div>
    </main>
  );
}
