import assert from "node:assert/strict";

export default async function openLogin({ page }) {
  await page.getByRole("link", { name: "Acessar plataforma", exact: true }).click();
  await page.waitForURL("**/login?**");
  await page.getByRole("button", { name: "Entrar", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/login");
}
