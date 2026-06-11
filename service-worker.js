const CACHE_NAME = "dailyframe-shell-v3";
const RUNTIME = "dailyframe-runtime-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/main.js",
  "./js/db.js",
  "./js/video.js",
  "./manifest.json",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];

// CDN deps pre-cached on install so they work offline too
const CDN_DEPS = [
  "https://cdn.jsdelivr.net/npm/idb@8/+esm",
  "https://cdn.jsdelivr.net/npm/jszip@3/+esm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_SHELL, ...CDN_DEPS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![CACHE_NAME, RUNTIME].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (url.hostname.includes("cdn.jsdelivr.net")) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    if (request.mode === "navigate") {
      const fallback = await caches.match("./index.html");
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}
