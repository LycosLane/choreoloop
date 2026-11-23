import type {
  CountInMode,
  CountInTone,
  LoopBookmark,
  TrackLyrics,
  TrackMetadata,
  TrackSettings,
} from '../types';
import { generateId } from '../utils';

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
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

/**
 * Encodes a YouTube track's full practice setup (including lyrics) into a #share= / #sharez= URL.
 */
export async function encodeShareUrl(track: TrackMetadata): Promise<string> {
  if (track.mediaKind !== 'youtube' || !track.youtubeId) {
    throw new Error('Share links are available for YouTube tracks.');
  }

  const s = track.settings;
  const payload: CompactSharePayload = {
    v: 1,
    yt: track.youtubeId,
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

  const json = JSON.stringify(payload);
  const compressed = await compressString(json);
  const base = `${window.location.origin}${window.location.pathname}`;
  if (compressed && compressed.length < toBase64Url(json).length) {
    return `${base}#sharez=${compressed}`;
  }
  return `${base}#share=${toBase64Url(json)}`;
}

/**
 * Decodes an incoming #share=... or #sharez=... URL hash into track settings, bookmarks, and lyrics.
 */
export async function decodeShareHash(hash: string): Promise<{
  youtubeId: string;
  name?: string;
  settings: Partial<TrackSettings>;
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
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText) as CompactSharePayload;
    if (!parsed || parsed.v !== 1 || typeof parsed.yt !== 'string' || !parsed.yt) {
      return null;
    }

    const bookmarks: LoopBookmark[] = Array.isArray(parsed.bm)
      ? parsed.bm
          .filter(
            (entry): entry is [string, number, number] =>
              Array.isArray(entry) &&
              typeof entry[0] === 'string' &&
              typeof entry[1] === 'number' &&
              typeof entry[2] === 'number' &&
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

    const settings: Partial<TrackSettings> = {
      speed: parsed.s ?? 1.0,
      pointA: typeof parsed.a === 'number' ? parsed.a : null,
      pointB: typeof parsed.b === 'number' ? parsed.b : null,
      loopEnabled: Boolean(parsed.l),
    };

    if (parsed.ci) {
      settings.countInEnabled = Boolean(parsed.ci.e);
      settings.countInMode = parsed.ci.m;
      settings.repeatCountInOnLoop = Boolean(parsed.ci.r);
      settings.bpm = parsed.ci.bpm;
      settings.beatCount = parsed.ci.bc;
      settings.countInTone = parsed.ci.t;
      settings.countInVolume = parsed.ci.v;
    }

    let lyrics: TrackLyrics | undefined;
    if (parsed.ly && Array.isArray(parsed.ly.l) && parsed.ly.l.length > 0) {
      const lines = parsed.ly.l
        .filter(
          (item): item is [number, number, string] =>
            Array.isArray(item) &&
            typeof item[0] === 'number' &&
            typeof item[1] === 'number' &&
            typeof item[2] === 'string'
        )
        .map(([baseTime, offset, text]) => ({ baseTime, offset, text }));
      if (lines.length > 0) {
        lyrics = {
          lines,
          globalOffset: typeof parsed.ly.go === 'number' ? parsed.ly.go : 0,
          source: parsed.ly.s ?? 'lrc',
          updatedAt: Date.now(),
        };
      }
    }

    return {
      youtubeId: parsed.yt,
      name: typeof parsed.n === 'string' ? parsed.n : undefined,
      settings,
      bookmarks,
      lyrics,
      lyricsOffset: typeof parsed.lo === 'number' ? parsed.lo : undefined,
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

    const bookmarks: LoopBookmark[] = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks
          .filter(
            (b) =>
              b &&
              typeof b.name === 'string' &&
              typeof b.start === 'number' &&
              typeof b.end === 'number' &&
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

    const lyrics =
      parsed.lyrics && Array.isArray(parsed.lyrics.lines)
        ? {
            lines: parsed.lyrics.lines.filter(
              (l) =>
                l &&
                typeof l.baseTime === 'number' &&
                typeof l.offset === 'number' &&
                typeof l.text === 'string'
            ),
            globalOffset: typeof parsed.lyrics.globalOffset === 'number' ? parsed.lyrics.globalOffset : 0,
            source: parsed.lyrics.source ?? 'lrc',
            query: parsed.lyrics.query,
            updatedAt: Date.now(),
          }
        : undefined;

    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      youtubeId: typeof parsed.youtubeId === 'string' ? parsed.youtubeId : undefined,
      settings: parsed.settings ?? {},
      bookmarks,
      lyrics,
    };
  } catch {
    return null;
  }
}
