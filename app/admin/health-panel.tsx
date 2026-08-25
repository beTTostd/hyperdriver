"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../components/ui-icons";
import type {
  UploadEventCategory,
  UploadEventPage,
  UploadHealthSummary,
} from "../../lib/upload-telemetry";
import styles from "./health-panel.module.css";

const categories: UploadEventCategory[] = ["success", "error", "duplicate", "non_t0", "corrupt"];
const labels: Record<UploadEventCategory, string> = {
  success: "Partidas aceitas",
  error: "Uploads com erro",
  duplicate: "Arquivos duplicados",
  non_t0: "Não começou no T0",
  corrupt: "Arquivos corrompidos",
};

type Selection = { date: string; label: string; category: UploadEventCategory } | null;

export default function HealthPanel({ initialSummary }: { initialSummary: UploadHealthSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [selection, setSelection] = useState<Selection>(null);
  const [details, setDetails] = useState<UploadEventPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/upload-health", { cache: "no-store" });
      const data = await response.json() as { summary?: UploadHealthSummary; error?: string };
      if (!response.ok || !data.summary) throw new Error(data.error || "Não foi possível atualizar os dados.");
      setSummary(data.summary);
      if (selection) {
        setSelection(null);
        setDetails(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar os dados.");
    } finally {
      setLoading(false);
    }
  }, [selection]);

  const selectCell = useCallback(async (date: string, dateLabel: string, category: UploadEventCategory, page = 1) => {
    setSelection({ date, label: dateLabel, category });
    setDetailsLoading(true);
    setDetailsError("");
    try {
      const params = new URLSearchParams({ date, category, page: String(page) });
      const response = await fetch("/api/admin/upload-health?" + params.toString(), { cache: "no-store" });
      const data = await response.json() as { details?: UploadEventPage; error?: string };
      if (!response.ok || !data.details) throw new Error(data.error || "Não foi possível carregar as tentativas.");
      setDetails(data.details);
    } catch (caught) {
      setDetailsError(caught instanceof Error ? caught.message : "Não foi possível carregar as tentativas.");
      setDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const lastUpdated = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(summary.generatedAt));
  const maxByCategory = useMemo(() => Object.fromEntries(categories.map((category) => [
    category,
    Math.max(...summary.days.map((day) => day.cells[category].count), 0),
  ])) as Record<UploadEventCategory, number>, [summary]);

  return (
    <div className={styles.content}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}><span>01</span> Administração</p>
          <h1>Saúde do sistema</h1>
          <p className={styles.description}>Últimos sete dias-calendário de uploads, agrupados em {summary.timeZone}.</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.updatedAt}><span>Janela</span><strong>{summary.window.label}</strong><small>Atualizado às {lastUpdated}</small></div>
          <button className={styles.refreshButton} type="button" onClick={refresh} disabled={loading}>
            <Icon name="refresh" size={15} /> {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.summaryGrid} aria-label="Resumo das tentativas de upload">
        {summary.categories.map((category) => (
          <article className={styles.summaryCard} key={category.key}>
            <span>{category.label}</span>
            <strong>{category.total.toLocaleString("pt-BR")}</strong>
            <small>tentativas na janela</small>
          </article>
        ))}
      </section>

      <section className={styles.heatmapSection} aria-labelledby="heatmap-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}><span>LEITURA</span> Volume diário</p>
            <h2 id="heatmap-title">Tentativas por dia</h2>
          </div>
          <p className={styles.sectionNote}>Selecione uma célula para abrir o detalhe.</p>
        </div>

        <div className={styles.legend} aria-label="Legenda de intensidade do heatmap">
          <span>Intensidade</span><i className={styles.legend0}>0</i><i className={styles.legend1}>1</i><i className={styles.legend2}>2</i><i className={styles.legend3}>3</i><i className={styles.legend4}>4+</i>
          <small>número e borda reforçam a diferença além da cor</small>
        </div>

        {summary.total === 0 && <p className={styles.emptyState}>Nenhuma tentativa registrada nos últimos sete dias.</p>}
        <div className={styles.tableScroller}>
          <table className={styles.heatmap}>
            <caption className={styles.visuallyHidden}>Tentativas de upload por dia e categoria</caption>
            <thead>
              <tr><th scope="col">Dia</th>{categories.map((category) => <th scope="col" key={category}>{labels[category]}</th>)}</tr>
            </thead>
            <tbody>
              {summary.days.map((day) => (
                <tr key={day.date}>
                  <th scope="row"><time dateTime={day.date}>{day.label}</time><small>{day.total} total</small></th>
                  {categories.map((category) => {
                    const cell = day.cells[category];
                    const max = maxByCategory[category];
                    const level = cell.count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((cell.count / Math.max(max, 1)) * 4)));
                    const selected = selection?.date === day.date && selection.category === category;
                    return (
                      <td key={category}>
                        <button
                          className={styles.heatCell + " " + styles["level" + level] + (selected ? " " + styles.selected : "")}
                          type="button"
                          aria-pressed={selected}
                          title={day.label + ", " + labels[category] + ": " + cell.count + " (" + cell.percentage + "% do dia)"}
                          aria-label={day.label + ", " + labels[category] + ": " + cell.count + " tentativa" + (cell.count === 1 ? "" : "s") + ", " + cell.percentage + "% do dia"}
                          onClick={() => selectCell(day.date, day.label, category)}
                        >
                          <strong>{cell.count}</strong><small>{cell.percentage}%</small>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selection && (
        <section className={styles.detailsSection} aria-labelledby="details-title" aria-live="polite">
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}><span>DETALHE</span> Tentativas selecionadas</p>
              <h2 id="details-title">{labels[selection.category]} · {selection.label}</h2>
            </div>
            {details && <span className={styles.detailCount}>{details.total} registro{details.total === 1 ? "" : "s"}</span>}
          </div>
          {detailsLoading && <p className={styles.emptyState}>Carregando tentativas…</p>}
          {detailsError && <p className={styles.error} role="alert">{detailsError}</p>}
          {!detailsLoading && !detailsError && details && details.items.length === 0 && <p className={styles.emptyState}>Nenhum registro nessa célula.</p>}
          {!detailsLoading && details && details.items.length > 0 && (
            <>
              <div className={styles.detailScroller}>
                <table className={styles.detailsTable}>
                  <caption className={styles.visuallyHidden}>Tentativas selecionadas</caption>
                  <thead><tr><th>Horário</th><th>Usuário</th><th>Partida</th><th>Categoria</th><th>Status</th><th>Código</th><th>Mensagem técnica</th><th>Replay</th></tr></thead>
                  <tbody>{details.items.map((item) => {
                    const occurredAt = new Date(item.attemptedAt);
                    return <tr key={item.id}>
                      <td><time dateTime={occurredAt.toISOString()}>{formatTime(occurredAt)}</time></td>
                      <td>{item.username}</td>
                      <td className={styles.mono}>{item.sourceMatchId || "—"}</td>
                      <td>{labels[item.category]}</td>
                      <td className={styles.mono}>{item.httpStatus}</td>
                      <td className={styles.mono}>{item.errorCode || "—"}</td>
                      <td>{item.technicalMessage || "—"}</td>
                      <td>{item.replayId && item.sourceMatchId ? <Link href={"/replays/" + item.sourceMatchId}>Abrir</Link> : "—"}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {details.pageCount > 1 && <div className={styles.pagination}>
                <button type="button" disabled={details.page <= 1 || detailsLoading} onClick={() => selectCell(selection.date, selection.label, selection.category, details.page - 1)}>Anterior</button>
                <span>Página {details.page} de {details.pageCount}</span>
                <button type="button" disabled={details.page >= details.pageCount || detailsLoading} onClick={() => selectCell(selection.date, selection.label, selection.category, details.page + 1)}>Próxima</button>
              </div>}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}
