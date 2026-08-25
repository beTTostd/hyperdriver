import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth";
import { listExtensionArtifacts } from "../../../lib/extension-artifacts.js";
import styles from "../admin-content.module.css";
import extensionStyles from "./page.module.css";

export const metadata: Metadata = {
  title: "versões da extensão",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default async function ExtensionVersionsPage() {
  await requireAdmin("/admin/extensoes");
  const artifacts = listExtensionArtifacts();

  return (
    <div className={styles.content}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}><span>02</span> Administração</p>
          <h1>Versões da extensão</h1>
          <p className={styles.description}>Artefatos publicados em <code>public/downloads</code>, prontos para instalação.</p>
        </div>
      </header>

      {!artifacts.length ? (
        <div className={extensionStyles.emptyState}>
          <strong>Nenhuma versão publicada</strong>
          <p>Adicione um ZIP no formato <code>hyperdriver-extension-vX.Y.Z.zip</code> para disponibilizá-lo aqui.</p>
        </div>
      ) : (
        <ul className={extensionStyles.artifactList}>
          {artifacts.map((artifact, index) => {
            const createdAt = new Date(artifact.createdAt);
            return (
              <li className={extensionStyles.artifact} key={artifact.fileName}>
                <div className={extensionStyles.artifactIndex}>EXT / {String(index + 1).padStart(2, "0")}</div>
                <div className={extensionStyles.artifactInfo}>
                  <strong>v{artifact.version}</strong>
                  <span>{artifact.fileName}</span>
                  <time dateTime={createdAt.toISOString()}>Data de criação: {dateFormatter.format(createdAt)}</time>
                </div>
                <a className={extensionStyles.download} href={artifact.url} download={artifact.fileName}>
                  Baixar <span aria-hidden="true">↓</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
