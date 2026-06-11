import { openDB } from "https://cdn.jsdelivr.net/npm/idb@8/+esm";

const DB_NAME = "tracklens-private-db";
const DB_VERSION = 1;
const STORE = "entries";

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: "date" });
      store.createIndex("timestamp", "timestamp");
    }
  },
});

function isQuotaError(error) {
  return (
    error &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

export async function saveEntry(entry) {
  try {
    const db = await dbPromise;
    await db.put(STORE, entry);
  } catch (error) {
    if (isQuotaError(error)) {
      throw new Error("Storage is full. Export backup and remove older images to free space.");
    }
    throw error;
  }
}

export async function getEntry(date) {
  const db = await dbPromise;
  return db.get(STORE, date);
}

export async function getAllEntries() {
  const db = await dbPromise;
  const entries = await db.getAll(STORE);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

export async function deleteEntry(date) {
  const db = await dbPromise;
  await db.delete(STORE, date);
}

export async function clearEntries() {
  const db = await dbPromise;
  await db.clear(STORE);
}

export async function bulkPutEntries(entries) {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readwrite");
  for (const entry of entries) {
    await tx.store.put(entry);
  }
  await tx.done;
}
