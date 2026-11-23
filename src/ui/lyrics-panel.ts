import {
  buildTrackLyricsFromLrclib,
  findActiveLyricIndex,
  getEffectiveLineTime,
  guessSearchQuery,
  parseLyricsText,
  searchLrclib,
  type LrclibResult,
} from '../services/lyrics';
import type { TrackLyrics, TrackMetadata } from '../types';
import { formatTime } from '../utils';

type NudgeMode = 'global' | 'ripple' | 'single';

export interface LyricsControllerDeps {
  getActiveTrack: () => TrackMetadata | null;
  getCurrentTime: () => number;
  getLoopEnabled: () => boolean;
  getIsPlaying: () => boolean;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  onRestartA: () => void;
  onBack5: () => void;
  onToggleLoop: () => void;
  onSaveTrack: (track: TrackMetadata) => Promise<void>;
  onToast: (message: string) => void;
}

export interface LyricsController {
  onTrackChanged: (track: TrackMetadata | null) => void;
  onTimeUpdate: (currentTime: number) => void;
  onPlayerStateUpdate: (isPlaying: boolean, loopEnabled: boolean, canRestartA: boolean) => void;
  isFullscreen: () => boolean;
  exitFullscreen: () => void;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

export function createLyricsController(deps: LyricsControllerDeps): LyricsController {
  const card = el<HTMLElement>('lyrics-card');
  const btnFind = el<HTMLButtonElement>('btn-lyrics-find');
  const btnSync = el<HTMLButtonElement>('btn-lyrics-sync');
  const btnFs = el<HTMLButtonElement>('btn-lyrics-fs');

  const findBar = el<HTMLDivElement>('lyrics-find-bar');
  const findForm = el<HTMLFormElement>('lyrics-find-form');
  const findInput = el<HTMLInputElement>('lyrics-find-input');
  const btnFindSubmit = el<HTMLButtonElement>('btn-lyrics-search');
  const btnImportFile = el<HTMLButtonElement>('btn-lyrics-file');
  const lrcFileInput = el<HTMLInputElement>('lrc-file-input');
  const btnTogglePaste = el<HTMLButtonElement>('btn-lyrics-paste-toggle');
  const pasteWrap = el<HTMLDivElement>('lyrics-paste-wrap');
  const pasteArea = el<HTMLTextAreaElement>('lyrics-paste-input');
  const btnPasteSave = el<HTMLButtonElement>('btn-lyrics-paste-save');
  const resultsEl = el<HTMLDivElement>('lyrics-results');

  const syncBar = el<HTMLDivElement>('lyrics-sync-bar');
  const nudgeReadout = el<HTMLSpanElement>('lyrics-nudge-readout');
  const btnNudgeReset = el<HTMLButtonElement>('btn-lyrics-nudge-reset');
  const btnClear = el<HTMLButtonElement>('btn-lyrics-clear');

  const listEl = el<HTMLDivElement>('lyrics-list');
  const emptyEl = el<HTMLParagraphElement>('lyrics-empty');

  // Fullscreen teleprompter elements
  const fsOverlay = el<HTMLDivElement>('lyrics-fs-overlay');
  const fsTitle = el<HTMLSpanElement>('lyrics-fs-title');
  const fsPrev = el<HTMLDivElement>('lyrics-fs-prev');
  const fsCurr = el<HTMLDivElement>('lyrics-fs-curr');
  const fsNext = el<HTMLDivElement>('lyrics-fs-next');
  const fsRestartA = el<HTMLButtonElement>('btn-lfs-restart-a');
  const fsBack5 = el<HTMLButtonElement>('btn-lfs-back-5');
  const fsPlay = el<HTMLButtonElement>('btn-lfs-play');
  const fsLoop = el<HTMLButtonElement>('btn-lfs-loop');
  const fsExit = el<HTMLButtonElement>('btn-lfs-exit');

  let findOpen = false;
  let syncOpen = false;
  let pasteOpen = false;
  let nudgeMode: NudgeMode = 'global';
  let activeLineIdx = -1;
  let selectedLineIdx = 0;
  let isFsOpen = false;
  let searchResults: LrclibResult[] = [];

  function syncModeButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-lyrics-mode]').forEach((btn) => {
      const active = btn.dataset.lyricsMode === nudgeMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function renderTeleprompter(track: TrackMetadata | null): void {
    if (!isFsOpen) return;
    fsTitle.textContent = track ? track.name : 'Lyrics';
    const lyrics = track?.lyrics;
    if (!lyrics || lyrics.lines.length === 0) {
      fsPrev.textContent = '';
      fsCurr.textContent = 'No lyrics loaded';
      fsNext.textContent = 'Open Find or import an .lrc file to display lyrics here.';
      return;
    }

    const idx = activeLineIdx >= 0 ? activeLineIdx : 0;
    const prev = lyrics.lines[idx - 1];
    const curr = lyrics.lines[idx];
    const next = lyrics.lines[idx + 1];

    fsPrev.textContent = prev ? prev.text : '';
    fsCurr.textContent = curr ? curr.text : '';
    fsNext.textContent = next ? next.text : '';
  }

