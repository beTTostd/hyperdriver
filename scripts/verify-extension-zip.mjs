import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { compareExtensionVersions, EXTENSION_FILE_PATTERN } from "../lib/extension-artifacts.js";

const sourceDirectory = resolve("talishar-local-history");
const sourceFiles = listFiles(sourceDirectory).sort();
const downloadsDirectory = resolve("public/downloads");
const archives = readdirSync(downloadsDirectory)
  .filter((fileName) => EXTENSION_FILE_PATTERN.test(fileName))
  .filter((fileName) => statSync(resolve(downloadsDirectory, fileName)).isFile())
  .sort((left, right) => compareExtensionVersions(right, left));

if (!archives.length) throw new Error("No versioned extension ZIP found in public/downloads.");

for (const [index, fileName] of archives.entries()) {
  verifyArchive(resolve(downloadsDirectory, fileName), fileName, index === 0);
}

console.log(`Verified ${archives.length} deterministic extension ZIP(s); latest archive matches ${sourceFiles.length} source files.`);

function verifyArchive(archive, fileName, isLatest) {
  const archiveFiles = runUnzip(["-Z1", archive])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  if (JSON.stringify(archiveFiles) !== JSON.stringify([...archiveFiles].sort())) {
    throw new Error(`Extension ZIP entries are not sorted deterministically: ${fileName}`);
  }

  if (isLatest) {
    if (JSON.stringify(archiveFiles) !== JSON.stringify(sourceFiles)) {
      throw new Error(`Latest extension ZIP entries differ from source: ${fileName}`);
    }

    for (const file of sourceFiles) {
      const archived = runUnzip(["-p", archive, file]);
      const source = readFileSync(resolve(sourceDirectory, file));
      if (!archived.equals(source)) throw new Error(`Latest extension ZIP contains stale content: ${fileName}/${file}`);
    }
  }

  const listing = runUnzip(["-l", archive]).toString();
  const datedEntries = listing.split("\n").filter((line) => /\d{4}-\d{2}-\d{2}/.test(line));
  if (datedEntries.some((line) => !line.includes("1980-01-01 00:00"))) {
    throw new Error(`Extension ZIP timestamps are not normalized to 1980-01-01 00:00: ${fileName}`);
  }
}

function listFiles(directory, prefix = "") {
  return readdirSync(directory).flatMap((name) => {
    const relative = prefix ? `${prefix}/${name}` : name;
    const absolute = resolve(directory, name);
    return statSync(absolute).isDirectory() ? listFiles(absolute, relative) : [relative];
  });
}

function runUnzip(args) {
  const result = spawnSync("unzip", args);
  if (result.status !== 0) throw new Error(result.stderr?.toString() || "unzip failed");
  return result.stdout;
}
