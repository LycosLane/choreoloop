import './style.css';
import {
  clearAllTracks,
  deleteTrack,
  findMatchingLocalTrack,
  getLastActiveTrackId,
  getTrackMedia,
  getTrackMeta,
  listTracks,
  saveImportedFile,
  saveYouTubeTrack,
  setLastActiveTrackId,
  updateTrackMeta,
} from './db';
import { ChoreoPlayer, type PlayerStateSnapshot } from './player';
import { createMediaSessionSync } from './services/media-session';
import {
  decodeShareHash,
  encodeShareUrl,
  exportTrackSetupJson,
  parseTrackSetupJson,
} from './services/share';
import { createTapTempo } from './services/tap-tempo';
import { createWakeLockController } from './services/wake-lock';
import type { CountInMode, CountInTone, LoopBookmark, TrackMetadata } from './types';
import { initLayoutOrder } from './ui/layout-order';
import { renderLibraryDrawer } from './ui/library-drawer';
import { createLyricsController } from './ui/lyrics-panel';
import { initVideoGestures } from './ui/video-gesture';
import { clamp, formatBytes, formatTime, generateId } from './utils';
import { extractYouTubeId } from './youtube';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

// DOM Elements
const trackTitleEl = $<HTMLSpanElement>('track-title');
const libraryCountEl = $<HTMLSpanElement>('library-count');
const fileInput = $<HTMLInputElement>('file-input');

const stageCardEl = $<HTMLElement>('stage-card');
const stageEmptyEl = $<HTMLDivElement>('stage-empty');
const stageVideoWrap = $<HTMLDivElement>('stage-video-wrap');
const stageYtWrap = $<HTMLDivElement>('stage-yt-wrap');
const ytContainerEl = $<HTMLDivElement>('yt-container');
const stageAudioWrap = $<HTMLDivElement>('stage-audio-wrap');
const videoEl = $<HTMLVideoElement>('video-player');
const audioEl = $<HTMLAudioElement>('audio-player');
const mirrorBadgeEl = $<HTMLSpanElement>('mirror-badge');
const btnFullscreen = $<HTMLButtonElement>('btn-fullscreen');
const btnZoomReset = $<HTMLButtonElement>('btn-zoom-reset');
const fsHudEl = $<HTMLDivElement>('fs-hud');
const btnFsRestartA = $<HTMLButtonElement>('btn-fs-restart-a');
const btnFsBack5 = $<HTMLButtonElement>('btn-fs-back-5');
const btnFsPlay = $<HTMLButtonElement>('btn-fs-play');
const btnFsLoop = $<HTMLButtonElement>('btn-fs-loop');
const btnFsExit = $<HTMLButtonElement>('btn-fs-exit');
const audioDiscEl = $<HTMLDivElement>('audio-disc');
const audioTrackNameEl = $<HTMLSpanElement>('audio-track-name');
const audioLoopStatusEl = $<HTMLSpanElement>('audio-loop-status');
const audioTimecodeEl = $<HTMLDivElement>('audio-timecode');

const countInOverlay = $<HTMLDivElement>('countin-overlay');
const countInLabelEl = $<HTMLSpanElement>('countin-label');
const countInNumberEl = $<HTMLSpanElement>('countin-number');
const btnCancelCountIn = $<HTMLButtonElement>('btn-cancel-countin');
const ytCountInBarEl = $<HTMLDivElement>('yt-countin-bar');
const ytCountInLabelEl = $<HTMLSpanElement>('yt-countin-label');
const ytCountInNumberEl = $<HTMLSpanElement>('yt-countin-number');
const btnYtCancelCountIn = $<HTMLButtonElement>('btn-yt-cancel-countin');

const timeCurrentEl = $<HTMLSpanElement>('time-current');
const timeDurationEl = $<HTMLSpanElement>('time-duration');
const loopSpanReadoutEl = $<HTMLSpanElement>('loop-span-readout');

const scrubberEl = $<HTMLDivElement>('scrubber');
const scrubberProgressEl = $<HTMLDivElement>('scrubber-progress');
const scrubberThumbEl = $<HTMLDivElement>('scrubber-thumb');
const scrubberAbRangeEl = $<HTMLDivElement>('scrubber-ab-range');
const markerAEl = $<HTMLDivElement>('marker-a');
const markerBEl = $<HTMLDivElement>('marker-b');

const btnRestartA = $<HTMLButtonElement>('btn-restart-a');
const btnBack5 = $<HTMLButtonElement>('btn-back-5');
const btnPlay = $<HTMLButtonElement>('btn-play');
const playIconEl = $<HTMLSpanElement>('play-icon');
const btnFwd5 = $<HTMLButtonElement>('btn-fwd-5');

const btnMirror = $<HTMLButtonElement>('btn-mirror');
const btnCountInToggle = $<HTMLButtonElement>('btn-countin-toggle');
const countInOptionsEl = $<HTMLDivElement>('countin-options');
const countInButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-countin]'));
const btnLoopCountIn = $<HTMLButtonElement>('btn-loop-countin');
const bpmRowEl = $<HTMLDivElement>('bpm-row');
const btnTapBpm = $<HTMLButtonElement>('btn-tap-bpm');
const bpmInput = $<HTMLInputElement>('bpm-input');
const btnBpmMinus = $<HTMLButtonElement>('btn-bpm-minus');
const btnBpmPlus = $<HTMLButtonElement>('btn-bpm-plus');
const beatCountInput = $<HTMLInputElement>('beat-count-input');
const btnBeatCountMinus = $<HTMLButtonElement>('btn-beat-count-minus');
const btnBeatCountPlus = $<HTMLButtonElement>('btn-beat-count-plus');
const toneButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tone]'));
const countInVolSlider = $<HTMLInputElement>('countin-vol');
const bpmEffectiveEl = $<HTMLSpanElement>('bpm-effective');

const btnSetA = $<HTMLButtonElement>('btn-set-a');
const btnSetB = $<HTMLButtonElement>('btn-set-b');
const btnLoopToggle = $<HTMLButtonElement>('btn-loop-toggle');
const btnClearAB = $<HTMLButtonElement>('btn-clear-ab');

const stepButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-step]'));
const btnJumpA = $<HTMLButtonElement>('btn-jump-a');
const btnJumpB = $<HTMLButtonElement>('btn-jump-b');
const labelAEl = $<HTMLSpanElement>('label-a');
const labelBEl = $<HTMLSpanElement>('label-b');
const btnAMinus = $<HTMLButtonElement>('btn-a-minus');
const btnAPlus = $<HTMLButtonElement>('btn-a-plus');
const btnBMinus = $<HTMLButtonElement>('btn-b-minus');
const btnBPlus = $<HTMLButtonElement>('btn-b-plus');

const btnSaveBookmark = $<HTMLButtonElement>('btn-save-bookmark');
const bookmarkForm = $<HTMLFormElement>('bookmark-form');
const bookmarkNameInput = $<HTMLInputElement>('bookmark-name-input');
const btnCancelBookmark = $<HTMLButtonElement>('btn-cancel-bookmark');
const bookmarkPresetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bm-preset]'));
const bookmarksListEl = $<HTMLDivElement>('bookmarks-list');

