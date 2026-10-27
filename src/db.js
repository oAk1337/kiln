import { defaultSettings } from "./logic.js";

const DB_NAME = "kiln";
const DB_VERSION = 1;
const LOCAL_KEY = "kiln.v1";

let dbPromise = null;
let memoryFallback = null;

export async function loadAll() {
  try {
    const db = await getDb();
    const settings = await getKv(db, "settings");
    const days = await getKv(db, "days");
    const plan = await getKv(db, "plan");
    const sessions = await getAll(db, "sessions");
    return {
      settings: settings || defaultSettings(),
      days: Array.isArray(days) ? days : [],
      plan: plan || null,
      sessions: Array.isArray(sessions) ? sessions : [],
      backend: "indexeddb",
    };
  } catch {
    const local = readLocal();
    memoryFallback = local;
    return { ...local, backend: "localstorage" };
  }
}

export async function saveSettings(settings) {
  return mutate((data) => {
    data.settings = settings;
  }, (db) => putKv(db, "settings", settings));
}

export async function saveDays(days) {
  return mutate((data) => {
    data.days = days;
  }, (db) => putKv(db, "days", days));
}

export async function savePlan(plan) {
  return mutate((data) => {
    data.plan = plan;
  }, (db) => putKv(db, "plan", plan));
}

export async function saveSession(session) {
  return mutate((data) => {
    const index = data.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) data.sessions[index] = session;
    else data.sessions.push(session);
  }, (db) => putSession(db, session));
}

export async function deleteSession(id) {
  return mutate((data) => {
    data.sessions = data.sessions.filter((item) => item.id !== id);
  }, (db) => removeSession(db, id));
}

export async function replaceAll({ settings, days, plan, sessions }) {
  if (memoryFallback) {
    memoryFallback = {
      settings,
      days,
      plan,
      sessions,
    };
    writeLocal(memoryFallback);
    return;
  }
  const db = await getDb();
  await transaction(db, ["kv", "sessions"], "readwrite", (tx) => {
    const kv = tx.objectStore("kv");
    const store = tx.objectStore("sessions");
    kv.put(settings, "settings");
    kv.put(days, "days");
    kv.put(plan ?? null, "plan");
    store.clear();
    for (const session of sessions) store.put(session);
  });
}

export async function clearAll() {
  const settings = defaultSettings();
  await replaceAll({ settings, days: [], plan: null, sessions: [] });
  return settings;
}

async function mutate(editLocal, editDb) {
  if (memoryFallback) {
    editLocal(memoryFallback);
    writeLocal(memoryFallback);
    return;
  }
  const db = await getDb();
  await editDb(db);
}

function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("byDate", "date");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
  });
  return dbPromise;
}

function getKv(db, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("kv", "readonly").objectStore("kv").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putKv(db, key, value) {
  return transaction(db, ["kv"], "readwrite", (tx) => {
    tx.objectStore("kv").put(value, key);
  });
}

function putSession(db, session) {
  return transaction(db, ["sessions"], "readwrite", (tx) => {
    tx.objectStore("sessions").put(session);
  });
}

function removeSession(db, id) {
  return transaction(db, ["sessions"], "readwrite", (tx) => {
    tx.objectStore("sessions").delete(id);
  });
}

function transaction(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    try {
      fn(tx);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Storage transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
  });
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { settings: defaultSettings(), days: [], plan: null, sessions: [] };
    const data = JSON.parse(raw);
    return {
      settings: data.settings || defaultSettings(),
      days: Array.isArray(data.days) ? data.days : [],
      plan: data.plan || null,
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
    };
  } catch {
    return { settings: defaultSettings(), days: [], plan: null, sessions: [] };
  }
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({
    settings: data.settings,
    days: data.days,
    plan: data.plan,
    sessions: data.sessions,
  }));
}
