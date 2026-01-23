const catalogPathInput = document.getElementById("catalogPath");
const passwordInput = document.getElementById("password");
const iterationsInput = document.getElementById("iterations");
const endpointInput = document.getElementById("endpoint");
const awsProfileInput = document.getElementById("awsProfile");
const loadCatalogBtn = document.getElementById("loadCatalogBtn");
const catalogInfo = document.getElementById("catalogInfo");
const statusEl = document.getElementById("status");
const mainPanel = document.getElementById("mainPanel");
const searchInput = document.getElementById("searchInput");
const itemList = document.getElementById("itemList");
const countLabel = document.getElementById("countLabel");
const emptyState = document.getElementById("emptyState");
const itemPanel = document.getElementById("itemPanel");
const itemTitle = document.getElementById("itemTitle");
const itemKey = document.getElementById("itemKey");
const downloadBtn = document.getElementById("downloadBtn");
const deleteBtn = document.getElementById("deleteBtn");
const editForm = document.getElementById("editForm");
const editTitle = document.getElementById("editTitle");
const editAuthors = document.getElementById("editAuthors");
const editYear = document.getElementById("editYear");
const editTags = document.getElementById("editTags");
const editNotes = document.getElementById("editNotes");
const uploadFile = document.getElementById("uploadFile");
const uploadTitle = document.getElementById("uploadTitle");
const uploadAuthors = document.getElementById("uploadAuthors");
const uploadYear = document.getElementById("uploadYear");
const uploadTags = document.getElementById("uploadTags");
const uploadNotes = document.getElementById("uploadNotes");
const uploadBtn = document.getElementById("uploadBtn");

let sessionId = null;
let catalog = null;
let items = [];
let selectedId = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b42318" : "";
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return null;
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : id;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0)
    : [];
  const formatRaw = typeof raw.format === "string" ? raw.format.trim() : "";
  const format = formatRaw ? formatRaw.toLowerCase() : "pdf";
  const item = {
    id,
    title,
    authors: typeof raw.authors === "string" ? raw.authors.trim() : "",
    year: Number.isFinite(raw.year) ? raw.year : undefined,
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    tags,
    objectKey: typeof raw.objectKey === "string" ? raw.objectKey : "",
    size: Number.isFinite(raw.size) ? raw.size : undefined,
    format,
  };
  item.searchText = [
    item.title,
    item.authors,
    item.notes,
    item.year ? String(item.year) : "",
    item.tags.join(" "),
    item.format || "",
  ]
    .join(" ")
    .toLowerCase();
  return item;
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
  return `${(kb / 1024).toFixed(1)} MB`;
}

function inferFormatFromFilename(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".djvu") || lower.endsWith(".djv")) {
    return "djvu";
  }
  return "pdf";
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!query) {
      return true;
    }
    return item.searchText.includes(query);
  });

  itemList.textContent = "";
  filtered.forEach((item) => {
    const card = document.createElement("div");
    card.className = "item-card";
    if (item.id === selectedId) {
      card.classList.add("active");
    }

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.title;

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
    if (item.tags.length > 0) {
      metaPieces.push(item.tags.join(", "));
    }
    if (item.format) {
      metaPieces.push(item.format.toUpperCase());
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaPieces.join(" - ");

    card.appendChild(name);
    card.appendChild(meta);
    card.addEventListener("click", () => selectItem(item.id));
    itemList.appendChild(card);
  });

  countLabel.textContent = `${filtered.length} item(s)`;
}

function selectItem(id) {
  selectedId = id;
  renderList();
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    emptyState.classList.remove("hidden");
    itemPanel.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  itemPanel.classList.remove("hidden");
  itemTitle.textContent = item.title;
  itemKey.textContent = item.objectKey;
  editTitle.value = item.title || "";
  editAuthors.value = item.authors || "";
  editYear.value = item.year || "";
  editTags.value = item.tags.join(", ");
  editNotes.value = item.notes || "";
  downloadBtn.disabled = false;
  deleteBtn.disabled = false;
}

async function loadConfig() {
  try {
    const config = await apiFetch("/api/config");
    catalogPathInput.value = config.defaultCatalogPath || "";
    iterationsInput.value = config.defaultIterations || "";
    endpointInput.value = config.defaultEndpoint || "";
    awsProfileInput.value = config.defaultAwsProfile || "";
  } catch (error) {
    setStatus(error.message || "Failed to load config", true);
  }
}