const speedReadoutEl = $<HTMLSpanElement>('speed-readout');
const btnSpeedMinus = $<HTMLButtonElement>('btn-speed-minus');
const btnSpeedPlus = $<HTMLButtonElement>('btn-speed-plus');
const speedSlider = $<HTMLInputElement>('speed-slider');
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'));

const ytModal = $<HTMLDivElement>('yt-modal');
const ytForm = $<HTMLFormElement>('yt-form');
const ytUrlInput = $<HTMLInputElement>('yt-url-input');
const ytTitleInput = $<HTMLInputElement>('yt-title-input');
const btnYtPaste = $<HTMLButtonElement>('btn-yt-paste');

const ytMirrorNoteEl = $<HTMLParagraphElement>('yt-mirror-note');
const ytSpeedNoteEl = $<HTMLParagraphElement>('yt-speed-note');

const guideModal = $<HTMLDivElement>('guide-modal');

const btnShareOpen = $<HTMLButtonElement>('btn-share-open');
const shareModal = $<HTMLDivElement>('share-modal');
const shareYtSection = $<HTMLDivElement>('share-yt-section');
const shareSummaryChips = $<HTMLDivElement>('share-summary-chips');
const shareLinkInput = $<HTMLInputElement>('share-link-input');
const btnCopyShare = $<HTMLButtonElement>('btn-copy-share');
const btnNativeShare = $<HTMLButtonElement>('btn-native-share');
const btnExportJson = $<HTMLButtonElement>('btn-export-json');
const btnImportJson = $<HTMLButtonElement>('btn-import-json');
const setupJsonInput = $<HTMLInputElement>('setup-json-input');

const libraryModal = $<HTMLDivElement>('library-modal');
const libraryListEl = $<HTMLDivElement>('library-list');
const libraryStorageEl = $<HTMLSpanElement>('library-storage');
const btnKeepCopy = $<HTMLButtonElement>('btn-keep-copy');
const storageChoiceBannerEl = $<HTMLDivElement>('storage-choice-banner');
const storageChoiceTextEl = $<HTMLSpanElement>('storage-choice-text');
const btnChoiceStream = $<HTMLButtonElement>('btn-choice-stream');
const btnChoiceCopy = $<HTMLButtonElement>('btn-choice-copy');
const btnClearLibrary = $<HTMLButtonElement>('btn-clear-library');
const libraryConfirmEl = $<HTMLDivElement>('library-confirm');
const libraryConfirmTextEl = $<HTMLSpanElement>('library-confirm-text');
const toastEl = $<HTMLDivElement>('toast');

const btnTheme = $<HTMLButtonElement>('btn-theme');
const btnReorderLayout = $<HTMLButtonElement>('btn-reorder-layout');
const btnMenu = $<HTMLButtonElement>('btn-menu');
const headerMenuEl = $<HTMLDivElement>('header-menu');
const faviconLinkEl = document.getElementById('favicon-link') as HTMLLinkElement | null;
const manifestLinkEl = document.getElementById('manifest-link') as HTMLLinkElement | null;
const appleTouchIconEl = document.getElementById('apple-touch-icon') as HTMLLinkElement | null;
const themeColorMetaEl = document.getElementById('theme-color-meta') as HTMLMetaElement | null;

const THEME_KEY = 'choreoloop:theme';
const NUDGE_STEP_KEY = 'choreoloop:nudgeStep';
const KEEP_COPY_KEY = 'choreoloop:keepLocalCopy';
type AppTheme = 'dark' | 'light';

// App State
let tracks: TrackMetadata[] = [];
let activeTrack: TrackMetadata | null = null;
let toastTimer: number | null = null;
let saveDebounceTimer: number | null = null;
let nudgeStep = 0.1;
let isStageFullscreen = false;
let keepLocalCopy = true;
let pendingRelinkTrackId: string | null = null;
const sessionFiles = new Map<string, File>();

function syncKeepCopyUI(): void {
  btnKeepCopy.classList.toggle('is-active', keepLocalCopy);
  btnKeepCopy.setAttribute('aria-pressed', String(keepLocalCopy));
}

function setKeepLocalCopy(enabled: boolean): void {
  keepLocalCopy = enabled;
  syncKeepCopyUI();
  try {
    localStorage.setItem(KEEP_COPY_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage restriction
  }
}

function loadKeepLocalCopy(): void {
  try {
    const raw = localStorage.getItem(KEEP_COPY_KEY);
    setKeepLocalCopy(raw !== '0');
  } catch {
    setKeepLocalCopy(true);
  }
}

function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  const isLight = theme === 'light';
  const svgIcon = isLight ? './icons/choreoloop-light.svg' : './icons/choreoloop.svg';
  const appleIcon = isLight ? './icons/apple-touch-icon-light.png' : './icons/apple-touch-icon.png';

  if (faviconLinkEl) faviconLinkEl.href = svgIcon;
  if (manifestLinkEl) manifestLinkEl.href = isLight ? './manifest-light.json' : './manifest.json';
  if (appleTouchIconEl) appleTouchIconEl.href = appleIcon;
  if (themeColorMetaEl) themeColorMetaEl.content = isLight ? '#F8FAFC' : '#101216';

  document.querySelectorAll<HTMLImageElement>('[data-theme-logo]').forEach((img) => {
    img.src = svgIcon;
  });

  btnTheme.textContent = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  btnTheme.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage errors
  }
}

function initTheme(): void {
  let saved: AppTheme = 'dark';
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark') saved = raw;
  } catch {
    // Default to dark
  }
  applyTheme(saved);
}

function setNudgeStep(step: number): void {
  nudgeStep = step;
  for (const btn of stepButtons) {
    const isActive = Number(btn.dataset.step) === step;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
  const label = `${step}s`;
  btnAMinus.textContent = `-${label}`;
  btnAPlus.textContent = `+${label}`;
  btnBMinus.textContent = `-${label}`;
  btnBPlus.textContent = `+${label}`;
  try {
    localStorage.setItem(NUDGE_STEP_KEY, String(step));
  } catch {
    // Ignore storage errors
  }
}

function initNudgeStep(): void {
  try {
    const raw = Number(localStorage.getItem(NUDGE_STEP_KEY));
    if (raw === 0.1 || raw === 0.25 || raw === 0.5) {
      setNudgeStep(raw);
      return;
    }
  } catch {
    // Default
  }
  setNudgeStep(0.1);
}

function showToast(message: string, durationMs = 2800): void {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.add('hidden');
  }, durationMs);
}

const player = new ChoreoPlayer(videoEl, audioEl, ytContainerEl, {
  onStateChange: (snapshot) => renderPlayerState(snapshot),
  onTimeUpdate: (currentTime, duration) => renderTimeline(currentTime, duration),
  onSettingsChanged: () => scheduleSaveTrackSettings(),
  onError: (msg) => showToast(msg, 5200),
});

