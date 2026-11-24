export interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(suggestedRate: number): void;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(volume: number): void;
  getVolume(): number;
  destroy(): void;
}

export interface YTGlobal {
  Player: new (
    elementId: string | HTMLElement,
    options: {
      host?: string;
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YTPlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTGlobal> | null = null;
const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function isValidYouTubeId(id: string): boolean {
  return YT_ID_RE.test(id);
}

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YT_ID_RE.test(trimmed)) {
    return trimmed;
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  const candidate = urlMatch ? urlMatch[0] : trimmed;

  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && YT_ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && YT_ID_RE.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'embed', 'live'].includes(parts[0])) {
        return YT_ID_RE.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function loadYouTubeAPI(): Promise<YTGlobal> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const prevCallback = window.onYouTubeIframeAPIReady;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      ytApiPromise = null;
      script.remove();
      reject(new Error(message));
    };

    const timeoutId = window.setTimeout(() => {
      fail('YouTube Player timed out while loading.');
    }, 12000);

    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) {
        try {
          prevCallback();
        } catch {
          // Ignore stale callback errors
        }
      }
      if (settled) return;
      if (window.YT?.Player) {
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(window.YT);
      } else {
        fail('YouTube IFrame API failed to initialize.');
      }
    };

    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      fail('Unable to load YouTube Player (check internet connection).');
    };
    document.head.appendChild(script);
  });

  return ytApiPromise;
}
