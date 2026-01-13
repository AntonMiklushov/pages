import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { encryptBytes } from "./crypto.mjs";

const textEncoder = new TextEncoder();

const password = process.env.LIB_PASSWORD;
const baseUrl = process.env.LIB_BASE_URL;
const iterations = Number.parseInt(
  process.env.LIB_PBKDF2_ITERS || "300000",
  10
);

if (!password) {
  console.error("LIB_PASSWORD is required.");
  process.exit(1);
}

if (!baseUrl) {
  console.error("LIB_BASE_URL is required.");
  process.exit(1);
}

if (!baseUrl.endsWith("/")) {
  console.error('LIB_BASE_URL must end with "/".');
  process.exit(1);
}

if (!Number.isFinite(iterations) || iterations <= 0) {
  console.error("LIB_PBKDF2_ITERS must be a positive integer.");
  process.exit(1);
}

const root = process.cwd();
const pdfDir = path.join(root, "library_src", "pdfs");
const metadataPath = path.join(root, "library_src", "metadata.json");
const outObjectsRoot = path.join(root, "out", "objects");
const outCatalogPath = path.join(root, "out", "catalog.json");
const cachePath = path.join(root, "out", "build-cache.json");
const libraryCatalogPath = path.join(root, "library", "catalog.enc");
const cacheVersion = 1;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlug(base, used) {
  let slug = base;
  let counter = 2;
  while (used.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  used.add(slug);
  return slug;
}

function humanize(name) {
  const cleaned = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Untitled";
  }
  return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function parseYear(value) {
  if (Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function safeObjectKey(key) {
  const cleaned = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = cleaned
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
}

function safeObjectPath(rootPath, key) {
  const safeKey = safeObjectKey(key);
  const fullPath = path.join(rootPath, safeKey);
  if (!fullPath.startsWith(rootPath)) {
    throw new Error(`Unsafe object key: ${key}`);
  }
  return { safeKey, fullPath };
}

function buildKeyId(secret, iterationsValue) {
  return createHash("sha256")
    .update(secret)
    .update("\0")
    .update(String(iterationsValue))
    .digest("hex");
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function loadCache() {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== cacheVersion) {
      return null;
    }
    if (typeof parsed.keyId !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveCache(keyId) {
  const payload = { version: cacheVersion, keyId };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2));
}

async function loadMetadata() {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildMetadataMaps(metadata) {
  if (!metadata) {
    return { byFilename: new Map(), byId: new Map() };
  }

  let items = [];
  if (Array.isArray(metadata)) {
    items = metadata;
  } else if (Array.isArray(metadata.items)) {
    items = metadata.items;
  } else if (metadata && typeof metadata === "object") {
    items = Object.entries(metadata)
      .map(([key, value]) => {
        if (!value || typeof value !== "object") {
          return null;
        }
        const entry = { ...value };
        if (!entry.filename && key.toLowerCase().endsWith(".pdf")) {
          entry.filename = key;
        } else if (!entry.id) {
          entry.id = key;
        }
        return entry;
      })
      .filter(Boolean);
  }

  const byFilename = new Map();
  const byId = new Map();
  items.forEach((item) => {
    if (item.filename) {
      byFilename.set(item.filename, item);
    }
    if (item.id) {
      byId.set(item.id, item);
    }
  });

  return { byFilename, byId };
}

async function listPdfFiles() {
  try {
    const entries = await fs.readdir(pdfDir, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.warn("library_src/pdfs not found. Building an empty catalog.");
      return [];
    }
    throw error;
  }
}

const metadata = await loadMetadata();
const metadataMaps = buildMetadataMaps(metadata);
const filenames = await listPdfFiles();
const usedIds = new Set();
const items = [];
const cache = await loadCache();
const cacheKeyId = buildKeyId(password, iterations);
const forceReencrypt = !cache || cache.keyId !== cacheKeyId;

await fs.mkdir(outObjectsRoot, { recursive: true });

for (const filename of filenames) {
  const filePath = path.join(pdfDir, filename);
  const baseName = path.basename(filename, path.extname(filename));
  const slugBase = slugify(baseName) || "doc";
  const id = uniqueSlug(slugBase, usedIds);

  const meta =
    metadataMaps.byFilename.get(filename) ||
    metadataMaps.byId.get(id) ||
    {};

  const title =
    typeof meta.title === "string" && meta.title.trim().length > 0
      ? meta.title.trim()
      : humanize(baseName);

  const fileBytes = await fs.readFile(filePath);
  const contentHash = hashBytes(fileBytes);
  const objectKey = `pdf/${contentHash}.pdf.enc`;
  const { safeKey, fullPath } = safeObjectPath(outObjectsRoot, objectKey);

  const shouldEncrypt = forceReencrypt || !(await fileExists(fullPath));
  if (shouldEncrypt) {
    const encrypted = await encryptBytes(password, fileBytes, iterations);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, encrypted);
  }

  const stat = await fs.stat(filePath);
  const size =
    Number.isFinite(meta.size) && meta.size > 0 ? meta.size : stat.size;
  const year = parseYear(meta.year);
  const tags = normalizeTags(meta.tags);

  const item = {
    id,
    title,
    objectKey: safeKey,
  };
  if (meta.authors && typeof meta.authors === "string") {
    item.authors = meta.authors.trim();
  }
  if (year) {
    item.year = year;
  }
  if (tags.length > 0) {
    item.tags = tags;
  }
  if (meta.notes && typeof meta.notes === "string") {
    item.notes = meta.notes.trim();
  }
  if (size) {
    item.size = size;
  }

  items.push(item);
}

const catalog = {
  version: 1,
  baseUrl,
  generatedAt: new Date().toISOString(),
  items,
};

await fs.mkdir(path.dirname(outCatalogPath), { recursive: true });
await fs.writeFile(outCatalogPath, JSON.stringify(catalog, null, 2));

const catalogBytes = textEncoder.encode(JSON.stringify(catalog));
const catalogEncrypted = await encryptBytes(password, catalogBytes, iterations);
await fs.mkdir(path.dirname(libraryCatalogPath), { recursive: true });
await fs.writeFile(libraryCatalogPath, catalogEncrypted);
await saveCache(cacheKeyId);

console.log(`Encrypted ${items.length} PDF(s).`);
console.log(`Wrote catalog to ${libraryCatalogPath}`);