async function loadCatalog() {
  setStatus("Loading catalog...");
  try {
    const payload = {
      catalogPath: catalogPathInput.value,
      password: passwordInput.value,
      iterations: iterationsInput.value,
      endpoint: endpointInput.value,
      awsProfile: awsProfileInput.value,
    };
    const data = await apiFetch("/api/catalog/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    sessionId = data.sessionId;
    catalog = data.catalog;
    items = (catalog.items || []).map(normalizeItem).filter(Boolean);
    selectedId = null;

    catalogInfo.textContent = `Loaded ${items.length} item(s). Base URL: ${catalog.baseUrl}`;
    mainPanel.classList.remove("hidden");
    renderList();
    emptyState.classList.remove("hidden");
    itemPanel.classList.add("hidden");
    downloadBtn.disabled = true;
    deleteBtn.disabled = true;
    setStatus("Catalog loaded.");
  } catch (error) {
    setStatus(error.message || "Failed to load catalog", true);
  }
}

async function uploadPdf() {
  if (!sessionId) {
    setStatus("Load a catalog first.", true);
    return;
  }
  const file = uploadFile.files[0];
  if (!file) {
    setStatus("Choose a PDF first.", true);
    return;
  }

  setStatus("Encrypting and uploading...");
  try {
    const format = inferFormatFromFilename(file.name);
    const query = new URLSearchParams({
      session: sessionId,
      filename: file.name,
      title: uploadTitle.value,
      authors: uploadAuthors.value,
      year: uploadYear.value,
      tags: uploadTags.value,
      notes: uploadNotes.value,
      iterations: iterationsInput.value,
      format,
    });

    const buffer = await file.arrayBuffer();
    const data = await apiFetch(`/api/items/upload?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: buffer,
    });

    const item = normalizeItem(data.item);
    if (item) {
      items.push(item);
    }
    clearUploadForm();
    renderList();
    setStatus("Upload complete.");
  } catch (error) {
    setStatus(error.message || "Upload failed", true);
  }
}

async function updateMetadata(event) {
  event.preventDefault();
  if (!sessionId || !selectedId) {
    return;
  }
  setStatus("Saving metadata...");
  try {
    const payload = {
      sessionId,
      id: selectedId,
      title: editTitle.value,
      authors: editAuthors.value,
      year: editYear.value,
      tags: editTags.value,
      notes: editNotes.value,
    };
    const data = await apiFetch("/api/items/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const updated = normalizeItem(data.item);
    if (updated) {
      items = items.map((item) => (item.id === updated.id ? updated : item));
      selectItem(updated.id);
    }
    setStatus("Metadata saved.");
  } catch (error) {
    setStatus(error.message || "Update failed", true);
  }
}

async function deleteItem() {
  if (!sessionId || !selectedId) {
    return;
  }
  const item = items.find((entry) => entry.id === selectedId);
  if (!item) {
    return;
  }
  if (!confirm(`Delete "${item.title}" from S3 and catalog?`)) {
    return;
  }

  setStatus("Deleting item...");
  try {
    await apiFetch("/api/items/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, id: selectedId }),
    });
    items = items.filter((entry) => entry.id !== selectedId);
    selectedId = null;
    renderList();
    emptyState.classList.remove("hidden");
    itemPanel.classList.add("hidden");
    setStatus("Item deleted.");
  } catch (error) {
    setStatus(error.message || "Delete failed", true);
  }
}

function downloadSelected() {
  if (!sessionId || !selectedId) {
    return;
  }
  const url = `/api/items/decrypt?session=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(
    selectedId
  )}`;
  window.open(url, "_blank", "noopener");
}

function clearUploadForm() {
  uploadFile.value = "";
  uploadTitle.value = "";
  uploadAuthors.value = "";
  uploadYear.value = "";
  uploadTags.value = "";
  uploadNotes.value = "";
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.ok) {
    return response.json();
  }
  let message = "Request failed.";
  try {
    const data = await response.json();
    if (data && data.error) {
      message = data.error;
    }
  } catch (error) {
    message = response.statusText || message;
  }
  throw new Error(message);
}

searchInput.addEventListener("input", () => renderList());
loadCatalogBtn.addEventListener("click", loadCatalog);
uploadBtn.addEventListener("click", uploadPdf);
editForm.addEventListener("submit", updateMetadata);
deleteBtn.addEventListener("click", deleteItem);
downloadBtn.addEventListener("click", downloadSelected);

loadConfig();
downloadBtn.disabled = true;
deleteBtn.disabled = true;
setStatus("Ready.");
