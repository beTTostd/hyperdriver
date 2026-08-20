"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type Card = {
  cardNumber?: string;
  slot?: string;
  controller?: string | number;
  counters?: string | number;
  countersMap?: Record<string, string | number>;
  tapped?: boolean;
  isBroken?: boolean;
  onChain?: boolean;
  facing?: string;
};

type Chain = {
  attackingCard?: Card;
  totalPower?: string | number;
  totalDefense?: string | number;
  attackTarget?: string;
  goAgain?: boolean;
  dominate?: boolean;
  overpower?: boolean;
  reactions?: Card[];
};

type Payload = {
  turnNo?: string | number;
  turnPlayer?: string | number;
  turnPhase?: { turnPhase?: string; layer?: string; caption?: string };
  playerHealth?: string | number;
  opponentHealth?: string | number;
  playerDeckCount?: string | number;
  opponentDeckCount?: string | number;
  playerEquipment?: Card[];
  opponentEquipment?: Card[];
  playerHand?: Card[];
  opponentHand?: Card[];
  playerArse?: Card[];
  opponentArse?: Card[];
  playerPitch?: Card[];
  opponentPitch?: Card[];
  playerBanish?: Card[];
  opponentBanish?: Card[];
  playerDiscard?: Card[];
  opponentDiscard?: Card[];
  playerPermanents?: Card[];
  opponentPermanents?: Card[];
  playerItems?: Card[];
  opponentItems?: Card[];
  playerAuras?: Card[];
  opponentAuras?: Card[];
  playerAllies?: Card[];
  opponentAllies?: Card[];
  playerDeckCard?: Card;
  opponentDeckCard?: Card;
  activeChainLink?: Chain | null;
  lastPlayedCard?: Card;
  chatLog?: string;
};

type Frame = { sequence: number; receivedAt: string; payload: Payload };
type Replay = { match: { startedAt?: string; frames: Frame[] } };
type EquipmentKey = "playerEquipment" | "opponentEquipment";

const list = (value?: Card[]) => (Array.isArray(value) ? value : []);

function cardName(card?: Card) {
  const id = card?.cardNumber;
  if (!id || id === "NONE00") return "Vazio";
  if (id === "CardBack") return "Carta oculta";
  if (id === "dash_io") return "Dash I/O";
  return id
    .replace(/_(red|yellow|blue)(_(red|yellow|blue))?$/i, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function imageUrl(card?: Card) {
  const id = card?.cardNumber;
  if (!id || id === "NONE00" || id === "CardBack") return null;
  return `https://images.talishar.net/public/cardimages/english/${encodeURIComponent(id)}.webp`;
}

function counterLabel(card: Card) {
  const mapped = Object.entries(card.countersMap ?? {})
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => key === "steam" ? String(value) : `${key.slice(0, 1).toUpperCase()} ${value}`);
  if (mapped.length) return mapped.join(" · ");
  return Number(card.counters ?? 0) === 0 ? "" : String(card.counters);
}

function phaseName(payload: Payload) {
  if (payload.turnPhase?.turnPhase === "OVER") return "Partida encerrada";
  return payload.turnPhase?.caption || payload.turnPhase?.layer || payload.turnPhase?.turnPhase || "Aguardando";
}

function playerName(value?: string | number) {
  return String(value) === "1" ? "Você" : "Oponente";
}

function plainLog(html = "") {
  if (typeof DOMParser === "undefined") return [];
  const normalized = html.replace(/<br\s*\/?\s*>/gi, "\n");
  const document = new DOMParser().parseFromString(normalized, "text/html");
  return (document.body.textContent ?? "")
    .replace(/\[\[TURN_START:[^\]]+\]\]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !line.includes("No rust counters"));
}

function turnMarkers(frames: Frame[]) {
  const markers: Array<{ index: number; key: string; turn: string; player: string }> = [];
  let previous = "";
  frames.forEach((frame, index) => {
    const turn = String(frame.payload.turnNo ?? "?");
    const player = String(frame.payload.turnPlayer ?? "?");
    const key = `${turn}-${player}`;
    if (key !== previous) {
      markers.push({ index, key, turn, player });
      previous = key;
    }
  });
  return markers;
}

