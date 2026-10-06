import assert from "node:assert/strict";

// Run with an authenticated context and a replay already open.
export default async function inspectMobileReplay({ page }) {
  const slider = page.getByRole("slider", { name: "Posição do replay" });
  await slider.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("figure img")].every((image) => image.complete));
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `/output/replay-${width}.png`, fullPage: true });
    const geometry = await page.evaluate(() => {
      const controls = document.querySelector('[aria-label="Controles do replay"]');
      const table = document.querySelector('[aria-label="Mesa do oponente"]').parentElement;
      const rect = controls.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        controlsBottom: rect.bottom,
        viewportHeight: window.innerHeight,
        tableWidth: table.getBoundingClientRect().width,
        handsInsideBoard: [...table.querySelectorAll('[aria-label^="Mão"]')].every((hand) => {
          const handBounds = hand.getBoundingClientRect();
          const tableBounds = table.getBoundingClientRect();
          return handBounds.top >= tableBounds.top && handBounds.bottom <= tableBounds.bottom;
        }),
      };
    });
    assert.ok(geometry.documentWidth <= width, `Page overflows at ${width}px`);
    assert.ok(geometry.tableWidth <= width, `Board overflows at ${width}px`);
    assert.ok(geometry.handsInsideBoard, `Hands clipped at ${width}px`);
    assert.ok(geometry.controlsBottom <= height + 1, `Controls clipped at ${width}px`);
    for (const label of ["Mesa do oponente", "Sua mesa"]) {
      const half = page.getByRole("region", { name: label, exact: true });
      if (width <= 680) {
        const areas = await half.locator(':scope > section:not([aria-label^="Mão"]):not([aria-label="Permanentes e itens"]), :scope > div > section').evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }));
        for (let index = 0; index < areas.length; index++) {
          for (const other of areas.slice(index + 1)) {
            const area = areas[index];
            const overlapX = Math.min(area.right, other.right) - Math.max(area.left, other.left);
            const overlapY = Math.min(area.bottom, other.bottom) - Math.max(area.top, other.top);
            assert.ok(overlapX <= 1 || overlapY <= 1, `Overlapping zones in ${label} at ${width}px`);
          }
        }
      }
      const cards = await half.locator('figure').evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, right: rect.right, width: rect.width };
      }));
      assert.ok(cards.every((card) => card.width >= 32), `Unreadable cards at ${width}px`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await slider.inputValue();
  await page.getByRole("button", { name: "Próximo frame", exact: true }).click();
  assert.equal(Number(await slider.inputValue()), Number(before) + 1);
  await page.getByRole("button", { name: /Abrir painel de telemetria/ }).click();
  await page.getByRole("dialog", { name: /Telemetria/ }).waitFor();
  await page.getByRole("button", { name: /Fechar painel de telemetria/ }).last().click();
  const card = page.getByRole("region", { name: "Sua mesa", exact: true }).locator('figure[tabindex="0"]').first();
  await card.tap();
  await page.getByRole("button", { name: /Fechar.*carta/i }).waitFor();
  await page.screenshot({ path: "/output/replay-touch-preview.png" });
  await page.getByRole("button", { name: /Fechar.*carta/i }).click({ position: { x: 5, y: 5 } });
  assert.equal(await page.getByRole("dialog", { name: /Prévia/ }).count(), 0);
}
