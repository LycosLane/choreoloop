import './style.css';
import {
  deleteTrack,
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
import type { CountInMode, LoopBookmark, TrackMetadata } from './types';
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
const audioDiscEl = $<HTMLDivElement>('audio-disc');
const audioTrackNameEl = $<HTMLSpanElement>('audio-track-name');
const audioLoopStatusEl = $<HTMLSpanElement>('audio-loop-status');

const countInOverlay = $<HTMLDivElement>('countin-overlay');
const countInLabelEl = $<HTMLSpanElement>('countin-label');
const countInNumberEl = $<HTMLSpanElement>('countin-number');
const btnCancelCountIn = $<HTMLButtonElement>('btn-cancel-countin');

const timeCurrentEl = $<HTMLSpanElement>('time-current');
const timeDurationEl = $<HTMLSpanElement>('time-duration');
const loopSpanReadoutEl = $<HTMLSpanElement>('loop-span-readout');

const scrubberEl = $<HTMLDivElement>('scrubber');
const scrubberProgressEl = $<HTMLDivElement>('scrubber-progress');
const scrubberThumbEl = $<HTMLDivElement>('scrubber-thumb');
const scrubberAbRangeEl = $<HTMLDivElement>('scrubber-ab-range');
const markerAEl = $<HTMLDivElement>('marker-a');
const markerBEl = $<HTMLDivElement>('marker-b');

const btnBack5 = $<HTMLButtonElement>('btn-back-5');
const btnPlay = $<HTMLButtonElement>('btn-play');
const playIconEl = $<HTMLSpanElement>('play-icon');
const btnFwd5 = $<HTMLButtonElement>('btn-fwd-5');

const btnMirror = $<HTMLButtonElement>('btn-mirror');
const countInButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-countin]'));
const bpmRowEl = $<HTMLDivElement>('bpm-row');
const bpmInput = $<HTMLInputElement>('bpm-input');
const btnBpmMinus = $<HTMLButtonElement>('btn-bpm-minus');
const btnBpmPlus = $<HTMLButtonElement>('btn-bpm-plus');
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
const bookmarksListEl = $<HTMLDivElement>('bookmarks-list');

const speedReadoutEl = $<HTMLSpanElement>('speed-readout');
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

const libraryModal = $<HTMLDivElement>('library-modal');
const libraryListEl = $<HTMLDivElement>('library-list');
const toastEl = $<HTMLDivElement>('toast');

const btnTheme = $<HTMLButtonElement>('btn-theme');
const btnMenu = $<HTMLButtonElement>('btn-menu');
const headerMenuEl = $<HTMLDivElement>('header-menu');
const faviconLinkEl = document.getElementById('favicon-link') as HTMLLinkElement | null;
const manifestLinkEl = document.getElementById('manifest-link') as HTMLLinkElement | null;
const appleTouchIconEl = document.getElementById('apple-touch-icon') as HTMLLinkElement | null;
const themeColorMetaEl = document.getElementById('theme-color-meta') as HTMLMetaElement | null;

const THEME_KEY = 'choreoloop:theme';
const NUDGE_STEP_KEY = 'choreoloop:nudgeStep';
type AppTheme = 'dark' | 'light';

// App State
let tracks: TrackMetadata[] = [];
let activeTrack: TrackMetadata | null = null;
let toastTimer: number | null = null;
let saveDebounceTimer: number | null = null;
let nudgeStep = 0.1;
let isStageFullscreen = false;

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
    btn.classList.toggle('is-active', Number(btn.dataset.step) === step);
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
    countInMode: snap.countInMode,
    bpm: snap.bpm,
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

  // Count-In overlay (only over local stage; YouTube uses native player without overlays)
  if (snap.countInRemaining !== null) {
    countInOverlay.classList.remove('hidden');
    const isBeats = snap.countInMode === '4beats' || snap.countInMode === '8beats';
    countInLabelEl.textContent = isBeats ? `BEAT COUNT (${Math.round(snap.bpm * snap.speed)} BPM)` : 'GET READY';
    countInNumberEl.textContent = String(snap.countInRemaining);
  } else {
    countInOverlay.classList.add('hidden');
  }

  // Play/Pause button
  playIconEl.innerHTML = snap.isPlaying ? '&#10074;&#10074;' : '&#9654;';
  btnPlay.disabled = !hasMedia;
  btnBack5.disabled = !hasMedia;
  btnFwd5.disabled = !hasMedia;

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
  btnMirror.textContent = isYouTube ? 'Mirror: Local Only' : snap.mirror ? 'Mirror: On' : 'Mirror: Off';
  mirrorBadgeEl.classList.toggle('hidden', !snap.mirror || !isLocalVideo);
  ytMirrorNoteEl.classList.toggle('hidden', !isYouTube);
  ytSpeedNoteEl.classList.toggle('hidden', !isYouTube);

  // Count-in chips & BPM row
  for (const btn of countInButtons) {
    btn.classList.toggle('is-active', btn.dataset.countin === snap.countInMode);
  }
  const showBpm = snap.countInMode === '4beats' || snap.countInMode === '8beats';
  bpmRowEl.classList.toggle('hidden', !showBpm);
  if (document.activeElement !== bpmInput) {
    bpmInput.value = String(snap.bpm);
  }
  const effectiveBpm = Math.round(snap.bpm * snap.speed);
  bpmEffectiveEl.textContent =
    Math.abs(snap.speed - 1.0) < 0.01 ? `${snap.bpm} BPM` : `${effectiveBpm} eff. BPM`;

  // A-B Loop buttons
  const hasA = snap.pointA !== null;
  const hasB = snap.pointB !== null;
  const hasValidRange = hasA && hasB && (snap.pointB as number) > (snap.pointA as number);

  btnSetA.disabled = !hasMedia;
  btnSetB.disabled = !hasMedia;
  btnSetA.classList.toggle('is-set', hasA);
  btnSetB.classList.toggle('is-set', hasB);

  btnLoopToggle.disabled = !hasValidRange;
  btnLoopToggle.classList.toggle('is-active', snap.loopEnabled && hasValidRange);
  btnLoopToggle.setAttribute('aria-pressed', String(snap.loopEnabled && hasValidRange));
  btnLoopToggle.textContent = snap.loopEnabled && hasValidRange ? 'Loop On' : 'Loop Off';

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
  speedSlider.value = String(snap.speed);
  for (const btn of speedButtons) {
    const preset = Number(btn.dataset.speed);
    btn.classList.toggle('is-active', Math.abs(preset - snap.speed) < 0.01);
  }

  renderTimeline(snap.currentTime, snap.duration);
  renderBookmarks();
}