function setupEquipment(frames: Frame[], key: EquipmentKey) {
  const bySlot = new Map<string, Card>();
  frames.forEach((frame) => {
    list(frame.payload[key]).forEach((card) => {
      if (card.slot && card.slot !== "-" && card.cardNumber !== "NONE00" && !bySlot.has(card.slot)) bySlot.set(card.slot, card);
    });
  });
  return [...bySlot.values()];
}

function completeFirstEquipment(values: Card[] | undefined, setup: Card[], firstFrame: boolean) {
  const current = list(values);
  if (!firstFrame) return current;
  return [...current, ...setup.filter((card) => !current.some((item) => item.slot === card.slot && item.cardNumber !== "NONE00"))];
}

function attackCardNumbers(frames: Frame[]) {
  return new Set(frames.map((frame) => frame.payload.activeChainLink?.attackingCard?.cardNumber).filter((cardNumber): cardNumber is string => Boolean(cardNumber)));
}

function CardView({ card, hidden = false, variant = "normal", label }: { card?: Card; hidden?: boolean; variant?: "normal" | "hero" | "handCard" | "combat"; label?: string }) {
  const [failed, setFailed] = useState(false);
  const faceDown = hidden || card?.cardNumber === "CardBack";
  const source = faceDown ? null : imageUrl(card);
  const counters = card ? counterLabel(card) : "";
  return (
    <figure
      className={`${styles.card} ${styles[variant]} ${faceDown ? styles.cardBack : ""} ${card?.tapped ? styles.tapped : ""} ${card?.onChain ? styles.onChain : ""} ${!card && !faceDown ? styles.missingCard : ""}`}
      title={faceDown ? "Carta oculta" : cardName(card)}
      aria-label={faceDown ? "Carta oculta" : cardName(card)}
    >
      {source && !failed ? <img src={source} alt={cardName(card)} onError={() => setFailed(true)} /> : !faceDown && <span>{label || cardName(card)}</span>}
      {counters && !faceDown && <b className={styles.counter}>{counters}</b>}
      {card?.isBroken && <b className={styles.broken}>×</b>}
    </figure>
  );
}

function ZonePile({ className, label, values, count, topCard, hidden = false, stacked = false }: { className: string; label: string; values?: Card[]; count?: string | number; topCard?: Card; hidden?: boolean; stacked?: boolean }) {
  const zoneCards = list(values);
  const total = count ?? zoneCards.length;
  const card = topCard ?? zoneCards.at(-1);
  const occupied = Number(total) > 0 || Boolean(card);
  const showStack = stacked && zoneCards.length > 1;
  return (
    <section className={`${styles.zone} ${className}`} aria-label={`${label}: ${total}`}>
      <div className={`${styles.zoneCard} ${showStack ? styles.stackedZoneCards : ""}`}>
        {occupied ? showStack ? zoneCards.map((zoneCard, index) => (
          <div className={styles.stackedCard} style={{ top: `${index * 24}px`, zIndex: index + 1 }} key={`${zoneCard.cardNumber}-${index}`}>
            <CardView card={zoneCard} hidden={hidden} />
          </div>
        )) : <CardView card={card} hidden={hidden} /> : <div className={styles.zoneGhost}>{label}</div>}
      </div>
      {occupied && <b>{total}</b>}
    </section>
  );
}

function EquipmentCluster({ equipment, opponent }: { equipment?: Card[]; opponent: boolean }) {
  const values = list(equipment);
  const get = (slot: string) => values.find((card) => card.slot === slot && card.cardNumber !== "NONE00");
  const slot = (name: string, label: string) => {
    const card = get(name);
    return card ? <CardView card={card} /> : <div className={styles.emptyEquipment} aria-label={`${label} vazio`} />;
  };
  return (
    <section className={`${styles.equipment} ${opponent ? styles.opponentEquipment : styles.playerEquipment}`} aria-label={`Equipamentos ${opponent ? "do oponente" : "do jogador"}`}>
      <div className={styles.slotHead}>{slot("Head", "Cabeça")}</div>
      <div className={styles.slotChest}>{slot("Chest", "Peito")}</div>
      <div className={styles.slotArms}>{slot("Arms", "Braços")}</div>
      <div className={styles.slotLegs}>{slot("Legs", "Pernas")}</div>
    </section>
  );
}

