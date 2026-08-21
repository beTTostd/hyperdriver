"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import Icon from "../components/ui-icons";
import styles from "../auth.module.css";

export default function SetupPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirmation }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setError(data.error || "Não foi possível definir a senha.");
        return;
      }
      setComplete(true);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setPending(false);
    }
  }

  if (complete) {
    return (
      <div>
        <p className={styles.success} role="status">Senha criada. Você já pode entrar no Hyperdriver.</p>
        <Link className={styles.link} href="/login">Ir para o login <Icon name="arrowRight" size={15} /></Link>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <label className={styles.field}>
        Nova senha
        <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <p className={styles.hint}>Mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo.</p>
      <label className={styles.field}>
        Confirmar senha
        <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
      </label>
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Criar senha"}
      </button>
    </form>
  );
}
