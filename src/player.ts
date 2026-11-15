import type { CountInMode, CountInTone, MediaKind, TrackSettings } from './types';
import { clamp, playCountInTone } from './utils';
import { loadYouTubeAPI, type YTPlayerInstance } from './youtube';

export interface PlayerStateSnapshot {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  mirror: boolean;
  countInEnabled: boolean;
  countInMode: CountInMode;
  repeatCountInOnLoop: boolean;
  bpm: number;
  beatCount: number;
  countInTone: CountInTone;
  countInVolume: number;
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

const MIN_LOOP_SPAN = 0.5;
const YT_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25];

function quantizeSeconds(val: number): number {
  return Math.round(val * 100) / 100;
}

function snapYouTubeSpeed(speed: number): number {
  return YT_SPEEDS.reduce((best, cur) =>
    Math.abs(cur - speed) < Math.abs(best - speed) ? cur : best
  );
}

export class ChoreoPlayer {
  private videoEl: HTMLVideoElement;
  private audioEl: HTMLAudioElement;
  private ytContainerEl: HTMLElement;
  private callbacks: PlayerCallbacks;

  private activeKind: MediaKind | null = null;
  private objectUrl: string | null = null;
  private ytPlayer: YTPlayerInstance | null = null;
  private ytReady = false;
  private ytPlaying = false;

  private rafId: number | null = null;
  private countInTimerId: number | null = null;
  private unlockTimerId: number | null = null;
  private ytLoadSeq = 0;

  private speed = 1.0;
  private mirror = false;
  private countInEnabled = false;
  private countInMode: CountInMode = '3s';
  private repeatCountInOnLoop = true;
  private bpm = 120;
  private beatCount = 4;
  private countInTone: CountInTone = 'woodblock';
  private countInVolume = 0.85;
  private countInRemaining: number | null = null;
  private pointA: number | null = null;
  private pointB: number | null = null;
  private loopEnabled = false;

  constructor(
    videoEl: HTMLVideoElement,
    audioEl: HTMLAudioElement,
    ytContainerEl: HTMLElement,
    callbacks: PlayerCallbacks
  ) {
    this.videoEl = videoEl;
    this.audioEl = audioEl;
    this.ytContainerEl = ytContainerEl;
    this.callbacks = callbacks;

    this.bindMediaEvents(this.videoEl);
    this.bindMediaEvents(this.audioEl);
  }

  private get activeHtmlMedia(): HTMLMediaElement | null {
    if (this.activeKind === 'video') return this.videoEl;
    if (this.activeKind === 'audio') return this.audioEl;
    return null;
  }

  private bindMediaEvents(el: HTMLMediaElement): void {
    el.addEventListener('play', () => {
      if (el !== this.activeHtmlMedia) return;
      this.startLoopMonitor();
      this.emitState();
    });

    el.addEventListener('pause', () => {
      if (el !== this.activeHtmlMedia) return;
      this.stopLoopMonitor();
      this.emitState();
    });

    el.addEventListener('ended', () => {
      if (el !== this.activeHtmlMedia) return;
      if (this.loopEnabled && this.pointA !== null) {
        el.currentTime = this.pointA;
        void el.play();
        return;
      }
      this.stopLoopMonitor();
      this.emitState();
    });

    el.addEventListener('loadedmetadata', () => {
      if (el !== this.activeHtmlMedia) return;
      this.applyPlaybackRate(el);
      this.emitTime();
      this.emitState();
    });

    el.addEventListener('timeupdate', () => {
      if (el !== this.activeHtmlMedia) return;
      this.checkABLoop();
      this.emitTime();
    });

    el.addEventListener('error', () => {
      if (el !== this.activeHtmlMedia) return;
      this.stopLoopMonitor();
      const code = el.error?.code;
      if (code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        this.callbacks.onError(
          'Unsupported video/audio codec in this browser (common with 4K HEVC/H.265 phone videos). Try playing on your phone or recording in H.264 MP4.'
        );
      } else {
        this.callbacks.onError('Unable to play this media file on this browser.');
      }
      this.emitState();
    });
  }

  public loadMedia(blob: Blob, kind: 'audio' | 'video', settings: TrackSettings): void {
    this.cleanupActiveMedia();
    this.applyTrackSettings(settings);
    this.activeKind = kind;

    this.objectUrl = URL.createObjectURL(blob);
    const target = kind === 'video' ? this.videoEl : this.audioEl;
    target.src = this.objectUrl;
    this.applyPlaybackRate(target);
    this.applyMirror();
    target.load();
    this.emitState();
  }

