import Brand from "../components/brand";
import SetupPasswordForm from "../primeira-senha/setup-password-form";
import styles from "../auth.module.css";

export default function SetPasswordPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Brand subtitle="First setup" />
        <header>
          <p className={styles.eyebrow}>Convite de acesso</p>
          <h1>Crie sua<br /><em>senha</em></h1>
          <p className={styles.description}>
            Defina uma senha para concluir o seu convite de acesso.
          </p>
        </header>
        <SetupPasswordForm />
      </section>
    </main>
  );
}
