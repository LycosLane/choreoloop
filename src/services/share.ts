import { normalizeTrackSettings } from '../db';
import type {
  CountInMode,
  CountInTone,
  LoopBookmark,
  TrackLyrics,
  TrackMetadata,
  TrackSettings,
} from '../types';
import { generateId } from '../utils';
import { isValidYouTubeId } from '../youtube';

const MAX_DECOMPRESSED_BYTES = 256 * 1024;
const MAX_IMPORT_BOOKMARKS = 50;
const MAX_IMPORT_LYRIC_LINES = 2000;
const VALID_LYRIC_SOURCES = new Set<TrackLyrics['source']>(['lrclib', 'lrc', 'plain']);

interface CompactSharePayload {
  v: 1;
  yt: string;
  n?: string;
  s?: number;
  a?: number | null;
  b?: number | null;
  l?: boolean;
  ci?: {
    e: boolean;
    m: CountInMode;
    r: boolean;
    bpm: number;
    bc: number;
    t: CountInTone;
    v: number;
  };
  bm?: Array<[string, number, number]>;
  lo?: number;
  ly?: {
    s: TrackLyrics['source'];
    go: number;
    l: Array<[number, number, string]>;
  };
}

export interface LocalSetupExport {
  format: 'choreoloop-setup';
  version: 1;
  name: string;
  mediaKind: TrackMetadata['mediaKind'];
  youtubeId?: string;
  settings: TrackSettings;
  bookmarks: Array<{ name: string; start: number; end: number }>;
  lyrics?: TrackLyrics;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padLen = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function toBase64Url(str: string): string {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

function fromBase64Url(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

async function compressString(str: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return bytesToBase64Url(new Uint8Array(buf));
  } catch {
    return null;
  }
}

async function decompressString(b64url: string): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const bytes = base64UrlToBytes(b64url);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_DECOMPRESSED_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
  } catch {
    return null;
  }
}

function buildCompactPayload(track: TrackMetadata): CompactSharePayload {
  const s = track.settings;
  const payload: CompactSharePayload = {
    v: 1,
    yt: track.youtubeId ?? '',
    n: track.name.slice(0, 80),
    s: s.speed,
    a: s.pointA !== null ? Math.round(s.pointA * 100) / 100 : null,
    b: s.pointB !== null ? Math.round(s.pointB * 100) / 100 : null,
    l: s.loopEnabled,
    ci: {
      e: s.countInEnabled,
      m: s.countInMode,
      r: s.repeatCountInOnLoop,
      bpm: s.bpm,
      bc: s.beatCount,
      t: s.countInTone,
      v: s.countInVolume,
    },
    bm: track.bookmarks.slice(0, 12).map((bm) => [
      bm.name.slice(0, 32),
      Math.round(bm.start * 100) / 100,
      Math.round(bm.end * 100) / 100,
    ]),
  };

  if (track.lyrics && track.lyrics.lines.length > 0) {
    payload.lo = track.lyrics.globalOffset;
    payload.ly = {
      s: track.lyrics.source,
      go: track.lyrics.globalOffset,
      l: track.lyrics.lines.map((line) => [
        line.baseTime,
        line.offset,
        line.text,
      ]),
    };
  }

  return payload;
}

/**
 * Pure helper returning `#sharez=...` or `#share=...` hash for a YouTube track without browser globals.
 */
export async function encodeShareHash(track: TrackMetadata): Promise<string> {
  if (track.mediaKind !== 'youtube' || !track.youtubeId || !isValidYouTubeId(track.youtubeId)) {
    throw new Error('Share links are available for YouTube tracks.');
  }
  const json = JSON.stringify(buildCompactPayload(track));
  const compressed = await compressString(json);
  const plain = toBase64Url(json);
  return compressed && compressed.length < plain.length
    ? `#sharez=${compressed}`
    : `#share=${plain}`;
}

/**
 * Encodes a YouTube track's full practice setup (including lyrics) into a #share= / #sharez= URL.
 */
