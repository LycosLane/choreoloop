/**
 * Rolling tap-tempo calculator that averages up to 6 recent taps and resets
 * automatically after 2.2 seconds of inactivity.
 */
export interface TapTempo {
  tap(): number | null;
  reset(): void;
}

export function createTapTempo(resetThresholdMs = 2200, maxSamples = 6): TapTempo {
  let tapTimes: number[] = [];

  return {
    tap(): number | null {
      const now = performance.now();
      if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > resetThresholdMs) {
        tapTimes = [];
      }
      tapTimes.push(now);
      if (tapTimes.length > maxSamples) {
        tapTimes.shift();
      }
      if (tapTimes.length < 2) return null;

      let totalDiff = 0;
      for (let i = 1; i < tapTimes.length; i += 1) {
        totalDiff += tapTimes[i] - tapTimes[i - 1];
      }
      const avgMs = totalDiff / (tapTimes.length - 1);
      return avgMs > 0 ? Math.round(60000 / avgMs) : null;
    },

    reset(): void {
      tapTimes = [];
    },
  };
}
