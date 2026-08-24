"use client";

import { FormEvent, useState } from "react";
import { cardArtImageUrl, DEFAULT_CARD_AVATAR } from "../../lib/card-avatars";
import Icon from "../components/ui-icons";
import CardImage from "../components/card-image";
import styles from "../auth.module.css";

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
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ id: number; type: "link" | "delete" } | null>(null);
  const [copied, setCopied] = useState(false);

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
      const data = await response.json() as { error?: string; id?: number; setupUrl?: string; expiresAt?: number; username?: string; role?: "admin" | "user" };
      if (!response.ok || !data.id || !data.setupUrl || !data.expiresAt || !data.username || !data.role) {
        setError(data.error || "Não foi possível criar o usuário.");
        return;
      }
      setUsers((current) => [{ id: data.id!, username: data.username!, role: data.role!, avatarCardId: null, isActive: true, hasPassword: false, lastLoginAt: null }, ...current]);
      setInvite({ url: data.setupUrl, expiresAt: data.expiresAt, username: data.username });
      setUsername("");
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
    <section className={styles.adminGrid}>
      <div className={styles.panel}>
        <h2>Novo acesso</h2>
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
        {invite && (
          <div className={styles.invite} role="status">
            <strong>Link de senha para {invite.username}</strong>
            <p className={styles.hint}>Este link substitui qualquer convite anterior, é válido por duas horas e só pode ser usado uma vez.</p>
            <code>{invite.url}</code>
            <button className={styles.copy} type="button" onClick={copyInvite}><Icon name="clipboard" size={14} />{copied ? "Copiado" : "Copiar link"}</button>
          </div>
        )}
      </div>
      <div className={styles.panel}>
        <h2>Usuários</h2>
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
      </div>
    </section>
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