function HeroCluster({ equipment, health, opponent }: { equipment?: Card[]; health?: string | number; opponent: boolean }) {
  const values = list(equipment);
  const hero = values.find((card) => card.slot === "Hero");
  const leftWeapon = values.find((card) => card.slot === "LWep");
  const rightWeapon = values.find((card) => card.slot === "RWep");
  return (
    <section className={`${styles.heroCluster} ${opponent ? styles.opponentHero : styles.playerHero}`}>
      <div className={styles.leftWeapon}>{leftWeapon && <CardView card={leftWeapon} />}</div>
      <div className={styles.heroCenter}>
        <CardView card={hero} variant="hero" label="Herói" />
        <b className={styles.heroLife} aria-label={`Vida: ${health ?? "desconhecida"}`}><span aria-hidden="true">♥</span>{health ?? "—"}</b>
      </div>
      <div className={styles.rightWeapon}>{rightWeapon && <CardView card={rightWeapon} />}</div>
    </section>
  );
}

function Hand({ values, opponent }: { values?: Card[]; opponent: boolean }) {
  const hand = list(values);
  return (
    <section className={`${styles.hand} ${opponent ? styles.opponentHand : styles.playerHand}`} aria-label={`Mão ${opponent ? "do oponente" : "do jogador"}: ${hand.length}`}>
      {hand.map((card, index) => <CardView key={`${card.cardNumber}-${index}`} card={card} hidden={opponent} variant="handCard" />)}
    </section>
  );
}

function Arsenal({ values, opponent }: { values?: Card[]; opponent: boolean }) {
  const arsenal = list(values);
  return (
    <section className={`${styles.arsenal} ${opponent ? styles.opponentArsenal : styles.playerArsenal}`} aria-label={`Arsenal: ${arsenal.length}`}>
      {arsenal.length ? arsenal.slice(0, 3).map((card, index) => <CardView key={`${card.cardNumber}-${index}`} card={card} hidden={opponent} />) : <div className={styles.zoneGhost}>Arsenal</div>}
    </section>
  );
}

function Permanents({ values, opponent }: { values: Card[]; opponent: boolean }) {
  if (!values.length) return null;
  return (
    <section className={`${styles.permanents} ${opponent ? styles.opponentPermanents : styles.playerPermanents}`} aria-label="Permanentes e itens">
      {values.slice(0, 7).map((card, index) => <CardView key={`${card.cardNumber}-${index}`} card={card} />)}
      {values.length > 7 && <b>+{values.length - 7}</b>}
    </section>
  );
}

function CombatChain({ chain }: { chain?: Chain | null }) {
  if (!chain?.attackingCard) return null;
  const reactions = list(chain.reactions);
  return (
    <section className={styles.combatChain} aria-label="Combat chain">
      <small>Combat chain</small>
      <div className={styles.attackCard}><CardView card={chain.attackingCard} variant="combat" /><b>{chain.totalPower ?? "—"}<span>ATK</span></b></div>
      <i>›</i>
      <div className={styles.reactions}>{reactions.map((card, index) => <CardView key={`${card.cardNumber}-${index}`} card={card} variant="combat" />)}{!reactions.length && <span>Sem defesa</span>}</div>
      <div className={styles.chainInfo}><strong>{chain.totalDefense ?? 0} DEF</strong><span>Alvo: {chain.attackTarget || "—"}</span><div>{chain.goAgain && <em>Go again</em>}{chain.dominate && <em>Dominate</em>}{chain.overpower && <em>Overpower</em>}</div></div>
    </section>
  );
}