function renderTimeline(currentTime: number, duration: number): void {
  const snap = player.getSnapshot();
  const dur = duration > 0 ? duration : activeTrack?.duration ?? 0;

  timeCurrentEl.textContent = formatTime(currentTime);
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
    selectBtn.innerHTML = `<span>${escapeHtml(bm.name)}</span><span class="bookmark-range">${formatTime(bm.start, false)}-${formatTime(bm.end, false)}</span>`;
    selectBtn.addEventListener('click', () => {
      player.applyBookmark(bm.start, bm.end);
      showToast(`Loaded "${bm.name}"`);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'bookmark-delete';
    delBtn.setAttribute('aria-label', `Delete ${bm.name}`);
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', () => {
      void removeBookmark(bm.id);
    });

    chip.appendChild(selectBtn);
    chip.appendChild(delBtn);
    bookmarksListEl.appendChild(chip);
  }
}

function renderLibrary(): void {
  libraryCountEl.textContent = String(tracks.length);
  libraryListEl.innerHTML = '';

  if (tracks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'No tracks yet. Tap "+ File" or "+ YT" to add audio, video, or YouTube.';
    libraryListEl.appendChild(empty);
    return;
  }

  for (const track of tracks) {
    const row = document.createElement('div');
    row.className = `library-item${activeTrack?.id === track.id ? ' is-active' : ''}`;

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'library-item-main';
    const kindLabel =
      track.mediaKind === 'youtube' ? 'YOUTUBE' : track.mediaKind === 'video' ? 'VIDEO' : 'AUDIO';
    const durLabel = track.duration > 0 ? formatTime(track.duration, false) : '--:--';
    const sizeOrNet = track.mediaKind === 'youtube' ? 'Online' : formatBytes(track.size);
    const bmCount = track.bookmarks.length;
    mainBtn.innerHTML = `
      <span class="library-item-title">${escapeHtml(track.name)}</span>
      <span class="library-item-meta">${kindLabel} · ${durLabel} · ${sizeOrNet} · ${bmCount} loop${bmCount === 1 ? '' : 's'}</span>
    `;
    mainBtn.addEventListener('click', () => {
      void selectTrack(track.id);
      closeLibraryModal();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'library-item-delete';
    delBtn.setAttribute('aria-label', `Remove ${track.name} from ChoreoLoop library`);
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => {
      void handleDeleteTrack(track.id);
    });

    row.appendChild(mainBtn);
    row.appendChild(delBtn);
    libraryListEl.appendChild(row);
  }
}

async function refreshTrackList(): Promise<void> {
  tracks = await listTracks();
  renderLibrary();
}

async function selectTrack(id: string): Promise<void> {
  const meta = await getTrackMeta(id);
  if (!meta) {
    showToast('Track metadata not found.');
    return;
  }

  activeTrack = meta;
  setLastActiveTrackId(meta.id);
  trackTitleEl.textContent = meta.name;
  audioTrackNameEl.textContent = meta.name;

  if (meta.mediaKind === 'youtube' && meta.youtubeId) {
    await player.loadYouTube(meta.youtubeId, meta.settings);
    renderLibrary();
    return;
  }

  const blob = await getTrackMedia(id);
  if (!blob) {
    showToast('Track media data not found in local storage.');
    return;
  }

  player.loadMedia(blob, meta.mediaKind === 'video' ? 'video' : 'audio', meta.settings);
  renderLibrary();
}

async function handleFilesImported(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;

  let lastImported: TrackMetadata | null = null;
  for (const file of Array.from(files)) {
    try {
      showToast(`Importing ${file.name}...`);
      lastImported = await saveImportedFile(file);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : `Failed to import ${file.name}`;
      showToast(msg, 5500);
    }
  }

  await refreshTrackList();
  if (lastImported) {
    await selectTrack(lastImported.id);
    showToast(`Ready: ${lastImported.name}`);
  }
  fileInput.value = '';
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
  if (activeTrack?.id === id) {
    activeTrack = null;
    trackTitleEl.textContent = 'No track loaded';
    player.unload();
  }
  await refreshTrackList();
  if (!activeTrack && tracks.length > 0) {
    await selectTrack(tracks[0].id);
  }
  showToast('Track deleted');
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

function setStageFullscreen(active: boolean): void {
  isStageFullscreen = active;
  stageCardEl.classList.toggle('is-fullscreen', active);
  btnFullscreen.textContent = active ? 'Exit' : 'Fullscreen';
}

function openYtModal(): void {
  ytModal.classList.remove('hidden');
  ytUrlInput.focus();
}

function closeYtModal(): void {
  ytModal.classList.add('hidden');
  ytUrlInput.value = '';
  ytTitleInput.value = '';
}

function openLibraryModal(): void {
  renderLibrary();
  libraryModal.classList.remove('hidden');
}

function closeLibraryModal(): void {
  libraryModal.classList.add('hidden');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Scrubber Pointer Interaction
let isScrubbing = false;

function seekFromClientX(clientX: number): void {
  const snap = player.getSnapshot();
  const dur = snap.duration > 0 ? snap.duration : activeTrack?.duration ?? 0;
  if (dur <= 0) return;
  const rect = scrubberEl.getBoundingClientRect();
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
  seekFromClientX(e.clientX);
});

scrubberEl.addEventListener('pointerup', (e) => {
  if (!isScrubbing) return;
  isScrubbing = false;
  scrubberEl.releasePointerCapture(e.pointerId);
});

scrubberEl.addEventListener('pointercancel', () => {
  isScrubbing = false;
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

const triggerImport = () => {
  closeHeaderMenu();
  fileInput.click();
};
$('btn-import-top').addEventListener('click', triggerImport);
$('btn-import-empty').addEventListener('click', triggerImport);
$('btn-import-modal').addEventListener('click', triggerImport);
fileInput.addEventListener('change', () => {
  void handleFilesImported(fileInput.files);
});

$('btn-yt-top').addEventListener('click', () => {
  closeHeaderMenu();
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

$('btn-guide').addEventListener('click', () => {
  closeHeaderMenu();
  guideModal.classList.remove('hidden');
});
$('btn-close-guide').addEventListener('click', () => guideModal.classList.add('hidden'));
guideModal.addEventListener('click', (e) => {
  if (e.target === guideModal) guideModal.classList.add('hidden');
});

btnPlay.addEventListener('click', () => player.togglePlay());
btnBack5.addEventListener('click', () => player.seekBy(-5));
btnFwd5.addEventListener('click', () => player.seekBy(5));
btnCancelCountIn.addEventListener('click', () => player.cancelCountIn());

btnMirror.addEventListener('click', () => player.toggleMirror());

for (const btn of countInButtons) {
  btn.addEventListener('click', () => {
    player.setCountInMode((btn.dataset.countin ?? 'off') as CountInMode);
  });
}

bpmInput.addEventListener('change', () => {
  const val = Number(bpmInput.value);
  if (Number.isFinite(val)) player.setBpm(val);
});
btnBpmMinus.addEventListener('click', () => player.setBpm(player.getSnapshot().bpm - 5));
btnBpmPlus.addEventListener('click', () => player.setBpm(player.getSnapshot().bpm + 5));

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

btnSaveBookmark.addEventListener('click', () => {
  bookmarkForm.classList.remove('hidden');
  bookmarkNameInput.focus();
});

btnCancelBookmark.addEventListener('click', () => {
  bookmarkForm.classList.add('hidden');
  bookmarkNameInput.value = '';
});

bookmarkForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = bookmarkNameInput.value.trim();
  if (!name) return;
  void saveBookmark(name);
  bookmarkNameInput.value = '';
  bookmarkForm.classList.add('hidden');
});

for (const btn of speedButtons) {
  btn.addEventListener('click', () => {
    player.setSpeed(Number(btn.dataset.speed));
  });
}

speedSlider.addEventListener('input', () => {
  player.setSpeed(Number(speedSlider.value));
});

// Keyboard shortcuts for desktop testing
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Escape' && isStageFullscreen) {
    setStageFullscreen(false);
  } else if (e.code === 'Space') {
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

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Handle ?yt=... or Android PWA share_target (?url=... / ?text=...)
async function checkIncomingSharedLink(): Promise<boolean> {
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
  renderPlayerState(player.getSnapshot());
  if (navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => {});
  }
  await refreshTrackList();

  const handledShared = await checkIncomingSharedLink();
  if (handledShared) return;

  const lastId = getLastActiveTrackId();
  if (lastId && tracks.some((t) => t.id === lastId)) {
    await selectTrack(lastId);
  } else if (tracks.length > 0) {
    await selectTrack(tracks[0].id);
  }
}

void init();