function scheduleSaveTrackSettings(): void {
  if (!activeTrack) return;
  const snap = player.getSnapshot();
  activeTrack.settings = {
    speed: snap.speed,
    mirror: snap.mirror,
    countInEnabled: snap.countInEnabled,
    countInMode: snap.countInMode,
    repeatCountInOnLoop: snap.repeatCountInOnLoop,
    bpm: snap.bpm,
    beatCount: snap.beatCount,
    countInTone: snap.countInTone,
    countInVolume: snap.countInVolume,
    pointA: snap.pointA,
    pointB: snap.pointB,
    loopEnabled: snap.loopEnabled,
  };
  if (saveDebounceTimer !== null) window.clearTimeout(saveDebounceTimer);
  saveDebounceTimer = window.setTimeout(() => {
    if (activeTrack) {
      void updateTrackMeta(activeTrack);
    }
  }, 200);
}

function renderPlayerState(snap: PlayerStateSnapshot): void {
  const hasMedia = snap.mediaKind !== null;
  const isLocalVideo = snap.mediaKind === 'video';
  const isYouTube = snap.mediaKind === 'youtube';

  // Stage visibility
  stageEmptyEl.classList.toggle('hidden', hasMedia);
  stageVideoWrap.classList.toggle('hidden', !isLocalVideo);
  stageYtWrap.classList.toggle('hidden', !isYouTube);
  stageAudioWrap.classList.toggle('hidden', snap.mediaKind !== 'audio');
  // Keep overlays off the YouTube iframe to comply with YouTube API ToS
  btnFullscreen.classList.toggle('hidden', !isLocalVideo);
  if (!isLocalVideo && isStageFullscreen) {
    setStageFullscreen(false);
  }

  // Count-In display: stage overlay for local media, timeline bar for YouTube (YouTube ToS compliant)
  if (snap.countInRemaining !== null) {
    const isBeats = snap.countInMode === 'beats';
    const labelText = isBeats
      ? `BEAT COUNT (${snap.beatCount} Beats @ ${Math.round(snap.bpm * snap.speed)} BPM)`
      : 'GET READY';
    const numText = String(snap.countInRemaining);

    if (isYouTube) {
      countInOverlay.classList.add('hidden');
      ytCountInBarEl.classList.remove('hidden');
      ytCountInLabelEl.textContent = labelText;
      ytCountInNumberEl.textContent = numText;
    } else {
      ytCountInBarEl.classList.add('hidden');
      countInOverlay.classList.remove('hidden');
      countInLabelEl.textContent = labelText;
      countInNumberEl.textContent = numText;
    }
  } else {
    countInOverlay.classList.add('hidden');
    ytCountInBarEl.classList.add('hidden');
  }

  // Play/Pause & Restart A buttons
  playIconEl.innerHTML = snap.isPlaying ? '&#10074;&#10074;' : '&#9654;';
  btnPlay.setAttribute('aria-label', snap.isPlaying ? 'Pause' : 'Play');
  btnPlay.disabled = !hasMedia;
  btnRestartA.disabled = !hasMedia;
  btnBack5.disabled = !hasMedia;
  btnFwd5.disabled = !hasMedia;

  // Fullscreen HUD sync
  btnFsPlay.innerHTML = snap.isPlaying ? '&#10074;&#10074;' : '&#9654;';
  btnFsPlay.setAttribute('aria-label', snap.isPlaying ? 'Pause' : 'Play');
  btnFsLoop.classList.toggle('is-active', snap.loopEnabled && snap.pointA !== null && snap.pointB !== null && snap.pointB > snap.pointA);
  btnFsLoop.disabled = snap.pointA === null || snap.pointB === null || snap.pointB <= snap.pointA;

  // Audio disc animation & status
  audioDiscEl.classList.toggle('is-playing', snap.isPlaying);
  if (snap.loopEnabled && snap.pointA !== null && snap.pointB !== null) {
    audioLoopStatusEl.textContent = `Looping ${formatTime(snap.pointA)} - ${formatTime(snap.pointB)}`;
  } else {
    audioLoopStatusEl.textContent = snap.isPlaying ? 'Playing' : 'Paused';
  }

  // Mirror mode (local video only)
  btnMirror.disabled = isYouTube;
  btnMirror.classList.toggle('is-active', snap.mirror && !isYouTube);
  btnMirror.setAttribute('aria-pressed', String(snap.mirror && !isYouTube));
  btnMirror.textContent = 'Mirror';
  mirrorBadgeEl.classList.toggle('hidden', !snap.mirror || !isLocalVideo);
  ytMirrorNoteEl.classList.toggle('hidden', !isYouTube);
  ytSpeedNoteEl.classList.toggle('hidden', !isYouTube);

  // Count-in toggle, Each Loop switch, mode chips & Beat Grid row
  btnCountInToggle.classList.toggle('is-active', snap.countInEnabled);
  btnCountInToggle.setAttribute('aria-pressed', String(snap.countInEnabled));
  btnCountInToggle.textContent = 'Count-In';

  countInOptionsEl.classList.toggle('hidden', !snap.countInEnabled);
  btnLoopCountIn.classList.toggle('is-active', snap.repeatCountInOnLoop);
  btnLoopCountIn.setAttribute('aria-pressed', String(snap.repeatCountInOnLoop));
  btnLoopCountIn.textContent = 'Each Loop';

  for (const btn of countInButtons) {
    const isActive = btn.dataset.countin === snap.countInMode;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }

  const showBpm = snap.countInEnabled && snap.countInMode === 'beats';
  bpmRowEl.classList.toggle('hidden', !showBpm);
  if (document.activeElement !== bpmInput) {
    bpmInput.value = String(snap.bpm);
  }
  if (document.activeElement !== beatCountInput) {
    beatCountInput.value = String(snap.beatCount);
  }
  const effectiveBpm = Math.round(snap.bpm * snap.speed);
  const bpmSuffix =
    Math.abs(snap.speed - 1.0) < 0.01 ? `${snap.bpm} BPM` : `${effectiveBpm} eff. BPM`;
  bpmEffectiveEl.textContent = `${snap.beatCount} Beats @ ${bpmSuffix}`;

  for (const btn of toneButtons) {
    const isActive = btn.dataset.tone === snap.countInTone;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
  if (document.activeElement !== countInVolSlider) {
    countInVolSlider.value = String(snap.countInVolume);
  }

  // A-B Loop buttons
  const hasA = snap.pointA !== null;
  const hasB = snap.pointB !== null;
  const hasValidRange = hasA && hasB && (snap.pointB as number) > (snap.pointA as number);

  btnSetA.disabled = !hasMedia;
  btnSetB.disabled = !hasMedia;
  btnSetA.classList.toggle('is-set', hasA);
  btnSetB.classList.toggle('is-set', hasB);
  btnSetA.setAttribute('aria-pressed', String(hasA));
  btnSetB.setAttribute('aria-pressed', String(hasB));

  btnLoopToggle.disabled = !hasValidRange;
  btnLoopToggle.classList.toggle('is-active', snap.loopEnabled && hasValidRange);
  btnLoopToggle.setAttribute('aria-pressed', String(snap.loopEnabled && hasValidRange));
  btnLoopToggle.textContent = 'Loop';

  btnClearAB.disabled = !hasA && !hasB;

  labelAEl.textContent = hasA ? formatTime(snap.pointA as number) : '--:--.-';
  labelBEl.textContent = hasB ? formatTime(snap.pointB as number) : '--:--.-';
  btnAMinus.disabled = !hasA;
  btnAPlus.disabled = !hasA;
  btnBMinus.disabled = !hasB;
  btnBPlus.disabled = !hasB;

  btnSaveBookmark.disabled = !hasValidRange;

  if (hasValidRange) {
    const span = (snap.pointB as number) - (snap.pointA as number);
    loopSpanReadoutEl.textContent = `Loop: ${span.toFixed(1)}s`;
  } else {
    loopSpanReadoutEl.textContent = '';
  }

  // Speed controls
  speedReadoutEl.textContent = `${snap.speed.toFixed(2)}x`;
  speedSlider.step = isYouTube ? '0.25' : '0.05';
  speedSlider.value = String(snap.speed);
  btnSpeedMinus.textContent = isYouTube ? '-25%' : '-5%';
  btnSpeedPlus.textContent = isYouTube ? '+25%' : '+5%';
  for (const btn of speedButtons) {
    const preset = Number(btn.dataset.speed);
    const unsupportedOnYt = isYouTube && Math.abs(preset - 0.9) < 0.01;
    btn.classList.toggle('hidden', unsupportedOnYt);
    const isActive = Math.abs(preset - snap.speed) < 0.01;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }

  renderTimeline(snap.currentTime, snap.duration);
  renderBookmarks();
  btnShareOpen.classList.toggle('hidden', !activeTrack);
  lyricsController.onPlayerStateUpdate(
    snap.isPlaying,
    snap.loopEnabled,
    snap.pointA !== null
  );
  lyricsController.onTimeUpdate(snap.currentTime);
  wakeLock.sync(hasMedia);
  mediaSession.sync(snap, activeTrack?.name ?? null);
}

function renderTimeline(currentTime: number, duration: number): void {
  const snap = player.getSnapshot();
  const dur = duration > 0 ? duration : activeTrack?.duration ?? 0;

  timeCurrentEl.textContent = formatTime(currentTime);
  audioTimecodeEl.textContent = formatTime(currentTime);
  lyricsController.onTimeUpdate(currentTime);
  timeDurationEl.textContent = formatTime(dur);

  const pct = dur > 0 ? clamp((currentTime / dur) * 100, 0, 100) : 0;
  scrubberProgressEl.style.width = `${pct}%`;
  scrubberThumbEl.style.left = `${pct}%`;
  scrubberEl.setAttribute('aria-valuenow', String(Math.round(pct)));

  if (dur > 0 && snap.pointA !== null) {
    const aPct = clamp((snap.pointA / dur) * 100, 0, 100);
    markerAEl.style.left = `${aPct}%`;
    markerAEl.classList.remove('hidden');

    if (snap.pointB !== null && snap.pointB > snap.pointA) {
      const bPct = clamp((snap.pointB / dur) * 100, 0, 100);
      markerBEl.style.left = `${bPct}%`;
      markerBEl.classList.remove('hidden');
      scrubberAbRangeEl.style.left = `${aPct}%`;
      scrubberAbRangeEl.style.width = `${bPct - aPct}%`;
      scrubberAbRangeEl.classList.remove('hidden');
    } else {
      markerBEl.classList.add('hidden');
      scrubberAbRangeEl.classList.add('hidden');
    }
  } else {
    markerAEl.classList.add('hidden');
    markerBEl.classList.add('hidden');
    scrubberAbRangeEl.classList.add('hidden');
  }
}

function renderBookmarks(): void {
  bookmarksListEl.innerHTML = '';
  if (!activeTrack || activeTrack.bookmarks.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'empty-hint';
    hint.textContent = 'Set A and B, then tap "+ Save" to bookmark sections.';
    bookmarksListEl.appendChild(hint);
    return;
  }

  const snap = player.getSnapshot();
  for (const bm of activeTrack.bookmarks) {
    const chip = document.createElement('div');
    const isCurrent =
      snap.pointA !== null &&
      snap.pointB !== null &&
      Math.abs(snap.pointA - bm.start) < 0.05 &&
      Math.abs(snap.pointB - bm.end) < 0.05;
    chip.className = `bookmark-chip${isCurrent ? ' is-active' : ''}`;

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'bookmark-select';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = bm.name;
    const rangeSpan = document.createElement('span');
    rangeSpan.className = 'bookmark-range';
    rangeSpan.textContent = `${formatTime(bm.start, false)}-${formatTime(bm.end, false)}`;
    selectBtn.append(nameSpan, rangeSpan);
    selectBtn.addEventListener('click', () => {
      player.applyBookmark(bm.start, bm.end);
      showToast(`Loaded "${bm.name}"`);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'bookmark-delete';
    delBtn.setAttribute('aria-label', `Delete ${bm.name}`);
    delBtn.textContent = '\u00d7';
    delBtn.addEventListener('click', () => {
      void removeBookmark(bm.id);
    });

    chip.appendChild(selectBtn);
    chip.appendChild(delBtn);
    bookmarksListEl.appendChild(chip);
  }
}

function renderLibrary(): void {
  renderLibraryDrawer({
    tracks,
    activeTrackId: activeTrack?.id ?? null,
    sessionFiles,
    libraryCountEl,
    libraryListEl,
    libraryStorageEl,
    libraryConfirmEl,
    btnClearLibrary,
    onSelectTrack: (trackId) => {
      void selectTrack(trackId);
      closeLibraryModal();
    },
    onDeleteTrack: (trackId) => {
      void handleDeleteTrack(trackId);
    },
  });
}

async function refreshTrackList(): Promise<void> {
  tracks = await listTracks();
  renderLibrary();
}

async function selectTrack(id: string, allowPrompt = true): Promise<void> {
  const meta = await getTrackMeta(id);
  if (!meta) {
    showToast('Track metadata not found.');
    return;
  }

  if (meta.mediaKind === 'youtube' && meta.youtubeId) {
    activeTrack = meta;
    setLastActiveTrackId(meta.id);
    trackTitleEl.textContent = meta.name;
    audioTrackNameEl.textContent = meta.name;
    await player.loadYouTube(meta.youtubeId, meta.settings);
    lyricsController.onTrackChanged(activeTrack);
    renderLibrary();
    return;
  }

  let mediaSource: Blob | File | null = sessionFiles.get(id) ?? null;
  if (!mediaSource && meta.hasOfflineCopy !== false) {
    mediaSource = await getTrackMedia(id);
  }

  if (!mediaSource) {
    if (allowPrompt) {
      pendingRelinkTrackId = meta.id;
      showToast(`Select "${meta.fileName || meta.name}" to resume with your saved loops.`, 4500);
      fileInput.click();
    }
    return;
  }

  activeTrack = meta;
  setLastActiveTrackId(meta.id);
  trackTitleEl.textContent = meta.name;
  audioTrackNameEl.textContent = meta.name;
  player.loadMedia(mediaSource, meta.mediaKind === 'video' ? 'video' : 'audio', meta.settings);
  lyricsController.onTrackChanged(activeTrack);
  renderLibrary();
}

async function processImportedFiles(
  fileList: File[],
  useKeepCopy: boolean,
  relinkId: string | null
): Promise<void> {
  let lastImported: TrackMetadata | null = null;
  let lastWasMatched = false;
  let lastQuotaFallback = false;

  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList[i];
    try {
      showToast(useKeepCopy ? `Importing ${file.name}...` : `Loading ${file.name}...`);
      let existingTrack: TrackMetadata | undefined;
      if (relinkId && i === 0 && fileList.length === 1) {
        existingTrack = (await getTrackMeta(relinkId)) ?? undefined;
      } else {
        existingTrack = await findMatchingLocalTrack(file);
      }

      const result = await saveImportedFile(file, { keepLocalCopy: useKeepCopy, existingTrack });
      sessionFiles.set(result.meta.id, file);
      lastImported = result.meta;
      lastWasMatched = Boolean(existingTrack);
      lastQuotaFallback = result.quotaFallback;
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : `Failed to load ${file.name}`;
      showToast(msg, 5500);
    }
  }

  await refreshTrackList();
  if (lastImported) {
    await selectTrack(lastImported.id);
    if (lastQuotaFallback) {
      showToast('Storage full: playing in Stream Mode (loops & settings saved).', 4500);
    } else if (lastWasMatched) {
      showToast(`Restored saved loops & settings for ${lastImported.name}`);
    } else {
      showToast(`Ready: ${lastImported.name}`);
    }
  }
}

let pendingChoiceFiles: File[] | null = null;
let pendingChoiceRelinkId: string | null = null;

async function handleFilesImported(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) {
    pendingRelinkTrackId = null;
    return;
  }

  const relinkId = pendingRelinkTrackId;
  pendingRelinkTrackId = null;
  const fileList = Array.from(files);
  fileInput.value = '';

  const largeFileBytes = 250 * 1024 * 1024;
  const cacheThresholdBytes = 500 * 1024 * 1024;
  const cachedBytes = tracks
    .filter((t) => t.mediaKind !== 'youtube' && t.hasOfflineCopy !== false)
    .reduce((sum, t) => sum + (t.size || 0), 0);
  const incomingBytes = fileList.reduce((sum, f) => sum + f.size, 0);
  const hasLargeFile = fileList.some((f) => f.size > largeFileBytes);

  if (keepLocalCopy && !relinkId && (hasLargeFile || cachedBytes + incomingBytes > cacheThresholdBytes)) {
    pendingChoiceFiles = fileList;
    pendingChoiceRelinkId = relinkId;
    storageChoiceTextEl.textContent = `Large import (${formatBytes(incomingBytes)}, cached: ${formatBytes(cachedBytes)}). Save an offline copy, or stream directly (0 MB)? Due to iOS/Android browser security, streamed files must be re-selected after an app restart, though your loops stay saved.`;
    storageChoiceBannerEl.classList.remove('hidden');
    openLibraryModal();
    return;
  }

  await processImportedFiles(fileList, keepLocalCopy, relinkId);
}

async function handleYouTubeImport(urlOrId: string, title?: string): Promise<void> {
  const videoId = extractYouTubeId(urlOrId);
  if (!videoId) {
    showToast('Invalid YouTube URL or Video ID.', 3500);
    return;
  }
  const meta = await saveYouTubeTrack(videoId, title);
  await refreshTrackList();
  await selectTrack(meta.id);
  closeYtModal();
  showToast('YouTube video loaded');
}

async function handleDeleteTrack(id: string): Promise<void> {
  await deleteTrack(id);
  sessionFiles.delete(id);
  if (activeTrack?.id === id) {
    activeTrack = null;
    trackTitleEl.textContent = 'No track loaded';
    player.unload();
    lyricsController.onTrackChanged(null);
  }
  await refreshTrackList();
  if (!activeTrack && tracks.length > 0) {
    await selectTrack(tracks[0].id, false);
  }
  showToast('Track removed from library');
}

async function saveBookmark(name: string): Promise<void> {
  if (!activeTrack) return;
  const snap = player.getSnapshot();
  if (snap.pointA === null || snap.pointB === null || snap.pointB <= snap.pointA) return;

  const bookmark: LoopBookmark = {
    id: generateId(),
    name: name.trim(),
    start: snap.pointA,
    end: snap.pointB,
    createdAt: Date.now(),
  };

  activeTrack.bookmarks.push(bookmark);
  await updateTrackMeta(activeTrack);
  await refreshTrackList();
  renderBookmarks();
  showToast(`Saved "${bookmark.name}"`);
}

async function removeBookmark(bookmarkId: string): Promise<void> {
  if (!activeTrack) return;
  activeTrack.bookmarks = activeTrack.bookmarks.filter((b) => b.id !== bookmarkId);
  await updateTrackMeta(activeTrack);
  await refreshTrackList();
  renderBookmarks();
}

// Screen Wake Lock & MediaSession
const wakeLock = createWakeLockController();
const mediaSession = createMediaSessionSync({
  onTogglePlay: () => player.togglePlay(),
  onSeekBy: (delta) => player.seekBy(delta),
  onRestartA: () => {
    const s = player.getSnapshot();
    player.seekTo(s.pointA ?? 0);
  },
});

// Fullscreen Stage + Auto-Hide HUD
let fsHudTimer: number | null = null;
function showFsHudTemporarily(): void {
  if (!isStageFullscreen) {
    fsHudEl.classList.add('hidden');
    return;
  }
  fsHudEl.classList.remove('hidden');
  if (fsHudTimer !== null) window.clearTimeout(fsHudTimer);
  fsHudTimer = window.setTimeout(() => {
    if (isStageFullscreen) {
      fsHudEl.classList.add('hidden');
    }
  }, 3000);
}

function setStageFullscreen(active: boolean): void {
  isStageFullscreen = active;
  stageCardEl.classList.toggle('is-fullscreen', active);
  btnFullscreen.textContent = active ? 'Exit' : 'Fullscreen';
  if (active) {
    showFsHudTemporarily();
  } else {
    if (fsHudTimer !== null) window.clearTimeout(fsHudTimer);
    fsHudEl.classList.add('hidden');
  }
}

// Pinch-to-Zoom & Pan on Video Stage
initVideoGestures({
  stageVideoWrap,
  videoEl,
  btnZoomReset,
  btnFullscreen,
  onSingleTap: () => {
    player.togglePlay();
    if (isStageFullscreen) {
      showFsHudTemporarily();
    }
  },
});

function syncModalScrollLock(): void {
  const anyOpen =
    !ytModal.classList.contains('hidden') ||
    !libraryModal.classList.contains('hidden') ||
    !guideModal.classList.contains('hidden') ||
    !shareModal.classList.contains('hidden');
  document.body.style.overflow = anyOpen ? 'hidden' : '';
}

async function openShareModal(): Promise<void> {
  if (!activeTrack) return;
  const isYt = activeTrack.mediaKind === 'youtube' && Boolean(activeTrack.youtubeId);
  shareYtSection.classList.toggle('hidden', !isYt);

  if (isYt) {
    shareLinkInput.value = await encodeShareUrl(activeTrack);
    shareSummaryChips.innerHTML = '';
    const chips: string[] = [
      'YouTube',
      `${activeTrack.settings.speed.toFixed(2)}x`,
      activeTrack.settings.pointA !== null && activeTrack.settings.pointB !== null
        ? `Loop ${formatTime(activeTrack.settings.pointA).slice(0, 5)} - ${formatTime(activeTrack.settings.pointB).slice(0, 5)}`
        : 'No A-B range',
      `${activeTrack.bookmarks.length} Bookmark${activeTrack.bookmarks.length === 1 ? '' : 's'}`,
    ];
    if (activeTrack.lyrics && activeTrack.lyrics.lines.length > 0) {
      chips.push(`Lyrics (${activeTrack.lyrics.lines.length} lines)`);
    }
    if (activeTrack.settings.countInEnabled) {
      chips.push(
        activeTrack.settings.countInMode === 'beats'
          ? `${activeTrack.settings.beatCount} Beats @ ${activeTrack.settings.bpm} BPM`
          : `Count-In ${activeTrack.settings.countInMode}`
      );
    }
    for (const label of chips) {
      const span = document.createElement('span');
      span.className = 'share-chip';
      span.textContent = label;
      shareSummaryChips.appendChild(span);
    }
    btnNativeShare.classList.toggle('hidden', typeof navigator.share !== 'function');
  }

  shareModal.classList.remove('hidden');
  syncModalScrollLock();
}

function closeShareModal(): void {
  shareModal.classList.add('hidden');
  syncModalScrollLock();
}

function openYtModal(): void {
  ytModal.classList.remove('hidden');
  syncModalScrollLock();
  ytUrlInput.focus();
}

function closeYtModal(): void {
  ytModal.classList.add('hidden');
  syncModalScrollLock();
  ytUrlInput.value = '';
  ytTitleInput.value = '';
}

function openLibraryModal(): void {
  libraryConfirmEl.classList.add('hidden');
  renderLibrary();
  libraryModal.classList.remove('hidden');
  syncModalScrollLock();
}

function closeLibraryModal(): void {
  libraryConfirmEl.classList.add('hidden');
  libraryModal.classList.add('hidden');
  syncModalScrollLock();
}

function openGuideModal(): void {
  guideModal.classList.remove('hidden');
  syncModalScrollLock();
}

function closeGuideModal(): void {
  guideModal.classList.add('hidden');
  syncModalScrollLock();
}

// Scrubber Pointer & Keyboard Interaction
let isScrubbing = false;
let scrubRafId: number | null = null;
let pendingScrubX: number | null = null;

function seekFromClientX(clientX: number): void {
  const snap = player.getSnapshot();
  const dur = snap.duration > 0 ? snap.duration : activeTrack?.duration ?? 0;
  if (dur <= 0) return;
  const rect = scrubberEl.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  player.seekTo(ratio * dur);
}

scrubberEl.addEventListener('pointerdown', (e) => {
  isScrubbing = true;
  scrubberEl.setPointerCapture(e.pointerId);
  seekFromClientX(e.clientX);
});

scrubberEl.addEventListener('pointermove', (e) => {
  if (!isScrubbing) return;
  pendingScrubX = e.clientX;
  if (scrubRafId === null) {
    scrubRafId = window.requestAnimationFrame(() => {
      scrubRafId = null;
      if (pendingScrubX !== null && isScrubbing) {
        seekFromClientX(pendingScrubX);
      }
    });
  }
});

scrubberEl.addEventListener('pointerup', (e) => {
  if (!isScrubbing) return;
  isScrubbing = false;
  if (scrubRafId !== null) {
    window.cancelAnimationFrame(scrubRafId);
    scrubRafId = null;
  }
  seekFromClientX(e.clientX);
  pendingScrubX = null;
  scrubberEl.releasePointerCapture(e.pointerId);
});

scrubberEl.addEventListener('pointercancel', () => {
  isScrubbing = false;
  if (scrubRafId !== null) {
    window.cancelAnimationFrame(scrubRafId);
    scrubRafId = null;
  }
  pendingScrubX = null;
});

scrubberEl.addEventListener('keydown', (e) => {
  const snap = player.getSnapshot();
  const dur = snap.duration > 0 ? snap.duration : activeTrack?.duration ?? 0;
  if (dur <= 0) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    player.seekBy(e.shiftKey ? -5 : -1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    player.seekBy(e.shiftKey ? 5 : 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    player.seekTo(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    player.seekTo(dur);
  }
});

function closeHeaderMenu(): void {
  headerMenuEl.classList.add('hidden');
  btnMenu.setAttribute('aria-expanded', 'false');
}

btnMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !headerMenuEl.classList.contains('hidden');
  headerMenuEl.classList.toggle('hidden', isOpen);
  btnMenu.setAttribute('aria-expanded', String(!isOpen));
});

document.addEventListener('click', (e) => {
  if (!headerMenuEl.classList.contains('hidden') && !headerMenuEl.contains(e.target as Node) && e.target !== btnMenu) {
    closeHeaderMenu();
  }
});

// Event Listeners
btnTheme.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
  closeHeaderMenu();
});

