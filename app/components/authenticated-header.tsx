import Brand from "./brand";
import Icon from "./ui-icons";
import AuthControls from "./auth-controls";
import Link from "next/link";
import styles from "./authenticated-header.module.css";

const CHROME_WEB_STORE_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/ahbjlfpiejjlaplcjnipdcplnkoibegn?utm_source=header";

type AuthenticatedHeaderProps = {
  username: string;
  avatarCardId?: string | null;
  isAdmin?: boolean;
};

export default function AuthenticatedHeader({
  username,
  avatarCardId = null,
  isAdmin = false,
}: AuthenticatedHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Brand href="/replays" subtitle={null} />
        <a
          className={styles.installButton}
          href={CHROME_WEB_STORE_EXTENSION_URL}
          target="_blank"
          rel="noreferrer"
        >
          Instalar extensão <Icon name="externalLink" size={14} />
        </a>
        {isAdmin && (
          <Link className={styles.adminPartidasLink} href="/admin/replays">
            Partidas
          </Link>
        )}
      </div>
      <AuthControls
        username={username}
        avatarCardId={avatarCardId}
        isAdmin={isAdmin}
        extensionUrl={CHROME_WEB_STORE_EXTENSION_URL}
      />
    </header>
  );
}
