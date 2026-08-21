import Link from "next/link";
import Brand from "../components/brand";
import { getPasswordSetupState } from "../../lib/auth";
import SetupPasswordForm from "../primeira-senha/setup-password-form";
import Icon from "../components/ui-icons";
import styles from "../auth.module.css";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token || "";
  const setup = token ? getPasswordSetupState(token) : null;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Brand subtitle="First setup" />
        <header>
          <p className={styles.eyebrow}>Convite de acesso</p>
          <h1>Crie sua<br /><em>senha</em></h1>
          <p className={styles.description}>
            {setup ? `Defina uma nova senha para ${setup.username}.` : "Este link não é válido ou já expirou."}
          </p>
        </header>
        {setup ? <SetupPasswordForm token={token} /> : <Link className={styles.link} href="/login">Voltar para o login <Icon name="arrowRight" size={15} /></Link>}
      </section>
    </main>
  );
}