btnKeepCopy.addEventListener('click', () => {
  setKeepLocalCopy(!keepLocalCopy);
  showToast(
    keepLocalCopy
      ? 'Keep Local Copy: On (files cached offline)'
      : 'Keep Local Copy: Off (streaming with 0 MB cache)'
  );
});

btnChoiceStream.addEventListener('click', () => {
  const files = pendingChoiceFiles;
  const relink = pendingChoiceRelinkId;
  pendingChoiceFiles = null;
  pendingChoiceRelinkId = null;
  storageChoiceBannerEl.classList.add('hidden');
  closeLibraryModal();
  if (files) {
    void processImportedFiles(files, false, relink);
  }
});

btnChoiceCopy.addEventListener('click', () => {
  const files = pendingChoiceFiles;
  const relink = pendingChoiceRelinkId;
  pendingChoiceFiles = null;
  pendingChoiceRelinkId = null;
  storageChoiceBannerEl.classList.add('hidden');
  closeLibraryModal();
  if (files) {
    void processImportedFiles(files, true, relink);
  }
});

const triggerImport = () => {
  closeHeaderMenu();
  fileInput.click();
};
$('btn-import-empty').addEventListener('click', triggerImport);
$('btn-import-modal').addEventListener('click', triggerImport);
fileInput.addEventListener('change', () => {
  void handleFilesImported(fileInput.files);
});
fileInput.addEventListener('cancel', () => {
  pendingRelinkTrackId = null;
});

