const statusText = document.getElementById("statusText");
const viewerStatus = document.getElementById("viewerStatus");
const lockScreen = document.getElementById("lockScreen");
const lockError = document.getElementById("lockError");
const passwordInput = document.getElementById("passwordInput");
const unlockBtn = document.getElementById("unlockBtn");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const tagList = document.getElementById("tagList");
const catalogBody = document.getElementById("catalogBody");
const catalogList = document.getElementById("catalogList");
const emptyState = document.getElementById("emptyState");
const viewerTitle = document.getElementById("viewerTitle");
const viewerBody = document.getElementById("viewerBody");
const djvuViewer = document.getElementById("djvuViewer");
const openTabLink = document.getElementById("openTabLink");
const clearViewerBtn = document.getElementById("clearViewerBtn");

const STORAGE_KEY = "encryptedPdfLibraryPassphrase";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const state = {
  password: "",
  catalog: null,
  items: [],
  selectedTags: new Set(),
  selectedId: null,
  searchQuery: "",
  sortBy: "title",
  currentBlobUrl: null,
  requestId: 0,
};

let djvuInstance = null;

function setStatus(text) {
  statusText.textContent = text;
}

function setViewerStatus(text) {
  viewerStatus.textContent = text;
}

function setLockError(message) {
  lockError.textContent = message;
}

function clearLockError() {
  lockError.textContent = "";
}

function setViewerMessage(message, className) {
  clearViewerBody();
  const wrapper = document.createElement("div");
  wrapper.className = className;
  wrapper.textContent = message;
  viewerBody.appendChild(wrapper);
}

function clearViewerBody() {
  viewerBody.querySelectorAll(".viewer-frame").forEach((frame) => frame.remove());
  viewerBody
    .querySelectorAll(".viewer-placeholder, .viewer-error")
    .forEach((node) => node.remove());
  if (djvuViewer) {
    djvuViewer.classList.add("is-hidden");
  }
}

function clearViewer() {
  if (state.currentBlobUrl) {
    URL.revokeObjectURL(state.currentBlobUrl);
  }
  state.currentBlobUrl = null;
  viewerTitle.textContent = "Select a document";
  setViewerStatus("Ready");
  setViewerMessage("Select a document to render it.", "viewer-placeholder");
  openTabLink.href = "#";
  openTabLink.classList.add("is-disabled");
  openTabLink.setAttribute("aria-disabled", "true");
  openTabLink.textContent = "Open in new tab";
  clearViewerBtn.disabled = true;
}

function slugifyFilename(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function hasAsciiSignature(bytes, signature, maxBytes) {
  if (!(bytes instanceof Uint8Array)) {
    return false;
  }
  const needle = new TextEncoder().encode(signature);
  const limit = Math.min(bytes.length, maxBytes);
  for (let i = 0; i <= limit - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  return false;
}

function detectFormat(bytes, fallback = "pdf") {
  if (!(bytes instanceof Uint8Array)) {
    return fallback;
  }
  const fallbackLower = String(fallback || "").toLowerCase();
  const isPdf =
    bytes.length >= 5 && hasAsciiSignature(bytes, "%PDF-", 1024);
  if (isPdf) {
    return "pdf";
  }
  const isDjvu =
    hasAsciiSignature(bytes, "AT&TFORM", 32) ||
    hasAsciiSignature(bytes, "DJVU", 64) ||
    hasAsciiSignature(bytes, "DJVM", 64) ||
    hasAsciiSignature(bytes, "DJVI", 64);
  if (isDjvu) {
    return "djvu";
  }
  if (fallbackLower && fallbackLower !== "pdf") {
    return fallbackLower;
  }
  return "djvu";
}

function formatBytes(size) {
  if (!Number.isFinite(size)) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const kb = size / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
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

function buildSearchText(item) {
  const fields = [
    item.title,
    item.authors,
    item.notes,
    item.year ? String(item.year) : "",
    item.tags.join(" "),
    item.format || "",
  ];
  return fields
    .filter((value) => value && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return null;
  }
  const title =
    typeof raw.title === "string" && raw.title.trim().length > 0
      ? raw.title.trim()
      : id;
  const formatRaw = typeof raw.format === "string" ? raw.format.trim() : "";
  const format = formatRaw ? formatRaw.toLowerCase() : "pdf";
  const tags = normalizeTags(raw.tags);
  const item = {
    id,
    title,
    authors: typeof raw.authors === "string" ? raw.authors.trim() : "",
    year: parseYear(raw.year),
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    tags,
    objectKey: typeof raw.objectKey === "string" ? raw.objectKey : "",
    size: Number.isFinite(raw.size) ? raw.size : undefined,
    format,
  };
  item.searchText = buildSearchText(item);
  return item;
}

function renderTags(tags) {
  tagList.textContent = "";
  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item-meta";
    empty.textContent = "No tags available.";
    tagList.appendChild(empty);
    return;
  }
  tags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    if (state.selectedTags.has(tag)) {
      button.classList.add("is-active");
    }
    button.textContent = tag;
    button.addEventListener("click", () => {
      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
      } else {
        state.selectedTags.add(tag);
      }
      renderTags(tags);
      updateList();
    });
    tagList.appendChild(button);
  });
}

