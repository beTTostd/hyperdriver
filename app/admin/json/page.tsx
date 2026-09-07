import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth";
import { listAdminJsonFiles } from "../../../lib/admin-json";
import Icon from "../../components/ui-icons";
import contentStyles from "../admin-content.module.css";
import JsonUploadForm from "./json-upload-form";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "arquivos JSON" };

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminJsonPage() {
  await requireAdmin("/admin/json");
  const files = listAdminJsonFiles();

  return (
    <div className={contentStyles.content}>
      <header className={contentStyles.pageHeader}>
        <div>
          <p className={contentStyles.eyebrow}><span>JSON</span> Administração</p>
          <h1>Arquivos JSON</h1>
          <p className={contentStyles.description}>Caixa privada para armazenar arquivos sem validar nem analisar o conteúdo. Limite de 50 MB por arquivo.</p>
        </div>
      </header>

      <JsonUploadForm />

      <section className={styles.files} aria-labelledby="json-files-heading">
        <div className={contentStyles.sectionHeader}>
          <div>
            <p className={contentStyles.eyebrow}>Uploads recentes</p>
            <h2 id="json-files-heading">Arquivos armazenados</h2>
          </div>
          <span className={contentStyles.count}>{files.length} {files.length === 1 ? "arquivo" : "arquivos"}</span>
        </div>
        {!files.length ? (
          <p className={contentStyles.empty}>Nenhum arquivo JSON armazenado.</p>
        ) : (
          <ul className={styles.fileList}>
            {files.map((file, index) => {
              const uploadedAt = new Date(file.uploadedAt);
              return (
                <li className={styles.file} key={file.id}>
                  <span className={styles.index}>JSON / {String(index + 1).padStart(3, "0")}</span>
                  <div className={styles.fileInfo}>
                    <strong>{file.originalName}</strong>
                    <span>{formatBytes(file.sizeBytes)}</span>
                    <time dateTime={uploadedAt.toISOString()}>{dateFormatter.format(uploadedAt)}</time>
                    <span>Enviado por {file.adminUsername}</span>
                  </div>
                  <a className={styles.download} href={`/api/admin/json/${file.id}`} download={file.originalName}>
                    Baixar <Icon name="download" size={16} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
