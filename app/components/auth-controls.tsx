"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cardArtImageUrl, DEFAULT_CARD_AVATAR } from "../../lib/card-avatars";
import Icon from "./ui-icons";
import CardImage from "./card-image";
import styles from "./auth-controls.module.css";

type AuthControlsProps = {
  username: string;
  avatarCardId?: string | null;
  isAdmin?: boolean;
  extensionUrl: string;
};

export default function AuthControls({
  username,
  avatarCardId = null,
  isAdmin = false,
  extensionUrl,
}: AuthControlsProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const mobileButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const profileMenuId = useId();
  const mobileMenuId = useId();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!profileOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setProfileOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileOpen(false);
        profileButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = mobileButtonRef.current;
    const mobileMedia = window.matchMedia("(max-width: 680px)");
    const focusTimer = window.setTimeout(() => {
      mobileDrawerRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    }, 0);
    document.body.style.overflow = "hidden";

    function handleDrawerKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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

    function closeDrawerOnDesktop(event: MediaQueryListEvent) {
      if (!event.matches) setMobileOpen(false);
    }

    document.addEventListener("keydown", handleDrawerKeyDown);
    mobileMedia.addEventListener("change", closeDrawerOnDesktop);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDrawerKeyDown);
      mobileMedia.removeEventListener("change", closeDrawerOnDesktop);
      trigger?.focus();
    };
  }, [mobileOpen]);

  async function signOut() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const visibleAvatar = avatarCardId || DEFAULT_CARD_AVATAR;
  const initials = username.slice(0, 1).toUpperCase();
  const closeMobileMenu = () => setMobileOpen(false);

  return (
    <div className={styles.controls} ref={containerRef}>
      <button
        ref={profileButtonRef}
        className={styles.profileButton}
        type="button"
        aria-label={`Abrir menu de ${username}`}
        aria-haspopup="menu"
        aria-expanded={profileOpen}
        aria-controls={profileMenuId}
        onClick={() => setProfileOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          <span className={styles.avatarFallback}>{initials}</span>
          <CardImage src={cardArtImageUrl(visibleAvatar)} alt="" width={128} height={128} onError={(event) => event.currentTarget.remove()} />
        </span>
        <span className={styles.profileName}>{username}</span>
        <Icon className={styles.chevron} name="chevronDown" size={16} />
      </button>
      <div className={styles.profileMenu} id={profileMenuId} role="menu" hidden={!profileOpen}>
          <Link
            className={styles.statsLink}
            href="/me/stats"
            role="menuitem"
            onClick={() => setProfileOpen(false)}
          >
            Estatísticas
            <Icon name="chart" size={14} />
          </Link>
          {isAdmin && (
            <Link
              className={styles.adminLink}
              href="/admin"
              role="menuitem"
              onClick={() => setProfileOpen(false)}
            >
              Administração
              <Icon name="externalLink" size={14} />
            </Link>
          )}
          <Link
            className={styles.editProfileLink}
            href="/me/profile"
            role="menuitem"
            onClick={() => setProfileOpen(false)}
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

      <button
        ref={mobileButtonRef}
        className={styles.mobileMenuButton}
        type="button"
        aria-label="Abrir menu principal"
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
        aria-controls={mobileMenuId}
        onClick={() => setMobileOpen(true)}
      >
        <Icon name="menu" size={22} />
      </button>

      <div className={styles.mobileLayer} hidden={!mobileOpen}>
        <button className={styles.mobileBackdrop} type="button" aria-label="Fechar menu principal" onClick={closeMobileMenu} />
        <aside
          ref={mobileDrawerRef}
          className={styles.mobileDrawer}
          id={mobileMenuId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${mobileMenuId}-title`}
        >
          <header className={styles.mobileDrawerHeader}>
            <div>
              <small>Pitwall / navegação</small>
              <strong id={`${mobileMenuId}-title`}>Menu</strong>
            </div>
            <button type="button" aria-label="Fechar menu principal" onClick={closeMobileMenu}>
              <Icon name="x" size={20} />
            </button>
          </header>

          <Link className={styles.mobileUser} href="/me/profile" onClick={closeMobileMenu}>
            <span className={`${styles.avatar} ${styles.mobileAvatar}`} aria-hidden="true">
              <span className={styles.avatarFallback}>{initials}</span>
              <CardImage src={cardArtImageUrl(visibleAvatar)} alt="" width={160} height={160} onError={(event) => event.currentTarget.remove()} />
            </span>
            <span>
              <small>Usuário conectado</small>
              <strong>{username}</strong>
              <em>Ver perfil</em>
            </span>
            <Icon name="chevronRight" size={18} />
          </Link>

          <nav className={styles.mobileNav} aria-label="Navegação principal">
            <Link href="/replays" aria-current={pathname.startsWith("/replays") ? "page" : undefined} onClick={closeMobileMenu}>
              <span><small>01</small> Replays</span><Icon name="arrowRight" size={17} />
            </Link>
            <Link href="/me/stats" aria-current={pathname === "/me/stats" ? "page" : undefined} onClick={closeMobileMenu}>
              <span><small>02</small> Estatísticas</span><Icon name="chart" size={17} />
            </Link>
            <Link href="/me/profile" aria-current={pathname === "/me/profile" ? "page" : undefined} onClick={closeMobileMenu}>
              <span><small>03</small> Editar perfil</span><Icon name="externalLink" size={17} />
            </Link>
            {isAdmin && (
              <>
                <Link href="/admin/replays" aria-current={pathname === "/admin/replays" ? "page" : undefined} onClick={closeMobileMenu}>
                  <span><small>04</small> Partidas</span><Icon name="arrowRight" size={17} />
                </Link>
                <Link href="/admin" aria-current={pathname === "/admin" ? "page" : undefined} onClick={closeMobileMenu}>
                  <span><small>05</small> Administração</span><Icon name="externalLink" size={17} />
                </Link>
              </>
            )}
          </nav>

          <div className={styles.mobileDrawerFooter}>
            <a href={extensionUrl} target="_blank" rel="noreferrer" onClick={closeMobileMenu}>
              Instalar extensão <Icon name="externalLink" size={17} />
            </a>
            <button type="button" onClick={signOut} disabled={pending}>
              {pending ? "Saindo…" : "Sair da conta"}<Icon name="logOut" size={17} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
