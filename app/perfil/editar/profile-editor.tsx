"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CARD_AVATAR_OPTIONS,
  type CardAvatarOption,
  cardArtImageUrl,
  DEFAULT_CARD_AVATAR,
} from "../../../lib/card-avatars";
import styles from "./page.module.css";

type ProfileEditorProps = {
  username: string;
  avatarCardId: string | null;
};

export default function ProfileEditor({ username, avatarCardId }: ProfileEditorProps) {
  const router = useRouter();
  const [selectedCardId, setSelectedCardId] = useState(avatarCardId || DEFAULT_CARD_AVATAR);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<readonly CardAvatarOption[]>(CARD_AVATAR_OPTIONS);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [visibleCardCount, setVisibleCardCount] = useState(96);

  const filteredCards = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return cards;
    return cards.filter((card) =>
      `${card.label} ${card.id.replace(/_(red|yellow|blue)$/, "")}`.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [cards, search]);

  const visibleCards = filteredCards.slice(0, visibleCardCount);
  const isLoadingCards = isModalOpen && !catalogLoaded && !error;

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
    if (!isModalOpen || catalogLoaded) return;

    let cancelled = false;
    fetch("/api/profile/avatar-options")
      .then(async (response) => {
        const data = await response.json() as { options?: CardAvatarOption[]; error?: string };
        if (!response.ok || !Array.isArray(data.options)) {
          throw new Error(data.error || "Não foi possível carregar as cartas.");
        }
        if (!cancelled) {
          setCards(data.options);
          setCatalogLoaded(true);
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar as cartas.");
      });

    return () => {
      cancelled = true;
    };
  }, [catalogLoaded, isModalOpen]);

  function openModal() {
    setError(null);
    setSearch("");
    setVisibleCardCount(96);
    setIsModalOpen(true);
  }

  function closeModal() {
    if (!pendingCardId) setIsModalOpen(false);
  }

  async function chooseCard(cardId: string) {
    setError(null);
    setPendingCardId(cardId);

    try {
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
      const data = await response.json() as { avatarCardId?: string; error?: string };
      if (!response.ok || !data.avatarCardId) {
        throw new Error(data.error || "Não foi possível alterar a foto.");
      }

      setSelectedCardId(data.avatarCardId);
      router.refresh();
      setIsModalOpen(false);
      setSearch("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível alterar a foto.");
    } finally {
      setPendingCardId(null);
    }
  }

  const selectedCard = cards.find((card) => card.id === selectedCardId);
  const selectedCardLabel = selectedCard?.label || selectedCardId;

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
            <img src={cardArtImageUrl(selectedCardId)} alt={selectedCardLabel} />
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
            Alterar foto <span aria-hidden="true">↗</span>
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
                ×
              </button>
            </div>

            <label className={styles.searchField}>
              <span aria-hidden="true">⌕</span>
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou ID"
                aria-label="Buscar artes"
              />
            </label>

            <div className={styles.resultsHeader}>
              <span>{filteredCards.length} {filteredCards.length === 1 ? "arte encontrada" : "artes encontradas"}</span>
              <span>{isLoadingCards ? "Carregando catálogo completo…" : "Selecione uma para aplicar"}</span>
            </div>

            {filteredCards.length > 0 ? (
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
                        onClick={() => chooseCard(card.id)}
                        disabled={Boolean(pendingCardId)}
                        aria-pressed={isSelected}
                      >
                        <span className={styles.artImage}>
                          <img src={cardArtImageUrl(card.id)} alt="" loading="lazy" />
                        </span>
                        <span className={styles.artMeta}>
                          <strong>{card.label}</strong>
                          <small>{isPending ? "Aplicando…" : isSelected ? "Selecionada" : "Escolher"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {visibleCards.length < filteredCards.length && (
                  <button
                    className={styles.loadMoreButton}
                    type="button"
                    onClick={() => setVisibleCardCount((count) => count + 96)}
                  >
                    Carregar mais cartas ({filteredCards.length - visibleCards.length} restantes)
                  </button>
                )}
              </>
            ) : (
              <p className={styles.emptyState}>Nenhuma arte encontrada para “{search}”.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
