import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decryptBytes, encryptBytes } from "../crypto.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const publicDir = path.join(currentDir, "public");
const DEFAULT_CATALOG_PATH = "library/catalog.enc";
const DEFAULT_ITERATIONS = 300000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 500;

const sessions = new Map();
const envDefaults = await loadEnvDefaults();
const envIterations = Number.parseInt(envDefaults.LIB_PBKDF2_ITERS || "", 10);
const defaultIterations =
  Number.isFinite(envIterations) && envIterations > 0
    ? envIterations
    : DEFAULT_ITERATIONS;

const defaultConfig = {
  catalogPath: DEFAULT_CATALOG_PATH,
  baseUrl: envDefaults.LIB_BASE_URL || "",
  iterations: defaultIterations,
  endpoint: inferEndpoint(envDefaults.LIB_BASE_URL || ""),
  awsProfile: envDefaults.AWS_PROFILE || "",
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    const pathname = requestUrl.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, requestUrl);
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    const filePath = await resolveStaticFile(pathname);
    if (!filePath) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  } catch (error) {
    respondError(res, 500, error instanceof Error ? error.message : "Server error");
  }
});

const port = Number.parseInt(process.env.ADMIN_PANEL_PORT || "8787", 10);
server.listen(port, "127.0.0.1", () => {
  console.log(`Admin panel running at http://127.0.0.1:${port}`);
});

