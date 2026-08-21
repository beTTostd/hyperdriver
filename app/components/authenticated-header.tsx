import Brand from "./brand";
import Icon from "./ui-icons";
import AuthControls from "./auth-controls";
import styles from "./authenticated-header.module.css";

type AuthenticatedHeaderProps = {
  username: string;
  avatarCardId?: string | null;
  isAdmin?: boolean;
};

const extensionUrl = "/downloads/hyperdriver-extension.zip";

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
          download="hyperdriver-extension.zip"
        >
          Instalar extensão <Icon name="download" size={14} />
        </a>
      </div>
      <AuthControls username={username} avatarCardId={avatarCardId} isAdmin={isAdmin} />
    </header>
  );
}
