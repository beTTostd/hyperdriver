"use client";

import { FormEvent, useState } from "react";
import styles from "../auth.module.css";

type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  isActive: boolean;
  hasPassword: boolean;
};

export default function AdminPanel({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<{ url: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState(false);
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
      const data = await response.json() as { error?: string; setupUrl?: string; expiresAt?: number; username?: string; role?: "admin" | "user" };
      if (!response.ok || !data.setupUrl || !data.expiresAt || !data.username || !data.role) {
        setError(data.error || "Não foi possível criar o usuário.");
        return;
      }
      setUsers((current) => [{ id: Date.now(), username: data.username!, role: data.role!, isActive: true, hasPassword: false }, ...current]);
      setInvite({ url: data.setupUrl, expiresAt: data.expiresAt });
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

  return (
    <section className={styles.adminGrid}>
      <div className={styles.panel}>
        <h2>Novo acesso</h2>
        <form className={styles.form} onSubmit={submit}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <label className={styles.field}>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ex.: piloto-01" required />
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
            <strong>Link de primeira senha</strong>
            <p className={styles.hint}>Entregue este link ao usuário. Ele é válido por duas horas e só pode ser usado uma vez.</p>
            <code>{invite.url}</code>
            <button className={styles.copy} type="button" onClick={copyInvite}>{copied ? "Copiado" : "Copiar link"}</button>
          </div>
        )}
      </div>
      <div className={styles.panel}>
        <h2>Usuários</h2>
        <ul className={styles.userList}>
          {users.map((user) => (
            <li className={styles.userRow} key={user.id}>
              <div>
                <strong>{user.username}</strong>
                <span>{user.hasPassword ? "Senha definida" : "Aguardando primeira senha"}</span>
              </div>
              <span className={styles.role}>{user.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
