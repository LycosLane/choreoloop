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
let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buf;
  return buf;
}

function triggerNoiseBurst(
  ctx: AudioContext,
  now: number,
  freq: number,
  q: number,
  duration: number,
  level: number
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, now);
  filter.Q.setValueAtTime(q, now);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(ctx.destination);
  src.start(now);
  src.stop(now + duration + 0.005);
}

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
    if (audioCtx.state === 'suspended' || (audioCtx.state as string) === 'interrupted') {
      void audioCtx.resume();
    }
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const peak = clampedVol * 0.85;

    if (tone === 'woodblock') {
      // Resonant dual-partial clave / studio woodblock + crisp transient
      const base = isGoTone ? 1160 : 810;
      const ratios = [1, 1.48];
      ratios.forEach((ratio, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = idx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(base * ratio * 1.06, now);
        osc.frequency.exponentialRampToValueAtTime(base * ratio, now + 0.018);
        const partLevel = idx === 0 ? peak * 0.8 : peak * 0.42;
        const dur = isGoTone ? 0.095 : 0.065;
        g.gain.setValueAtTime(partLevel, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.01);
      });
      triggerNoiseBurst(ctx, now, base * 2.2, 3.5, 0.014, peak * 0.35);
    } else if (tone === 'click') {
      // Tight DAW rimshot / metronome click
      const bodyOsc = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      bodyOsc.type = 'sine';
      bodyOsc.frequency.setValueAtTime(isGoTone ? 1680 : 1220, now);
      bodyOsc.frequency.exponentialRampToValueAtTime(isGoTone ? 540 : 410, now + 0.025);
      bodyGain.gain.setValueAtTime(peak * 0.78, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
      bodyOsc.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      bodyOsc.start(now);
      bodyOsc.stop(now + 0.038);
      triggerNoiseBurst(ctx, now, isGoTone ? 3400 : 2600, 2.2, 0.018, peak * 0.55);
    } else {
      // Warm harmonic studio bell (fundamental + fifth)
      const root = isGoTone ? 880 : 587.33;
      [1, 1.5].forEach((ratio, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(root * ratio, now);
        const dur = isGoTone ? 0.16 : 0.1;
        g.gain.setValueAtTime(idx === 0 ? peak * 0.7 : peak * 0.25, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.01);
      });
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
      el.onloadedmetadata = null;
      el.onerror = null;
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
