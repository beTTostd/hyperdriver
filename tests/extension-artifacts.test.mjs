import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import {
  getLatestExtensionArtifact,
  listExtensionArtifacts,
  parseExtensionFilename,
} from "../lib/extension-artifacts.js";

const temporaryDirectories = [];

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

test("filtra ZIPs de extensão e ordena versões semanticamente", () => {
  const directory = createDownloadsDirectory();
  writeArtifact(directory, "hyperdriver-extension-v0.4.4.zip", "4.4", 1_000);
  writeArtifact(directory, "hyperdriver-extension-v0.10.0.zip", "10.0", 2_000);
  writeArtifact(directory, "hyperdriver-extension-v1.0.0.zip", "1.0", 3_000);
  writeFileSync(join(directory, "hyperdriver-extension.zip"), "legacy");
  writeFileSync(join(directory, "hyperdriver-extension-v1.0.zip"), "invalid");
  mkdirSync(join(directory, "hyperdriver-extension-v9.9.9.zip"));

  const artifacts = listExtensionArtifacts(directory);

  assert.deepEqual(artifacts.map(({ version, fileName }) => ({ version, fileName })), [
    { version: "1.0.0", fileName: "hyperdriver-extension-v1.0.0.zip" },
    { version: "0.10.0", fileName: "hyperdriver-extension-v0.10.0.zip" },
    { version: "0.4.4", fileName: "hyperdriver-extension-v0.4.4.zip" },
  ]);
  assert.equal(artifacts[0].url, "/downloads/hyperdriver-extension-v1.0.0.zip");
  assert.equal(artifacts[0].createdAt, 3_000);
});

test("retorna a versão mais recente e lida com diretório ausente", () => {
  const directory = createDownloadsDirectory();
  writeArtifact(directory, "hyperdriver-extension-v2.1.0.zip", "latest", 4_000);
  writeArtifact(directory, "hyperdriver-extension-v2.0.9.zip", "older", 5_000);

  assert.deepEqual(getLatestExtensionArtifact(directory), {
    fileName: "hyperdriver-extension-v2.1.0.zip",
    version: "2.1.0",
    url: "/downloads/hyperdriver-extension-v2.1.0.zip",
    createdAt: 4_000,
  });
  assert.deepEqual(listExtensionArtifacts(join(directory, "missing")), []);
});

test("reconhece somente o formato de versão definido", () => {
  assert.deepEqual(parseExtensionFilename("hyperdriver-extension-v0.4.4.zip"), {
    version: "0.4.4",
    major: 0,
    minor: 4,
    patch: 4,
  });
  assert.equal(parseExtensionFilename("hyperdriver-extension-v0.4.zip"), null);
  assert.equal(parseExtensionFilename("hyperdriver-extension-v0.4.4-beta.zip"), null);
});

function createDownloadsDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "hyperdriver-extension-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeArtifact(directory, fileName, content, timestamp) {
  const filePath = join(directory, fileName);
  writeFileSync(filePath, content);
  utimesSync(filePath, timestamp / 1000, timestamp / 1000);
}