  public async loadYouTube(videoId: string, settings: TrackSettings): Promise<void> {
    const seq = ++this.ytLoadSeq;
    this.cleanupActiveMedia();
    this.applyTrackSettings(settings);
    this.activeKind = 'youtube';
    this.applyMirror();
    this.emitState();

    try {
      const YT = await loadYouTubeAPI();
      if (this.activeKind !== 'youtube' || seq !== this.ytLoadSeq) return;

      this.ytContainerEl.innerHTML = '<div id="yt-player-mount"></div>';
      this.ytPlayer = new YT.Player('yt-player-mount', {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            this.ytReady = true;
            e.target.setPlaybackRate(this.speed);
            this.emitTime();
            this.emitState();
          },
          onStateChange: (e) => {
            const state = e.data;
            if (state === YT.PlayerState.PLAYING) {
              this.ytPlaying = true;
              e.target.setPlaybackRate(this.speed);
              this.startLoopMonitor();
              this.emitState();
            } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.CUED) {
              this.ytPlaying = false;
              this.stopLoopMonitor();
              this.emitState();
            } else if (state === YT.PlayerState.ENDED) {
              if (this.loopEnabled && this.pointA !== null) {
                e.target.seekTo(this.pointA, true);
                e.target.playVideo();
                return;
              }
              this.ytPlaying = false;
              this.stopLoopMonitor();
              this.emitState();
            }
          },
          onError: () => {
            this.callbacks.onError('YouTube video could not be loaded (embedding may be disabled by uploader).');
          },
        },
      });
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : 'Failed to load YouTube Player.');
    }
  }

  public unload(): void {
    this.cleanupActiveMedia();
    this.pointA = null;
    this.pointB = null;
    this.loopEnabled = false;
    this.emitState();
  }

  private applyTrackSettings(settings: TrackSettings): void {
    this.speed = clamp(settings.speed, 0.25, 1.25);
    this.mirror = settings.mirror;
    this.countInEnabled = settings.countInEnabled;
    this.countInMode = settings.countInMode;
    this.repeatCountInOnLoop = settings.repeatCountInOnLoop ?? true;
    this.bpm = clamp(settings.bpm || 120, 40, 240);
    this.beatCount = clamp(Math.round(settings.beatCount || 4), 1, 16);
    this.countInTone = settings.countInTone ?? 'woodblock';
    this.countInVolume = clamp(settings.countInVolume ?? 0.85, 0, 1);
    this.pointA = settings.pointA;
    this.pointB = settings.pointB;
    this.loopEnabled = settings.loopEnabled;
  }

  private cleanupActiveMedia(): void {
    this.cancelCountIn();
    this.stopLoopMonitor();

    this.videoEl.pause();
    this.audioEl.pause();
    this.videoEl.removeAttribute('src');
    this.videoEl.load();
    this.audioEl.removeAttribute('src');
    this.audioEl.load();

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    if (this.ytPlayer) {
      try {
        this.ytPlayer.destroy();
      } catch {
        // Ignore teardown errors
      }
      this.ytPlayer = null;
    }
    this.ytContainerEl.innerHTML = '';
    this.ytReady = false;
    this.ytPlaying = false;
    this.activeKind = null;
  }

  public togglePlay(): void {
    if (!this.activeKind) return;

    if (this.countInRemaining !== null) {
      this.cancelCountIn();
      return;
    }

    if (this.isCurrentlyPlaying()) {
      this.pauseNow();
      return;
    }

    if (this.countInEnabled) {
      this.startCountIn();
    } else {
      this.startPlayback();
    }
  }

  private isCurrentlyPlaying(): boolean {
    if (this.activeKind === 'youtube') return this.ytPlaying;
    const media = this.activeHtmlMedia;
    return Boolean(media && !media.paused);
  }

  private pauseNow(): void {
    if (this.activeKind === 'youtube') {
      this.ytPlayer?.pauseVideo();
      return;
    }
    this.activeHtmlMedia?.pause();
  }

  private getCurrentTimeInternal(): number {
    if (this.activeKind === 'youtube') {
      return this.ytReady && this.ytPlayer ? this.ytPlayer.getCurrentTime() : 0;
    }
    return this.activeHtmlMedia?.currentTime ?? 0;
  }

  private getDurationInternal(): number {
    if (this.activeKind === 'youtube') {
      return this.ytReady && this.ytPlayer ? this.ytPlayer.getDuration() : 0;
    }
    const d = this.activeHtmlMedia?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  private startPlayback(): void {
    const cur = this.getCurrentTimeInternal();
    if (
      this.loopEnabled &&
      this.pointA !== null &&
      this.pointB !== null &&
      this.pointB > this.pointA &&
      (cur < this.pointA || cur >= this.pointB)
    ) {
      this.seekInternal(this.pointA);
    }

    if (this.activeKind === 'youtube') {
      if (!this.ytReady || !this.ytPlayer) return;
      this.ytPlayer.setPlaybackRate(this.speed);
      this.ytPlayer.playVideo();
      return;
    }

    const media = this.activeHtmlMedia;
    if (!media) return;
    this.applyPlaybackRate(media);
    void media.play().catch(() => {
      this.callbacks.onError('Tap Play again to start playback.');
    });
  }

  private startCountIn(): void {
    // Unlock HTML media element or YouTube iframe on iOS/Android within user gesture
    if (this.activeKind === 'youtube' && this.ytReady && this.ytPlayer) {
      const wasMuted = this.ytPlayer.isMuted();
      this.ytPlayer.mute();
      this.ytPlayer.playVideo();
      this.unlockTimerId = window.setTimeout(() => {
        this.unlockTimerId = null;
        if (this.ytPlayer) {
          this.ytPlayer.pauseVideo();
          if (!wasMuted) this.ytPlayer.unMute();
        }
      }, 60);
    } else {
      const media = this.activeHtmlMedia;
      if (media) {
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
      }
    }

    const isBeats = this.countInMode === 'beats';
    const totalSteps =
      this.countInMode === '3s'
        ? 3
        : this.countInMode === '5s'
          ? 5
          : this.beatCount;
    const stepMs = isBeats ? Math.round(60000 / (this.bpm * this.speed)) : 1000;

    let stepIndex = 1;
    this.countInRemaining = isBeats ? 1 : totalSteps;
    if (isBeats) {
      playCountInTone(false, this.countInTone, this.countInVolume);
    }
    this.emitState();

    this.countInTimerId = window.setInterval(() => {
      stepIndex += 1;
      if (stepIndex > totalSteps) {
        this.clearCountInTimer();
        this.countInRemaining = null;
        if (isBeats) {
          playCountInTone(true, this.countInTone, this.countInVolume);
        }
        this.emitState();
        this.startPlayback();
      } else {
        this.countInRemaining = isBeats ? stepIndex : totalSteps - stepIndex + 1;
        if (isBeats) {
          playCountInTone(false, this.countInTone, this.countInVolume);
        }
        this.emitState();
      }
    }, stepMs);
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
    if (this.unlockTimerId !== null) {
      window.clearTimeout(this.unlockTimerId);
      this.unlockTimerId = null;
      if (this.activeKind === 'youtube' && this.ytPlayer) {
        this.ytPlayer.pauseVideo();
        this.ytPlayer.unMute();
      }
    }
  }

  private seekInternal(seconds: number): void {
    const dur = this.getDurationInternal();
    const target = dur > 0 ? clamp(seconds, 0, dur) : Math.max(0, seconds);
    if (this.activeKind === 'youtube') {
      if (this.ytReady && this.ytPlayer) {
        this.ytPlayer.seekTo(target, true);
      }
      return;
    }
    const media = this.activeHtmlMedia;
    if (media) {
      media.currentTime = target;
    }
  }

  public seekTo(seconds: number): void {
    if (!this.activeKind) return;
    this.seekInternal(seconds);
    this.emitTime();
  }

  public seekBy(deltaSeconds: number): void {
    if (!this.activeKind) return;
    this.seekTo(this.getCurrentTimeInternal() + deltaSeconds);
  }

  public setSpeed(newSpeed: number): void {
    const clamped = clamp(Math.round(newSpeed * 100) / 100, 0.25, 1.25);
    this.speed = this.activeKind === 'youtube' ? snapYouTubeSpeed(clamped) : clamped;
    if (this.activeKind === 'youtube') {
      if (this.ytReady && this.ytPlayer) {
        this.ytPlayer.setPlaybackRate(this.speed);
      }
    } else if (this.activeHtmlMedia) {
      this.applyPlaybackRate(this.activeHtmlMedia);
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
    if (this.activeKind === 'youtube') {
      this.callbacks.onError('Mirror Mode is only available for local video files (YouTube ToS restriction).');
      return;
    }
    this.mirror = !this.mirror;
    this.applyMirror();
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  private applyMirror(): void {
    this.videoEl.classList.toggle('is-mirrored', this.mirror && this.activeKind === 'video');
    this.ytContainerEl.classList.remove('is-mirrored');
  }

  public toggleCountIn(): void {
    this.countInEnabled = !this.countInEnabled;
    if (!this.countInEnabled) {
      this.cancelCountIn();
    }
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setCountInMode(mode: CountInMode): void {
    this.countInMode = mode;
    if (!this.countInEnabled) {
      this.countInEnabled = true;
    }
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public toggleRepeatCountInOnLoop(): void {
    this.repeatCountInOnLoop = !this.repeatCountInOnLoop;
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setBpm(bpm: number): void {
    this.bpm = clamp(Math.round(bpm), 40, 240);
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setBeatCount(count: number): void {
    this.beatCount = clamp(Math.round(count), 1, 16);
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setCountInTone(tone: CountInTone): void {
    this.countInTone = tone;
    playCountInTone(false, this.countInTone, this.countInVolume);
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setCountInVolume(volume: number): void {
    this.countInVolume = clamp(volume, 0, 1);
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setPointA(): void {
    if (!this.activeKind) return;
    const t = quantizeSeconds(this.getCurrentTimeInternal());
    this.pointA = t;
    if (this.pointB !== null && this.pointB < this.pointA + MIN_LOOP_SPAN) {
      this.pointB = null;
      this.loopEnabled = false;
    } else if (this.pointB !== null) {
      this.loopEnabled = true;
    }
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public setPointB(): void {
    if (!this.activeKind) return;
    const t = quantizeSeconds(this.getCurrentTimeInternal());
    const dur = this.getDurationInternal();
    if (this.pointA === null) {
      this.pointA = 0;
    }
    if (t < this.pointA + MIN_LOOP_SPAN) {
      this.pointB = quantizeSeconds(clamp(this.pointA + MIN_LOOP_SPAN, 0, dur || this.pointA + MIN_LOOP_SPAN));
    } else {
      this.pointB = t;
    }
    this.loopEnabled = true;
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public nudgePointA(delta: number): void {
    if (!this.activeKind || this.pointA === null) return;
    const dur = this.getDurationInternal();
    const maxA = this.pointB !== null ? this.pointB - MIN_LOOP_SPAN : dur || this.pointA + 10;
    this.pointA = quantizeSeconds(clamp(this.pointA + delta, 0, Math.max(0, maxA)));
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public nudgePointB(delta: number): void {
    if (!this.activeKind || this.pointB === null) return;
    const dur = this.getDurationInternal();
    const minB = this.pointA !== null ? this.pointA + MIN_LOOP_SPAN : MIN_LOOP_SPAN;
    const maxB = dur || this.pointB + 10;
    this.pointB = quantizeSeconds(clamp(this.pointB + delta, minB, maxB));
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  public toggleLoop(): void {
    if (this.pointA === null || this.pointB === null || this.pointB <= this.pointA) {
      return;
    }
    this.loopEnabled = !this.loopEnabled;
    if (this.loopEnabled && this.activeKind) {
      const cur = this.getCurrentTimeInternal();
      if (cur < this.pointA || cur >= this.pointB) {
        this.seekInternal(this.pointA);
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
    this.pointA = start;
    this.pointB = end;
    this.loopEnabled = true;
    if (this.activeKind) {
      this.seekInternal(start);
    }
    this.emitTime();
    this.emitState();
    this.callbacks.onSettingsChanged();
  }

  private checkABLoop(): void {
    if (
      !this.loopEnabled ||
      this.pointA === null ||
      this.pointB === null ||
      this.pointB <= this.pointA
    ) {
      return;
    }
    if (this.getCurrentTimeInternal() >= this.pointB) {
      this.seekInternal(this.pointA);
      if (this.countInEnabled && this.repeatCountInOnLoop && this.countInRemaining === null) {
        this.pauseNow();
        this.stopLoopMonitor();
        this.startCountIn();
      }
    }
  }

  private startLoopMonitor(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      if (!this.isCurrentlyPlaying()) {
        this.rafId = null;
        return;
      }
      this.checkABLoop();
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
    return {
      isPlaying: this.isCurrentlyPlaying(),
      currentTime: this.getCurrentTimeInternal(),
      duration: this.getDurationInternal(),
      speed: this.speed,
      mirror: this.mirror,
      countInEnabled: this.countInEnabled,
      countInMode: this.countInMode,
      repeatCountInOnLoop: this.repeatCountInOnLoop,
      bpm: this.bpm,
      beatCount: this.beatCount,
      countInTone: this.countInTone,
      countInVolume: this.countInVolume,
      countInRemaining: this.countInRemaining,
      pointA: this.pointA,
      pointB: this.pointB,
      loopEnabled: this.loopEnabled,
      mediaKind: this.activeKind,
    };
  }

  private emitTime(): void {
    if (!this.activeKind) return;
    this.callbacks.onTimeUpdate(this.getCurrentTimeInternal(), this.getDurationInternal());
  }

  private emitState(): void {
    this.callbacks.onStateChange(this.getSnapshot());
  }
}