async function handleApi(req, res, requestUrl) {
  try {
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && pathname === "/api/config") {
      respondJson(res, {
        defaultCatalogPath: defaultConfig.catalogPath,
        defaultBaseUrl: defaultConfig.baseUrl,
        defaultIterations: defaultConfig.iterations,
        defaultEndpoint: defaultConfig.endpoint,
        defaultAwsProfile: defaultConfig.awsProfile,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/catalog/load") {
      const payload = await readJson(req, MAX_JSON_BYTES);
      const catalogPathInput = stringOrEmpty(payload.catalogPath).trim();
      const password = stringOrEmpty(payload.password);
      const endpoint = stringOrEmpty(payload.endpoint) || defaultConfig.endpoint;
      const awsProfile = stringOrEmpty(payload.awsProfile) || defaultConfig.awsProfile;
      const iterations = parseIterations(payload.iterations, defaultConfig.iterations);

      if (!password) {
        respondError(res, 400, "Password is required.");
        return;
      }

      const catalogPath = resolveCatalogPath(catalogPathInput);
      const encBytes = await fs.readFile(catalogPath);
      const catalogIterations = readIterations(encBytes);
      const plaintext = await decryptBytes(password, encBytes);
      const catalog = JSON.parse(Buffer.from(plaintext).toString("utf8"));
      validateCatalog(catalog);

      const sessionId = randomUUID();
      sessions.set(sessionId, {
        password,
        catalogPath,
        catalog,
        baseUrl: catalog.baseUrl,
        endpoint,
        awsProfile,
        catalogIterations,
        fileIterations: iterations,
      });

      respondJson(res, {
        sessionId,
        catalogPath,
        baseUrl: catalog.baseUrl,
        catalog,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/items/upload") {
      const sessionId = stringOrEmpty(requestUrl.searchParams.get("session"));
      const session = requireSession(sessionId);
      if (!session) {
        respondError(res, 401, "Invalid session.");
        return;
      }

      const filename = stringOrEmpty(requestUrl.searchParams.get("filename"));
      const title = stringOrEmpty(requestUrl.searchParams.get("title"));
      const authors = stringOrEmpty(requestUrl.searchParams.get("authors"));
      const year = stringOrEmpty(requestUrl.searchParams.get("year"));
      const tags = stringOrEmpty(requestUrl.searchParams.get("tags"));
      const notes = stringOrEmpty(requestUrl.searchParams.get("notes"));
      const format = normalizeFormat(
        stringOrEmpty(requestUrl.searchParams.get("format")),
        inferFormatFromFilename(filename)
      );
      const iterations = parseIterations(
        requestUrl.searchParams.get("iterations"),
        session.fileIterations
      );

      const fileBytes = await readBuffer(req, MAX_UPLOAD_BYTES);
      if (!fileBytes || fileBytes.length === 0) {
        respondError(res, 400, "Missing file data.");
        return;
      }

      const contentHash = hashBytes(fileBytes);
      const objectKey = `pdf/${contentHash}.pdf.enc`;
      const safeKey = safeObjectKey(objectKey);

      if (session.catalog.items.some((item) => item.objectKey === safeKey)) {
        respondError(res, 409, "This file is already in the catalog.");
        return;
      }

      const baseName = filename ? path.basename(filename, path.extname(filename)) : title;
      const slugBase = slugify(baseName || "doc") || "doc";
      const id = uniqueSlug(slugBase, new Set(session.catalog.items.map((item) => item.id)));
      const resolvedTitle = title || humanize(baseName || id);

      const item = {
        id,
        title: resolvedTitle,
        objectKey: safeKey,
        size: fileBytes.length,
        format,
      };

      if (authors) {
        item.authors = authors.trim();
      }
      const parsedYear = parseYear(year);
      if (parsedYear) {
        item.year = parsedYear;
      }
      const parsedTags = normalizeTagsInput(tags);
      if (parsedTags.length > 0) {
        item.tags = parsedTags;
      }
      if (notes) {
        item.notes = notes.trim();
      }

      const encrypted = await encryptBytes(session.password, fileBytes, iterations);
      await awsS3PutObject(session, safeKey, encrypted);

      session.catalog.items.push(item);
      session.catalog.generatedAt = new Date().toISOString();
      await saveCatalog(session);

      respondJson(res, { item });
      return;
    }

    if (req.method === "POST" && pathname === "/api/items/update") {
      const payload = await readJson(req, MAX_JSON_BYTES);
      const sessionId = stringOrEmpty(payload.sessionId);
      const session = requireSession(sessionId);
      if (!session) {
        respondError(res, 401, "Invalid session.");
        return;
      }
      const id = stringOrEmpty(payload.id);
      if (!id) {
        respondError(res, 400, "Item id is required.");
        return;
      }

      const item = session.catalog.items.find((entry) => entry.id === id);
      if (!item) {
        respondError(res, 404, "Item not found.");
        return;
      }

      const nextTitle = stringOrEmpty(payload.title);
      if (nextTitle) {
        item.title = nextTitle;
      }
      const nextAuthors = stringOrEmpty(payload.authors);
      if (nextAuthors) {
        item.authors = nextAuthors;
      } else {
        delete item.authors;
      }
      const parsedYear = parseYear(payload.year);
      if (parsedYear) {
        item.year = parsedYear;
      } else {
        delete item.year;
      }
      const parsedTags = normalizeTagsInput(payload.tags);
      if (parsedTags.length > 0) {
        item.tags = parsedTags;
      } else {
        delete item.tags;
      }
      const notes = stringOrEmpty(payload.notes);
      if (notes) {
        item.notes = notes;
      } else {
        delete item.notes;
      }

      session.catalog.generatedAt = new Date().toISOString();
      await saveCatalog(session);

      respondJson(res, { item });
      return;
    }

    if (req.method === "POST" && pathname === "/api/items/delete") {
      const payload = await readJson(req, MAX_JSON_BYTES);
      const sessionId = stringOrEmpty(payload.sessionId);
      const session = requireSession(sessionId);
      if (!session) {
        respondError(res, 401, "Invalid session.");
        return;
      }
      const id = stringOrEmpty(payload.id);
      if (!id) {
        respondError(res, 400, "Item id is required.");
        return;
      }

      const index = session.catalog.items.findIndex((entry) => entry.id === id);
      if (index === -1) {
        respondError(res, 404, "Item not found.");
        return;
      }
      const [item] = session.catalog.items.splice(index, 1);

      await awsS3DeleteObject(session, item.objectKey);
      session.catalog.generatedAt = new Date().toISOString();
      await saveCatalog(session);

      respondJson(res, { id });
      return;
    }

    if (req.method === "GET" && pathname === "/api/items/decrypt") {
      const sessionId = stringOrEmpty(requestUrl.searchParams.get("session"));
      const session = requireSession(sessionId);
      if (!session) {
        respondError(res, 401, "Invalid session.");
        return;
      }
      const id = stringOrEmpty(requestUrl.searchParams.get("id"));
      if (!id) {
        respondError(res, 400, "Item id is required.");
        return;
      }

      const item = session.catalog.items.find((entry) => entry.id === id);
      if (!item) {
        respondError(res, 404, "Item not found.");
        return;
      }

      const encrypted = await awsS3GetObject(session, item.objectKey);
      const plaintext = await decryptBytes(session.password, encrypted);

      const format =
        typeof item.format === "string" ? item.format.toLowerCase() : "pdf";
      const extension = format === "djvu" ? "djvu" : "pdf";
      const contentType =
        format === "djvu" ? "image/vnd.djvu" : "application/pdf";
      const safeName = `${slugify(item.title || id) || id}.${extension}`;
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename=\"${safeName}\"`,
      });
      res.end(Buffer.from(plaintext));
      return;
    }

    respondError(res, 404, "Not Found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const lowered = message.toLowerCase();
    const status = lowered.includes("payload too large")
      ? 413
      : lowered.includes("invalid json") ||
        lowered.includes("password") ||
        lowered.includes("catalog")
      ? 400
      : 500;
    respondError(res, status, message);
  }
}

async function resolveStaticFile(requestPath) {
  let target = requestPath;
  if (target === "/") {
    target = "/index.html";
  }
  const fullPath = path.join(publicDir, target);
  const normalized = path.normalize(fullPath);
  if (!normalized.startsWith(publicDir)) {
    return null;
  }
  try {
    const stat = await fs.stat(normalized);
    if (!stat.isFile()) {
      return null;
    }
    return normalized;
  } catch (error) {
    return null;
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function respondJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function respondError(res, status, message) {
  respondJson(res, { error: message }, status);
}

function stringOrEmpty(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function parseIterations(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function requireSession(sessionId) {
  if (!sessionId) {
    return null;
  }
  return sessions.get(sessionId) || null;
}

async function readJson(req, limit) {
  const buffer = await readBuffer(req, limit);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error("Invalid JSON payload.");
  }
}

async function readBuffer(req, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += piece.length;
    if (length > limit) {
      throw new Error("Payload too large.");
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks, length);
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Catalog format invalid.");
  }
  if (typeof catalog.baseUrl !== "string" || !catalog.baseUrl.endsWith("/")) {
    throw new Error("Catalog baseUrl invalid.");
  }
  if (!Array.isArray(catalog.items)) {
    throw new Error("Catalog items missing.");
  }
}

function resolveCatalogPath(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) {
    return path.join(repoRoot, DEFAULT_CATALOG_PATH);
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  const resolved = path.resolve(repoRoot, trimmed);
  if (!resolved.startsWith(repoRoot)) {
    throw new Error("Catalog path must stay within the repo root.");
  }
  return resolved;
}

async function loadEnvDefaults() {
  const envPath = path.join(repoRoot, ".env.local");
  let raw;
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function inferEndpoint(baseUrl) {
  if (!baseUrl) {
    return "";
  }
  try {
    const { host } = new URL(baseUrl);
    if (host.includes("storage.yandexcloud.net")) {
      return "https://storage.yandexcloud.net";
    }
  } catch (error) {
    return "";
  }
  return "";
}

function parseBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  const rawPath = parsed.pathname.replace(/^\/+/, "");
  if (!rawPath) {
    throw new Error("Base URL must include a bucket path.");
  }
  const parts = rawPath.split("/").filter(Boolean);
  const bucket = parts.shift();
  if (!bucket) {
    throw new Error("Base URL must include a bucket path.");
  }
  const prefix = parts.length > 0 ? `${parts.join("/")}/` : "";
  return { bucket, prefix };
}

async function awsS3PutObject(session, objectKey, bytes) {
  const { bucket, prefix } = parseBaseUrl(session.baseUrl);
  const key = safeObjectKey(objectKey);
  const dest = prefix ? `s3://${bucket}/${prefix}${key}` : `s3://${bucket}/${key}`;
  const args = buildAwsArgs(session, [
    "s3",
    "cp",
    "-",
    dest,
    "--no-progress",
    "--content-type",
    "application/octet-stream",
  ]);
  await runAws(args, bytes, session);
}

async function awsS3DeleteObject(session, objectKey) {
  const { bucket, prefix } = parseBaseUrl(session.baseUrl);
  const key = safeObjectKey(objectKey);
  const dest = prefix ? `s3://${bucket}/${prefix}${key}` : `s3://${bucket}/${key}`;
  const args = buildAwsArgs(session, ["s3", "rm", dest, "--no-progress"]);
  await runAws(args, null, session);
}

async function awsS3GetObject(session, objectKey) {
  const { bucket, prefix } = parseBaseUrl(session.baseUrl);
  const key = safeObjectKey(objectKey);
  const source = prefix ? `s3://${bucket}/${prefix}${key}` : `s3://${bucket}/${key}`;
  const args = buildAwsArgs(session, ["s3", "cp", source, "-", "--no-progress"]);
  return runAws(args, null, session, true);
}

function buildAwsArgs(session, args) {
  const finalArgs = [];
  if (session.endpoint) {
    finalArgs.push("--endpoint-url", session.endpoint);
  }
  return finalArgs.concat(args);
}

function runAws(args, inputBuffer, session, captureStdout = false) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (session.awsProfile) {
      env.AWS_PROFILE = session.awsProfile;
    }

    const child = spawn("aws", args, { env });
    const stdoutChunks = [];
    const stderrChunks = [];

    if (captureStdout) {
      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    }
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", (error) => {
      reject(new Error(`Failed to run aws: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        reject(new Error(stderr || `AWS CLI failed with code ${code}`));
        return;
      }
      if (captureStdout) {
        resolve(Buffer.concat(stdoutChunks));
      } else {
        resolve();
      }
    });

    if (inputBuffer) {
      child.stdin.write(inputBuffer);
    }
    child.stdin.end();
  });
}

async function saveCatalog(session) {
  const json = JSON.stringify(session.catalog, null, 2);
  const bytes = Buffer.from(json, "utf8");
  const iterations = session.catalogIterations || session.fileIterations || DEFAULT_ITERATIONS;
  const encrypted = await encryptBytes(session.password, bytes, iterations);
  await fs.mkdir(path.dirname(session.catalogPath), { recursive: true });
  await fs.writeFile(session.catalogPath, encrypted);
}

function readIterations(encBytes) {
  if (!encBytes || encBytes.length < 8) {
    return DEFAULT_ITERATIONS;
  }
  const magic = Buffer.from(encBytes.slice(0, 4)).toString("utf8");
  if (magic !== "LIB1") {
    return DEFAULT_ITERATIONS;
  }
  const view = new DataView(encBytes.buffer, encBytes.byteOffset, encBytes.byteLength);
  return view.getUint32(4, false) || DEFAULT_ITERATIONS;
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function slugify(name) {
  return String(name)
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
  const cleaned = String(name).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Untitled";
  }
  return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeTagsInput(tags) {
  if (!tags) {
    return [];
  }
  return String(tags)
    .split(",")
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

function inferFormatFromFilename(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".djvu" || ext === ".djv") {
    return "djvu";
  }
  return "pdf";
}

function normalizeFormat(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "pdf" || normalized === "djvu") {
    return normalized;
  }
  return fallback;
}

function safeObjectKey(key) {
  const cleaned = String(key).replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = cleaned
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
}
