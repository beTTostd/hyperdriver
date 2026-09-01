"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MAX_PASSWORD_LENGTH } from "../../lib/password-policy";
import Icon from "../components/ui-icons";
import styles from "../auth.module.css";

export default function SetupPasswordForm({ token: initialToken = "" }: { token?: string }) {
  const tokenRef = useRef(initialToken);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = hash.get("token") || initialToken;
    tokenRef.current = fragmentToken;
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [initialToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, password, confirmation }),
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
        <input type="password" autoComplete="new-password" maxLength={MAX_PASSWORD_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <p className={styles.hint}>Entre 12 e {MAX_PASSWORD_LENGTH} caracteres, com maiúscula, minúscula, número e símbolo.</p>
      <label className={styles.field}>
        Confirmar senha
        <input type="password" autoComplete="new-password" maxLength={MAX_PASSWORD_LENGTH} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
      </label>
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Criar senha"}
      </button>
    </form>
  );
}