  function renderLyricsList(): void {
    const track = deps.getActiveTrack();
    const lyrics = track?.lyrics;
    const hasLyrics = Boolean(lyrics && lyrics.lines.length > 0);

    btnSync.disabled = !hasLyrics;
    btnFs.disabled = !hasLyrics;
    if (!hasLyrics) {
      syncOpen = false;
      syncBar.classList.add('hidden');
      btnSync.setAttribute('aria-pressed', 'false');
    }

    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', hasLyrics);
    listEl.classList.toggle('hidden', !hasLyrics);

    if (!lyrics || lyrics.lines.length === 0) {
      nudgeReadout.textContent = 'Global: +0.0s';
      renderTeleprompter(track);
      return;
    }

    const sign = lyrics.globalOffset >= 0 ? '+' : '';
    nudgeReadout.textContent = `Global: ${sign}${lyrics.globalOffset.toFixed(1)}s`;

    const frag = document.createDocumentFragment();
    lyrics.lines.forEach((line, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      const isActive = idx === activeLineIdx;
      const isSelected = syncOpen && idx === selectedLineIdx;
      row.className = `lyric-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`;
      row.dataset.lineIdx = String(idx);

      const textSpan = document.createElement('span');
      textSpan.className = 'lyric-text';
      textSpan.textContent = line.text;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'lyric-time';
      const eff = getEffectiveLineTime(line, lyrics.globalOffset);
      if (eff >= 0) {
        const lineBadge =
          line.offset !== 0 ? ` (${line.offset > 0 ? '+' : ''}${line.offset.toFixed(1)}s)` : '';
        timeSpan.textContent = `${formatTime(eff)}${lineBadge}`;
      } else {
        timeSpan.textContent = 'Plain';
      }

      row.append(textSpan, timeSpan);
      row.addEventListener('click', () => {
        selectedLineIdx = idx;
        if (eff >= 0) {
          deps.onSeek(eff);
          activeLineIdx = idx;
        }
        renderLyricsList();
      });

      frag.appendChild(row);
    });

    listEl.appendChild(frag);
    renderTeleprompter(track);
  }

