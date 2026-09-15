import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(`${projectRoot}/talishar-local-history/manifest.json`, "utf8"));
const popup = readFileSync(`${projectRoot}/talishar-local-history/popup.html`, "utf8");
const popupStyles = readFileSync(`${projectRoot}/talishar-local-history/popup.css`, "utf8");
const serviceWorker = readFileSync(`${projectRoot}/talishar-local-history/service-worker.js`, "utf8");
const offscreenScript = readFileSync(`${projectRoot}/talishar-local-history/offscreen.js`, "utf8");

test("publica a extensão 1.5.2 com permissões agrupadas e documento offscreen", () => {
  assert.equal(manifest.version, "1.5.2");
  assert.deepEqual(manifest.permissions, ["downloads", "offscreen", "storage"]);
  assert.doesNotMatch(offscreenScript, /chrome\.downloads/);
  assert.match(serviceWorker, /chrome\.downloads\.download/);
  assert.deepEqual(manifest.host_permissions, [
    "https://*.talishar.net/*",
    "https://*.hyperdriver.com.br/*",
  ]);

  const matches = [...new Set(manifest.content_scripts.flatMap(({ matches: scriptMatches }) => scriptMatches))].sort();
  assert.deepEqual(matches, [
    "https://*.hyperdriver.com.br/*",
    "https://*.talishar.net/*",
  ]);
  assert.equal(manifest.content_scripts.length, 3);
  assert.deepEqual(manifest.content_scripts[0].js, ["decision-capture-utils.js", "page-bridge.js"]);

  const serializedManifest = JSON.stringify(manifest);
  for (const legacyPattern of [
    "https://talishar.net/*",
    "https://api.talishar.net/*",
    "https://hyperdriver.com.br/*",
    "https://beta.hyperdriver.com.br/*",
  ]) {
    assert.equal(serializedManifest.includes(legacyPattern), false, legacyPattern);
  }
});

test("exibe a versão no rodapé semântico do popup", () => {
  assert.match(popup, /<footer[^>]*class="popup-footer"[^>]*>[\s\S]*<small>v1\.5\.2<\/small>[\s\S]*<\/footer>/);
  assert.match(popupStyles, /\.popup-footer\s*\{/);
});

test("lista somente a página solicitada pelo índice sem regravar replays", () => {
  assert.match(serviceWorker, /index\("startedAt"\)\.openCursor\(null, "prev"\)/);
  assert.match(serviceWorker, /listMatchPage\(message\.page\)/);
  const listHandler = serviceWorker.slice(
    serviceWorker.indexOf('if (message.type === "list-matches")'),
    serviceWorker.indexOf('if (message.type === "list-sync-pending")'),
  );
  assert.doesNotMatch(listHandler, /putMatch\(/);
  assert.match(popup, /id="previous-page"/);
  assert.match(popup, /id="next-page"/);
  assert.match(popup, /id="page-indicator"/);
});
