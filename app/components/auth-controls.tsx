"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cardArtImageUrl, DEFAULT_CARD_AVATAR } from "../../lib/card-avatars";
import Icon from "./ui-icons";
import CardImage from "./card-image";
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
  const router = useRouter();

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
    router.push("/login");
    router.refresh();
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
          <CardImage src={cardArtImageUrl(visibleAvatar)} alt="" width={128} height={128} onError={(event) => event.currentTarget.remove()} />
        </span>
        <span className={styles.profileName}>{username}</span>
        <Icon className={styles.chevron} name="chevronDown" size={16} />
      </button>
      <div className={styles.profileMenu} id={menuId} role="menu" hidden={!open}>
          <Link
            className={styles.statsLink}
            href="/me/stats"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Estatísticas
            <Icon name="chart" size={14} />
          </Link>
          {isAdmin && (
            <Link
              className={styles.adminLink}
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Administração
              <Icon name="externalLink" size={14} />
            </Link>
          )}
          <Link
            className={styles.editProfileLink}
            href="/me/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Editar perfil
            <Icon name="externalLink" size={14} />
          </Link>
          <button
            className={styles.signOutButton}
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={pending}
          >
            {pending ? "Saindo…" : "Sair"}
            <Icon name="logOut" size={14} />
          </button>
      </div>
    </div>
  );
}
