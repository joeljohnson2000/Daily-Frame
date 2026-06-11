import { bulkPutEntries, clearEntries, deleteEntry, getAllEntries, getEntry, saveEntry } from "./db.js";
import { generateProgressVideo } from "./video.js";

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".panel"),
  net: document.getElementById("net-indicator"),

  currentStreak: document.getElementById("current-streak"),
  longestStreak: document.getElementById("longest-streak"),
  todayPreview: document.getElementById("today-preview"),

  entryForm: document.getElementById("entry-form"),
  entryDate: document.getElementById("entry-date"),
  entryImage: document.getElementById("entry-image"),
  entryImageGallery: document.getElementById("entry-image-gallery"),
  entryPreview: document.getElementById("entry-preview"),
  entryPreviewCaption: document.getElementById("entry-preview-caption"),
  entryWeight: document.getElementById("entry-weight"),
  weightUnitLabel: document.getElementById("weight-unit-label"),
  entryNote: document.getElementById("entry-note"),
  entryStatus: document.getElementById("entry-status"),

  timelineList: document.getElementById("timeline-list"),

  compareA: document.getElementById("compare-date-a"),
  compareB: document.getElementById("compare-date-b"),
  runCompare: document.getElementById("run-compare"),
  compareMeta: document.getElementById("compare-meta"),
  compareResult: document.getElementById("compare-result"),

  exportBackup: document.getElementById("export-backup"),
  importBackupInput: document.getElementById("import-backup-input"),
  exportZip: document.getElementById("export-zip"),
  videoDuration: document.getElementById("video-duration"),
  exportVideo: document.getElementById("export-video"),
  videoProgress: document.getElementById("video-progress"),
  videoStatus: document.getElementById("video-status"),
  videoPlayerContainer: document.getElementById("video-player-container"),
  videoPlayer: document.getElementById("video-player"),
  videoDownloadBtn: document.getElementById("video-download-btn"),
  videoDateFrom: document.getElementById("video-date-from"),
  videoDateTo: document.getElementById("video-date-to"),
  weightUnitKg: document.getElementById("weight-unit-kg"),
  weightUnitLbs: document.getElementById("weight-unit-lbs"),
  clearAllDataBtn: document.getElementById("clear-all-data"),
};

const MAX_IMAGE_WIDTH = 720;
const MAX_NOTE_LENGTH = 500;
const todayISO = isoDate(new Date());
let selectedImageBlob = null;
let selectedImageObjectUrl = "";
let entriesCache = [];
let timelineObserver = null;
let cameraMediaStream = null;
let generatedVideoBlob = null;

init().catch((error) => {
  console.error(error);
  setEntryStatus(`Startup error: ${error.message}`, true);
});

async function init() {
  wireNavigation();
  wireConnectivity();
  wireEntryForm();
  wireCompare();
  wireSettings();
  registerServiceWorker();
  applyWeightUnitUI();

  els.entryDate.max = todayISO;
  els.entryDate.value = todayISO;

  await loadEntryToEditor(todayISO);
  await refreshAllViews();
}

function wireNavigation() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      els.tabs.forEach((x) => x.classList.toggle("is-active", x === tab));
      els.panels.forEach((panel) => panel.classList.toggle("is-active", panel.id === target));
    });
  });
}

function wireConnectivity() {
  const update = () => {
    const online = navigator.onLine;
    els.net.textContent = online ? "Online" : "Offline";
    els.net.classList.toggle("offline", !online);
  };
  update();
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}

// ── Weight unit helpers ──────────────────────────────────────────────────────
function getWeightUnit() {
  return localStorage.getItem("weightUnit") || "kg";
}

function setWeightUnitPref(unit) {
  localStorage.setItem("weightUnit", unit);
}

function kgToDisplay(kg) {
  if (kg == null || isNaN(Number(kg))) return null;
  const v = Number(kg);
  const out = getWeightUnit() === "lbs" ? v * 2.20462 : v;
  return Math.round(out * 10) / 10;
}

function inputToKg(value) {
  const v = parseFloat(value);
  if (isNaN(v) || v <= 0) return null;
  return getWeightUnit() === "lbs"
    ? Math.round(v * 0.453592 * 100) / 100
    : Math.round(v * 100) / 100;
}

