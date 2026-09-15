"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/ui-icons";
import { apiRequest, jsonRequest } from "../../lib/client-api";
import styles from "./replay-table.module.css";

type PlayerActionModal = "note" | "share";
type SharePermissions = {
  includeAnalysis: boolean;
  includeNote: boolean;
  includeBookmarks: boolean;
  includeGoals: boolean;
};

const initialSharePermissions: SharePermissions = {
  includeAnalysis: false,
  includeNote: false,
  includeBookmarks: false,
  includeGoals: false,
};
const defaultCoachName = "Treinador";

export default function ReplayPlayerActions({
  replayId,
  frameIndex,
  onOpen,
  disabled = false,
}: {
  replayId: string;
  frameIndex: number;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const [activeModal, setActiveModal] = useState<PlayerActionModal | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [note, setNote] = useState("");
  const [noteFrameIndex, setNoteFrameIndex] = useState(frameIndex);
  const [coachName, setCoachName] = useState(defaultCoachName);
  const [durationDays, setDurationDays] = useState(7);
  const [permissions, setPermissions] = useState<SharePermissions>(initialSharePermissions);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const closeModal = useCallback(() => {
    if (pendingRef.current) return;
    setActiveModal(null);
  }, []);

  useEffect(() => {
    if (!activeModal) return;

    const previousOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>("input:not([readonly]), textarea, select, button")?.focus();
    }, 0);
    document.body.style.overflow = "hidden";

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleModalKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleModalKeyDown);
      triggerRef.current?.focus();
    };
  }, [activeModal, closeModal]);

  function openNoteModal() {
    onOpen();
    triggerRef.current = noteButtonRef.current;
    setNoteFrameIndex(frameIndex);
    setNoteTitle(`Momento no frame ${frameIndex + 1}`);
    setNote("");
    setError("");
    setActionStatus("");
    setActiveModal("note");
  }

  function openShareModal() {
    onOpen();
    triggerRef.current = shareButtonRef.current;
    setCoachName(defaultCoachName);
    setDurationDays(7);
    setPermissions(initialSharePermissions);
    setShareUrl("");
    setCopied(false);
    setError("");
    setActionStatus("");
    setActiveModal("share");
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/replays/${replayId}/bookmarks`, jsonRequest("POST", { frameIndex: noteFrameIndex, title: noteTitle, note }));
      setActionStatus(`Nota salva no frame ${noteFrameIndex + 1}.`);
      setActiveModal(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a nota.");
    } finally {
      setPending(false);
    }
  }

  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setCopied(false);
    try {
      const body = await apiRequest<{ url?: string }>(`/api/replays/${replayId}/shares`, jsonRequest("POST", { coachName, durationDays, ...permissions }));
      if (!body.url) throw new Error("Não foi possível criar o compartilhamento.");
      setShareUrl(`${window.location.origin}${body.url}`);
      setActionStatus("Link seguro criado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o compartilhamento.");
    } finally {
      setPending(false);
    }
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setError("");
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
    }
  }

  const modalTitleId = activeModal === "note" ? "replay-note-title" : "replay-share-title";

  return (
    <>
      <div className={styles.playerActions} aria-label="Ações do replay">
        <button ref={noteButtonRef} type="button" onClick={openNoteModal} aria-haspopup="dialog" aria-expanded={activeModal === "note"} aria-controls="replay-note-modal" title="Tomar nota" disabled={disabled}>
          <Icon name="clipboard" size={16} /><span>Tomar nota</span>
        </button>
        <button ref={shareButtonRef} type="button" onClick={openShareModal} aria-haspopup="dialog" aria-expanded={activeModal === "share"} aria-controls="replay-share-modal" title="Compartilhar" disabled={disabled}>
          <Icon name="externalLink" size={16} /><span>Compartilhar</span>
        </button>
      </div>
      <span className={styles.playerActionStatus} role="status">{actionStatus}</span>

      {activeModal && (
        <div className={styles.playerModalLayer}>
          <button className={styles.playerModalBackdrop} type="button" aria-label="Fechar configurações" onClick={closeModal} />
          <div
            ref={modalRef}
            className={styles.playerModal}
            id={activeModal === "note" ? "replay-note-modal" : "replay-share-modal"}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
          >
            <header className={styles.playerModalHeader}>
              <div>
                <small>{activeModal === "note" ? `Frame ${noteFrameIndex + 1}` : "Acesso do treinador"}</small>
                <h2 id={modalTitleId}>{activeModal === "note" ? "Tomar nota" : "Compartilhar replay"}</h2>
              </div>
              <button type="button" onClick={closeModal} aria-label="Fechar configurações" disabled={pending}><Icon name="x" size={19} /></button>
            </header>

            {activeModal === "note" ? (
              <form className={styles.playerModalForm} onSubmit={saveNote}>
                <p>Registre um momento ligado ao frame atual para encontrá-lo depois no seu caderno.</p>
                <label><span>Título</span><input required maxLength={120} value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} /></label>
                <label><span>Nota <small>opcional · {note.length}/1000</small></span><textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="O que aconteceu neste momento?" /></label>
                {error && <p className={styles.playerModalError} role="alert">{error}</p>}
                <div className={styles.playerModalFooter}><button type="button" onClick={closeModal} disabled={pending}>Cancelar</button><button className={styles.playerModalPrimary} type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar nota"}</button></div>
              </form>
            ) : shareUrl ? (
              <div className={styles.playerModalResult}>
                <p>Link criado. Copie agora: o token de acesso não será exibido novamente.</p>
                <label><span>Link seguro</span><input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label>
                {error && <p className={styles.playerModalError} role="alert">{error}</p>}
                <div className={styles.playerModalFooter}><button type="button" onClick={closeModal}>Concluir</button><button className={styles.playerModalPrimary} type="button" onClick={copyShareUrl}><Icon name={copied ? "check" : "clipboard"} size={15} />{copied ? "Copiado" : "Copiar link"}</button></div>
              </div>
            ) : (
              <form className={styles.playerModalForm} onSubmit={createShare}>
                <p>O replay e os comentários são incluídos. Os demais conteúdos privados começam desligados.</p>
                <label><span>Nome do treinador</span><input required maxLength={80} value={coachName} onChange={(event) => setCoachName(event.target.value)} /></label>
                <label><span>Validade do link</span><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))}><option value={1}>24 horas</option><option value={7}>7 dias</option><option value={30}>30 dias</option></select></label>
                <fieldset className={styles.playerModalPermissions}>
                  <legend>Também permitir acesso a</legend>
                  {(Object.entries({ includeAnalysis: "Análise", includeNote: "Nota geral", includeBookmarks: "Notas por frame", includeGoals: "Metas" }) as Array<[keyof SharePermissions, string]>).map(([key, label]) => (
                    <label key={key}><input type="checkbox" checked={permissions[key]} onChange={(event) => setPermissions((value) => ({ ...value, [key]: event.target.checked }))} /><span>{label}</span></label>
                  ))}
                </fieldset>
                {error && <p className={styles.playerModalError} role="alert">{error}</p>}
                <div className={styles.playerModalFooter}><button type="button" onClick={closeModal} disabled={pending}>Cancelar</button><button className={styles.playerModalPrimary} type="submit" disabled={pending}>{pending ? "Criando…" : "Criar link seguro"}</button></div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
