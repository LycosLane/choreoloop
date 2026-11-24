import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findActiveLyricIndex,
  getEffectiveLineTime,
  guessSearchQuery,
  parseLyricsText,
} from '../src/services/lyrics';
import type { TrackLyrics } from '../src/types';

describe('lyrics service seams', () => {
  it('parses 1-digit, 2-digit, 3-digit, and multi-timestamp LRC lines chronologically', () => {
    const raw = [
      '[ti:Practice Song]',
      '[ar:Artist]',
      '[00:45.00][00:10.00]Chorus line',
      '[00:05.5]One digit tenth',
      '[00:01.250]Three digit ms',
      '[01:02.35]Minute rollover',
    ].join('\n');

    const result = parseLyricsText(raw);
    assert.equal(result.source, 'lrc');
    assert.deepEqual(
      result.lines.map((l) => ({ baseTime: l.baseTime, text: l.text })),
      [
        { baseTime: 1.25, text: 'Three digit ms' },
        { baseTime: 5.5, text: 'One digit tenth' },
        { baseTime: 10, text: 'Chorus line' },
        { baseTime: 45, text: 'Chorus line' },
        { baseTime: 62.35, text: 'Minute rollover' },
      ]
    );
  });

  it('falls back to untimed plain lines when no timestamps are present', () => {
    const result = parseLyricsText('First line\r\n\r\nSecond line');
    assert.equal(result.source, 'plain');
    assert.deepEqual(result.lines, [
      { baseTime: -1, offset: 0, text: 'First line' },
      { baseTime: -1, offset: 0, text: 'Second line' },
    ]);
  });

  it('applies +0.08s lookahead, global offset, and clamping in findActiveLyricIndex', () => {
    const lyrics: TrackLyrics = {
      source: 'lrc',
      globalOffset: 0.5,
      updatedAt: 1,
      lines: [
        { baseTime: 10, offset: -0.5, text: 'Line 1' }, // effective 10.0s
        { baseTime: 15, offset: 0.2, text: 'Line 2' },  // effective 15.7s
      ],
    };

    assert.equal(getEffectiveLineTime({ baseTime: 0.2, offset: -1 }, 0), 0);
    assert.equal(findActiveLyricIndex(lyrics, 9.91), -1);
    assert.equal(findActiveLyricIndex(lyrics, 9.93), 0);
    assert.equal(findActiveLyricIndex(lyrics, 15.65), 1);
  });

  it('cleans filenames and YouTube suffixes in guessSearchQuery', () => {
    assert.equal(
      guessSearchQuery('NewJeans_Super_Shy_(Dance Practice) [4K].mp4'),
      'NewJeans Super Shy'
    );
  });
});