function applyWeightUnitUI() {
  const unit = getWeightUnit();
  if (els.weightUnitLabel) els.weightUnitLabel.textContent = unit;
  els.weightUnitKg.classList.toggle("active", unit === "kg");
  els.weightUnitLbs.classList.toggle("active", unit === "lbs");
}

// ── Camera with timer ────────────────────────────────────────────────────────
// (removed — using file inputs only)

function wireEntryForm() {
  els.entryDate.addEventListener("change", async () => {
    if (els.entryDate.value > todayISO) {
      els.entryDate.value = todayISO;
    }
    await loadEntryToEditor(els.entryDate.value);
  });

  const onImageSelected = async (file) => {
    if (!file) return;
    try {
      setEntryStatus("Compressing image…");
      selectedImageBlob = await compressImage(file, MAX_IMAGE_WIDTH, 0.84);
      setPreviewImage(selectedImageBlob);
      setEntryStatus("Image ready. Stored only inside this app.");
    } catch (error) {
      console.error(error);
      setEntryStatus("Failed to process image.", true);
    }
  };

  els.entryImage.addEventListener("change", async () => {
    await onImageSelected(els.entryImage.files?.[0]);
  });

  els.entryImageGallery.addEventListener("change", async () => {
    await onImageSelected(els.entryImageGallery.files?.[0]);
  });


  els.entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const date = els.entryDate.value;
    if (!date) {
      setEntryStatus("Please choose a date.", true);
      return;
    }
    if (date > todayISO) {
      setEntryStatus("Future dates are not allowed.", true);
      return;
    }

    const existing = await getEntry(date);
    const image = selectedImageBlob || existing?.image;
    if (!image) {
      setEntryStatus("Please capture or upload an image.", true);
      return;
    }

    const note = (els.entryNote.value || "").trim().slice(0, MAX_NOTE_LENGTH);
    const weightKg = inputToKg(els.entryWeight.value);

    try {
      await saveEntry({
        date,
        image,
        note,
        weightKg,
        timestamp: Date.now(),
      });
      setEntryStatus(`Saved entry for ${date}.`);
      els.entryImage.value = "";
      els.entryImageGallery.value = "";
      await refreshAllViews();
      await loadEntryToEditor(date);
    } catch (error) {
      console.error(error);
      setEntryStatus(error.message || "Failed to save entry.", true);
    }
  });
}

function wireCompare() {
  els.compareA.max = todayISO;
  els.compareB.max = todayISO;
  els.runCompare.addEventListener("click", () => {
    renderCompare(els.compareA.value, els.compareB.value);
  });
}

