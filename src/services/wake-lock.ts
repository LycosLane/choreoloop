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

  async function acquire(): Promise<void> {
    if (!wanted || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator) || sentinel) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
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
      } else if (sentinel) {
        void sentinel.release().catch(() => {});
        sentinel = null;
      }
    },
  };
}
