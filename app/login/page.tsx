import Brand from "../components/brand";
import LoginForm from "./login-form";
import styles from "../auth.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Brand subtitle="Secure pitwall" />
        <header>
          <p className={styles.eyebrow}>Acesso restrito</p>
          <h1>Entre<br /><em>na pista</em></h1>
          <p className={styles.description}>Use suas credenciais para acessar os replays e a telemetria do Hyperdriver.</p>
        </header>
        <LoginForm returnTo={params.returnTo || "/me"} />
      </section>
    </main>
  );
}
