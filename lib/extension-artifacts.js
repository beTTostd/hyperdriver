import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const EXTENSION_FILE_PATTERN = /^hyperdriver-extension-v(\d+)\.(\d+)\.(\d+)\.zip$/;

const defaultDownloadsDirectory = resolve(process.cwd(), "public", "downloads");

/**
 * @typedef {Object} ExtensionArtifact
 * @property {string} fileName
 * @property {string} version
 * @property {string} url
 * @property {number} createdAt
 */

/**
 * @param {string} fileName
 * @returns {{version: string, major: number, minor: number, patch: number} | null}
 */
export function parseExtensionFilename(fileName) {
  const match = EXTENSION_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  return {
    version: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareExtensionVersions(left, right) {
  const leftVersion = parseExtensionFilename(left)?.version ?? left.replace(/^v/, "");
  const rightVersion = parseExtensionFilename(right)?.version ?? right.replace(/^v/, "");
  const leftParts = leftVersion.split(".").map(Number);
  const rightParts = rightVersion.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

/**
 * @param {string} [downloadsDirectory]
 * @returns {ExtensionArtifact[]}
 */
export function listExtensionArtifacts(downloadsDirectory = defaultDownloadsDirectory) {
  let names;
  try {
    names = readdirSync(downloadsDirectory);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw error;
  }

  return names
    .map((fileName) => {
      const parsed = parseExtensionFilename(fileName);
      if (!parsed) return null;

      const filePath = join(downloadsDirectory, fileName);
      let fileStats;
      try {
        fileStats = statSync(filePath);
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
        throw error;
      }
      if (!fileStats.isFile()) return null;

      return {
        fileName,
        version: parsed.version,
        url: `/downloads/${encodeURIComponent(fileName)}`,
        createdAt: fileStats.mtimeMs,
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareExtensionVersions(right.fileName, left.fileName));
}

/**
 * @param {string} [downloadsDirectory]
 * @returns {ExtensionArtifact | null}
 */
export function getLatestExtensionArtifact(downloadsDirectory = defaultDownloadsDirectory) {
  return listExtensionArtifacts(downloadsDirectory)[0] ?? null;
}