export async function encodeShareUrl(track: TrackMetadata): Promise<string> {
  const hash = await encodeShareHash(track);
  const base = `${window.location.origin}${window.location.pathname}`;
  const longUrl = `${base}${hash}`;

  const shortenerUrl = (import.meta.env.VITE_SHORTENER_URL as string | undefined)?.trim();
  if (shortenerUrl) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(shortenerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: longUrl }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { shortUrl?: unknown };
        if (typeof data.shortUrl === 'string' && /^https?:\/\//i.test(data.shortUrl)) {
          return data.shortUrl;
        }
      }
    } catch {
      // Fallback to self-contained #sharez= URL
    } finally {
      window.clearTimeout(timer);
    }
  }

  return longUrl;
}

/**
 * Decodes an incoming #share=... or #sharez=... URL hash into validated track settings, bookmarks, and lyrics.
 */
export async function decodeShareHash(hash: string): Promise<{
  youtubeId: string;
  name?: string;
  settings: TrackSettings;
  bookmarks: LoopBookmark[];
  lyrics?: TrackLyrics;
  lyricsOffset?: number;
} | null> {
  const isCompressed = hash.startsWith('#sharez=');
  const isPlain = hash.startsWith('#share=');
  if (!isCompressed && !isPlain) return null;

  const raw = hash.slice(isCompressed ? '#sharez='.length : '#share='.length).trim();
  if (!raw) return null;

  try {
    const jsonText = isCompressed ? await decompressString(raw) : fromBase64Url(raw);
    if (!jsonText || jsonText.length > MAX_DECOMPRESSED_BYTES) return null;
    const parsed = JSON.parse(jsonText) as CompactSharePayload;
    if (!parsed || parsed.v !== 1 || typeof parsed.yt !== 'string' || !isValidYouTubeId(parsed.yt)) {
      return null;
    }

    const bookmarks: LoopBookmark[] = Array.isArray(parsed.bm)
      ? parsed.bm
          .slice(0, MAX_IMPORT_BOOKMARKS)
          .filter(
            (entry): entry is [string, number, number] =>
              Array.isArray(entry) &&
              typeof entry[0] === 'string' &&
              typeof entry[1] === 'number' &&
              typeof entry[2] === 'number' &&
              Number.isFinite(entry[1]) &&
              Number.isFinite(entry[2]) &&
              entry[1] >= 0 &&
              entry[2] > entry[1]
          )
          .map(([name, start, end]) => ({
            id: generateId(),
            name: name.trim().slice(0, 32) || 'Loop',
            start,
            end,
            createdAt: Date.now(),
          }))
      : [];

    const rawSettings: Partial<TrackSettings> = {
      speed: parsed.s ?? 1.0,
      pointA: typeof parsed.a === 'number' && Number.isFinite(parsed.a) ? parsed.a : null,
      pointB: typeof parsed.b === 'number' && Number.isFinite(parsed.b) ? parsed.b : null,
      loopEnabled: Boolean(parsed.l),
    };

    if (parsed.ci && typeof parsed.ci === 'object') {
      rawSettings.countInEnabled = Boolean(parsed.ci.e);
      rawSettings.countInMode = parsed.ci.m;
      rawSettings.repeatCountInOnLoop = Boolean(parsed.ci.r);
      rawSettings.bpm = parsed.ci.bpm;
      rawSettings.beatCount = parsed.ci.bc;
      rawSettings.countInTone = parsed.ci.t;
      rawSettings.countInVolume = parsed.ci.v;
    }

    const settings = normalizeTrackSettings(rawSettings, 'youtube');

    let lyrics: TrackLyrics | undefined;
    if (parsed.ly && typeof parsed.ly === 'object' && Array.isArray(parsed.ly.l) && parsed.ly.l.length > 0) {
      const lines = parsed.ly.l
        .slice(0, MAX_IMPORT_LYRIC_LINES)
        .filter(
          (item): item is [number, number, string] =>
            Array.isArray(item) &&
            typeof item[0] === 'number' &&
            typeof item[1] === 'number' &&
            Number.isFinite(item[0]) &&
            Number.isFinite(item[1]) &&
            typeof item[2] === 'string'
        )
        .map(([baseTime, offset, text]) => ({ baseTime, offset, text }));
      if (lines.length > 0) {
        const source = VALID_LYRIC_SOURCES.has(parsed.ly.s) ? parsed.ly.s : 'lrc';
        lyrics = {
          lines,
          globalOffset:
            typeof parsed.ly.go === 'number' && Number.isFinite(parsed.ly.go) ? parsed.ly.go : 0,
          source,
          updatedAt: Date.now(),
        };
      }
    }

    return {
      youtubeId: parsed.yt,
      name: typeof parsed.n === 'string' ? parsed.n.trim().slice(0, 80) || undefined : undefined,
      settings,
      bookmarks,
      lyrics,
      lyricsOffset:
        typeof parsed.lo === 'number' && Number.isFinite(parsed.lo) ? parsed.lo : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Triggers a download of a small .choreoloop.json file with loops, settings, and lyrics.
 */
export function exportTrackSetupJson(track: TrackMetadata): void {
  const payload: LocalSetupExport = {
    format: 'choreoloop-setup',
    version: 1,
    name: track.name,
    mediaKind: track.mediaKind,
    youtubeId: track.youtubeId,
    settings: track.settings,
    bookmarks: track.bookmarks.map((bm) => ({
      name: bm.name,
      start: bm.start,
      end: bm.end,
    })),
    lyrics: track.lyrics,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = (track.name || 'track').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 48);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.choreoloop.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parses an imported .choreoloop.json file into validated setup data.
 */
export function parseTrackSetupJson(rawText: string): {
  name?: string;
  youtubeId?: string;
  settings: Partial<TrackSettings>;
  bookmarks: LoopBookmark[];
  lyrics?: TrackLyrics;
} | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<LocalSetupExport>;
    if (!parsed || parsed.format !== 'choreoloop-setup' || parsed.version !== 1) {
      return null;
    }

    if (
      parsed.youtubeId !== undefined &&
      (typeof parsed.youtubeId !== 'string' || !isValidYouTubeId(parsed.youtubeId))
    ) {
      return null;
    }

    const bookmarks: LoopBookmark[] = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks
          .slice(0, MAX_IMPORT_BOOKMARKS)
          .filter(
            (b) =>
              b &&
              typeof b.name === 'string' &&
              typeof b.start === 'number' &&
              typeof b.end === 'number' &&
              Number.isFinite(b.start) &&
              Number.isFinite(b.end) &&
              b.start >= 0 &&
              b.end > b.start
          )
          .map((b) => ({
            id: generateId(),
            name: b.name.trim().slice(0, 32) || 'Loop',
            start: b.start,
            end: b.end,
            createdAt: Date.now(),
          }))
      : [];

    let lyrics: TrackLyrics | undefined;
    if (parsed.lyrics && typeof parsed.lyrics === 'object' && Array.isArray(parsed.lyrics.lines)) {
      const lines = parsed.lyrics.lines
        .slice(0, MAX_IMPORT_LYRIC_LINES)
        .filter(
          (l) =>
            l &&
            typeof l.baseTime === 'number' &&
            typeof l.offset === 'number' &&
            Number.isFinite(l.baseTime) &&
            Number.isFinite(l.offset) &&
            typeof l.text === 'string'
        )
        .map((l) => ({ baseTime: l.baseTime, offset: l.offset, text: l.text }));
      if (lines.length > 0) {
        const source = VALID_LYRIC_SOURCES.has(parsed.lyrics.source) ? parsed.lyrics.source : 'lrc';
        lyrics = {
          lines,
          globalOffset:
            typeof parsed.lyrics.globalOffset === 'number' && Number.isFinite(parsed.lyrics.globalOffset)
              ? parsed.lyrics.globalOffset
              : 0,
          source,
          query: typeof parsed.lyrics.query === 'string' ? parsed.lyrics.query.slice(0, 120) : undefined,
          updatedAt: Date.now(),
        };
      }
    }

    const rawSettings =
      parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)
        ? parsed.settings
        : {};
    const targetKind = parsed.youtubeId ? 'youtube' : undefined;

    return {
      name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 80) || undefined : undefined,
      youtubeId: parsed.youtubeId,
      settings: normalizeTrackSettings(rawSettings, targetKind),
      bookmarks,
      lyrics,
    };
  } catch {
    return null;
  }
}
