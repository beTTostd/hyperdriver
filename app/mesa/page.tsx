"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Brand from "../components/brand";

type Card = {
  cardNumber?: string;
  counters?: number | string;
  countersMap?: Record<string, number | string>;
  defCounters?: number | string;
  powerCounters?: number | string;
  slot?: string;
  tapped?: boolean;
  isBroken?: boolean;
  pitchValue?: number | string;
};

type Payload = Record<string, unknown> & {
  turnNo?: string | number;
  turnPlayer?: string | number;
  turnPhase?: { turnPhase?: string; layer?: string; caption?: string };
  playerHealth?: string | number;
  opponentHealth?: string | number;
  playerEquipment?: Card[];
  opponentEquipment?: Card[];
  playerHand?: Card[];
  opponentHand?: Card[];
  playerArse?: Card[];
  opponentArse?: Card[];
  playerPitch?: Card[];
  opponentPitch?: Card[];
  playerPermanents?: Card[];
  opponentPermanents?: Card[];
  playerItems?: Card[];
  opponentItems?: Card[];
  playerBanish?: Card[];
  opponentBanish?: Card[];
  playerDeckCount?: number | string;
  opponentDeckCount?: number | string;
  chatLog?: string;
  activeChainLink?: {
    attackingCard?: Card;
    totalPower?: number | string;
    totalDefense?: number | string;
    reactions?: Card[];
    attackTarget?: string;
    goAgain?: boolean;
  } | null;
};

type Frame = { sequence: number; receivedAt: string; payload: Payload };
type Replay = { exportedAt?: string; match: { startedAt?: string; endedAt?: string | null; frames: Frame[] } };

const CARD_NAMES: Record<string, string> = {
  dash_io: "Dash I/O", symbiosis_shot: "Symbiosis Shot", teklo_foundry_heart: "Teklo Foundry Heart",
  crown_of_providence: "Crown of Providence", cogwerx_tinker_rings: "Cogwerx Tinker Rings", adaptive_plating: "Adaptive Plating",
  achilles_accelerator: "Achilles Accelerator", bios_update_red: "Bios Update", zero_to_sixty_red: "Zero to Sixty",
  fast_and_furious_red: "Fast and Furious", heist_red: "Heist", pulsewave_harpoon_red: "Pulsewave Harpoon",
  fender_bender_red: "Fender Bender", spark_of_genius_yellow: "Spark of Genius", zipper_hit_red: "Zipper Hit",
  throttle_blue: "Throttle", boom_grenade_red: "Boom Grenade", cerebellum_processor_blue: "Cerebellum Processor",
  teklo_trebuchet_2000_blue: "Teklo Trebuchet 2000", teklo_pounder_blue: "Teklo Pounder"
};

const asCards = (value: unknown): Card[] => Array.isArray(value) ? (value as Card[]) : [];

