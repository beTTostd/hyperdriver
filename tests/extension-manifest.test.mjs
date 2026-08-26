import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(`${projectRoot}/talishar-local-history/manifest.json`, "utf8"));
const popup = readFileSync(`${projectRoot}/talishar-local-history/popup.html`, "utf8");
const popupStyles = readFileSync(`${projectRoot}/talishar-local-history/popup.css`, "utf8");

test("publica a extensão 1.1.0 com permissões agrupadas", () => {
  assert.equal(manifest.version, "1.1.0");
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
  assert.match(popup, /<footer[^>]*class="popup-footer"[^>]*>[\s\S]*<small>v1\.1\.0<\/small>[\s\S]*<\/footer>/);
  assert.match(popupStyles, /\.popup-footer\s*\{/);
});
