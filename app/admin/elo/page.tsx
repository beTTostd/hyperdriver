import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth";
import { getEloAdminData } from "../../../lib/elo";
import styles from "../admin-content.module.css";
import eloStyles from "./page.module.css";

export const metadata: Metadata = {
  title: "Elo Talishar",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default async function AdminEloPage({
  searchParams,
}: {
  searchParams?: Promise<{ format?: string | string[] }>;
}) {
  await requireAdmin("/admin/elo");
  const query = searchParams ? await searchParams : {};
  const requestedFormat = Array.isArray(query.format) ? query.format[0] : query.format;
  const data = getEloAdminData(requestedFormat);

  return (
    <div className={styles.content}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}><span>04</span> Administração</p>
          <h1>Elo Talishar</h1>
          <p className={styles.description}>
            Ranking PvP por nick e formato. Cada <code>gameGUID</code> altera os pontos uma única vez.
          </p>
        </div>
        {data.formats.length > 0 && (
          <form className={eloStyles.filter} action="/admin/elo" method="get">
            <label htmlFor="elo-format">Formato</label>
            <div>
              <select id="elo-format" name="format" defaultValue={data.selectedFormat ?? ""}>
                {data.formats.map((format) => (
                  <option value={format} key={format}>{format.toUpperCase()}</option>
                ))}
              </select>
              <button type="submit">Filtrar</button>
            </div>
          </form>
        )}
      </header>

      <section className={eloStyles.section} aria-labelledby="elo-ranking-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Classificação</p>
            <h2 id="elo-ranking-title">
              {data.selectedFormat ? data.selectedFormat.toUpperCase() : "Sem formato"}
            </h2>
          </div>
          <span className={styles.count}>{data.ranking.length} jogadores</span>
        </div>

        {data.ranking.length === 0 ? (
          <p className={styles.empty}>Nenhuma partida elegível foi pontuada ainda.</p>
        ) : (
          <div className={eloStyles.tableScroll}>
            <table className={eloStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Posição</th>
                  <th scope="col">Nick Talishar</th>
                  <th scope="col">Elo</th>
                  <th scope="col">Partidas</th>
                  <th scope="col">Vitórias</th>
                  <th scope="col">Derrotas</th>
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((entry) => (
                  <tr key={entry.playerId}>
                    <td><strong>#{entry.position}</strong></td>
                    <td>{entry.nickname}</td>
                    <td><strong>{Math.round(entry.rating)}</strong></td>
                    <td>{entry.games}</td>
                    <td>{entry.wins}</td>
                    <td>{entry.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={eloStyles.section} aria-labelledby="elo-conflicts-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Auditoria</p>
            <h2 id="elo-conflicts-title">Conflitos recentes</h2>
          </div>
          <span className={styles.count}>{data.conflicts.length} conflitos</span>
        </div>
        {data.conflicts.length === 0 ? (
          <p className={styles.empty}>Nenhuma divergência foi registrada.</p>
        ) : (
          <ul className={eloStyles.conflicts}>
            {data.conflicts.map((conflict) => (
              <li key={conflict.gameGuid}>
                <div>
                  <code>{conflict.gameGuid}</code>
                  <time dateTime={new Date(conflict.conflictAt).toISOString()}>
                    {dateFormatter.format(new Date(conflict.conflictAt))}
                  </time>
                </div>
                <p>{conflict.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