function wireSettings() {
  els.exportBackup.addEventListener("click", exportBackup);
  els.importBackupInput.addEventListener("change", importBackup);
  els.exportZip.addEventListener("click", exportZip);
  els.clearAllDataBtn.addEventListener("click", clearAllData);

  els.weightUnitKg.addEventListener("click", () => {
    setWeightUnitPref("kg");
    applyWeightUnitUI();
    refreshAllViews();
    loadEntryToEditor(els.entryDate.value);
  });

  els.weightUnitLbs.addEventListener("click", () => {
    setWeightUnitPref("lbs");
    applyWeightUnitUI();
    refreshAllViews();
    loadEntryToEditor(els.entryDate.value);
  });

  els.videoDownloadBtn.addEventListener("click", () => {
    if (!generatedVideoBlob) return;
    const url = URL.createObjectURL(generatedVideoBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dailyframe-progress-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  els.exportVideo.addEventListener("click", async () => {
    const duration = Math.min(30, Math.max(5, Number(els.videoDuration.value) || 10));
    els.videoDuration.value = String(duration);

    const fromDate = els.videoDateFrom.value || (entriesCache[0]?.date ?? todayISO);
    const toDate = els.videoDateTo.value || todayISO;

    const rangeEntries = entriesCache.filter(
      (e) => e.date >= fromDate && e.date <= toDate
    );

    if (!rangeEntries.length) {
      els.videoStatus.textContent = "No entries in the selected date range.";
      return;
    }

    try {
      els.exportVideo.disabled = true;
      els.videoProgress.hidden = false;
      els.videoProgress.value = 0;
      els.videoPlayerContainer.hidden = true;
      els.videoStatus.textContent = "Generating video…";

      const result = await generateProgressVideo(
        rangeEntries,
        duration,
        (pct) => { els.videoProgress.value = pct; },
        (status) => { els.videoStatus.textContent = status; }
      );

      if (result?.blob) {
        generatedVideoBlob = result.blob;
        const url = URL.createObjectURL(result.blob);
        els.videoPlayer.src = url;
        els.videoPlayerContainer.hidden = false;
      }
    } catch (error) {
      console.error(error);
      els.videoStatus.textContent = error.message || "Failed to export video.";
    } finally {
      els.exportVideo.disabled = false;
    }
  });
}

async function loadEntryToEditor(date) {
  resetSelectedImage();
  els.entryImage.value = "";
  els.entryImageGallery.value = "";

  const entry = date ? await getEntry(date) : null;
  els.entryNote.value = entry?.note || "";

  // Load weight converting from stored kg to display unit
  if (entry?.weightKg != null) {
    els.entryWeight.value = String(kgToDisplay(entry.weightKg) ?? "");
  } else {
    els.entryWeight.value = "";
  }

  if (entry?.image) {
    selectedImageBlob = entry.image;
    setPreviewImage(entry.image);
    els.entryPreviewCaption.textContent = "Editing existing entry image";
    setEntryStatus(`Loaded existing entry for ${date}.`);
  } else {
    clearPreviewImage();
    els.entryPreviewCaption.textContent = "No image selected";
    setEntryStatus("Create a new entry for this date.");
  }
}

async function refreshAllViews() {
  entriesCache = await getAllEntries();
  renderHome();
  renderTimeline();
  syncCompareDateOptions();
  syncVideoDateDefaults();
}

function syncVideoDateDefaults() {
  if (!entriesCache.length) return;
  const sorted = entriesCache; // already sorted ascending in getAllEntries
  // Only set defaults once (when inputs are blank); user changes are preserved.
  if (!els.videoDateFrom.value) {
    els.videoDateFrom.value = sorted[0].date;
  }
  if (!els.videoDateTo.value) {
    els.videoDateTo.value = todayISO;
  }
  // Clamp max to today
  els.videoDateFrom.max = todayISO;
  els.videoDateTo.max = todayISO;
}

function renderHome() {
  const streaks = calculateStreaks(entriesCache);
  els.currentStreak.textContent = String(streaks.current);
  els.longestStreak.textContent = String(streaks.longest);

  const todayEntry = entriesCache.find((entry) => entry.date === todayISO);
  if (!todayEntry) {
    els.todayPreview.classList.add("muted");
    els.todayPreview.textContent = "No entry for today yet.";
    return;
  }

  const note = todayEntry.note?.trim() || "No note";
  const weightStr = todayEntry.weightKg != null
    ? ` · ${kgToDisplay(todayEntry.weightKg)} ${getWeightUnit()}`
    : "";
  els.todayPreview.classList.remove("muted");
  els.todayPreview.textContent = `${todayEntry.date}${weightStr}: ${note}`;
}

function renderTimeline() {
  if (timelineObserver) {
    timelineObserver.disconnect();
  }

  els.timelineList.innerHTML = "";

  if (!entriesCache.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No entries yet.";
    els.timelineList.appendChild(empty);
    return;
  }

  timelineObserver = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) {
          continue;
        }
        const img = record.target;
        const url = img.dataset.objectUrl;
        if (url && !img.src) {
          img.src = url;
          img.addEventListener(
            "load",
            () => {
              URL.revokeObjectURL(url);
              img.dataset.objectUrl = "";
            },
            { once: true }
          );
        }
        timelineObserver.unobserve(img);
      }
    },
    { rootMargin: "180px" }
  );

  const descending = [...entriesCache].sort((a, b) => b.date.localeCompare(a.date));

  for (const entry of descending) {
    const card = document.createElement("article");
    card.className = "card timeline-item";

    // Header row: date + delete button
    const header = document.createElement("div");
    header.className = "tl-header";

    const title = document.createElement("strong");
    title.textContent = entry.date;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tl-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete entry for ${entry.date}? This cannot be undone.`)) return;
      await deleteEntry(entry.date);
      await refreshAllViews();
    });
    header.append(title, deleteBtn);

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = `Progress entry for ${entry.date}`;
    img.dataset.objectUrl = URL.createObjectURL(entry.image);

    const meta = document.createElement("div");
    meta.className = "tl-meta";

    if (entry.weightKg != null) {
      const w = document.createElement("p");
      w.className = "tl-weight";
      w.textContent = `${kgToDisplay(entry.weightKg)} ${getWeightUnit()}`;
      meta.appendChild(w);
    }

    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = entry.note || "No note";
    meta.appendChild(note);

    card.append(header, img, meta);
    els.timelineList.appendChild(card);
    timelineObserver.observe(img);
  }
}

function syncCompareDateOptions() {
  const sorted = [...entriesCache].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) {
    els.compareA.value = "";
    els.compareB.value = "";
    els.compareMeta.textContent = "Add entries to compare.";
    els.compareResult.innerHTML = "";
    return;
  }

  // Always default to earliest → latest
  els.compareA.value = sorted[0].date;
  els.compareB.value = sorted[sorted.length - 1].date;
  renderCompare(els.compareA.value, els.compareB.value);
}

function renderCompare(dateA, dateB) {
  els.compareResult.innerHTML = "";

  if (!dateA || !dateB) {
    els.compareMeta.textContent = "Choose two dates.";
    return;
  }

  const entryA = entriesCache.find((entry) => entry.date === dateA);
  const entryB = entriesCache.find((entry) => entry.date === dateB);

  if (!entryA || !entryB) {
    els.compareMeta.textContent = "One or both selected dates have no entry.";
    return;
  }

  const diff = Math.abs(daysBetween(dateA, dateB));
  els.compareMeta.textContent = `${diff} day${diff !== 1 ? "s" : ""} apart`;

  els.compareResult.appendChild(buildCompareCard(entryA));
  els.compareResult.appendChild(buildCompareCard(entryB));
}

function buildCompareCard(entry) {
  const card = document.createElement("article");
  card.className = "compare-card";

  const img = document.createElement("img");
  img.alt = `Entry image for ${entry.date}`;
  img.src = URL.createObjectURL(entry.image);
  img.addEventListener(
    "load",
    () => {
      URL.revokeObjectURL(img.src);
    },
    { once: true }
  );

  const date = document.createElement("strong");
  date.textContent = entry.date;

  const weight = document.createElement("p");
  weight.className = "compare-weight";
  weight.textContent = entry.weightKg != null
    ? `${kgToDisplay(entry.weightKg)} ${getWeightUnit()}`
    : "—";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = entry.note || "No note";

  card.append(img, date, weight, note);
  return card;
}

async function exportBackup() {
  if (!entriesCache.length) {
    setEntryStatus("No entries to export.", true);
    return;
  }

  const payload = {
    type: "tracklens-backup-v1",
    exportedAt: new Date().toISOString(),
    entries: await Promise.all(
      entriesCache.map(async (entry) => ({
        date: entry.date,
        note: entry.note || "",
        weightKg: entry.weightKg ?? null,
        timestamp: entry.timestamp,
        mimeType: entry.image.type || "image/jpeg",
        imageBase64: await blobToBase64(entry.image),
      }))
    ),
  };

  downloadJson(payload, `dailyframe-backup-${Date.now()}.json`);
  setEntryStatus("Backup exported.");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    validateBackup(data);

    const restored = data.entries.map((entry) => ({
      date: entry.date,
      note: String(entry.note || "").slice(0, MAX_NOTE_LENGTH),
      weightKg: entry.weightKg != null ? Number(entry.weightKg) : null,
      timestamp: Number(entry.timestamp) || Date.now(),
      image: base64ToBlob(entry.imageBase64, entry.mimeType || "image/jpeg"),
    }));

    await clearEntries();
    await bulkPutEntries(restored);
    setEntryStatus(`Imported ${restored.length} entries.`);
    await refreshAllViews();
    await loadEntryToEditor(els.entryDate.value || todayISO);
  } catch (error) {
    console.error(error);
    setEntryStatus(error.message || "Import failed.", true);
  } finally {
    els.importBackupInput.value = "";
  }
}

// ── ZIP export ────────────────────────────────────────────────────────────────
async function exportZip() {
  if (!entriesCache.length) { setEntryStatus("No entries to export.", true); return; }
  setEntryStatus("Building ZIP archive…");
  try {
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3/+esm");
    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    const manifest = [];

    for (const entry of entriesCache) {
      const ext = (entry.image.type || "image/jpeg").includes("png") ? "png" : "jpg";
      const filename = `${entry.date}.${ext}`;
      imgFolder.file(filename, await entry.image.arrayBuffer());
      manifest.push({
        date: entry.date,
        image: `images/${filename}`,
        note: entry.note || "",
        weightKg: entry.weightKg ?? null,
        timestamp: entry.timestamp,
      });
    }

    zip.file(
      "data.json",
      JSON.stringify({ exportedAt: new Date().toISOString(), entries: manifest }, null, 2)
    );

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dailyframe-export-${Date.now()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setEntryStatus("ZIP exported successfully.");
  } catch (error) {
    console.error(error);
    setEntryStatus(`ZIP export failed: ${error.message}`, true);
  }
}

// ── Clear all data ────────────────────────────────────────────────────────────
async function clearAllData() {
  if (!confirm("This will permanently delete ALL entries. This cannot be undone. Continue?")) return;
  await clearEntries();
  setEntryStatus("All data cleared.");
  await refreshAllViews();
  await loadEntryToEditor(todayISO);
}

function validateBackup(data) {
  if (!data || data.type !== "tracklens-backup-v1" || !Array.isArray(data.entries)) {
    throw new Error("Invalid backup file.");
  }

  for (const entry of data.entries) {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.date);
    if (!validDate || entry.date > todayISO || typeof entry.imageBase64 !== "string") {
      throw new Error("Backup contains invalid entries.");
    }
  }
}

function calculateStreaks(entries) {
  if (!entries.length) {
    return { current: 0, longest: 0 };
  }

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = [...new Set(sorted.map((entry) => entry.date))];

  let longest = 1;
  let run = 1;
  for (let i = 1; i < uniqueDates.length; i += 1) {
    const diff = daysBetween(uniqueDates[i], uniqueDates[i - 1]);
    if (diff === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const dateSet = new Set(uniqueDates);
  let current = 0;
  let cursor = parseISODate(todayISO);
  while (dateSet.has(isoDate(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest };
}

function daysBetween(isoA, isoB) {
  const a = parseISODate(isoA);
  const b = parseISODate(isoB);
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / 86_400_000);
}

function parseISODate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function compressImage(file, maxWidth, quality) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    const ratio = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const width = Math.round(bitmap.width * ratio);
    const height = Math.round(bitmap.height * ratio);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  } else {
    const src = await fileToDataUrl(file);
    const img = await loadImage(src);
    const ratio = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
    const width = Math.round(img.naturalWidth * ratio);
    const height = Math.round(img.naturalHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("Failed to compress image."));
          return;
        }
        resolve(result);
      },
      "image/jpeg",
      quality
    );
  });

  return blob;
}

function setPreviewImage(blob) {
  if (selectedImageObjectUrl) {
    URL.revokeObjectURL(selectedImageObjectUrl);
  }
  selectedImageObjectUrl = URL.createObjectURL(blob);
  els.entryPreview.src = selectedImageObjectUrl;
  els.entryPreview.hidden = false;
  els.entryPreviewCaption.textContent = "Preview (compressed for storage)";
}

function clearPreviewImage() {
  if (selectedImageObjectUrl) {
    URL.revokeObjectURL(selectedImageObjectUrl);
  }
  selectedImageObjectUrl = "";
  els.entryPreview.removeAttribute("src");
  els.entryPreview.hidden = true;
}

function resetSelectedImage() {
  selectedImageBlob = null;
  clearPreviewImage();
}

function setEntryStatus(message, isError = false) {
  els.entryStatus.textContent = message;
  els.entryStatus.style.color = isError ? "#ff3b30" : "";
}

async function blobToBase64(blob) {
  const dataUrl = await fileToDataUrl(blob);
  return dataUrl.split(",")[1] || "";
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = src;
  });
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