function renderList(items) {
  catalogList.textContent = "";
  items.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "item-card";
    card.dataset.id = item.id;
    if (state.selectedId === item.id) {
      card.classList.add("is-active");
    }

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;
    card.appendChild(title);

    const metaPieces = [];
    if (item.authors) {
      metaPieces.push(item.authors);
    }
    if (item.year) {
      metaPieces.push(String(item.year));
    }
    if (item.size) {
      metaPieces.push(formatBytes(item.size));
    }
    if (item.format) {
      metaPieces.push(item.format.toUpperCase());
    }
    if (metaPieces.length > 0) {
      const meta = document.createElement("div");
      meta.className = "item-meta";
      meta.textContent = metaPieces.join(" - ");
      card.appendChild(meta);
    }

    if (item.notes) {
      const notes = document.createElement("div");
      notes.className = "item-notes";
      notes.textContent = item.notes;
      card.appendChild(notes);
    }

    if (item.tags.length > 0) {
      const tags = document.createElement("div");
      tags.className = "item-tags";
      item.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "item-tag";
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      card.appendChild(tags);
    }

    card.addEventListener("click", () => {
      openItem(item);
    });

    catalogList.appendChild(card);
  });
}

function updateList() {
  const query = state.searchQuery.trim().toLowerCase();
  let filtered = state.items.filter((item) => {
    if (query && !item.searchText.includes(query)) {
      return false;
    }
    if (state.selectedTags.size > 0) {
      const match = item.tags.some((tag) => state.selectedTags.has(tag));
      if (!match) {
        return false;
      }
    }
    return true;
  });

  if (state.sortBy === "title") {
    filtered = filtered.slice().sort((a, b) =>
      a.title.localeCompare(b.title, "en", { sensitivity: "base" })
    );
  } else if (state.sortBy === "newest") {
    filtered = filtered.slice().sort((a, b) => {
      const yearA = Number.isFinite(a.year) ? a.year : -Infinity;
      const yearB = Number.isFinite(b.year) ? b.year : -Infinity;
      return yearB - yearA;
    });
  } else if (state.sortBy === "oldest") {
    filtered = filtered.slice().sort((a, b) => {
      const yearA = Number.isFinite(a.year) ? a.year : Infinity;
      const yearB = Number.isFinite(b.year) ? b.year : Infinity;
      return yearA - yearB;
    });
  }

  renderList(filtered);
  emptyState.classList.toggle("is-hidden", filtered.length !== 0);
}

function enableControls() {
  searchInput.disabled = false;
  sortSelect.disabled = false;
}

function setActiveItem(id) {
  state.selectedId = id;
  catalogList.querySelectorAll(".item-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.id === id);
  });
}

function clearStoredPassword() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Ignore storage access issues (private browsing, blocked storage).
  }
}

function getDjvuViewer() {
  if (!window.DjVu || !window.DjVu.Viewer) {
    throw new Error("DjVu viewer library not loaded.");
  }
  if (!djvuInstance) {
    djvuInstance = new window.DjVu.Viewer();
    djvuInstance.render(djvuViewer);
  }
  return djvuInstance;
}

async function openItem(item) {
  if (!item.objectKey) {
    setViewerMessage("Missing object key for this item.", "viewer-error");
    setViewerStatus("Error");
    return;
  }

  const requestId = ++state.requestId;
  setActiveItem(item.id);
  clearViewer();
  viewerTitle.textContent = item.title;

  try {
    setStatus("Downloading");
    setViewerStatus("Downloading");
    const url = new URL(item.objectKey, state.catalog.baseUrl).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());
    if (requestId !== state.requestId) {
      return;
    }

    setStatus("Decrypting");
    setViewerStatus("Decrypting");
    const fileBytes = await decryptBytes(state.password, encryptedBytes);
    if (requestId !== state.requestId) {
      return;
    }

    const format = detectFormat(fileBytes, item.format || "pdf");
    if (format === "pdf") {
      setStatus("Rendering");
      setViewerStatus("Rendering");
      const safeName = slugifyFilename(item.title || item.id) || item.id;
      const file = new File([fileBytes], `${safeName}.pdf`, {
        type: "application/pdf",
      });
      const blobUrl = URL.createObjectURL(file);
      state.currentBlobUrl = blobUrl;

      const frame = document.createElement("iframe");
      frame.className = "viewer-frame";
      frame.title = item.title;
      frame.src = blobUrl;
      clearViewerBody();
      viewerBody.appendChild(frame);

      openTabLink.href = blobUrl;
      openTabLink.classList.remove("is-disabled");
      openTabLink.setAttribute("aria-disabled", "false");
      openTabLink.textContent = "Open in new tab";
      clearViewerBtn.disabled = false;

      setStatus("Done");
      setViewerStatus("Done");
    } else if (format === "djvu") {
      setStatus("Rendering");
      setViewerStatus("Rendering");
      const viewer = getDjvuViewer();
      clearViewerBody();
      djvuViewer.classList.remove("is-hidden");
      await viewer.loadDocument(
        fileBytes.buffer.slice(
          fileBytes.byteOffset,
          fileBytes.byteOffset + fileBytes.byteLength
        ),
        item.title || item.id
      );
      openTabLink.href = "#";
      openTabLink.classList.add("is-disabled");
      openTabLink.setAttribute("aria-disabled", "true");
      openTabLink.textContent = "Open in new tab (PDF only)";
      clearViewerBtn.disabled = false;

      setStatus("Done");
      setViewerStatus("Done");
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }
    setStatus("Error");
    setViewerStatus("Error");
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to load document.";
    setViewerMessage(message, "viewer-error");
  }
}

