import type { MediaKind, TrackMediaRecord, TrackMetadata } from './types';
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
const YT_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25];

let dbPromise: Promise<IDBDatabase> | null = null;

function snapYouTubeRate(speed: number): number {
  return YT_SPEEDS.reduce((best, cur) =>
    Math.abs(cur - speed) < Math.abs(best - speed) ? cur : best
  );
}

function awaitTx(tx: IDBTransaction, fallbackMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let txError: DOMException | Error | null = null;
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      txError = tx.error;
      reject(tx.error ?? new Error(fallbackMessage));
    };
    tx.onabort = () => {
      reject(txError ?? tx.error ?? new Error(`${fallbackMessage} (transaction aborted)`));
    };
  });
}

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
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Database upgrade blocked by another open ChoreoLoop tab.'));
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

export function normalizeTrackSettings(
  raw: Partial<TrackMetadata['settings']> | undefined,
  mediaKind?: MediaKind
): TrackMetadata['settings'] {
  const legacySec = (raw as { countInSeconds?: number } | undefined)?.countInSeconds;
  const legacyMode = raw?.countInMode as string | undefined;

  let countInEnabled = typeof raw?.countInEnabled === 'boolean' ? raw.countInEnabled : false;
  let countInMode: TrackMetadata['settings']['countInMode'] = '3s';
  const rawBeatCount = Number(raw?.beatCount);
  let beatCount = Number.isFinite(rawBeatCount) ? rawBeatCount : 4;

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
  const clampedSpeed = Number.isFinite(rawSpeed)
    ? Math.min(1.25, Math.max(0.25, Math.round(rawSpeed * 100) / 100))
    : 1.0;
  const speed = mediaKind === 'youtube' ? snapYouTubeRate(clampedSpeed) : clampedSpeed;
  const pointA = typeof raw?.pointA === 'number' && Number.isFinite(raw.pointA) && raw.pointA >= 0 ? raw.pointA : null;
  const rawPointB = typeof raw?.pointB === 'number' && Number.isFinite(raw.pointB) && raw.pointB >= 0 ? raw.pointB : null;
  const pointB = pointA !== null && rawPointB !== null && rawPointB > pointA ? rawPointB : pointA === null ? rawPointB : null;

  const rawVol = Number(raw?.countInVolume);
  const countInVolume = Number.isFinite(rawVol) ? Math.min(1, Math.max(0, rawVol)) : 0.85;
  const countInTone =
    raw?.countInTone === 'click' || raw?.countInTone === 'beep' || raw?.countInTone === 'woodblock'
      ? raw.countInTone
      : 'woodblock';

  const rawBpm = Number(raw?.bpm);
  const bpm = Number.isFinite(rawBpm) ? Math.min(240, Math.max(40, Math.round(rawBpm))) : 120;

  return {
    speed,
    mirror: mediaKind === 'youtube' ? false : Boolean(raw?.mirror),
    countInEnabled,
    countInMode,
    repeatCountInOnLoop: raw?.repeatCountInOnLoop ?? true,
    bpm,
    beatCount: Math.max(1, Math.min(16, Math.round(beatCount))),
    countInTone,
    countInVolume,
    pointA,
    pointB,
    loopEnabled: Boolean(raw?.loopEnabled) && pointA !== null && pointB !== null && pointB > pointA,
  };
}

export async function listTracks(): Promise<TrackMetadata[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).getAll();
    let result: TrackMetadata[] = [];
    req.onsuccess = () => {
      result = ((req.result as TrackMetadata[]) ?? []).map((item) => ({
        ...item,
        settings: normalizeTrackSettings(item.settings, item.mediaKind),
      }));
      result.sort((a, b) => b.updatedAt - a.updatedAt);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Failed to list tracks'));
    tx.onabort = () => reject(tx.error ?? new Error('Failed to list tracks (transaction aborted)'));
  });
}

export async function getTrackMeta(id: string): Promise<TrackMetadata | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(id);
    let item: TrackMetadata | null = null;
    req.onsuccess = () => {
      const raw = req.result as TrackMetadata | undefined;
      if (raw) {
        item = {
          ...raw,
          settings: normalizeTrackSettings(raw.settings, raw.mediaKind),
        };
      }
    };
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Failed to read track metadata'));
    tx.onabort = () => reject(tx.error ?? new Error('Failed to read track metadata (transaction aborted)'));
  });
}

export async function getTrackMedia(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).get(id);
    let media: Blob | null = null;
    req.onsuccess = () => {
      const rec = req.result as TrackMediaRecord | undefined;
      if (!rec) return;
      media = rec.data instanceof Blob ? rec.data : new Blob([rec.data], { type: rec.mimeType });
    };
    tx.oncomplete = () => resolve(media);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Failed to read track media'));
    tx.onabort = () => reject(tx.error ?? new Error('Failed to read track media (transaction aborted)'));
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
  options: { keepLocalCopy?: boolean; existingTrack?: TrackMetadata; forceMediaWrite?: boolean } = {}
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
    settings: existing?.settings ?? normalizeTrackSettings(undefined, mediaKind),
  };

  const db = await openDB();
  let quotaFallback = false;

  if (keepLocalCopy && (!existing?.hasOfflineCopy || options.forceMediaWrite)) {
    const mediaRecord: TrackMediaRecord = {
      id: meta.id,
      mimeType,
      data: blob,
    };
    try {
      meta.hasOfflineCopy = true;
      const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      tx.objectStore(MEDIA_STORE).put(mediaRecord);
      await awaitTx(tx, 'IndexedDB write failed');
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
    if (keepLocalCopy && existing && existing.hasOfflineCopy === undefined) {
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
    settings: normalizeTrackSettings(undefined, 'youtube'),
  };

  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put(meta);
  await awaitTx(tx, 'Failed to save YouTube track');

  setLastActiveTrackId(meta.id);
  return meta;
}

export async function updateTrackMeta(meta: TrackMetadata): Promise<void> {
  const db = await openDB();
  meta.updatedAt = Date.now();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put(meta);
  await awaitTx(tx, 'Failed to update track');
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
  tx.objectStore(META_STORE).delete(id);
  tx.objectStore(MEDIA_STORE).delete(id);
  await awaitTx(tx, 'Failed to delete track');
  if (getLastActiveTrackId() === id) {
    setLastActiveTrackId(null);
  }
}

export async function clearAllTracks(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
  tx.objectStore(META_STORE).clear();
  tx.objectStore(MEDIA_STORE).clear();
  await awaitTx(tx, 'Failed to clear library');
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