function ActionDisplay({ card }: { card?: Card }) {
  if (!card?.cardNumber || card.cardNumber === "CardBack" || card.cardNumber === "NONE00") return null;
  const owner = card.controller == null ? "Jogador ativo" : playerName(card.controller);
  return (
    <section className={`${styles.combatChain} ${styles.actionDisplay}`} aria-label={`Ação em resolução: ${cardName(card)}`}>
      <small>Ação</small>
      <div className={styles.actionCard}><CardView card={card} variant="combat" /></div>
      <div className={styles.actionInfo}><strong>{cardName(card)}</strong><span>{owner}</span></div>
    </section>
  );
}

export default function TalisharTable() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState("Partida gravada · 16/08/2026");
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    fetch("/replays/recorded-match.json")
      .then((response) => {
        if (!response.ok) throw new Error("Não foi possível abrir a partida.");
        return response.json();
      })
      .then((data: Replay) => setReplay(data))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const frames = useMemo(() => replay?.match.frames ?? [], [replay]);
  const currentFrame = frames[index];
  const current = currentFrame?.payload;
  const markers = useMemo(() => turnMarkers(frames), [frames]);
  const logs = useMemo(() => plainLog(current?.chatLog).slice(-18).reverse(), [current?.chatLog]);
  const opponentSetupEquipment = useMemo(() => setupEquipment(frames, "opponentEquipment"), [frames]);
  const playerSetupEquipment = useMemo(() => setupEquipment(frames, "playerEquipment"), [frames]);
  const attackCards = useMemo(() => attackCardNumbers(frames), [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((value) => {
        if (value >= frames.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, 480);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!frames.length || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setIndex((value) => Math.min(frames.length - 1, value + 1));
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frames.length]);

  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.currentTarget.closest("details")?.removeAttribute("open");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Replay;
        if (!Array.isArray(parsed.match?.frames)) throw new Error("Este JSON não contém frames de replay.");
        setReplay(parsed);
        setIndex(0);
        setPlaying(false);
        setSource(file.name);
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "JSON inválido.");
      }
    };
    reader.readAsText(file);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  if (error) return <main className={styles.loading}><div><small>Talishar Replay</small><h1>Não foi possível abrir</h1><p>{error}</p><Link href="/">Voltar para o replay clássico</Link></div></main>;
  if (!current || !currentFrame) return <main className={styles.loading}><div className={styles.spinner} /><p>Montando a mesa…</p></main>;

  const opponentPermanents = [...list(current.opponentPermanents), ...list(current.opponentItems), ...list(current.opponentAuras), ...list(current.opponentAllies)];
  const playerPermanents = [...list(current.playerPermanents), ...list(current.playerItems), ...list(current.playerAuras), ...list(current.playerAllies)];
  const opponentEquipment = completeFirstEquipment(current.opponentEquipment, opponentSetupEquipment, index === 0);
  const playerEquipment = completeFirstEquipment(current.playerEquipment, playerSetupEquipment, index === 0);
  const actionCard = !current.activeChainLink?.attackingCard && current.lastPlayedCard?.cardNumber && !attackCards.has(current.lastPlayedCard.cardNumber) ? current.lastPlayedCard : undefined;
  const isFinal = current.turnPhase?.turnPhase === "OVER";

  return (
    <main className={styles.replay}>
      <section className={styles.table}>
        <div className={styles.opponentMat} />
        <div className={styles.playerMat} />
        <Hand values={current.opponentHand} opponent />
        <ZonePile className={styles.opponentBanish} label="Banido" values={current.opponentBanish} />
        <ZonePile className={styles.opponentDeck} label="Deck" count={current.opponentDeckCount ?? 0} topCard={current.opponentDeckCard} hidden />
        <ZonePile className={styles.opponentPitch} label="Pitch" values={current.opponentPitch} stacked />
        <ZonePile className={styles.opponentGraveyard} label="Cemitério" values={current.opponentDiscard} />
        <Arsenal values={current.opponentArse} opponent />
        <HeroCluster equipment={opponentEquipment} health={current.opponentHealth} opponent />
        <EquipmentCluster equipment={opponentEquipment} opponent />
        <Permanents values={opponentPermanents} opponent />

        <EquipmentCluster equipment={playerEquipment} opponent={false} />
        <Permanents values={playerPermanents} opponent={false} />
        <HeroCluster equipment={playerEquipment} health={current.playerHealth} opponent={false} />
        <Arsenal values={current.playerArse} opponent={false} />
        <Hand values={current.playerHand} opponent={false} />
        <ZonePile className={styles.playerGraveyard} label="Cemitério" values={current.playerDiscard} />
        <ZonePile className={styles.playerPitch} label="Pitch" values={current.playerPitch} stacked />
        <ZonePile className={styles.playerDeck} label="Deck" count={current.playerDeckCount ?? 0} topCard={current.playerDeckCard} hidden={!current.playerDeckCard || current.playerDeckCard.cardNumber === "CardBack"} />
        <ZonePile className={styles.playerBanish} label="Banido" values={current.playerBanish} />

        <CombatChain chain={current.activeChainLink} />
        <ActionDisplay card={actionCard} />
        {isFinal && <div className={styles.result}><small>Partida encerrada</small><strong>Oponente venceu · 2 × 0</strong></div>}

        {showLog && <aside className={styles.logPanel}>
          <header><div><small>Snapshot #{currentFrame.sequence}</small><h2>Game log</h2></div><button type="button" onClick={() => setShowLog(false)} aria-label="Fechar log">×</button></header>
          <ol>{logs.map((entry, logIndex) => <li key={`${index}-${logIndex}`}><span>{logIndex === 0 ? "Agora" : `−${logIndex}`}</span><p>{entry}</p></li>)}</ol>
        </aside>}
      </section>

      <section className={styles.timeline} aria-label="Controles do replay">
        <div className={styles.transport}>
          <button type="button" onClick={() => { setPlaying(false); setIndex(0); }} aria-label="Primeiro snapshot">↞</button>
          <button type="button" onClick={() => { setPlaying(false); setIndex((value) => Math.max(0, value - 1)); }} aria-label="Snapshot anterior">‹</button>
          <button type="button" className={styles.playButton} onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pausar" : "Reproduzir"}>{playing ? "Ⅱ" : "▶"}</button>
          <button type="button" onClick={() => { setPlaying(false); setIndex((value) => Math.min(frames.length - 1, value + 1)); }} aria-label="Próximo snapshot">›</button>
          <button type="button" onClick={() => { setPlaying(false); setIndex(frames.length - 1); }} aria-label="Último snapshot">↠</button>
          <details className={styles.timelineMenu}>
            <summary aria-label="Abrir menu">⋯</summary>
            <div className={styles.menuPopover}>
              <div className={styles.menuMeta}>
                <span>Turno {current.turnNo ?? "—"} · {playerName(current.turnPlayer)}</span>
                <strong>{phaseName(current)}</strong>
                <small>{source}</small>
              </div>
              <Link href="/">Visão analítica</Link>
              <button type="button" onClick={(event) => { setShowLog((value) => !value); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{showLog ? "Fechar game log" : "Abrir game log"}</button>
              <button type="button" onClick={(event) => { toggleFullscreen(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Tela cheia</button>
              <label>Abrir JSON<input type="file" accept=".json,application/json" onChange={openFile} /></label>
            </div>
          </details>
        </div>
        <div className={styles.scrubber}>
          <div className={styles.turns}>{markers.map((marker, markerIndex) => {
            const next = markers[markerIndex + 1]?.index ?? frames.length;
            const selected = index >= marker.index && index < next;
            return <button className={selected ? styles.selectedTurn : ""} type="button" key={marker.key} onClick={() => { setPlaying(false); setIndex(marker.index); }}>T{marker.turn}</button>;
          })}</div>
          <input type="range" min="0" max={frames.length - 1} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} aria-label="Posição do replay" />
        </div>
        <div className={styles.frameCount}><strong>{index + 1}</strong><span>/ {frames.length}</span></div>
      </section>
    </main>
  );
}
