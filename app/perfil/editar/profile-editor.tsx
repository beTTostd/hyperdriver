"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CARD_AVATAR_OPTIONS,
  type CardAvatarOption,
  cardArtImageUrl,
  DEFAULT_CARD_AVATAR,
} from "../../../lib/card-avatars";
import Icon from "../../components/ui-icons";
import styles from "./page.module.css";

const SEARCH_DELAY_MS = 300;
const SEARCH_CACHE_LIMIT = 20;
const RESULTS_PER_PAGE = 24;

type SearchResult = {
  options: CardAvatarOption[];
  hasMore: boolean;
};

const searchCache = new Map<string, SearchResult>();

function readCachedSearch(key: string): SearchResult | undefined {
  const cached = searchCache.get(key);
  if (!cached) return undefined;
  searchCache.delete(key);
  searchCache.set(key, cached);
  return cached;
}

function cacheSearch(key: string, result: SearchResult) {
  searchCache.delete(key);
  searchCache.set(key, result);
  if (searchCache.size > SEARCH_CACHE_LIMIT) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
}

function initialAvatarLabel(cardId: string): string {
  const suggestedCard = CARD_AVATAR_OPTIONS.find((card) => card.id === cardId);
  if (suggestedCard) return suggestedCard.label;
  return cardId
    .replace(/_(red|yellow|blue)$/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

type ProfileEditorProps = {
  username: string;
  avatarCardId: string | null;
};

export default function ProfileEditor({ username, avatarCardId }: ProfileEditorProps) {
  const router = useRouter();
  const initialCardId = avatarCardId || DEFAULT_CARD_AVATAR;
  const [selectedCardId, setSelectedCardId] = useState(initialCardId);
  const [selectedCardLabel, setSelectedCardLabel] = useState(() => initialAvatarLabel(initialCardId));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [cards, setCards] = useState<readonly CardAvatarOption[]>(CARD_AVATAR_OPTIONS);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [visibleCardCount, setVisibleCardCount] = useState(RESULTS_PER_PAGE);
  const [retryCount, setRetryCount] = useState(0);

  const visibleCards = cards.slice(0, visibleCardCount);

  useEffect(() => {
    if (!isModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingCardId) setIsModalOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isModalOpen, pendingCardId]);

  useEffect(() => {
    if (!isModalOpen) return;

    const normalizedSearch = search.trim();
    if (normalizedSearch.length < 2) return;

    const cacheKey = normalizedSearch.toLocaleLowerCase("en");
    const cached = readCachedSearch(cacheKey);
    if (cached) {
      const timeoutId = window.setTimeout(() => {
        setCards(cached.options);
        setHasMore(cached.hasMore);
        setVisibleCardCount(RESULTS_PER_PAGE);
        setCatalogError(null);
        setIsLoadingCards(false);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      fetch(`/api/profile/avatar-options?name=${encodeURIComponent(normalizedSearch)}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json() as Partial<SearchResult> & { error?: string };
          if (!response.ok || !Array.isArray(data.options) || typeof data.hasMore !== "boolean") {
            throw new Error(data.error || "Não foi possível buscar as cartas.");
          }
          const result = { options: data.options, hasMore: data.hasMore };
          cacheSearch(cacheKey, result);
          setCards(result.options);
          setHasMore(result.hasMore);
          setVisibleCardCount(RESULTS_PER_PAGE);
          setCatalogError(null);
        })
        .catch((requestError) => {
          if (requestError instanceof DOMException && requestError.name === "AbortError") return;
          if (requestError instanceof Error && requestError.name === "AbortError") return;
          setCatalogError(requestError instanceof Error ? requestError.message : "Não foi possível buscar as cartas.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoadingCards(false);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isModalOpen, retryCount, search]);

  function changeSearch(value: string) {
    const normalizedSearch = value.trim();
    setSearch(value);
    setVisibleCardCount(RESULTS_PER_PAGE);
    setCatalogError(null);
    setHasMore(false);
    if (normalizedSearch.length >= 2) {
      setIsLoadingCards(true);
    } else {
      setCards(CARD_AVATAR_OPTIONS);
      setIsLoadingCards(false);
    }
  }

  function openModal() {
    setError(null);
    setCatalogError(null);
    setSearch("");
    setCards(CARD_AVATAR_OPTIONS);
    setHasMore(false);
    setVisibleCardCount(RESULTS_PER_PAGE);
    setIsModalOpen(true);
  }

  function closeModal() {
    if (!pendingCardId) setIsModalOpen(false);
  }

  async function chooseCard(card: CardAvatarOption) {
    setError(null);
    setPendingCardId(card.id);

    try {
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.id }),
      });
      const data = await response.json() as { avatarCardId?: string; error?: string };
      if (!response.ok || !data.avatarCardId) {
        throw new Error(data.error || "Não foi possível alterar a foto.");
      }

      setSelectedCardId(data.avatarCardId);
      setSelectedCardLabel(card.label);
      router.refresh();
      setIsModalOpen(false);
      setSearch("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível alterar a foto.");
    } finally {
      setPendingCardId(null);
    }
  }

  return (
    <section className={styles.editor} aria-labelledby="profile-editor-title">
      <div className={styles.editorHeader}>
        <div>
          <h2 id="profile-editor-title">Seu perfil</h2>
        </div>
        <span className={styles.status}><i aria-hidden="true" /> Ativo</span>
      </div>

      <div className={styles.profileCard}>
        <div className={styles.avatarBlock}>
          <div className={styles.avatarFrame}>
            <span className={styles.avatarFallback} aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
            <img
              src={cardArtImageUrl(selectedCardId)}
              alt={selectedCardLabel}
              decoding="async"
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          </div>
          <div>
            <p className={styles.photoLabel}>Foto do perfil</p>
            <span className={styles.photoValue}>{selectedCardLabel}</span>
          </div>
        </div>

        <div className={styles.profileFields}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Nome de usuário</span>
            <strong>{username}</strong>
            <small>O nome não pode ser alterado nesta versão.</small>
          </div>
          <button className={styles.changeButton} type="button" onClick={openModal}>
            Alterar foto <Icon name="imageEdit" size={16} />
          </button>
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {isModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="art-picker-title"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.sectionLabel}>Biblioteca de artes</p>
                <h2 id="art-picker-title">Escolha sua foto</h2>
              </div>
              <button className={styles.closeButton} type="button" onClick={closeModal} aria-label="Fechar modal">
                <Icon name="x" size={18} />
              </button>
            </div>

            <label className={styles.searchField}>
              <Icon name="search" size={18} />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                placeholder="Buscar por nome"
                aria-label="Buscar artes"
              />
            </label>

            <div className={styles.resultsHeader}>
              <span>{cards.length} {cards.length === 1 ? "arte encontrada" : "artes encontradas"}</span>
              <span>{isLoadingCards ? "Buscando no catálogo…" : search.trim().length < 2 ? "Digite pelo menos 2 caracteres" : "Selecione uma para aplicar"}</span>
            </div>

            {catalogError && (
              <div className={styles.catalogError} role="alert">
                <span>{catalogError} As opções exibidas continuam disponíveis.</span>
                <button
                  type="button"
                  onClick={() => {
                    setCatalogError(null);
                    setIsLoadingCards(true);
                    setRetryCount((count) => count + 1);
                  }}
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {hasMore && !isLoadingCards && (
              <p className={styles.refineHint} role="status">
                Há mais resultados no catálogo. Digite mais letras para refinar a busca.
              </p>
            )}

            {cards.length > 0 ? (
              <>
                <div className={styles.artGrid}>
                  {visibleCards.map((card) => {
                    const isSelected = card.id === selectedCardId;
                    const isPending = card.id === pendingCardId;
                    return (
                      <button
                        className={`${styles.artOption} ${isSelected ? styles.selected : ""}`}
                        key={card.id}
                        type="button"
                        onClick={() => chooseCard(card)}
                        disabled={Boolean(pendingCardId)}
                        aria-pressed={isSelected}
                      >
                        <span className={styles.artImage}>
                          <span className={styles.artImageFallback} aria-hidden="true">
                            {card.label.slice(0, 1).toUpperCase()}
                          </span>
                          <img
                            src={cardArtImageUrl(card.id)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(event) => { event.currentTarget.hidden = true; }}
                          />
                        </span>
                        <span className={styles.artMeta}>
                          <strong>{card.label}</strong>
                          <small>{isPending ? "Aplicando…" : isSelected ? <><Icon name="check" size={13} /> Selecionada</> : "Escolher"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {visibleCards.length < cards.length && (
                  <button
                    className={styles.loadMoreButton}
                    type="button"
                    onClick={() => setVisibleCardCount((count) => count + RESULTS_PER_PAGE)}
                  >
                    <Icon name="plus" size={14} /> Carregar mais cartas ({cards.length - visibleCards.length} restantes)
                  </button>
                )}
              </>
            ) : (
              <p className={styles.emptyState} role={isLoadingCards ? "status" : undefined}>
                {isLoadingCards ? "Buscando artes…" : `Nenhuma arte encontrada para “${search.trim()}”.`}
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
