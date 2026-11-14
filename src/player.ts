import type { MediaKind } from './types';
import { clamp, playCountInTone } from './utils';

export interface PlayerStateSnapshot {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  mirror: boolean;
  countInSeconds: number;
  countInRemaining: number | null;
  pointA: number | null;
  pointB: number | null;
  loopEnabled: boolean;
  mediaKind: MediaKind | null;
}

export interface PlayerCallbacks {
  onStateChange: (snapshot: PlayerStateSnapshot) => void;
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onSettingsChanged: () => void;
  onError: (message: string) => void;
}

export class ChoreoPlayer {
  private videoEl: HTMLVideoElement;
  private audioEl: HTMLAudioElement;
  private callbacks: PlayerCallbacks;

  private activeKind: MediaKind | null = null;
  private objectUrl: string | null = null;
  private rafId: number | null = null;
  private countInTimerId: number | null = null;

  private speed = 1.0;
  private mirror = false;
  private countInSeconds = 0;
  private countInRemaining: number | null = null;
  private pointA: number | null = null;
  private pointB: number | null = null;
  private loopEnabled = false;

  constructor(
    videoEl: HTMLVideoElement,
    audioEl: HTMLAudioElement,
    callbacks: PlayerCallbacks
  ) {
    this.videoEl = videoEl;
    this.audioEl = audioEl;
    this.callbacks = callbacks;

    this.bindMediaEvents(this.videoEl);
    this.bindMediaEvents(this.audioEl);
  }

  private get activeMedia(): HTMLMediaElement | null {
    if (this.activeKind === 'video') return this.videoEl;
    if (this.activeKind === 'audio') return this.audioEl;
    return null;
  }

  private bindMediaEvents(el: HTMLMediaElement): void {
    el.addEventListener('play', () => {
      if (el !== this.activeMedia) return;
      this.startLoopMonitor();
      this.emitState();
    });

    el.addEventListener('pause', () => {
      if (el !== this.activeMedia) return;
      this.stopLoopMonitor();
      this.emitState();
    });

    el.addEventListener('ended', () => {
      if (el !== this.activeMedia) return;
      if (this.loopEnabled && this.pointA !== null) {
        el.currentTime = this.pointA;
        void el.play();
        return;
      }
      this.stopLoopMonitor();
      this.emitState();
    });

    el.addEventListener('loadedmetadata', () => {
      if (el !== this.activeMedia) return;
      this.applyPlaybackRate(el);
      this.emitTime();
      this.emitState();
    });

    el.addEventListener('timeupdate', () => {
      if (el !== this.activeMedia) return;
      this.checkABLoop(el);
      this.emitTime();
    });

    el.addEventListener('error', () => {
      if (el !== this.activeMedia) return;
      this.stopLoopMonitor();
      this.callbacks.onError('Unable to play this media file on this browser.');
      this.emitState();
    });
  }

  public loadMedia(
    blob: Blob,
    kind: MediaKind,
    settings: {
      speed: number;
      mirror: boolean;
      countInSeconds: number;
      pointA: number | null;
      pointB: number | null;
      loopEnabled: boolean;
    }
  ): void {
    this.cancelCountIn();
    this.stopCurrentMedia();

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    this.activeKind = kind;
    this.speed = clamp(settings.speed, 0.25, 1.25);
    this.mirror = settings.mirror;
    this.countInSeconds = settings.countInSeconds;
    this.pointA = settings.pointA;
    this.pointB = settings.pointB;
    this.loopEnabled = settings.loopEnabled;

    this.objectUrl = URL.createObjectURL(blob);
    const target = kind === 'video' ? this.videoEl : this.audioEl;
    const other = kind === 'video' ? this.audioEl : this.videoEl;

    other.removeAttribute('src');
    other.load();

    target.src = this.objectUrl;
    this.applyPlaybackRate(target);
    this.applyMirror();
    target.load();
    this.emitState();
  }

  public unload(): void {
    this.cancelCountIn();
    this.stopCurrentMedia();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.activeKind = null;
    this.pointA = null;
    this.pointB = null;
    this.loopEnabled = false;
    this.emitState();
  }

  private stopCurrentMedia(): void {
    this.stopLoopMonitor();
    this.videoEl.pause();
    this.audioEl.pause();
  }

  public togglePlay(): void {
    const media = this.activeMedia;
    if (!media) return;

    if (this.countInRemaining !== null) {
      this.cancelCountIn();
      return;
    }

    if (!media.paused) {
      media.pause();
      return;
    }

    if (this.countInSeconds > 0) {
      this.startCountIn(media);
    } else {
      this.startPlayback(media);
    }
  }

  private startPlayback(media: HTMLMediaElement): void {
    if (
      this.loopEnabled &&
      this.pointA !== null &&
      this.pointB !== null &&
      this.pointB > this.pointA &&
      (media.currentTime < this.pointA || media.currentTime >= this.pointB)
    ) {
      media.currentTime = this.pointA;
    }
    this.applyPlaybackRate(media);
    void media.play().catch(() => {
      this.callbacks.onError('Tap Play again to start playback.');
    });
  }

