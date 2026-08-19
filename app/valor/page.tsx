import Link from "next/link";
import styles from "./page.module.css";

const turns = [
  ["T0", "Você", 4, 3], ["T1", "Oponente", 6, 0], ["T1", "Você", 14, 0], ["T2", "Oponente", 25, 7],
  ["T2", "Você", 10, 0], ["T3", "Oponente", 19, 3], ["T3", "Você", 17, 3], ["T4", "Oponente", 4, 3],
] as const;

export default function TurnValuePage() {
  return <main className={styles.page}><div className={styles.shell}>
    <nav><Link href="/">← Replays</Link><Link href="/mesa">Abrir mesa ↗</Link></nav>
    <header><p>Análise da partida</p><h1>Valor por turno</h1><span>Valor = poder final dos ataques + bloqueio feito por cartas da mão.</span></header>
    <section className={styles.summary}><article><small>Valor total</small><strong>118</strong><span>8 turnos efetivos</span></article><article><small>Ataque</small><strong className={styles.attack}>99</strong><span>84% do valor</span></article><article><small>Bloqueio da mão</small><strong className={styles.block}>19</strong><span>Equipamentos excluídos</span></article><article><small>Melhor turno</small><strong>32</strong><span>T2 · Oponente</span></article></section>
    <section className={styles.panel}><div className={styles.panelHeader}><div><p>Comparação</p><h2>Produção de cada turno</h2></div><aside><i /> Ataque <b /> Bloqueio da mão</aside></div><div className={styles.chart}>{turns.map(([turn, player, attack, block]) => <div className={styles.row} key={`${turn}-${player}`}><label><strong>{turn}</strong><span className={player === "Você" ? styles.you : styles.opponent}>{player}</span></label><div className={styles.track}><i style={{width:`${attack / 32 * 100}%`}} /><b style={{width:`${block / 32 * 100}%`}} /></div><strong>{attack + block}</strong></div>)}</div></section>
    <section className={styles.panel}><div className={styles.panelHeader}><div><p>Detalhamento</p><h2>Números por turno</h2></div></div><div className={styles.tableWrap}><table><thead><tr><th>Turno</th><th>Jogador ativo</th><th>Ataque</th><th>Bloqueio da mão</th><th>Valor</th></tr></thead><tbody>{turns.map(([turn, player, attack, block]) => <tr key={`${turn}-${player}`}><td>{turn}</td><td><span className={player === "Você" ? styles.you : styles.opponent}>{player}</span></td><td className={styles.attack}>{attack}</td><td className={styles.block}>{block}</td><td><strong>{attack + block}</strong></td></tr>)}</tbody></table></div></section>
    <footer><strong>Como calculamos</strong><span>Ataque usa o poder final de cada ação na combat chain. O bloqueio considera somente cartas da mão; herói e equipamentos não entram no valor.</span></footer>
  </div></main>;
}