async function unlockLibrary() {
  if (!window.crypto || !window.crypto.subtle) {
    setLockError("WebCrypto is not available in this browser.");
    return;
  }
  const password = passwordInput.value;
  if (!password) {
    setLockError("Enter a passphrase to continue.");
    return;
  }
  clearLockError();
  setStatus("Loading catalog");
  setViewerStatus("Locked");

  try {
    const response = await fetch("./catalog.enc", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Catalog download failed (${response.status})`);
    }
    const encrypted = new Uint8Array(await response.arrayBuffer());
    setStatus("Decrypting");
    const plaintext = await decryptBytes(password, encrypted);
    const catalog = JSON.parse(textDecoder.decode(plaintext));

    if (
      !catalog ||
      typeof catalog !== "object" ||
      typeof catalog.baseUrl !== "string" ||
      !catalog.baseUrl.endsWith("/")
    ) {
      throw new Error("Catalog format invalid.");
    }
    if (!Array.isArray(catalog.items)) {
      throw new Error("Catalog items missing.");
    }

    state.password = password;
    state.catalog = catalog;
    state.items = catalog.items.map(normalizeItem).filter(Boolean);

    const tags = Array.from(
      new Set(state.items.flatMap((item) => item.tags))
    ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    renderTags(tags);
    updateList();

    lockScreen.classList.add("is-hidden");
    catalogBody.classList.remove("is-hidden");
    enableControls();
    clearViewer();

    setStatus("Done");
    setViewerStatus("Ready");
  } catch (error) {
    setStatus("Locked");
    setViewerStatus("Locked");
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Wrong password or corrupted file";
    if (message.toLowerCase().includes("wrong password")) {
      setLockError("Wrong password or corrupted file");
    } else if (message.toLowerCase().includes("corrupted")) {
      setLockError("Wrong password or corrupted file");
    } else if (message.toLowerCase().includes("format")) {
      setLockError("Catalog format invalid.");
    } else {
      setLockError(message);
    }
  }
}

function parseHeader(encBytes) {
  if (encBytes.length < 36) {
    throw new Error("Wrong password or corrupted file");
  }
  const magic = textDecoder.decode(encBytes.slice(0, 4));
  if (magic !== "LIB1") {
    throw new Error("Wrong password or corrupted file");
  }
  const view = new DataView(
    encBytes.buffer,
    encBytes.byteOffset,
    encBytes.byteLength
  );
  const iterations = view.getUint32(4, false);
  const salt = encBytes.slice(8, 24);
  const iv = encBytes.slice(24, 36);
  const ciphertext = encBytes.slice(36);
  return { iterations, salt, iv, ciphertext };
}

async function deriveKey(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptBytes(password, encBytes) {
  let header;
  try {
    header = parseHeader(encBytes);
  } catch (error) {
    throw new Error("Wrong password or corrupted file");
  }
  try {
    const key = await deriveKey(password, header.salt, header.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: header.iv },
      key,
      header.ciphertext
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new Error("Wrong password or corrupted file");
  }
}

searchInput.addEventListener("input", (event) => {
  state.searchQuery = event.target.value;
  updateList();
});

sortSelect.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  updateList();
});

unlockBtn.addEventListener("click", () => {
  unlockLibrary();
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    unlockLibrary();
  }
});

clearViewerBtn.addEventListener("click", () => {
  setStatus("Done");
  clearViewer();
});

openTabLink.addEventListener("click", (event) => {
  if (openTabLink.classList.contains("is-disabled")) {
    event.preventDefault();
  }
});

setStatus("Locked");
setViewerStatus("Locked");
setViewerMessage(
  "Unlock the library to load the catalog and decrypt PDFs/DJVU locally.",
  "viewer-placeholder"
);
clearStoredPassword();