  private startCountIn(media: HTMLMediaElement): void {
    // Unlock media element on iOS Safari within the user gesture
    const wasMuted = media.muted;
    media.muted = true;
    void media
      .play()
      .then(() => {
        media.pause();
        media.muted = wasMuted;
      })
      .catch(() => {
        media.muted = wasMuted;
      });

    let remaining = this.countInSeconds;
    this.countInRemaining = remaining;
    playCountInTone(false);
    this.emitState();

    this.countInTimerId = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.clearCountInTimer();
        this.countInRemaining = null;
        playCountInTone(true);
        this.emitState();
        this.startPlayback(media);
      } else {
        this.countInRemaining = remaining;
        playCountInTone(false);
        this.emitState();
      }
    }, 1000);
  }

  public cancelCountIn(): void {
    if (this.countInRemaining === null && this.countInTimerId === null) return;
    this.clearCountInTimer();
    this.countInRemaining = null;
    this.emitState();
  }

  private clearCountInTimer(): void {
    if (this.countInTimerId !== null) {
      window.clearInterval(this.countInTimerId);
      this.countInTimerId = null;
    }
  }

  public seekTo(seconds: number): void {
    const media = this.activeMedia;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    media.currentTime = clamp(seconds, 0, media.duration);
    this.emitTime();
  }

  public seekBy(deltaSeconds: number): void {
    const media = this.activeMedia;
    if (!media) return;
    this.seekTo(media.currentTime + deltaSeconds);
  }

  public setSpeed(newSpeed: number): void {
    this.speed = clamp(Math.round(newSpeed * 100) / 100, 0.25, 1.25);
    const media = this.activeMedia;
    if (media) {
      this.applyPlaybackRate(media);
    }
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  private applyPlaybackRate(media: HTMLMediaElement): void {
    media.playbackRate = this.speed;
    if ('preservesPitch' in media) {
      media.preservesPitch = true;
    }
    const webkitMedia = media as unknown as { webkitPreservesPitch?: boolean };
    if ('webkitPreservesPitch' in webkitMedia) {
      webkitMedia.webkitPreservesPitch = true;
    }
  }

  public toggleMirror(): void {
    this.mirror = !this.mirror;
    this.applyMirror();
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  private applyMirror(): void {
    this.videoEl.classList.toggle('is-mirrored', this.mirror);
  }

  public setCountIn(seconds: number): void {
    this.countInSeconds = seconds;
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setPointA(): void {
    const media = this.activeMedia;
    if (!media) return;
    const t = media.currentTime;
    this.pointA = t;
    if (this.pointB !== null && this.pointB <= this.pointA + 0.1) {
      this.pointB = null;
      this.loopEnabled = false;
    } else if (this.pointB !== null) {
      this.loopEnabled = true;
    }
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setPointB(): void {
    const media = this.activeMedia;
    if (!media) return;
    const t = media.currentTime;
    if (this.pointA === null) {
      this.pointA = 0;
    }
    if (t <= this.pointA + 0.1) {
      this.pointB = clamp(this.pointA + 0.5, 0, media.duration || this.pointA + 0.5);
    } else {
      this.pointB = t;
    }
    this.loopEnabled = true;
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public nudgePointA(delta: number): void {
    const media = this.activeMedia;
    if (!media || this.pointA === null) return;
    const maxA = this.pointB !== null ? this.pointB - 0.1 : media.duration || this.pointA + 10;
    this.pointA = clamp(this.pointA + delta, 0, Math.max(0, maxA));
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public nudgePointB(delta: number): void {
    const media = this.activeMedia;
    if (!media || this.pointB === null) return;
    const minB = this.pointA !== null ? this.pointA + 0.1 : 0.1;
    const maxB = media.duration || this.pointB + 10;
    this.pointB = clamp(this.pointB + delta, minB, maxB);
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public toggleLoop(): void {
    if (this.pointA === null || this.pointB === null || this.pointB <= this.pointA) {
      return;
    }
    this.loopEnabled = !this.loopEnabled;
    const media = this.activeMedia;
    if (this.loopEnabled && media) {
      if (media.currentTime < this.pointA || media.currentTime >= this.pointB) {
        media.currentTime = this.pointA;
      }
    }
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public clearAB(): void {
    this.pointA = null;
    this.pointB = null;
    this.loopEnabled = false;
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public applyBookmark(start: number, end: number): void {
    const media = this.activeMedia;
    this.pointA = start;
    this.pointB = end;
    this.loopEnabled = true;
    if (media) {
      media.currentTime = start;
    }
    this.emitTime();
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  private checkABLoop(media: HTMLMediaElement): void {
    if (
      !this.loopEnabled ||
      this.pointA === null ||
      this.pointB === null ||
      this.pointB <= this.pointA
    ) {
      return;
    }
    if (media.currentTime >= this.pointB) {
      media.currentTime = this.pointA;
    }
  }

  private startLoopMonitor(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      const media = this.activeMedia;
      if (!media || media.paused) {
        this.rafId = null;
        return;
      }
      this.checkABLoop(media);
      this.emitTime();
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopLoopMonitor(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public getSnapshot(): PlayerStateSnapshot {
    const media = this.activeMedia;
    const duration = media && Number.isFinite(media.duration) ? media.duration : 0;
    const currentTime = media ? media.currentTime : 0;
    return {
      isPlaying: Boolean(media && !media.paused),
      currentTime,
      duration,
      speed: this.speed,
      mirror: this.mirror,
      countInSeconds: this.countInSeconds,
      countInRemaining: this.countInRemaining,
      pointA: this.pointA,
      pointB: this.pointB,
      loopEnabled: this.loopEnabled,
      mediaKind: this.activeKind,
    };
  }

  private emitTime(): void {
    const media = this.activeMedia;
    if (!media) return;
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    this.callbacks.onTimeUpdate(media.currentTime, duration);
  }

  private emitState(): void {
    this.callbacks.onStateChange(this.getSnapshot());
  }
}
