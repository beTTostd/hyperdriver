import Brand from "./brand";
import AuthControls from "./auth-controls";
import styles from "./authenticated-header.module.css";

type AuthenticatedHeaderProps = {
  username: string;
  avatarCardId?: string | null;
  isAdmin?: boolean;
};

const extensionUrl = "https://github.com/beTTostd/hyperdriver/tree/main/talishar-local-history";

export default function AuthenticatedHeader({
  username,
  avatarCardId = null,
  isAdmin = false,
}: AuthenticatedHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Brand subtitle={null} />
        <a
          className={styles.installButton}
          href={extensionUrl}
          target="_blank"
          rel="noreferrer"
        >
          Instalar extensão <span aria-hidden="true">↗</span>
        </a>
      </div>
      <AuthControls username={username} avatarCardId={avatarCardId} isAdmin={isAdmin} />
    </header>
  );
}
