import { clamp } from '../utils';

export interface VideoGestureOptions {
  stageVideoWrap: HTMLDivElement;
  videoEl: HTMLVideoElement;
  btnZoomReset: HTMLButtonElement;
  btnFullscreen: HTMLButtonElement;
  onSingleTap: () => void;
}

export interface VideoGestureController {
  resetZoom(): void;
}

/**
 * Attaches pinch-to-zoom, pan, and single-tap play/pause gestures to the
 * local video stage, using pointer capture so releases outside the stage
 * never leave stale pointers stuck.
 */
export function initVideoGestures(options: VideoGestureOptions): VideoGestureController {
  const { stageVideoWrap, videoEl, btnZoomReset, btnFullscreen, onSingleTap } = options;

  let videoZoom = 1;
  let videoPanX = 0;
  let videoPanY = 0;

  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let gestureMoved = false;

  function applyTransform(isGesturing = false): void {
    videoEl.classList.toggle('is-gesturing', isGesturing);
    videoEl.style.setProperty('--zoom', String(videoZoom));
    videoEl.style.setProperty('--pan-x', `${videoPanX.toFixed(1)}px`);
    videoEl.style.setProperty('--pan-y', `${videoPanY.toFixed(1)}px`);
    const zoomed = videoZoom > 1.02;
    btnZoomReset.classList.toggle('hidden', !zoomed);
    if (zoomed) {
      btnZoomReset.textContent = `${videoZoom.toFixed(1)}x Reset`;
    }
  }

  function resetZoom(): void {
    videoZoom = 1;
    videoPanX = 0;
    videoPanY = 0;
    applyTransform(false);
  }

  function getPointerDistance(): number {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  }

  btnZoomReset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetZoom();
  });
  videoEl.addEventListener('loadedmetadata', resetZoom);

  stageVideoWrap.addEventListener('pointerdown', (e) => {
    if (e.target === btnZoomReset || e.target === btnFullscreen) return;
    try {
      stageVideoWrap.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported for this pointer type
    }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureMoved = false;
    if (activePointers.size === 1) {
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = videoPanX;
      panOriginY = videoPanY;
    } else if (activePointers.size === 2) {
      pinchStartDist = getPointerDistance();
      pinchStartZoom = videoZoom;
    }
  });

  stageVideoWrap.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2 && pinchStartDist > 10) {
      gestureMoved = true;
      const dist = getPointerDistance();
      videoZoom = clamp(pinchStartZoom * (dist / pinchStartDist), 1, 3);
      if (videoZoom <= 1.02) {
        videoZoom = 1;
        videoPanX = 0;
        videoPanY = 0;
      }
      applyTransform(true);
    } else if (activePointers.size === 1 && videoZoom > 1.02) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.hypot(dx, dy) > 4) gestureMoved = true;
      const maxPanX = (stageVideoWrap.clientWidth * (videoZoom - 1)) / 2;
      const maxPanY = (stageVideoWrap.clientHeight * (videoZoom - 1)) / 2;
      videoPanX = clamp(panOriginX + dx, -maxPanX, maxPanX);
      videoPanY = clamp(panOriginY + dy, -maxPanY, maxPanY);
      applyTransform(true);
    }
  });

  const handlePointerEnd = (e: PointerEvent) => {
    const wasSingleTap = activePointers.size === 1 && !gestureMoved;
    activePointers.delete(e.pointerId);
    if (stageVideoWrap.hasPointerCapture?.(e.pointerId)) {
      try {
        stageVideoWrap.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore already-released pointer
      }
    }
    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      panStartX = remaining.x;
      panStartY = remaining.y;
      panOriginX = videoPanX;
      panOriginY = videoPanY;
    }
    applyTransform(false);

    if (wasSingleTap && e.target === videoEl) {
      onSingleTap();
    }
  };

  stageVideoWrap.addEventListener('pointerup', handlePointerEnd);
  stageVideoWrap.addEventListener('pointercancel', (e) => {
    activePointers.delete(e.pointerId);
    applyTransform(false);
  });

  return { resetZoom };
}
