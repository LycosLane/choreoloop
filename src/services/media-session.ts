import type { PlayerStateSnapshot } from '../player';
import { clamp } from '../utils';

export interface MediaSessionCallbacks {
  onTogglePlay: () => void;
  onSeekBy: (deltaSeconds: number) => void;
  onRestartA: () => void;
}

export interface MediaSessionSync {
  sync(snap: PlayerStateSnapshot, trackTitle: string | null): void;
}

/**
 * Syncs ChoreoLoop playback state and hardware media controls (Bluetooth
 * headphones, smartwatches, remotes) via the browser MediaSession API.
 */
export function createMediaSessionSync(callbacks: MediaSessionCallbacks): MediaSessionSync {
  let bound = false;

  return {
    sync(snap: PlayerStateSnapshot, trackTitle: string | null): void {
      if (!('mediaSession' in navigator)) return;

      if (!bound) {
        bound = true;
        const ms = navigator.mediaSession;
        try {
          ms.setActionHandler('play', callbacks.onTogglePlay);
          ms.setActionHandler('pause', callbacks.onTogglePlay);
          ms.setActionHandler('seekbackward', () => callbacks.onSeekBy(-5));
          ms.setActionHandler('seekforward', () => callbacks.onSeekBy(5));
          ms.setActionHandler('previoustrack', callbacks.onRestartA);
        } catch {
          // Ignore unsupported actions on older browsers
        }
      }

      if (trackTitle) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: trackTitle,
          artist: 'ChoreoLoop',
        });
      }

      navigator.mediaSession.playbackState = snap.isPlaying
        ? 'playing'
        : snap.mediaKind
          ? 'paused'
          : 'none';

      if (snap.duration > 0 && navigator.mediaSession.setPositionState) {
        try {
          navigator.mediaSession.setPositionState({
            duration: snap.duration,
            playbackRate: snap.speed,
            position: clamp(snap.currentTime, 0, snap.duration),
          });
        } catch {
          // Ignore invalid position state transitions
        }
      }
    },
  };
}
