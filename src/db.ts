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

function normalizeTrackSettings(raw: Partial<TrackMetadata['settings']> | undefined): TrackMetadata['settings'] {
  const legacySec = (raw as { countInSeconds?: number } | undefined)?.countInSeconds;
  let countInMode = raw?.countInMode ?? 'off';
  if (!raw?.countInMode && typeof legacySec === 'number') {
    countInMode = legacySec === 3 ? '3s' : legacySec === 5 ? '5s' : 'off';
  }
  return {
    speed: raw?.speed ?? 1.0,
    mirror: raw?.mirror ?? false,
    countInMode,
    bpm: raw?.bpm ?? 120,
    pointA: raw?.pointA ?? null,
    pointB: raw?.pointB ?? null,
    loopEnabled: raw?.loopEnabled ?? false,
  };
}

export async function listTracks(): Promise<TrackMetadata[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => {
      const items = ((req.result as TrackMetadata[]) ?? []).map((item) => ({
        ...item,
        settings: normalizeTrackSettings(item.settings),
      }));
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
    req.onsuccess = () => {
      const item = req.result as TrackMetadata | undefined;
      if (!item) {
        resolve(null);
        return;
      }
      resolve({
        ...item,
        settings: normalizeTrackSettings(item.settings),
      });
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to read track metadata'));
  });
}

export async function getTrackMedia(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).get(id);
    req.onsuccess = () => {
      const rec = req.result as TrackMediaRecord | undefined;
      if (!rec) {
        resolve(null);
        return;
      }
      if (rec.data instanceof Blob) {
        resolve(rec.data);
      } else {
        resolve(new Blob([rec.data], { type: rec.mimeType }));
      }
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to read track media'));
  });
}

export async function saveImportedFile(file: File): Promise<TrackMetadata> {
  if (file.size === 0) {
    throw new Error('Selected file is empty (0 bytes) or still downloading from cloud storage.');
  }

  const mediaKind = detectMediaKind(file);
  const mimeType = inferMimeType(file, mediaKind);
  const blob = file.slice(0, file.size, mimeType);
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
    settings: normalizeTrackSettings(undefined),
  };

  const mediaRecord: TrackMediaRecord = {
    id: meta.id,
    mimeType,
    data: blob,
  };

  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      tx.objectStore(MEDIA_STORE).put(mediaRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'QuotaExceededError') {
      throw new Error(
        'Not enough browser storage for this file. Delete old tracks in Library or trim/compress large 4K videos first.'
      );
    }
    if (name === 'NotReadableError') {
      throw new Error('Could not read the file from device storage. If it is in cloud backup, download it locally first.');
    }
    throw new Error(
      'Could not save this file locally. Very large 4K/HEVC phone videos can exceed mobile browser memory limits.'
    );
  }

  setLastActiveTrackId(meta.id);
  return meta;
}

export async function saveYouTubeTrack(youtubeId: string, title?: string): Promise<TrackMetadata> {
  const now = Date.now();
  const meta: TrackMetadata = {
    id: generateId(),
    name: title?.trim() || `YouTube (${youtubeId})`,
    mimeType: 'video/youtube',
    mediaKind: 'youtube',
    youtubeId,
    size: 0,
    duration: 0,
    createdAt: now,
    updatedAt: now,
    bookmarks: [],
    settings: normalizeTrackSettings(undefined),
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save YouTube track'));
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
