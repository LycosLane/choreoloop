import type { TrackMetadata } from '../types';
import { formatBytes, formatTime } from '../utils';

export interface LibraryRenderParams {
  tracks: TrackMetadata[];
  activeTrackId: string | null;
  sessionFiles: Map<string, File>;
  libraryCountEl: HTMLElement;
  libraryListEl: HTMLElement;
  libraryStorageEl: HTMLElement;
  libraryConfirmEl: HTMLElement;
  btnClearLibrary: HTMLButtonElement;
  onSelectTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
}

let storageReadoutSeq = 0;

async function updateStorageReadout(
  tracks: TrackMetadata[],
  libraryStorageEl: HTMLElement
): Promise<void> {
  const seq = ++storageReadoutSeq;
  const cachedBytes = tracks
    .filter((t) => t.mediaKind !== 'youtube' && t.hasOfflineCopy !== false)
    .reduce((sum, t) => sum + (t.size || 0), 0);
  const streamCount = tracks.filter(
    (t) => t.mediaKind !== 'youtube' && t.hasOfflineCopy === false
  ).length;

  let quotaPart = '';
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (seq !== storageReadoutSeq) return;
      if (typeof est.quota === 'number' && est.quota > 0) {
        quotaPart = ` of ${formatBytes(est.quota)} quota`;
      }
    }
  } catch {
    // Ignore storage estimate errors
  }

  if (seq !== storageReadoutSeq) return;
  const streamPart = streamCount > 0 ? ` · ${streamCount} stream-only` : '';
  libraryStorageEl.textContent = `Offline cache: ${formatBytes(cachedBytes)}${quotaPart}${streamPart}`;
}

/**
 * Renders the saved track library list and updates the offline storage readout.
 */
export function renderLibraryDrawer(params: LibraryRenderParams): void {
  const {
    tracks,
    activeTrackId,
    sessionFiles,
    libraryCountEl,
    libraryListEl,
    libraryStorageEl,
    libraryConfirmEl,
    btnClearLibrary,
    onSelectTrack,
    onDeleteTrack,
  } = params;

  libraryCountEl.textContent = String(tracks.length);
  btnClearLibrary.disabled = tracks.length === 0;
  if (tracks.length === 0) {
    libraryConfirmEl.classList.add('hidden');
  }
  void updateStorageReadout(tracks, libraryStorageEl);
  libraryListEl.innerHTML = '';

  if (tracks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent =
      'No tracks yet. Tap "+ File" or "+ YouTube" to add audio, video, or YouTube.';
    libraryListEl.appendChild(empty);
    return;
  }

  for (const track of tracks) {
    const row = document.createElement('div');
    row.className = `library-item${activeTrackId === track.id ? ' is-active' : ''}`;

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'library-item-main';
    const kindLabel =
      track.mediaKind === 'youtube' ? 'YOUTUBE' : track.mediaKind === 'video' ? 'VIDEO' : 'AUDIO';
    const durLabel = track.duration > 0 ? formatTime(track.duration, false) : '--:--';
    let sizeOrNet = 'Online';
    if (track.mediaKind !== 'youtube') {
      if (track.hasOfflineCopy === false) {
        const isLoaded = sessionFiles.has(track.id);
        sizeOrNet = `${formatBytes(track.size)} · ${isLoaded ? 'Stream' : 'Re-select file'}`;
      } else {
        sizeOrNet = formatBytes(track.size);
      }
    }
    const bmCount = track.bookmarks.length;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'library-item-title';
    titleSpan.textContent = track.name;
    const metaSpan = document.createElement('span');
    metaSpan.className = 'library-item-meta';
    metaSpan.textContent = `${kindLabel} · ${durLabel} · ${sizeOrNet} · ${bmCount} loop${bmCount === 1 ? '' : 's'}`;
    mainBtn.append(titleSpan, metaSpan);
    mainBtn.addEventListener('click', () => onSelectTrack(track.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'library-item-delete';
    delBtn.setAttribute('aria-label', `Remove ${track.name} from ChoreoLoop library`);
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => onDeleteTrack(track.id));

    row.appendChild(mainBtn);
    row.appendChild(delBtn);
    libraryListEl.appendChild(row);
  }
}
