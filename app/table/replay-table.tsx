"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../components/ui-icons";
import { BrandSymbol } from "../components/brand";
import CardImage from "../components/card-image";
import { replayResult } from "../../talishar-local-history/replay-state.js";
import {
  cardMarkers,
  fullCardImageUrl,
  markerSummary,
  squareCardImageUrl,
} from "./card-presentation.js";
import styles from "./replay-table.module.css";

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
};

type Frame = { sequence: number; receivedAt: string; payload: Payload };
type Replay = { match: { startedAt?: string; frames: Frame[]; summary?: { winner?: string | number }; } };
type EquipmentKey = "playerEquipment" | "opponentEquipment";
type PreviewState = { card: Card; frameIndex: number; side: "left" | "right"; persistent: boolean };
type PreviewContextValue = {
  showPreview: (card: Card, element: HTMLElement, persistent: boolean) => void;
  hideTransientPreview: () => void;
};

const PreviewContext = createContext<PreviewContextValue | null>(null);

const isReplayId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) || /^\d+$/.test(value);

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

function playerName(value?: string | number) {
  return String(value) === "1" ? "Você" : "Oponente";
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

function MarkerIcon({ kind, abbreviation }: { kind: string; abbreviation: string }) {
  if (kind === "generic") return <span className={styles.markerAbbreviation}>{abbreviation}</span>;
  if (kind === "defense") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 5v6c0 5-3.2 9-8 11-4.8-2-8-6-8-11V5l8-3Z" /></svg>;
  if (kind === "steam") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 2 1 3h4l1-3 3 2-2 3 2 3 3-1 1 4-4 1-2 3 2 3-3 2-1-3h-4l-1 3-3-2 2-3-2-3-3 1-1-4 4-1 2-3-2-3 3-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
  if (kind === "attack") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 18 12-12 3 3L6 21H3v-3Zm11-14 2-2 6 6-2 2-6-6Z" /></svg>;
  if (kind === "life") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21S3 16 3 9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 12-9 12Z" /></svg>;
  if (kind === "energy") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z" /></svg>;
  if (kind === "frost") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M8 4l4 3 4-3M8 20l4-3 4 3" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v5M12 18v5M1 12h5M18 12h5" /></svg>;
}

function TransportIcon({ name }: { name: "back" | "first" | "previous" | "play" | "pause" | "next" | "last" }) {
  if (name === "play") return <svg className={`${styles.transportIcon} ${styles.transportIconFill}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z" /></svg>;
  if (name === "pause") return <svg className={`${styles.transportIcon} ${styles.transportIconFill}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /></svg>;
  if (name === "back") return <svg className={styles.transportIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6-6 6 6 6M4 12h16" /></svg>;
  if (name === "first") return <svg className={styles.transportIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14m14-14-8 7 8 7V5Z" /></svg>;
  if (name === "previous") return <svg className={styles.transportIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
  if (name === "next") return <svg className={styles.transportIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
  return <svg className={styles.transportIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5v14M5 5l8 7-8 7V5Z" /></svg>;
}

function CardMarkers({ card }: { card: Card }) {
  const markers = cardMarkers(card);
  if (!markers.length) return null;
  return (
    <span className={styles.markerOverlay} aria-hidden="true">
      {markers.map((marker) => (
        <span className={`${styles.marker} ${styles[marker.kind] || ""}`} key={marker.key} title={`${marker.label}: ${marker.value}`}>
          <MarkerIcon kind={marker.kind} abbreviation={marker.abbreviation} />
          <strong>{marker.value}</strong>
        </span>
      ))}
    </span>
  );
}

function CardView({ card, hidden = false, variant = "normal", label }: { card?: Card; hidden?: boolean; variant?: "normal" | "hero" | "handCard" | "combat"; label?: string }) {
  const preview = useContext(PreviewContext);
  const [imageFailure, setImageFailure] = useState<{ cardNumber?: string; stage: "full" | "failed" } | null>(null);
  const faceDown = hidden || card?.cardNumber === "CardBack";
  const cardNumber = card?.cardNumber;
  const canPreview = !faceDown && Boolean(cardNumber && cardNumber !== "NONE00");
  const markers = card ? cardMarkers(card) : [];
  const summary = markerSummary(markers);
  const imageStage = imageFailure && imageFailure.cardNumber === cardNumber ? imageFailure.stage : "square";
  const source = canPreview
    ? imageStage === "square"
      ? squareCardImageUrl(cardNumber as string)
      : imageStage === "full"
        ? fullCardImageUrl(cardNumber as string)
        : null
    : null;

  const openPreview = (element: HTMLElement, persistent: boolean) => {
    if (card && canPreview) preview?.showPreview(card, element, persistent);
  };

  return (
    <figure
      className={`${styles.card} ${styles[variant]} ${faceDown ? styles.cardBack : ""} ${card?.tapped ? styles.tapped : ""} ${card?.onChain ? styles.onChain : ""} ${!card && !faceDown ? styles.missingCard : ""}`}
      title={faceDown ? "Carta oculta" : cardName(card)}
      aria-label={`${faceDown ? "Carta oculta" : cardName(card)}${summary ? `. ${summary}` : ""}`}
      tabIndex={canPreview ? 0 : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") openPreview(event.currentTarget, false); }}
      onPointerLeave={() => preview?.hideTransientPreview()}
      onPointerUp={(event) => { if (event.pointerType === "touch") openPreview(event.currentTarget, true); }}
      onFocus={(event) => openPreview(event.currentTarget, false)}
      onBlur={() => preview?.hideTransientPreview()}
    >
      {source ? <CardImage className={imageStage === "full" ? styles.fallbackCrop : ""} src={source} alt={cardName(card)} onError={() => setImageFailure({ cardNumber, stage: imageStage === "square" ? "full" : "failed" })} /> : !faceDown && <span>{label || cardName(card)}</span>}
      {card && !faceDown && <CardMarkers card={card} />}
      {card?.isBroken && <b className={styles.broken}><Icon name="alertTriangle" size={13} /></b>}
    </figure>
  );
}

function CardPreview({ preview, onClose }: { preview: PreviewState | null; onClose: () => void }) {
  const [failedCardNumber, setFailedCardNumber] = useState<string | null>(null);
  if (!preview?.card.cardNumber || failedCardNumber === preview.card.cardNumber) return null;
  return (
    <div className={`${styles.previewLayer} ${styles[preview.side]}`}>
      {preview.persistent && <button className={styles.previewBackdrop} type="button" aria-label="Fechar prévia da carta" onClick={onClose} />}
      <figure className={styles.cardPreview} role="dialog" aria-label={`Prévia de ${cardName(preview.card)}`}>
        <CardImage src={fullCardImageUrl(preview.card.cardNumber)} alt={cardName(preview.card)} onError={() => setFailedCardNumber(preview.card.cardNumber ?? null)} />
      </figure>
    </div>
  );
}

function ZonePile({ className, label, values, count, topCard, hidden = false, stacked = false, hoverCount = false, hideCount = false }: { className: string; label: string; values?: Card[]; count?: string | number; topCard?: Card; hidden?: boolean; stacked?: boolean; hoverCount?: boolean; hideCount?: boolean }) {
  const zoneCards = list(values);
  const total = count ?? zoneCards.length;
  const card = topCard ?? zoneCards.at(-1);
  const occupied = Number(total) > 0 || Boolean(card);
  const showStack = stacked && zoneCards.length > 1;
  return (
    <section className={`${styles.zone} ${hoverCount ? styles.hoverCount : ""} ${className}`} aria-label={`${label}: ${total}`}>
      <div className={`${styles.zoneCard} ${showStack ? styles.stackedZoneCards : ""}`}>
        {occupied ? showStack ? zoneCards.map((zoneCard, index) => (
          <div className={styles.stackedCard} style={{ top: `${index * 24}px`, zIndex: index + 1 }} key={`${zoneCard.cardNumber}-${index}`}>
            <CardView card={zoneCard} hidden={hidden} />
          </div>
        )) : <CardView card={card} hidden={hidden} /> : <div className={styles.zoneGhost}>{label}</div>}
      </div>
      {occupied && !hideCount && <b>{total}</b>}
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
        <b className={styles.heroLife} aria-label={`Vida: ${health ?? "desconhecida"}`}><Icon name="heart" size={13} />{health ?? "—"}</b>
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
      {values.length > 7 && <b aria-label={`Mais ${values.length - 7} permanentes`}><Icon name="plus" size={12} /><span>{values.length - 7}</span></b>}
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
      <Icon className={styles.chainArrow} name="chevronRight" size={21} />
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

export default function TalisharTable({ replayId }: { replayId?: string } = {}) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const showPreview = useCallback((card: Card, element: HTMLElement, persistent: boolean) => {
    const bounds = element.getBoundingClientRect();
    setPreview({ card, frameIndex: index, persistent, side: bounds.left > window.innerWidth / 2 ? "left" : "right" });
  }, [index]);
  const hideTransientPreview = useCallback(() => {
    setPreview((value) => value?.persistent ? value : null);
  }, []);
  const closePreview = useCallback(() => setPreview(null), []);
  const previewContext = useMemo(() => ({ showPreview, hideTransientPreview }), [showPreview, hideTransientPreview]);

  useEffect(() => {
    const legacyReplayId = new URLSearchParams(window.location.search).get("replay");
    const requestedReplayId = replayId ?? legacyReplayId;
    const endpoint = requestedReplayId && isReplayId(requestedReplayId)
      ? `/api/replays/${requestedReplayId}`
      : "/api/replays/recorded-match";
    fetch(endpoint)
      .then((response) => {
        if (!response.ok) throw new Error("Não foi possível abrir a partida.");
        return response.json();
      })
      .then((data: Replay) => {
        setReplay(data);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [replayId]);

  const frames = useMemo(() => replay?.match.frames ?? [], [replay]);
  const currentFrame = frames[index];
  const current = currentFrame?.payload;
  const markers = useMemo(() => turnMarkers(frames), [frames]);
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
      if (event.key === "Escape") {
        closePreview();
        return;
      }
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setIndex((value) => Math.min(frames.length - 1, value + 1));
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frames.length, closePreview]);

  if (error) return <main className={styles.loading}><div><small>Talishar Replay</small><h1>Não foi possível abrir</h1><p>{error}</p><Link href="/replays">Voltar para seus replays</Link></div></main>;
  if (!current || !currentFrame) return <main className={styles.loading}><div role="status" aria-live="polite"><BrandSymbol className={styles.loadingMark} /><p>Montando a mesa…</p></div></main>;

  const opponentPermanents = [...list(current.opponentPermanents), ...list(current.opponentItems), ...list(current.opponentAuras), ...list(current.opponentAllies)];
  const playerPermanents = [...list(current.playerPermanents), ...list(current.playerItems), ...list(current.playerAuras), ...list(current.playerAllies)];
  const opponentEquipment = completeFirstEquipment(current.opponentEquipment, opponentSetupEquipment, index === 0);
  const playerEquipment = completeFirstEquipment(current.playerEquipment, playerSetupEquipment, index === 0);
  const actionCard = !current.activeChainLink?.attackingCard && current.lastPlayedCard?.cardNumber && !attackCards.has(current.lastPlayedCard.cardNumber) ? current.lastPlayedCard : undefined;
  const isFinal = current.turnPhase?.turnPhase === "OVER";
  const result = replayResult(replay?.match ?? { frames: [] });

  return (
    <PreviewContext.Provider value={previewContext}>
      <main className={styles.replay}>
        <div className={styles.tableWorkspace}>
          <section className={styles.table}>
        <div className={styles.opponentMat} />
        <div className={styles.playerMat} />
        <Hand values={current.opponentHand} opponent />
        <ZonePile className={styles.opponentBanish} label="Banido" values={current.opponentBanish} hoverCount />
        <ZonePile className={styles.opponentDeck} label="Deck" count={current.opponentDeckCount ?? 0} topCard={current.opponentDeckCard} hidden hoverCount />
        <ZonePile className={styles.opponentPitch} label="Pitch" values={current.opponentPitch} stacked hideCount />
        <ZonePile className={styles.opponentGraveyard} label="Cemitério" values={current.opponentDiscard} hoverCount />
        <Arsenal values={current.opponentArse} opponent />
        <HeroCluster equipment={opponentEquipment} health={current.opponentHealth} opponent />
        <EquipmentCluster equipment={opponentEquipment} opponent />
        <Permanents values={opponentPermanents} opponent />

        <EquipmentCluster equipment={playerEquipment} opponent={false} />
        <Permanents values={playerPermanents} opponent={false} />
        <HeroCluster equipment={playerEquipment} health={current.playerHealth} opponent={false} />
        <Arsenal values={current.playerArse} opponent={false} />
        <Hand values={current.playerHand} opponent={false} />
        <div className={styles.playerZoneColumn}>
          <ZonePile className={styles.playerGraveyard} label="Cemitério" values={current.playerDiscard} hoverCount />
          <ZonePile className={styles.playerDeck} label="Deck" count={current.playerDeckCount ?? 0} topCard={current.playerDeckCard} hidden={!current.playerDeckCard || current.playerDeckCard.cardNumber === "CardBack"} hoverCount />
          <ZonePile className={styles.playerBanish} label="Banido" values={current.playerBanish} hoverCount />
        </div>
        <ZonePile className={styles.playerPitch} label="Pitch" values={current.playerPitch} stacked hideCount />

        <CombatChain chain={current.activeChainLink} />
        <ActionDisplay card={actionCard} />
        {isFinal && <div className={`${styles.result} ${styles[result]}`}><small>Partida encerrada</small><strong>{result === "victory" ? "Você venceu" : result === "defeat" ? "Oponente venceu" : "Resultado indisponível"}</strong></div>}

          </section>

          <aside className={styles.sidebar} aria-label="Barra lateral da mesa" />
        </div>

        <section className={styles.timeline} aria-label="Controles do replay">
        <div className={styles.transport}>
          <Link className={styles.backButton} href="/replays" aria-label="Voltar para seus replays" title="Voltar para seus replays"><TransportIcon name="back" /></Link>
          <button type="button" onClick={() => { setPlaying(false); setIndex(0); }} aria-label="Primeiro snapshot" title="Primeiro snapshot"><TransportIcon name="first" /></button>
          <button type="button" onClick={() => { setPlaying(false); setIndex((value) => Math.max(0, value - 1)); }} aria-label="Snapshot anterior" title="Snapshot anterior"><TransportIcon name="previous" /></button>
          <button type="button" className={styles.playButton} onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pausar" : "Reproduzir"} title={playing ? "Pausar" : "Reproduzir"}><TransportIcon name={playing ? "pause" : "play"} /></button>
          <button type="button" onClick={() => { setPlaying(false); setIndex((value) => Math.min(frames.length - 1, value + 1)); }} aria-label="Próximo snapshot" title="Próximo snapshot"><TransportIcon name="next" /></button>
          <button type="button" onClick={() => { setPlaying(false); setIndex(frames.length - 1); }} aria-label="Último snapshot" title="Último snapshot"><TransportIcon name="last" /></button>
        </div>
        <div className={styles.scrubber}>
          <div className={styles.turns}>{markers.map((marker, markerIndex) => {
            const next = markers[markerIndex + 1]?.index ?? frames.length;
            const selected = index >= marker.index && index < next;
            return <button className={selected ? styles.selectedTurn : ""} type="button" key={marker.index} onClick={() => { setPlaying(false); setIndex(marker.index); }}>T{marker.turn}</button>;
          })}</div>
          <input type="range" min="0" max={frames.length - 1} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} aria-label="Posição do replay" />
        </div>
        <div className={styles.frameCount}><strong>{index + 1}</strong><span>/ {frames.length}</span></div>
        </section>
        <CardPreview preview={preview?.frameIndex === index ? preview : null} onClose={closePreview} />
      </main>
    </PreviewContext.Provider>
  );
}