$('btn-yt-modal').addEventListener('click', () => {
  closeLibraryModal();
  openYtModal();
});
$('btn-yt-empty').addEventListener('click', openYtModal);
$('btn-close-yt').addEventListener('click', closeYtModal);
ytModal.addEventListener('click', (e) => {
  if (e.target === ytModal) closeYtModal();
});
btnYtPaste.addEventListener('click', () => {
  if (!navigator.clipboard?.readText) {
    showToast('Clipboard paste unavailable; paste directly into the field.');
    return;
  }
  void navigator.clipboard
    .readText()
    .then((text) => {
      ytUrlInput.value = text.trim();
    })
    .catch(() => showToast('Allow clipboard permission or paste directly.'));
});
ytForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void handleYouTubeImport(ytUrlInput.value, ytTitleInput.value);
});

btnFullscreen.addEventListener('click', () => {
  setStageFullscreen(!isStageFullscreen);
});

$('btn-library').addEventListener('click', openLibraryModal);
$('btn-close-library').addEventListener('click', closeLibraryModal);
libraryModal.addEventListener('click', (e) => {
  if (e.target === libraryModal) closeLibraryModal();
});

btnClearLibrary.addEventListener('click', () => {
  if (tracks.length === 0) return;
  libraryConfirmTextEl.textContent = `Remove all ${tracks.length} track${tracks.length === 1 ? '' : 's'} from ChoreoLoop? Your original files on this device are never touched.`;
  libraryConfirmEl.classList.remove('hidden');
});

