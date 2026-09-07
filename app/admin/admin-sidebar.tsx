"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "../components/ui-icons";
import styles from "./admin-layout.module.css";

const links = [
  { href: "/admin", label: "Saúde do sistema", icon: "chart" as const },
  { href: "/admin/usuarios", label: "Usuários", icon: "key" as const },
  { href: "/admin/replays", label: "Partidas", icon: "arrowRight" as const },
  { href: "/admin/json", label: "Arquivos JSON", icon: "download" as const },
  { href: "/admin/elo", label: "Elo", icon: "chart" as const },
  { href: "/admin/extensoes", label: "Versões da extensão", icon: "download" as const },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    const focusTimer = window.setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    }, 0);
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [open]);

  function isActive(href: string) {
    return href === "/admin" ? pathname === href : pathname.startsWith(href);
  }

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.mobileSidebarButton}
        type="button"
        aria-label="Abrir menu administrativo"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size={18} />
        Menu administrativo
      </button>
      <nav className={styles.sidebar} aria-label="Administração">
        <div className={styles.sidebarHeading}>
          <span>Admin / controle</span>
          <strong>Gestão</strong>
        </div>
        <div className={styles.sidebarLinks}>
          {links.map((link, index) => (
            <Link
              className={styles.sidebarLink}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              key={link.href}
            >
              <span><small>{String(index + 1).padStart(2, "0")}</small>{link.label}</span>
              <Icon name={link.icon} size={17} />
            </Link>
          ))}
        </div>
        <p className={styles.sidebarHint}>Partidas permanecem disponíveis no acesso superior.</p>
      </nav>
      <div className={styles.mobileSidebarLayer} hidden={!open}>
        <button className={styles.mobileSidebarBackdrop} type="button" aria-label="Fechar menu administrativo" onClick={close} />
        <aside
          ref={drawerRef}
          className={styles.mobileSidebarDrawer}
          id={menuId}
          role="dialog"
          aria-modal="true"
          aria-label="Menu administrativo"
        >
          <header className={styles.mobileSidebarHeader}>
            <div>
              <small>Admin / navegação</small>
              <strong>Gestão</strong>
            </div>
            <button type="button" aria-label="Fechar menu administrativo" onClick={close}>
              <Icon name="x" size={20} />
            </button>
          </header>
          <nav className={styles.mobileSidebarLinks} aria-label="Seções administrativas">
            {links.map((link, index) => (
              <Link
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                key={link.href}
                onClick={close}
              >
                <span><small>{String(index + 1).padStart(2, "0")}</small>{link.label}</span>
                <Icon name={link.icon} size={17} />
              </Link>
            ))}
          </nav>
          <p className={styles.sidebarHint}>Partidas continuam acessíveis no link superior.</p>
        </aside>
      </div>
    </>
  );
}