  function scrollActiveLineIntoView(): void {
    if (activeLineIdx < 0) return;
    const activeRow = listEl.querySelector<HTMLElement>(`[data-line-idx="${activeLineIdx}"]`);
    if (activeRow) {
      activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function renderSearchResults(): void {
    resultsEl.innerHTML = '';
    if (searchResults.length === 0) {
      resultsEl.classList.add('hidden');
      return;
    }
    resultsEl.classList.remove('hidden');

    const frag = document.createDocumentFragment();
    for (const item of searchResults) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lyrics-result-item';

      const main = document.createElement('span');
      main.className = 'lyrics-result-title';
      main.textContent = `${item.artistName} - ${item.trackName}`;

      const meta = document.createElement('span');
      meta.className = 'lyrics-result-meta';
      const dur = item.duration > 0 ? formatTime(item.duration).slice(0, 5) : '--:--';
      const kind = item.syncedLyrics ? 'Synced' : 'Plain';
      meta.textContent = `${kind} · ${dur}`;

      btn.append(main, meta);
      btn.addEventListener('click', async () => {
        const track = deps.getActiveTrack();
        if (!track) return;
        const built = buildTrackLyricsFromLrclib(item, findInput.value.trim());
        if (!built) {
          deps.onToast('Selected result had no usable lyrics.');
          return;
        }
        track.lyrics = built;
        await deps.onSaveTrack(track);
        findOpen = false;
        findBar.classList.add('hidden');
        btnFind.setAttribute('aria-pressed', 'false');
        searchResults = [];
        resultsEl.innerHTML = '';
        resultsEl.classList.add('hidden');
        activeLineIdx = findActiveLyricIndex(track.lyrics, deps.getCurrentTime());
        selectedLineIdx = Math.max(0, activeLineIdx);
        renderLyricsList();
        deps.onToast(`Saved ${built.lines.length} lyric lines offline.`);
      });

      frag.appendChild(btn);
    }
    resultsEl.appendChild(frag);
  }

  async function applyLyricsText(raw: string, source: 'lrc' | 'plain'): Promise<void> {
    const track = deps.getActiveTrack();
    if (!track) return;
    const parsed = parseLyricsText(raw);
    if (parsed.lines.length === 0) {
      deps.onToast('No lyric lines found in input.');
      return;
    }

    const nextLyrics: TrackLyrics = {
      lines: parsed.lines,
      globalOffset: 0,
      source: parsed.source === 'lrc' ? 'lrc' : source,
      updatedAt: Date.now(),
    };
    track.lyrics = nextLyrics;
    await deps.onSaveTrack(track);
    findOpen = false;
    pasteOpen = false;
    findBar.classList.add('hidden');
    pasteWrap.classList.add('hidden');
    btnFind.setAttribute('aria-pressed', 'false');
    activeLineIdx = findActiveLyricIndex(track.lyrics, deps.getCurrentTime());
    selectedLineIdx = Math.max(0, activeLineIdx);
    renderLyricsList();
    deps.onToast(`Saved ${nextLyrics.lines.length} lyric lines offline.`);
  }

  async function runSearch(): Promise<void> {
    const query = findInput.value.trim();
    if (!query) {
      deps.onToast('Enter a song title or artist.');
      return;
    }

    const track = deps.getActiveTrack();
    btnFindSubmit.disabled = true;
    btnFindSubmit.textContent = '...';
    try {
      searchResults = await searchLrclib(query, track?.duration ?? 0);
      if (searchResults.length === 0) {
        deps.onToast('No lyrics found on LRCLIB. Try shortening the title.');
      }
      renderSearchResults();
    } catch {
      deps.onToast('Could not reach LRCLIB. Check internet or import an .lrc file.');
    } finally {
      btnFindSubmit.disabled = false;
      btnFindSubmit.textContent = 'Search';
    }
  }

  async function applyNudge(delta: number): Promise<void> {
    const track = deps.getActiveTrack();
    if (!track?.lyrics || track.lyrics.lines.length === 0) return;

    const lyrics = track.lyrics;
    if (lyrics.lines[0].baseTime < 0) {
      deps.onToast('Plain lyrics have no timestamps to nudge.');
      return;
    }

    const targetIdx = activeLineIdx >= 0 ? activeLineIdx : selectedLineIdx;
    if (nudgeMode === 'global') {
      lyrics.globalOffset = Math.round((lyrics.globalOffset + delta) * 10) / 10;
    } else if (nudgeMode === 'single') {
      const line = lyrics.lines[targetIdx];
      if (line) {
        line.offset = Math.round((line.offset + delta) * 10) / 10;
      }
    } else {
      for (let i = targetIdx; i < lyrics.lines.length; i++) {
        lyrics.lines[i].offset = Math.round((lyrics.lines[i].offset + delta) * 10) / 10;
      }
    }

    lyrics.updatedAt = Date.now();
    await deps.onSaveTrack(track);
    activeLineIdx = findActiveLyricIndex(lyrics, deps.getCurrentTime());
    renderLyricsList();
  }

  function setFullscreen(open: boolean): void {
    isFsOpen = open;
    fsOverlay.classList.toggle('hidden', !open);
    document.body.classList.toggle('lyrics-fs-lock', open);

    if (open) {
      renderTeleprompter(deps.getActiveTrack());
      if (!document.fullscreenElement && fsOverlay.requestFullscreen) {
        void fsOverlay.requestFullscreen().catch(() => {});
      }
    } else if (document.fullscreenElement === fsOverlay && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {});
    }
  }

  // Event bindings
  btnFind.addEventListener('click', () => {
    findOpen = !findOpen;
    findBar.classList.toggle('hidden', !findOpen);
    btnFind.setAttribute('aria-pressed', String(findOpen));
    if (findOpen) {
      const track = deps.getActiveTrack();
      if (track && !findInput.value.trim()) {
        findInput.value = guessSearchQuery(track.name);
      }
      findInput.focus();
    }
  });

  btnSync.addEventListener('click', () => {
    syncOpen = !syncOpen;
    syncBar.classList.toggle('hidden', !syncOpen);
    btnSync.setAttribute('aria-pressed', String(syncOpen));
    syncModeButtons();
    renderLyricsList();
  });

  btnFs.addEventListener('click', () => {
    setFullscreen(!isFsOpen);
  });

  findForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void runSearch();
  });

  btnImportFile.addEventListener('click', () => {
    lrcFileInput.click();
  });

  lrcFileInput.addEventListener('change', async () => {
    const file = lrcFileInput.files?.[0];
    lrcFileInput.value = '';
    if (!file) return;
    const text = await file.text();
    await applyLyricsText(text, 'lrc');
  });

  btnTogglePaste.addEventListener('click', () => {
    pasteOpen = !pasteOpen;
    pasteWrap.classList.toggle('hidden', !pasteOpen);
    if (pasteOpen) pasteArea.focus();
  });

  btnPasteSave.addEventListener('click', async () => {
    await applyLyricsText(pasteArea.value, 'lrc');
    pasteArea.value = '';
  });

  document.querySelectorAll<HTMLButtonElement>('[data-lyrics-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.lyricsMode as NudgeMode | undefined;
      if (!mode) return;
      nudgeMode = mode;
      syncModeButtons();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-lyrics-nudge]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.lyricsNudge);
      if (Number.isFinite(delta)) {
        void applyNudge(delta);
      }
    });
  });

  btnNudgeReset.addEventListener('click', async () => {
    const track = deps.getActiveTrack();
    if (!track?.lyrics) return;
    track.lyrics.globalOffset = 0;
    for (const line of track.lyrics.lines) {
      line.offset = 0;
    }
    track.lyrics.updatedAt = Date.now();
    await deps.onSaveTrack(track);
    activeLineIdx = findActiveLyricIndex(track.lyrics, deps.getCurrentTime());
    renderLyricsList();
    deps.onToast('Lyrics sync reset.');
  });

  btnClear.addEventListener('click', async () => {
    const track = deps.getActiveTrack();
    if (!track?.lyrics) return;
    delete track.lyrics;
    await deps.onSaveTrack(track);
    activeLineIdx = -1;
    selectedLineIdx = 0;
    renderLyricsList();
    deps.onToast('Lyrics removed from track.');
  });

  fsRestartA.addEventListener('click', deps.onRestartA);
  fsBack5.addEventListener('click', deps.onBack5);
  fsPlay.addEventListener('click', deps.onPlayPause);
  fsLoop.addEventListener('click', deps.onToggleLoop);
  fsExit.addEventListener('click', () => setFullscreen(false));

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isFsOpen) {
      isFsOpen = false;
      fsOverlay.classList.add('hidden');
      document.body.classList.remove('lyrics-fs-lock');
    }
  });

  syncModeButtons();

  return {
    onTrackChanged(track: TrackMetadata | null): void {
      card.classList.toggle('hidden', !track);
      findOpen = false;
      syncOpen = false;
      pasteOpen = false;
      searchResults = [];
      findBar.classList.add('hidden');
      syncBar.classList.add('hidden');
      pasteWrap.classList.add('hidden');
      resultsEl.innerHTML = '';
      resultsEl.classList.add('hidden');
      btnFind.setAttribute('aria-pressed', 'false');
      btnSync.setAttribute('aria-pressed', 'false');
      findInput.value = track ? guessSearchQuery(track.name) : '';
      activeLineIdx = findActiveLyricIndex(track?.lyrics, 0);
      selectedLineIdx = Math.max(0, activeLineIdx);
      if (isFsOpen && !track) {
        setFullscreen(false);
      }
      renderLyricsList();
    },

    onTimeUpdate(currentTime: number): void {
      const track = deps.getActiveTrack();
      const nextIdx = findActiveLyricIndex(track?.lyrics, currentTime);
      if (nextIdx === activeLineIdx) return;

      const prevRow = listEl.querySelector<HTMLElement>('.lyric-row.is-active');
      if (prevRow) prevRow.classList.remove('is-active');

      activeLineIdx = nextIdx;
      if (activeLineIdx >= 0) {
        const nextRow = listEl.querySelector<HTMLElement>(`[data-line-idx="${activeLineIdx}"]`);
        if (nextRow) nextRow.classList.add('is-active');
        scrollActiveLineIntoView();
      }
      renderTeleprompter(track);
    },

    onPlayerStateUpdate(isPlaying: boolean, loopEnabled: boolean, canRestartA: boolean): void {
      fsPlay.innerHTML = isPlaying ? '&#10074;&#10074;' : '&#9654;';
      fsPlay.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      fsLoop.classList.toggle('is-active', loopEnabled);
      fsRestartA.disabled = !canRestartA;
    },

    isFullscreen(): boolean {
      return isFsOpen;
    },

    exitFullscreen(): void {
      setFullscreen(false);
    },
  };
}
