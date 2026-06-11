function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

export async function compressImageBlob(file, maxWidth = 720, quality = 0.82) {
  const source = await blobToImage(file);
  const ratio = Math.min(1, maxWidth / source.width);
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(source, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to compress image"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  if (!meta || !data) {
    throw new Error("Invalid data URL");
  }

  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const bytes = atob(data);
  const len = bytes.length;
  const arr = new Uint8Array(len);

  for (let i = 0; i < len; i += 1) {
    arr[i] = bytes.charCodeAt(i);
  }

  return new Blob([arr], { type: mime });
}

export function setPreviewImage(container, blob, altText) {
  container.innerHTML = "";
  if (!blob) {
    container.classList.add("empty");
    container.textContent = "No image";
    return;
  }

  const img = document.createElement("img");
  img.alt = altText;
  img.src = URL.createObjectURL(blob);
  img.onload = () => URL.revokeObjectURL(img.src);

  container.classList.remove("empty");
  container.append(img);
}

export function formatDisplayDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function dateDiffInDays(a, b) {
  const utcA = Date.parse(`${a}T00:00:00Z`);
  const utcB = Date.parse(`${b}T00:00:00Z`);
  return Math.round((utcB - utcA) / 86400000);
}
