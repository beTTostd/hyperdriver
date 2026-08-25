import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const sourceDirectory = resolve("talishar-local-history");
const manifest = JSON.parse(readFileSync(join(sourceDirectory, "manifest.json"), "utf8"));
const version = process.env.EXTENSION_VERSION || manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid extension version: ${version}`);

const outputDirectory = resolve("public/downloads");
const outputPath = join(outputDirectory, `hyperdriver-extension-v${version}.zip`);
const files = listFiles(sourceDirectory).sort();
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const entries = [];
const localParts = [];
let offset = 0;

for (const file of files) {
  const name = Buffer.from(file);
  const data = readFileSync(join(sourceDirectory, file));
  const crc = crc32(data);
  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(10, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(33, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  name.copy(localHeader, 30);
  localParts.push(localHeader, data);
  entries.push({ name, crc, size: data.length, offset });
  offset += localHeader.length + data.length;
}

const centralParts = entries.map(({ name, crc, size, offset: localOffset }) => {
  const centralHeader = Buffer.alloc(46 + name.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(10, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(33, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(size, 20);
  centralHeader.writeUInt32LE(size, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(localOffset, 42);
  name.copy(centralHeader, 46);
  return centralHeader;
});

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, end]));
console.log(`Built deterministic extension ZIP: ${outputPath} (${files.length} files).`);

function listFiles(directory, prefix = "") {
  return readdirSync(directory).flatMap((name) => {
    const relative = prefix ? `${prefix}/${name}` : name;
    const absolute = join(directory, name);
    return statSync(absolute).isDirectory() ? listFiles(absolute, relative) : [relative];
  });
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
