"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { cardArtImageUrl, DEFAULT_CARD_AVATAR } from "../../lib/card-avatars";
import styles from "./auth-controls.module.css";

type AuthControlsProps = {
  username: string;
  avatarCardId?: string | null;
  isAdmin?: boolean;
};

export default function AuthControls({
  username,
  avatarCardId = null,
  isAdmin = false,
}: AuthControlsProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function signOut() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const visibleAvatar = avatarCardId || DEFAULT_CARD_AVATAR;
  const initials = username.slice(0, 1).toUpperCase();

  return (
    <div className={styles.controls} ref={containerRef}>
      <button
        className={styles.profileButton}
        type="button"
        aria-label={`Abrir menu de ${username}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          <span className={styles.avatarFallback}>{initials}</span>
          <img src={cardArtImageUrl(visibleAvatar)} alt="" onError={(event) => event.currentTarget.remove()} />
        </span>
        <span className={styles.profileName}>{username}</span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </button>
      <div className={styles.profileMenu} id={menuId} role="menu" hidden={!open}>
          {isAdmin && (
            <Link
              className={styles.adminLink}
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Administração
              <span aria-hidden="true">↗</span>
            </Link>
          )}
          <Link
            className={styles.editProfileLink}
            href="/me/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Editar perfil
            <span aria-hidden="true">↗</span>
          </Link>
          <button
            className={styles.signOutButton}
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={pending}
          >
            {pending ? "Saindo…" : "Sair"}
            <span aria-hidden="true">↗</span>
          </button>
      </div>
    </div>
  );
}