$('btn-confirm-clear-cancel').addEventListener('click', () => {
  libraryConfirmEl.classList.add('hidden');
});

$('btn-confirm-clear-yes').addEventListener('click', () => {
  void (async () => {
    await clearAllTracks();
    sessionFiles.clear();
    activeTrack = null;
    trackTitleEl.textContent = 'No track loaded';
    player.unload();
    libraryConfirmEl.classList.add('hidden');
    await refreshTrackList();
    showToast('Library cleared');
  })();
});

$('btn-guide').addEventListener('click', () => {
  closeHeaderMenu();
  openGuideModal();
});
$('btn-close-guide').addEventListener('click', closeGuideModal);
guideModal.addEventListener('click', (e) => {
  if (e.target === guideModal) closeGuideModal();
});

const restartFromPointA = () => {
  const snap = player.getSnapshot();
  player.seekTo(snap.pointA ?? 0);
};

btnRestartA.addEventListener('click', restartFromPointA);
btnPlay.addEventListener('click', () => player.togglePlay());
btnBack5.addEventListener('click', () => player.seekBy(-5));
btnFwd5.addEventListener('click', () => player.seekBy(5));
btnCancelCountIn.addEventListener('click', () => player.cancelCountIn());
btnYtCancelCountIn.addEventListener('click', () => player.cancelCountIn());

