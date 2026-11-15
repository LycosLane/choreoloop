export function formatTime(seconds: number, showTenths = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return showTenths ? '00:00.0' : '00:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return showTenths ? `${mm}:${ss}.${tenths}` : `${mm}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 10 || exp === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exp]}`;
}

export function detectMediaKind(file: File): 'audio' | 'video' {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
  return 'audio';
}

export function inferMimeType(file: File, kind: 'audio' | 'video'): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  };
  return map[ext] ?? (kind === 'video' ? 'video/mp4' : 'audio/mpeg');
}

export function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '') || filename;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

import type { CountInTone } from './types';

let audioCtx: AudioContext | null = null;

export function playCountInTone(
  isGoTone: boolean,
  tone: CountInTone = 'woodblock',
  volume = 0.85
): void {
  const clampedVol = Math.max(0, Math.min(1, volume));
  if (clampedVol <= 0.005) return;

  try {
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const peak = clampedVol * 0.85;

    if (tone === 'woodblock') {
      osc.type = 'triangle';
      const startFreq = isGoTone ? 1180 : 780;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(startFreq * 0.72, now + 0.055);
      gain.gain.setValueAtTime(peak, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (isGoTone ? 0.11 : 0.065));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (isGoTone ? 0.12 : 0.07));
    } else if (tone === 'click') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(isGoTone ? 1650 : 1120, now);
      gain.gain.setValueAtTime(peak * 0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (isGoTone ? 0.06 : 0.035));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (isGoTone ? 0.065 : 0.04));
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isGoTone ? 920 : 580, now);
      gain.gain.setValueAtTime(peak * 0.75, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (isGoTone ? 0.15 : 0.09));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (isGoTone ? 0.16 : 0.1));
    }
  } catch {
    // Ignore audio context restrictions
  }
}

export function probeMediaDuration(blob: Blob, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement(kind);
    el.preload = 'metadata';

    const cleanup = () => {
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve(0);
    }, 4000);

    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dur = Number.isFinite(el.duration) ? el.duration : 0;
      cleanup();
      resolve(dur);
    };

    el.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(0);
    };

    el.src = url;
  });
}
