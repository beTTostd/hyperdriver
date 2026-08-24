import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const sourceDirectory = resolve("talishar-local-history");
const archive = resolve("public/downloads/hyperdriver-extension.zip");
const sourceFiles = listFiles(sourceDirectory).sort();
const archiveFiles = runUnzip(["-Z1", archive])
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);

if (JSON.stringify(archiveFiles) !== JSON.stringify(sourceFiles)) {
  throw new Error("Extension ZIP entries differ from source or are not sorted deterministically.");
}

for (const file of sourceFiles) {
  const archived = runUnzip(["-p", archive, file]);
  const source = readFileSync(resolve(sourceDirectory, file));
  if (!archived.equals(source)) throw new Error(`Extension ZIP contains stale content: ${file}`);
}

const listing = runUnzip(["-l", archive]).toString();
const datedEntries = listing.split("\n").filter((line) => /\d{4}-\d{2}-\d{2}/.test(line));
if (datedEntries.some((line) => !line.includes("1980-01-01 00:00"))) {
  throw new Error("Extension ZIP timestamps are not normalized to 1980-01-01 00:00.");
}

console.log(`Verified deterministic extension ZIP (${sourceFiles.length} files).`);

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