btnFsRestartA.addEventListener('click', () => {
  restartFromPointA();
  showFsHudTemporarily();
});
btnFsBack5.addEventListener('click', () => {
  player.seekBy(-5);
  showFsHudTemporarily();
});
btnFsPlay.addEventListener('click', () => {
  player.togglePlay();
  showFsHudTemporarily();
});
btnFsLoop.addEventListener('click', () => {
  player.toggleLoop();
  showFsHudTemporarily();
});
btnFsExit.addEventListener('click', () => setStageFullscreen(false));

btnMirror.addEventListener('click', () => player.toggleMirror());

btnCountInToggle.addEventListener('click', () => {
  player.toggleCountIn();
});

for (const btn of countInButtons) {
  btn.addEventListener('click', () => {
    player.setCountInMode((btn.dataset.countin ?? '3s') as CountInMode);
  });
}

btnLoopCountIn.addEventListener('click', () => {
  player.toggleRepeatCountInOnLoop();
});

const tapTempo = createTapTempo();
let tapResetTimer: number | null = null;
btnTapBpm.addEventListener('click', () => {
  btnTapBpm.classList.add('is-tapping');
  if (tapResetTimer !== null) window.clearTimeout(tapResetTimer);
  tapResetTimer = window.setTimeout(() => {
    btnTapBpm.classList.remove('is-tapping');
  }, 220);

  const bpm = tapTempo.tap();
  if (bpm !== null) {
    player.setBpm(bpm);
  }
});

for (const btn of toneButtons) {
  btn.addEventListener('click', () => {
    player.setCountInTone((btn.dataset.tone ?? 'woodblock') as CountInTone);
  });
}

countInVolSlider.addEventListener('input', () => {
  player.setCountInVolume(Number(countInVolSlider.value));
});

bpmInput.addEventListener('change', () => {
  const val = Number(bpmInput.value);
  if (Number.isFinite(val)) player.setBpm(val);
});
btnBpmMinus.addEventListener('click', () => player.setBpm(player.getSnapshot().bpm - 5));
btnBpmPlus.addEventListener('click', () => player.setBpm(player.getSnapshot().bpm + 5));

beatCountInput.addEventListener('change', () => {
  const val = Number(beatCountInput.value);
  if (Number.isFinite(val)) player.setBeatCount(val);
});
btnBeatCountMinus.addEventListener('click', () => player.setBeatCount(player.getSnapshot().beatCount - 1));
btnBeatCountPlus.addEventListener('click', () => player.setBeatCount(player.getSnapshot().beatCount + 1));

for (const btn of stepButtons) {
  btn.addEventListener('click', () => {
    setNudgeStep(Number(btn.dataset.step));
  });
}

btnSetA.addEventListener('click', () => player.setPointA());
btnSetB.addEventListener('click', () => player.setPointB());
btnLoopToggle.addEventListener('click', () => player.toggleLoop());
btnClearAB.addEventListener('click', () => player.clearAB());

btnJumpA.addEventListener('click', () => {
  const a = player.getSnapshot().pointA;
  if (a !== null) player.seekTo(a);
});
btnJumpB.addEventListener('click', () => {
  const b = player.getSnapshot().pointB;
  if (b !== null) player.seekTo(b);
});

btnAMinus.addEventListener('click', () => player.nudgePointA(-nudgeStep));
btnAPlus.addEventListener('click', () => player.nudgePointA(nudgeStep));
btnBMinus.addEventListener('click', () => player.nudgePointB(-nudgeStep));
btnBPlus.addEventListener('click', () => player.nudgePointB(nudgeStep));

function toggleBookmarkForm(open: boolean): void {
  bookmarkForm.classList.toggle('hidden', !open);
  btnSaveBookmark.textContent = open ? 'Cancel' : '+ Save';
  if (open) {
    bookmarkNameInput.focus();
  } else {
    bookmarkNameInput.value = '';
  }
}

btnSaveBookmark.addEventListener('click', () => {
  const isOpen = !bookmarkForm.classList.contains('hidden');
  toggleBookmarkForm(!isOpen);
});

btnCancelBookmark.addEventListener('click', () => {
  toggleBookmarkForm(false);
});

for (const btn of bookmarkPresetButtons) {
  btn.addEventListener('click', () => {
    const label = btn.dataset.bmPreset;
    if (!label) return;
    void saveBookmark(label);
    toggleBookmarkForm(false);
  });
}

bookmarkForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const nextPartIndex = (activeTrack?.bookmarks.length ?? 0) + 1;
  const name = bookmarkNameInput.value.trim() || `Part ${nextPartIndex}`;
  void saveBookmark(name);
  toggleBookmarkForm(false);
});

