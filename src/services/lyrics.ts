import type { LyricLine, TrackLyrics } from '../types';

export interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

const TIMESTAMP_TAG_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_TAG_RE = /^\[(ar|ti|al|au|by|re|ve|length|offset):.*\]$/i;

/**
 * Cleans up filenames and YouTube video titles into a search query for LRCLIB.
 */
export function guessSearchQuery(rawName: string): string {
  return rawName
    .replace(/\.(mp3|m4a|wav|aac|ogg|mp4|mov|webm)$/i, '')
    .replace(/[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|lyric\s*video|lyrics?|mv|hd|4k|uhd|choreography|dance\s*practice|mirror(?:ed)?|live|audio|explicit)[\)\]]/gi, ' ')
    .replace(/\b(?:official\s*(?:music\s*)?video|lyric\s*video|dance\s*practice|choreography)\b/gi, ' ')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses LRC-formatted text into sorted LyricLine entries.
 * Falls back to untimed plain lines (baseTime = -1) when no timestamps exist.
 */
export function parseLyricsText(rawText: string): { lines: LyricLine[]; source: 'lrc' | 'plain' } {
  const rawLines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const timed: LyricLine[] = [];
  const plain: LyricLine[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (METADATA_TAG_RE.test(trimmed)) continue;

    TIMESTAMP_TAG_RE.lastIndex = 0;
    const matches = Array.from(trimmed.matchAll(TIMESTAMP_TAG_RE));
    if (matches.length === 0) {
      plain.push({ baseTime: -1, offset: 0, text: trimmed });
      continue;
    }

    const text = trimmed.replace(TIMESTAMP_TAG_RE, '').trim();
    if (!text) continue;

    for (const m of matches) {
      const mins = Number(m[1]);
      const secs = Number(m[2]);
      const fracRaw = m[3] ?? '0';
      const frac = fracRaw.length === 3 ? Number(fracRaw) / 1000 : Number(fracRaw) / 100;
      const baseTime = mins * 60 + secs + frac;
      if (Number.isFinite(baseTime)) {
        timed.push({ baseTime: Math.round(baseTime * 100) / 100, offset: 0, text });
      }
    }
  }

  if (timed.length > 0) {
    timed.sort((a, b) => a.baseTime - b.baseTime);
    return { lines: timed, source: 'lrc' };
  }

  return { lines: plain, source: 'plain' };
}

/**
 * Searches LRCLIB's free public API for synced or plain lyrics.
 */
export async function searchLrclib(query: string, durationSec = 0): Promise<LrclibResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(clean)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`LRCLIB search failed (${res.status})`);
  }

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];

  const items = (raw as LrclibResult[]).filter(
    (item) =>
      !item.instrumental &&
      Boolean(item.syncedLyrics?.trim() || item.plainLyrics?.trim())
  );

  // Prefer synced results and closest track duration match
  items.sort((a, b) => {
    const aSynced = a.syncedLyrics ? 1 : 0;
    const bSynced = b.syncedLyrics ? 1 : 0;
    if (aSynced !== bSynced) return bSynced - aSynced;

    if (durationSec > 0) {
      const diffA = Math.abs((a.duration || 0) - durationSec);
      const diffB = Math.abs((b.duration || 0) - durationSec);
      return diffA - diffB;
    }
    return 0;
  });

  return items.slice(0, 6);
}

export function buildTrackLyricsFromLrclib(match: LrclibResult, query: string): TrackLyrics | null {
  const raw = match.syncedLyrics?.trim() || match.plainLyrics?.trim();
  if (!raw) return null;
  const parsed = parseLyricsText(raw);
  if (parsed.lines.length === 0) return null;

  return {
    lines: parsed.lines,
    globalOffset: 0,
    source: match.syncedLyrics ? 'lrclib' : parsed.source,
    query,
    updatedAt: Date.now(),
  };
}

export function getEffectiveLineTime(line: LyricLine, globalOffset: number): number {
  if (line.baseTime < 0) return -1;
  return Math.max(0, Math.round((line.baseTime + globalOffset + line.offset) * 100) / 100);
}

/**
 * Returns the active lyric line index for the given playback time, or -1 if untimed/before start.
 */
export function findActiveLyricIndex(
  lyrics: TrackLyrics | undefined,
  currentTime: number
): number {
  if (!lyrics || lyrics.lines.length === 0) return -1;
  if (lyrics.lines[0].baseTime < 0) return -1;

  let active = -1;
  const lookaheadTime = currentTime + 0.08;
  for (let i = 0; i < lyrics.lines.length; i++) {
    const t = getEffectiveLineTime(lyrics.lines[i], lyrics.globalOffset);
    if (t >= 0 && t <= lookaheadTime) {
      active = i;
    }
  }
  return active;
}
