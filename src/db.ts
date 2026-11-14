import type { TrackMediaRecord, TrackMetadata } from './types';
import {
  detectMediaKind,
  generateId,
  inferMimeType,
  probeMediaDuration,
  stripFileExtension,
} from './utils';

const DB_NAME = 'choreoloop-db';
const DB_VERSION = 1;
const META_STORE = 'trackMeta';
const MEDIA_STORE = 'trackMedia';
const LAST_TRACK_KEY = 'choreoloop:lastTrackId';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
}

export async function listTracks(): Promise<TrackMetadata[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as TrackMetadata[]) ?? [];
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to list tracks'));
  });
}

export async function getTrackMeta(id: string): Promise<TrackMetadata | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(id);
    req.onsuccess = () => resolve((req.result as TrackMetadata | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to read track metadata'));
  });
}

export async function getTrackMedia(id: string): Promise<TrackMediaRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).get(id);
    req.onsuccess = () => resolve((req.result as TrackMediaRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to read track media'));
  });
}

export async function saveImportedFile(file: File): Promise<TrackMetadata> {
  const mediaKind = detectMediaKind(file);
  const mimeType = inferMimeType(file, mediaKind);
  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const duration = await probeMediaDuration(blob, mediaKind);
  const now = Date.now();

  const meta: TrackMetadata = {
    id: generateId(),
    name: stripFileExtension(file.name),
    mimeType,
    mediaKind,
    size: file.size,
    duration,
    createdAt: now,
    updatedAt: now,
    bookmarks: [],
    settings: {
      speed: 1.0,
      mirror: false,
      countInSeconds: 0,
      pointA: null,
      pointB: null,
      loopEnabled: false,
    },
  };

  const mediaRecord: TrackMediaRecord = {
    id: meta.id,
    mimeType,
    data: arrayBuffer,
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(MEDIA_STORE).put(mediaRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save track'));
  });

  setLastActiveTrackId(meta.id);
  return meta;
}

export async function updateTrackMeta(meta: TrackMetadata): Promise<void> {
  const db = await openDB();
  meta.updatedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to update track'));
  });
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(MEDIA_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete track'));
  });
  if (getLastActiveTrackId() === id) {
    setLastActiveTrackId(null);
  }
}

export function getLastActiveTrackId(): string | null {
  try {
    return localStorage.getItem(LAST_TRACK_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveTrackId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(LAST_TRACK_KEY, id);
    } else {
      localStorage.removeItem(LAST_TRACK_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}
