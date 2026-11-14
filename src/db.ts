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

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

function normalizeTrackSettings(raw: Partial<TrackMetadata['settings']> | undefined): TrackMetadata['settings'] {
  const legacySec = (raw as { countInSeconds?: number } | undefined)?.countInSeconds;
  const legacyMode = raw?.countInMode as string | undefined;

  let countInEnabled = raw?.countInEnabled ?? false;
  let countInMode: TrackMetadata['settings']['countInMode'] = '3s';
  let beatCount = raw?.beatCount ?? 4;

  if (legacyMode === '3s' || legacyMode === '5s' || legacyMode === 'beats') {
    countInMode = legacyMode;
    if (raw?.countInEnabled === undefined) {
      countInEnabled = true;
    }
  } else if (legacyMode === '4beats' || legacyMode === '8beats') {
    countInMode = 'beats';
    if (raw?.countInEnabled === undefined) {
      countInEnabled = true;
    }
    if (raw?.beatCount === undefined) {
      beatCount = legacyMode === '8beats' ? 8 : 4;
    }
  } else if (legacyMode === 'off') {
    countInEnabled = false;
  } else if (typeof legacySec === 'number' && legacySec > 0) {
    countInEnabled = true;
    countInMode = legacySec === 5 ? '5s' : '3s';
  }

  const rawSpeed = Number(raw?.speed);
  const speed = Number.isFinite(rawSpeed) ? Math.min(1.25, Math.max(0.25, rawSpeed)) : 1.0;
  const pointA = typeof raw?.pointA === 'number' && Number.isFinite(raw.pointA) && raw.pointA >= 0 ? raw.pointA : null;
  const pointB = typeof raw?.pointB === 'number' && Number.isFinite(raw.pointB) && raw.pointB >= 0 ? raw.pointB : null;

  return {
    speed,
    mirror: Boolean(raw?.mirror),
    countInEnabled,
    countInMode,
    repeatCountInOnLoop: raw?.repeatCountInOnLoop ?? true,
    bpm: Math.min(240, Math.max(40, Math.round(raw?.bpm ?? 120))),
    beatCount: Math.max(1, Math.min(16, Math.round(beatCount))),
    pointA,
    pointB,
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

export async function findMatchingLocalTrack(file: File): Promise<TrackMetadata | undefined> {
  const tracks = await listTracks();
  const baseName = stripFileExtension(file.name);
  const localTracks = tracks.filter((t) => t.mediaKind !== 'youtube');

  const exact = localTracks.find(
    (t) =>
      (t.fileName === file.name || t.name === baseName) &&
      t.size === file.size &&
      t.lastModified !== undefined &&
      t.lastModified === file.lastModified
  );
  if (exact) return exact;

  return localTracks.find(
    (t) => (t.fileName === file.name || t.name === baseName) && t.size === file.size
  );
}

export interface SaveImportedResult {
  meta: TrackMetadata;
  quotaFallback: boolean;
}

export async function saveImportedFile(
  file: File,
  options: { keepLocalCopy?: boolean; existingTrack?: TrackMetadata } = {}
): Promise<SaveImportedResult> {
  if (file.size === 0) {
    throw new Error('Selected file is empty (0 bytes) or still downloading from cloud storage.');
  }

  const keepLocalCopy = options.keepLocalCopy ?? true;
  const existing = options.existingTrack;
  const mediaKind = detectMediaKind(file);
  const mimeType = inferMimeType(file, mediaKind);
  const blob = file.slice(0, file.size, mimeType);
  const duration = await probeMediaDuration(blob, mediaKind);
  const now = Date.now();

  const meta: TrackMetadata = {
    id: existing?.id ?? generateId(),
    name: existing?.name ?? stripFileExtension(file.name),
    fileName: file.name,
    mimeType,
    mediaKind,
    size: file.size,
    lastModified: file.lastModified,
    hasOfflineCopy: existing?.hasOfflineCopy ?? false,
    duration: duration > 0 ? duration : (existing?.duration ?? 0),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    bookmarks: existing?.bookmarks ?? [],
    settings: existing?.settings ?? normalizeTrackSettings(undefined),
  };

  const db = await openDB();
  let quotaFallback = false;

  if (keepLocalCopy && !existing?.hasOfflineCopy) {
    const mediaRecord: TrackMediaRecord = {
      id: meta.id,
      mimeType,
      data: blob,
    };
    try {
      meta.hasOfflineCopy = true;
      let txError: DOMException | Error | null = null;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
        tx.objectStore(META_STORE).put(meta);
        tx.objectStore(MEDIA_STORE).put(mediaRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          txError = tx.error;
          reject(tx.error ?? new Error('IndexedDB write failed'));
        };
        tx.onabort = () => {
          reject(txError ?? tx.error ?? new Error('IndexedDB transaction aborted'));
        };
      });
    } catch (err) {
      const errName = err instanceof DOMException ? err.name : '';
      const isQuota =
        errName === 'QuotaExceededError' ||
        (err instanceof Error && /quota/i.test(err.message));
      if (isQuota) {
        meta.hasOfflineCopy = false;
        quotaFallback = true;
        await updateTrackMeta(meta);
      } else if (errName === 'NotReadableError') {
        throw new Error(
          'Could not read the file from device storage. If it is in cloud backup, download it locally first.'
        );
      } else {
        throw new Error(
          'Could not save this file locally. Try switching to Stream Mode (Keep Copy off) for large videos.'
        );
      }
    }
  } else {
    if (existing?.hasOfflineCopy === undefined && existing) {
      meta.hasOfflineCopy = true;
    }
    await updateTrackMeta(meta);
  }

  setLastActiveTrackId(meta.id);
  return { meta, quotaFallback };
}

export async function saveYouTubeTrack(youtubeId: string, title?: string): Promise<TrackMetadata> {
  const now = Date.now();
  const cleanTitle = title?.trim().slice(0, 80);
  const meta: TrackMetadata = {
    id: generateId(),
    name: cleanTitle || `YouTube (${youtubeId})`,
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

export async function clearAllTracks(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
    tx.objectStore(META_STORE).clear();
    tx.objectStore(MEDIA_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear library'));
  });
  setLastActiveTrackId(null);
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
