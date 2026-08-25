import Brand from "./brand";
import Icon from "./ui-icons";
import AuthControls from "./auth-controls";
import Link from "next/link";
import styles from "./authenticated-header.module.css";
import { getLatestExtensionArtifact } from "../../lib/extension-artifacts.js";

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
  const extension = getLatestExtensionArtifact();

  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Brand href="/replays" subtitle={null} />
        {extension && (
          <a
            className={styles.installButton}
            href={extension.url}
            download={extension.fileName}
          >
            Instalar extensão <Icon name="download" size={14} />
          </a>
        )}
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
        extensionUrl={extension?.url}
        extensionDownloadName={extension?.fileName}
      />
    </header>
  );
}
