"use client";

import { FormEvent, useState } from "react";
import styles from "../auth.module.css";

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, returnTo }),
      });
      const data = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(data.error || "Não foi possível entrar.");
        return;
      }
      window.location.assign(data.redirectTo || "/");
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <label className={styles.field}>
        Username
        <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
      </label>
      <label className={styles.field}>
        Senha
        <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
