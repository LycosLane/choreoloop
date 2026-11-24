/**
 * Screen Wake Lock controller that keeps the device display awake during
 * playback or count-in and re-acquires the lock when returning to the tab.
 */
export interface WakeLockController {
  sync(active: boolean): void;
}

export function createWakeLockController(): WakeLockController {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;
  let requestSeq = 0;

  async function acquire(): Promise<void> {
    if (!wanted || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator) || sentinel) return;
    const seq = ++requestSeq;
    try {
      const next = await navigator.wakeLock.request('screen');
      if (!wanted || seq !== requestSeq || sentinel) {
        void next.release().catch(() => {});
        return;
      }
      sentinel = next;
      sentinel.addEventListener('release', () => {
        if (sentinel === next) {
          sentinel = null;
        }
      });
    } catch {
      // Ignore wake lock rejection (e.g. low battery mode)
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) {
      void acquire();
    }
  });

  return {
    sync(active: boolean): void {
      wanted = active;
      if (active) {
        void acquire();
      } else {
        requestSeq += 1;
        if (sentinel) {
          const current = sentinel;
          sentinel = null;
          void current.release().catch(() => {});
        }
      }
    },
  };
}
