function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function fitToCanvas(imgWidth, imgHeight, canvasWidth, canvasHeight) {
  const ratio = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
  const w = Math.round(imgWidth * ratio);
  const h = Math.round(imgHeight * ratio);
  const x = Math.round((canvasWidth - w) / 2);
  const y = Math.round((canvasHeight - h) / 2);
  return { x, y, w, h };
}

async function drawEntry(canvas, ctx, entry) {
  const url = URL.createObjectURL(entry.image);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();

  const { x, y, w, h } = fitToCanvas(img.naturalWidth, img.naturalHeight, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, x, y, w, h);

  // ── Bottom date bar ──────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(18, canvas.height - 70, canvas.width - 36, 46);
  ctx.fillStyle = "#fff";
  ctx.font = "600 26px 'Segoe UI', sans-serif";
  ctx.fillText(entry.date, 30, canvas.height - 38);

  // ── Top-right weight badge ───────────────────────────────────────────────
  if (entry.weightKg != null) {
    const unit = entry._displayUnit || "kg";
    const displayVal = unit === "lbs"
      ? (Math.round(entry.weightKg * 2.20462 * 10) / 10)
      : (Math.round(entry.weightKg * 10) / 10);
    const label = `${displayVal} ${unit}`;
    ctx.font = "bold 32px 'Segoe UI', sans-serif";
    const tw = ctx.measureText(label).width;
    const padX = 18, badgeH = 52, by = 18;
    const bx = canvas.width - tw - padX * 2 - 18;
    // pill background
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + padX * 2, badgeH, 12);
    ctx.fill();
    // text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, bx + padX, by + badgeH - 12);
  }

  URL.revokeObjectURL(url);
}

function pickMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

export async function exportImageSetFallback(entries, onStatus) {
  const items = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const base64 = await blobToBase64(entry.image);
    items.push({
      date: entry.date,
      note: entry.note || "",
      mimeType: entry.image.type || "image/jpeg",
      imageBase64: base64,
    });
  }

  const payload = {
    type: "tracklens-image-set",
    exportedAt: new Date().toISOString(),
    count: items.length,
    entries: items,
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  downloadBlob(blob, `tracklens-images-${Date.now()}.json`);
  onStatus("Video recording is not supported on this device. Exported image set instead.");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Failed to read image data."));
    reader.readAsDataURL(blob);
  });
}

export async function generateProgressVideo(entries, durationSeconds, onProgress, onStatus) {
  if (!entries.length) {
    throw new Error("No entries to export.");
  }

  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    await exportImageSetFallback(entries, onStatus);
    return;
  }

  // Determine canvas size from the maximum natural dimensions across all
  // entries so quality matches source photos. Cap at 1080×1920 (9:16 Full HD)
  // to avoid running out of GPU memory on mobile browsers.
  const MAX_W = 1080;
  const MAX_H = 1920;
  let bestW = 720, bestH = 1280;
  for (const entry of entries) {
    const probeUrl = URL.createObjectURL(entry.image);
    const probe = new Image();
    probe.src = probeUrl;
    await probe.decode().catch(() => {});
    URL.revokeObjectURL(probeUrl);
    if (probe.naturalWidth > bestW) {
      bestW = probe.naturalWidth;
      bestH = probe.naturalHeight;
    }
  }
  // Enforce 9:16 ratio and cap
  const ratio = 9 / 16;
  if (bestW / bestH > ratio) {
    bestW = Math.round(bestH * ratio);
  } else {
    bestH = Math.round(bestW / ratio);
  }
  const width  = Math.min(bestW, MAX_W);
  const height = Math.min(bestH, MAX_H);

  const fps = 30;
  const totalMs = Math.max(5000, Math.min(30000, durationSeconds * 1000));
  const frameMs = Math.max(120, Math.floor(totalMs / entries.length));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });

  const bitrate = width >= 1000 ? 6_000_000 : 2_500_000;

  const mimeType = pickMimeType();
  if (!mimeType) {
    await exportImageSetFallback(entries, onStatus);
    return;
  }

  const stream = canvas.captureStream(fps);
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const completed = new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Failed while generating video."));
    recorder.onstop = () => resolve();
  });

  // Draw the first frame onto the canvas BEFORE starting the recorder so the
  // stream never captures a blank black frame as the opening shot.
  await drawEntry(canvas, ctx, entries[0]);
  // Flush to the stream by waiting two animation frames.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  recorder.start();

  for (let i = 0; i < entries.length; i += 1) {
    // First entry already drawn above; redraw it so its duration is honoured.
    await drawEntry(canvas, ctx, entries[i]);
    onProgress(Math.round(((i + 1) / entries.length) * 100));
    await sleep(frameMs);
  }

  recorder.stop();
  await completed;

  if (!chunks.length) {
    throw new Error("No video data produced.");
  }

  const blob = new Blob(chunks, { type: mimeType });
  onStatus("Video ready.");
  return { blob };
}