function cardName(card?: Card) {
  const id = card?.cardNumber;
  if (!id || id === "NONE00") return "—";
  if (CARD_NAMES[id]) return CARD_NAMES[id];
  return id.replace(/_(red|yellow|blue)$/i, "").split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function cardImage(card?: Card) {
  if (!card?.cardNumber || card.cardNumber === "NONE00") return null;
  return `https://images.talishar.net/public/crops/${encodeURIComponent(card.cardNumber)}_cropped.webp`;
}

function textFromLog(html = "") {
  const withLineBreaks = html.replace(/<br\s*\/?\s*>/gi, "\n");
  const document = new DOMParser().parseFromString(withLineBreaks, "text/html");
  return (document.body.textContent || "").replace(/\[\[TURN_START:[^\]]+\]\]/g, "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function diffLog(previous?: Payload, current?: Payload) {
  const before = previous?.chatLog || "";
  const after = current?.chatLog || "";
  const changed = after.startsWith(before) ? after.slice(before.length) : after;
  return textFromLog(changed).filter((line) => !line.includes("No rust counters") && !line.includes("Sending game result"));
}

const heroFromEquipment = (cards: Card[]) => cards.find((card) => card.slot === "Hero") || cards[0];
const playerLabel = (player: unknown) => String(player) === "1" ? "Você" : "Oponente";
const phaseLabel = (payload: Payload) => payload.turnPhase?.caption || payload.turnPhase?.layer || payload.turnPhase?.turnPhase || "Aguardando atualização";

function counterLabel(card: Card) {
  const counters = Object.entries(card.countersMap || {}).filter(([, amount]) => String(amount) !== "0").map(([name, amount]) => `${name} ${amount}`);
  if (counters.length) return counters.join(" · ");
  if (String(card.counters ?? "0") !== "0") return `contador ${card.counters}`;
  return "";
}

function CardTile({ card, compact = false }: { card: Card; compact?: boolean }) {
  const [broken, setBroken] = useState(false);
  const image = cardImage(card);
  const name = cardName(card);
  const counter = counterLabel(card);
  return <div className={`card-tile ${compact ? "compact" : ""}`} title={name}>
    {image && !broken ? <img src={image} alt={name} onError={() => setBroken(true)} /> : <div className="card-fallback">{name}</div>}
    {card.tapped && <span className="state-badge tapped">T</span>}
    {card.isBroken && <span className="state-badge broken">X</span>}
    {counter && <span className="counter-badge">{counter}</span>}
    {card.pitchValue !== undefined && <span className="pitch-badge">{card.pitchValue}</span>}
  </div>;
}

function CardStrip({ cards, empty, limit = 8 }: { cards: Card[]; empty: string; limit?: number }) {
  if (!cards.length) return <span className="empty-zone">{empty}</span>;
  const visible = cards.slice(0, limit);
  return <div className="card-strip">
    {visible.map((card, index) => <CardTile card={card} key={`${card.cardNumber}-${index}`} compact />)}
    {cards.length > visible.length && <span className="overflow-count">+{cards.length - visible.length}</span>}
  </div>;
}

function Zone({ label, children, muted = false }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return <section className={`zone ${muted ? "muted" : ""}`}><h3>{label}</h3>{children}</section>;
}

function getTurnMarkers(frames: Frame[]) {
  const markers: { index: number; key: string; turn: string; player: string }[] = [];
  let prior = "";
  frames.forEach((frame, index) => {
    const turn = String(frame.payload.turnNo ?? "?");
    const player = String(frame.payload.turnPlayer ?? "?");
    const key = `${turn}-${player}`;
    if (key !== prior) { markers.push({ index, key, turn, player }); prior = key; }
  });
  return markers;
}

function dateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function Home() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Partida capturada");

  useEffect(() => {
    fetch("/replays/recorded-match.json").then((response) => {
      if (!response.ok) throw new Error("Não foi possível carregar a partida.");
      return response.json();
    }).then((data: Replay) => setReplay(data)).catch((error: Error) => setLoadError(error.message));
  }, []);

  const frames = replay?.match.frames || [];
  const currentFrame = frames[frameIndex];
  const current = currentFrame?.payload;
  const previous = frames[Math.max(frameIndex - 1, 0)]?.payload;
  const markers = useMemo(() => getTurnMarkers(frames), [frames]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return;
    const timer = window.setInterval(() => setFrameIndex((index) => {
      if (index >= frames.length - 1) { setIsPlaying(false); return index; }
      return index + 1;
    }), 420);
    return () => window.clearInterval(timer);
  }, [isPlaying, frames.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!frames.length || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft") setFrameIndex((index) => Math.max(0, index - 1));
      if (event.key === "ArrowRight") setFrameIndex((index) => Math.min(frames.length - 1, index + 1));
      if (event.key === " ") { event.preventDefault(); setIsPlaying((playing) => !playing); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frames.length]);

  function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Replay;
        if (!Array.isArray(parsed.match?.frames)) throw new Error("Arquivo não contém frames de replay.");
        setReplay(parsed); setFrameIndex(0); setIsPlaying(false); setLoadError(""); setSourceLabel(file.name);
      } catch (error) { setLoadError(error instanceof Error ? error.message : "Arquivo inválido."); }
    };
    reader.readAsText(file);
  }

  if (loadError) return <main className="status-page"><div><span className="eyebrow">Talishar Local History</span><h1>Não foi possível abrir o replay.</h1><p>{loadError}</p></div></main>;
  if (!replay || !current) return <main className="status-page"><div className="loading-orb" /><p>Carregando a partida…</p></main>;

  const playerEquipment = asCards(current.playerEquipment);
  const opponentEquipment = asCards(current.opponentEquipment);
  const playerHero = heroFromEquipment(playerEquipment);
  const opponentHero = heroFromEquipment(opponentEquipment);
  const recentEvents = diffLog(previous, current);
  const fullLog = textFromLog(current.chatLog || "");
  const chain = current.activeChainLink;

  return <main className="replay-shell">
    <header className="topbar">
      <Brand subtitle="Live replay" />
      <div className="replay-heading"><p className="eyebrow"><span>03</span> Mesa de análise</p><h1>Dash I/O mirror</h1><p className="subtitle">{sourceLabel} · {dateTime(replay.match.startedAt)}</p></div>
      <label className="file-button">＋ Abrir outro JSON<input type="file" accept="application/json,.json" onChange={loadFile} /></label>
    </header>

    <section className="scoreboard" aria-label="Placar da partida">
      <article className="player-score opponent"><div className="hero-chip"><CardTile card={opponentHero} /></div><div><span>Oponente · Player 2</span><strong>{cardName(opponentHero)}</strong></div><b>{current.opponentHealth ?? "—"}</b></article>
      <div className="versus"><span>vs</span><small>turno {current.turnNo ?? "—"}</small></div>
      <article className="player-score me"><b>{current.playerHealth ?? "—"}</b><div><span>Você · Player 1</span><strong>{cardName(playerHero)}</strong></div><div className="hero-chip"><CardTile card={playerHero} /></div></article>
    </section>

    <section className="turn-jumps" aria-label="Ir para turno">
      {markers.map((marker) => <button type="button" key={marker.key} className={marker.index <= frameIndex && (markers.find((item) => item.index > marker.index)?.index ?? frames.length) > frameIndex ? "active" : ""} onClick={() => setFrameIndex(marker.index)}>T{marker.turn} · {playerLabel(marker.player)}</button>)}
    </section>

    <section className="replay-controls" aria-label="Controles do replay">
      <button type="button" onClick={() => setFrameIndex(0)} aria-label="Primeiro frame">↞</button><button type="button" onClick={() => setFrameIndex((index) => Math.max(0, index - 1))} aria-label="Frame anterior">‹</button>
      <button type="button" className="play-button" onClick={() => setIsPlaying((playing) => !playing)}>{isPlaying ? "Pausar" : "Reproduzir"}</button>
      <button type="button" onClick={() => setFrameIndex((index) => Math.min(frames.length - 1, index + 1))} aria-label="Próximo frame">›</button><button type="button" onClick={() => setFrameIndex(frames.length - 1)} aria-label="Último frame">↠</button>
      <input aria-label="Posição na partida" type="range" min="0" max={Math.max(0, frames.length - 1)} value={frameIndex} onChange={(event) => { setIsPlaying(false); setFrameIndex(Number(event.target.value)); }} />
      <span className="frame-count">{frameIndex + 1} / {frames.length}</span>
    </section>

    <section className="match-state">
      <aside className="state-sidebar"><div className="state-panel"><span>Fase</span><strong>{phaseLabel(current)}</strong></div><div className="state-panel"><span>Jogador ativo</span><strong>{playerLabel(current.turnPlayer)}</strong></div><div className="state-panel"><span>Atualização</span><strong>{dateTime(currentFrame.receivedAt)}</strong></div></aside>
      <section className="board" aria-label="Mesa no frame atual">
        <div className="side opponent-side">
          <div className="side-heading"><span>Oponente</span><small>Mão: {asCards(current.opponentHand).length} · Deck: {current.opponentDeckCount ?? "—"}</small></div>
          <Zone label="Equipamento"><CardStrip cards={opponentEquipment.filter((card) => card.slot !== "Hero")} empty="Sem equipamento" /></Zone>
          <div className="zone-row"><Zone label={`Arsenal (${asCards(current.opponentArse).length})`} muted><span className="hidden-cards">Cartas ocultas</span></Zone><Zone label="Pitch"><CardStrip cards={asCards(current.opponentPitch)} empty="Vazio" limit={4} /></Zone><Zone label={`Banished (${asCards(current.opponentBanish).length})`}><CardStrip cards={asCards(current.opponentBanish)} empty="Vazio" limit={4} /></Zone></div>
          <Zone label={`Permanentes (${asCards(current.opponentPermanents).length + asCards(current.opponentItems).length})`}><CardStrip cards={[...asCards(current.opponentPermanents), ...asCards(current.opponentItems)]} empty="Nenhum permanente" /></Zone>
        </div>

        <div className="arena"><div className="arena-label">Combat chain</div>{chain?.attackingCard ? <div className="chain-card"><CardTile card={chain.attackingCard} /><div className="chain-stats"><strong>{chain.totalPower ?? "—"} ATK</strong><span>{chain.totalDefense ?? 0} DEF</span>{chain.goAgain && <em>Go again</em>}</div><div className="chain-target">Alvo: {chain.attackTarget || "—"}<br />{chain.reactions?.length ? `Reações: ${chain.reactions.map(cardName).join(", ")}` : "Sem reações"}</div></div> : <p>Nenhum ataque ativo neste momento.</p>}</div>

        <div className="side player-side">
          <div className="side-heading"><span>Você</span><small>Mão: {asCards(current.playerHand).length} · Deck: {current.playerDeckCount ?? "—"}</small></div>
          <Zone label="Equipamento"><CardStrip cards={playerEquipment.filter((card) => card.slot !== "Hero")} empty="Sem equipamento" /></Zone>
          <div className="zone-row"><Zone label={`Arsenal (${asCards(current.playerArse).length})`}><CardStrip cards={asCards(current.playerArse)} empty="Vazio" limit={2} /></Zone><Zone label="Pitch"><CardStrip cards={asCards(current.playerPitch)} empty="Vazio" limit={4} /></Zone><Zone label={`Banished (${asCards(current.playerBanish).length})`}><CardStrip cards={asCards(current.playerBanish)} empty="Vazio" limit={4} /></Zone></div>
          <Zone label={`Permanentes (${asCards(current.playerPermanents).length + asCards(current.playerItems).length})`}><CardStrip cards={[...asCards(current.playerPermanents), ...asCards(current.playerItems)]} empty="Nenhum permanente" /></Zone>
        </div>
      </section>
    </section>

    <section className="bottom-grid"><section className="hand-panel"><div className="panel-heading"><h2>Sua mão</h2><span>{asCards(current.playerHand).length} cartas</span></div><div className="hand-cards"><CardStrip cards={asCards(current.playerHand)} empty="Sem cartas na mão" limit={8} /></div></section><section className="event-panel"><div className="panel-heading"><h2>Eventos desta atualização</h2><span>{recentEvents.length}</span></div><ol>{(recentEvents.length ? recentEvents : fullLog.slice(-8)).slice(-10).map((event, index) => <li key={`${frameIndex}-${index}`}>{event}</li>)}</ol></section></section>
    <p className="keyboard-tip">Use ← → para avançar quadro a quadro e Espaço para reproduzir/pausar.</p>
  </main>;
}
