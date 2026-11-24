import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBeatIntervalMs,
  evaluateABLoopHit,
  snapYouTubeSpeed,
  stepSpeedValue,
} from '../src/player';
import { movePanelInOrder, reconcilePanelOrder } from '../src/ui/layout-order';

describe('player speed/loop math and layout order seams', () => {
  it('snaps and steps playback speeds cleanly for YouTube vs local media', () => {
    assert.equal(snapYouTubeSpeed(0.9), 1.0);
    assert.equal(snapYouTubeSpeed(0.6), 0.5);
    assert.equal(stepSpeedValue(0.9, -1, true), 0.75);
    assert.equal(stepSpeedValue(0.75, 1, true), 1.0);
    assert.equal(stepSpeedValue(1.25, 1, true), 1.25);

    assert.equal(stepSpeedValue(0.9, 1, false), 0.95);
    assert.equal(stepSpeedValue(0.25, -1, false), 0.25);
  });

  it('computes beat intervals and A-B loop hits cleanly', () => {
    assert.equal(computeBeatIntervalMs(120, 1.0), 500);
    assert.equal(computeBeatIntervalMs(120, 0.5), 1000);
    assert.equal(computeBeatIntervalMs(Number.NaN, 1.0), 500);

    assert.equal(evaluateABLoopHit(12.0, 5, 12, true), true);
    assert.equal(evaluateABLoopHit(11.99, 5, 12, true), false);
    assert.equal(evaluateABLoopHit(15.0, 5, 12, false), false);
    assert.equal(evaluateABLoopHit(15.0, 10, 10, true), false);
  });

  it('deduplicates corrupted persisted panel orders and restores missing panels', () => {
    assert.deepEqual(
      reconcilePanelOrder(['speed-card', 'speed-card', 'unknown-id', 'ab-card']),
      ['speed-card', 'ab-card', 'timeline-card', 'lyrics-card']
    );
    assert.deepEqual(reconcilePanelOrder('not-an-array'), [
      'timeline-card',
      'ab-card',
      'speed-card',
      'lyrics-card',
    ]);
  });

  it('skips hidden panels when reordering visible panels', () => {
    const order = ['timeline-card', 'lyrics-card', 'ab-card', 'speed-card'] as const;
    const hidden = new Set(['lyrics-card'] as const);

    assert.deepEqual(movePanelInOrder(order, 'timeline-card', 1, hidden), [
      'ab-card',
      'lyrics-card',
      'timeline-card',
      'speed-card',
    ]);

    assert.deepEqual(movePanelInOrder(['timeline-card', 'ab-card', 'speed-card', 'lyrics-card'], 'speed-card', 1, hidden), [
      'timeline-card',
      'ab-card',
      'speed-card',
      'lyrics-card',
    ]);
  });
});