btnSpeedMinus.addEventListener('click', () => player.stepSpeed(-1));
btnSpeedPlus.addEventListener('click', () => player.stepSpeed(1));

for (const btn of speedButtons) {
  btn.addEventListener('click', () => {
    player.setSpeed(Number(btn.dataset.speed));
  });
}

speedSlider.addEventListener('input', () => {
  player.setSpeed(Number(speedSlider.value));
});

const layoutOrder = initLayoutOrder(() => {
  btnReorderLayout.textContent = 'Reorder Panels';
  showToast('Panel order saved on this device.');
});

btnReorderLayout.addEventListener('click', () => {
  const editing = layoutOrder.toggleEditing();
  btnReorderLayout.textContent = editing ? 'Done Reordering' : 'Reorder Panels';
  closeHeaderMenu();
});

const lyricsController = createLyricsController({
  getActiveTrack: () => activeTrack,
  getCurrentTime: () => player.getSnapshot().currentTime,
  getLoopEnabled: () => player.getSnapshot().loopEnabled,
  getIsPlaying: () => player.getSnapshot().isPlaying,
  onSeek: (t) => player.seekTo(t),
  onPlayPause: () => player.togglePlay(),
  onRestartA: () => restartFromPointA(),
  onBack5: () => player.seekBy(-5),
  onToggleLoop: () => player.toggleLoop(),
  onSaveTrack: async (track) => {
    await updateTrackMeta(track);
    await refreshTrackList();
  },
  onToast: (msg) => showToast(msg),
});

btnShareOpen.addEventListener('click', () => {
  void openShareModal();
});
$<HTMLButtonElement>('btn-close-share').addEventListener('click', closeShareModal);
shareModal.addEventListener('click', (e) => {
  if (e.target === shareModal) closeShareModal();
});

btnCopyShare.addEventListener('click', async () => {
  const url = shareLinkInput.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Practice link copied to clipboard.');
  } catch {
    shareLinkInput.select();
    document.execCommand('copy');
    showToast('Practice link copied.');
  }
});

btnNativeShare.addEventListener('click', async () => {
  if (!navigator.share || !shareLinkInput.value) return;
  try {
    await navigator.share({
      title: activeTrack?.name ? `ChoreoLoop: ${activeTrack.name}` : 'ChoreoLoop Setup',
      url: shareLinkInput.value,
    });
  } catch {
    // User cancelled share sheet
  }
});

btnExportJson.addEventListener('click', () => {
  if (!activeTrack) return;
  exportTrackSetupJson(activeTrack);
  showToast('Setup exported as .choreoloop.json');
});

btnImportJson.addEventListener('click', () => {
  setupJsonInput.click();
});

setupJsonInput.addEventListener('change', async () => {
  const file = setupJsonInput.files?.[0];
  setupJsonInput.value = '';
  if (!file) return;
  const imported = parseTrackSetupJson(await file.text());
  if (!imported) {
    showToast('Invalid .choreoloop.json setup file.');
    return;
  }

  if (imported.youtubeId && (!activeTrack || activeTrack.mediaKind !== 'youtube')) {
    const meta = await saveYouTubeTrack(imported.youtubeId, imported.name);
    meta.settings = { ...meta.settings, ...imported.settings };
    meta.bookmarks = imported.bookmarks;
    if (imported.lyrics) meta.lyrics = imported.lyrics;
    await updateTrackMeta(meta);
    await refreshTrackList();
    await selectTrack(meta.id);
    closeShareModal();
    showToast('YouTube setup imported.');
    return;
  }

  if (!activeTrack) {
    showToast('Load a track first to apply a local setup.');
    return;
  }

  activeTrack.settings = { ...activeTrack.settings, ...imported.settings };
  activeTrack.bookmarks = imported.bookmarks;
  if (imported.lyrics) activeTrack.lyrics = imported.lyrics;
  await updateTrackMeta(activeTrack);
  await refreshTrackList();
  await selectTrack(activeTrack.id);
  closeShareModal();
  showToast('Setup applied to current track.');
});

// Keyboard shortcuts for desktop testing
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (lyricsController.isFullscreen()) {
      lyricsController.exitFullscreen();
      return;
    }
    if (layoutOrder.isEditing()) {
      layoutOrder.setEditing(false);
      btnReorderLayout.textContent = 'Reorder Panels';
      return;
    }
    if (!shareModal.classList.contains('hidden')) {
      closeShareModal();
      return;
    }
    if (!headerMenuEl.classList.contains('hidden')) {
      closeHeaderMenu();
      return;
    }
    if (!ytModal.classList.contains('hidden')) {
      closeYtModal();
      return;
    }
    if (!libraryModal.classList.contains('hidden')) {
      closeLibraryModal();
      return;
    }
    if (!guideModal.classList.contains('hidden')) {
      closeGuideModal();
      return;
    }
    if (isStageFullscreen) {
      setStageFullscreen(false);
      return;
    }
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    player.togglePlay();
  } else if (e.key === 'a' || e.key === 'A') {
    player.setPointA();
  } else if (e.key === 'b' || e.key === 'B') {
    player.setPointB();
  } else if (e.key === 'l' || e.key === 'L') {
    player.toggleLoop();
  } else if (e.key === 'm' || e.key === 'M') {
    player.toggleMirror();
  }
});

// Service Worker Registration (production builds only so Vite HMR stays clean)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Handle #share=... / #sharez=... practice setup links, ?yt=..., or Android PWA share_target
async function checkIncomingSharedLink(): Promise<boolean> {
  const shared = await decodeShareHash(window.location.hash);
  if (shared) {
    window.history.replaceState({}, '', window.location.pathname);
    const meta = await saveYouTubeTrack(shared.youtubeId, shared.name);
    meta.settings = { ...meta.settings, ...shared.settings };
    meta.bookmarks = shared.bookmarks;
    if (shared.lyrics) {
      meta.lyrics = shared.lyrics;
    }
    if (typeof shared.lyricsOffset === 'number' && meta.lyrics) {
      meta.lyrics.globalOffset = shared.lyricsOffset;
    }
    await updateTrackMeta(meta);
    await refreshTrackList();
    await selectTrack(meta.id);
    showToast('Shared practice setup loaded!');
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  const candidate = params.get('yt') || params.get('url') || params.get('text') || '';
  const sharedTitle = params.get('title') || undefined;
  const videoId = extractYouTubeId(candidate);
  if (!videoId) return false;

  window.history.replaceState({}, '', window.location.pathname);
  await handleYouTubeImport(videoId, sharedTitle);
  return true;
}

// Initialize App
async function init(): Promise<void> {
  initTheme();
  initNudgeStep();
  loadKeepLocalCopy();
  renderPlayerState(player.getSnapshot());
  if (navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => {});
  }
  await refreshTrackList();

  const handledShared = await checkIncomingSharedLink();
  if (handledShared) return;

  const lastId = getLastActiveTrackId();
  if (lastId && tracks.some((t) => t.id === lastId)) {
    await selectTrack(lastId, false);
  } else if (tracks.length > 0) {
    await selectTrack(tracks[0].id, false);
  }
}

void init();
