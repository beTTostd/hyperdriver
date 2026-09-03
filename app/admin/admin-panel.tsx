"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { cardArtImageUrl, DEFAULT_CARD_AVATAR } from "../../lib/card-avatars";
import Icon from "../components/ui-icons";
import CardImage from "../components/card-image";
import styles from "../auth.module.css";
import layoutStyles from "./admin-content.module.css";

type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  avatarCardId: string | null;
  isActive: boolean;
  hasPassword: boolean;
  lastLoginAt: number | null;
};

type Invite = {
  url: string;
  expiresAt: number;
  username: string;
};

export default function AdminPanel({
  initialUsers,
  currentUserId,
}: {
  initialUsers: User[];
  currentUserId: number;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ id: number; type: "link" | "delete" } | null>(null);
  const [copied, setCopied] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const closeModal = useCallback(() => {
    if (pendingRef.current) return;
    setModalOpen(false);
  }, []);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!modalOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = addButtonRef.current;
    const focusTimer = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    }, 0);
    document.body.style.overflow = "hidden";

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      trigger?.focus();
    };
  }, [closeModal, modalOpen]);

  function openModal() {
    setError("");
    setUsername("");
    setRole("user");
    setModalOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvite(null);
    setCopied(false);
    setPending(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, role }),
      });
      const data = await response.json() as { error?: string; id?: number; setupUrl?: string; expiresAt?: number; username?: string; role?: "admin" | "user"; avatarCardId?: string };
      if (!response.ok || !data.id || !data.setupUrl || !data.expiresAt || !data.username || !data.role || !data.avatarCardId) {
        setError(data.error || "Não foi possível criar o usuário.");
        return;
      }
      setUsers((current) => [{ id: data.id!, username: data.username!, role: data.role!, avatarCardId: data.avatarCardId!, isActive: true, hasPassword: false, lastLoginAt: null }, ...current]);
      setInvite({ url: data.setupUrl, expiresAt: data.expiresAt, username: data.username });
      setUsername("");
      setModalOpen(false);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setPending(false);
    }
  }

  async function copyInvite() {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.url);
    setCopied(true);
  }

  async function regeneratePasswordLink(user: User) {
    setError("");
    setInvite(null);
    setCopied(false);
    setPendingAction({ id: user.id, type: "link" });
    try {
      const response = await fetch(`/api/admin/users/${user.id}/password-link`, {
        method: "POST",
      });
      const data = await response.json() as { error?: string; setupUrl?: string; expiresAt?: number; username?: string };
      if (!response.ok || !data.setupUrl || !data.expiresAt || !data.username) {
        setError(data.error || "Não foi possível gerar um novo link de senha.");
        return;
      }
      setInvite({ url: data.setupUrl, expiresAt: data.expiresAt, username: data.username });
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteUser(user: User) {
    const confirmed = window.confirm(
      `Apagar ${user.username}? A conta, as sessões e todos os replays desse usuário serão removidos permanentemente.`,
    );
    if (!confirmed) return;

    setError("");
    setPendingAction({ id: user.id, type: "delete" });
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setError(data.error || "Não foi possível apagar o usuário.");
        return;
      }
      setUsers((current) => current.filter((currentUser) => currentUser.id !== user.id));
      if (invite?.username === user.username) setInvite(null);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className={layoutStyles.content}>
      <header className={layoutStyles.pageHeader}>
        <div>
          <p className={layoutStyles.eyebrow}><span>01</span> Administração</p>
          <h1>Usuários</h1>
          <p className={layoutStyles.description}>Controle os acessos ao Hyperdriver e os convites de primeira senha.</p>
        </div>
        <button ref={addButtonRef} className={layoutStyles.primaryButton} type="button" onClick={openModal}>
          <Icon name="plus" size={16} /> Adicionar usuário
        </button>
      </header>

      {error && !modalOpen && <p className={styles.error} role="alert">{error}</p>}

      {invite && (
        <div className={styles.invite} role="status">
          <strong>Link de senha para {invite.username}</strong>
          <p className={styles.hint}>Este link substitui qualquer convite anterior, é válido por duas horas e só pode ser usado uma vez.</p>
          <code>{invite.url}</code>
          <button className={styles.copy} type="button" onClick={copyInvite}><Icon name="clipboard" size={14} />{copied ? "Copiado" : "Copiar link"}</button>
        </div>
      )}

      <section className={`${styles.panel} ${layoutStyles.userPanel}`} aria-labelledby="users-title">
        <div className={layoutStyles.sectionHeader}>
          <div>
            <p className={layoutStyles.eyebrow}><span>ACESSOS</span> Diretório</p>
            <h2 id="users-title">Usuários cadastrados</h2>
          </div>
          <span className={layoutStyles.count}>{users.length} {users.length === 1 ? "conta" : "contas"}</span>
        </div>
        {!users.length ? (
          <p className={layoutStyles.empty}>Nenhum usuário cadastrado.</p>
        ) : (
          <ul className={styles.userList}>
            {users.map((user) => (
              <li className={styles.userRow} key={user.id}>
                <div className={styles.userIdentity}>
                  <span className={styles.userAvatar} aria-hidden="true">
                    <span className={styles.userAvatarFallback}>{user.username.slice(0, 1).toUpperCase()}</span>
                    <CardImage
                      src={cardArtImageUrl(user.avatarCardId || DEFAULT_CARD_AVATAR)}
                      alt=""
                      width={96}
                      height={96}
                      onError={(event) => event.currentTarget.remove()}
                    />
                  </span>
                  <div>
                    <strong>{user.username}</strong>
                    <span>{user.hasPassword ? "Senha definida" : "Aguardando primeira senha"}</span>
                    <span>
                      Último login: {user.lastLoginAt ? formatLoginDate(user.lastLoginAt) : "Nunca acessou"}
                    </span>
                  </div>
                </div>
                <div className={styles.userActions}>
                  <span className={styles.role}>{user.role}</span>
                  <button
                    className={styles.passwordLinkButton}
                    type="button"
                    onClick={() => regeneratePasswordLink(user)}
                    disabled={pendingAction !== null}
                  >
                    <Icon name="key" size={14} />{pendingAction?.id === user.id && pendingAction.type === "link" ? "Gerando…" : "Gerar link de senha"}
                  </button>
                  <button
                    className={styles.deleteUserButton}
                    type="button"
                    onClick={() => deleteUser(user)}
                    disabled={pendingAction !== null || user.id === currentUserId}
                    title={user.id === currentUserId ? "Não é possível apagar a conta atual" : `Apagar ${user.username}`}
                  >
                    <Icon name="trash" size={14} />{pendingAction?.id === user.id && pendingAction.type === "delete" ? "Apagando…" : "Apagar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modalOpen && (
        <div className={styles.modalLayer}>
          <button className={styles.modalBackdrop} type="button" aria-label="Fechar formulário de usuário" onClick={closeModal} />
          <div
            ref={modalRef}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-user-title"
            aria-describedby="new-user-description"
          >
            <header className={styles.modalHeader}>
              <div>
                <p className={layoutStyles.eyebrow}><span>NOVO ACESSO</span> Convite</p>
                <h2 id="new-user-title">Adicionar usuário</h2>
              </div>
              <button className={styles.modalClose} type="button" aria-label="Fechar formulário de usuário" onClick={closeModal}>
                <Icon name="x" size={19} />
              </button>
            </header>
            <p id="new-user-description" className={styles.hint}>Crie a conta e compartilhe o link para a pessoa definir a primeira senha.</p>
            <form className={styles.form} onSubmit={submit}>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <label className={styles.field}>
                Username
                <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ex.: jogador-01" required />
              </label>
              <label className={styles.field}>
                Role
                <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "user")}>
                  <option value="user">User · acesso à aplicação</option>
                  <option value="admin">Admin · gestão de usuários</option>
                </select>
              </label>
              <button className={styles.submit} type="submit" disabled={pending}>
                {pending ? "Criando…" : "Criar usuário"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const loginDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatLoginDate(timestamp: number): string {
  return loginDateFormatter.format(new Date(timestamp));
}
