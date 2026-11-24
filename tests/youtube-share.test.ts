import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeShareHash,
  encodeShareHash,
  parseTrackSetupJson,
} from '../src/services/share';
import type { TrackMetadata } from '../src/types';
import { extractYouTubeId, isValidYouTubeId } from '../src/youtube';

describe('youtube and share codec seams', () => {
  it('extracts valid YouTube IDs across URL formats and rejects spoofed hosts', () => {
    assert.equal(isValidYouTubeId('dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeId('dQw4w9WgXcQ?autoplay=1'), false);
    assert.equal(extractYouTubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractYouTubeId('HTTPS://YOUTU.BE/dQw4w9WgXcQ?t=12'), 'dQw4w9WgXcQ');
    assert.equal(
      extractYouTubeId('Check this choreo: https://www.youtube.com/shorts/AbCdEf12345'),
      'AbCdEf12345'
    );
    assert.equal(extractYouTubeId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'), null);
  });

  it('rejects crafted youtubeId injection and invalid bounds in parseTrackSetupJson', () => {
    const injected = JSON.stringify({
      format: 'choreoloop-setup',
      version: 1,
      youtubeId: 'dQw4w9WgXcQ?autoplay=1&list=evil',
      settings: { speed: 0.9 },
      bookmarks: [],
    });
    assert.equal(parseTrackSetupJson(injected), null);

    const validYtJson = JSON.stringify({
      format: 'choreoloop-setup',
      version: 1,
      name: '  Chorus Drill  ',
      youtubeId: 'dQw4w9WgXcQ',
      settings: { speed: 0.9, mirror: true, bpm: 999, pointA: 10, pointB: 5 },
      bookmarks: [
        { name: 'Invalid Negative', start: -2, end: 4 },
        { name: 'Invalid Order', start: 8, end: 8 },
        { name: '  Intro  ', start: 1.5, end: 9.25 },
      ],
    });
    const parsed = parseTrackSetupJson(validYtJson);
    assert.ok(parsed);
    assert.equal(parsed.name, 'Chorus Drill');
    assert.equal(parsed.youtubeId, 'dQw4w9WgXcQ');
    assert.equal(parsed.settings.speed, 1.0); // snapped from 0.9 for YouTube
    assert.equal(parsed.settings.mirror, false); // disabled for YouTube
    assert.equal(parsed.settings.bpm, 240); // clamped
    assert.equal(parsed.settings.pointA, 10);
    assert.equal(parsed.settings.pointB, null); // invalid pointB <= pointA dropped
    assert.equal(parsed.bookmarks.length, 1);
    assert.equal(parsed.bookmarks[0].name, 'Intro');
    assert.equal(parsed.bookmarks[0].start, 1.5);
    assert.equal(parsed.bookmarks[0].end, 9.25);
  });

  it('round-trips a YouTube setup through encodeShareHash and decodeShareHash', async () => {
    const track: TrackMetadata = {
      id: 'trk-1',
      name: 'Stage Mix',
      mimeType: 'video/youtube',
      mediaKind: 'youtube',
      youtubeId: 'dQw4w9WgXcQ',
      size: 0,
      duration: 180,
      createdAt: 1,
      updatedAt: 1,
      bookmarks: [{ id: 'bm-1', name: 'Bridge', start: 40, end: 56.5, createdAt: 1 }],
      settings: {
        speed: 0.75,
        mirror: false,
        countInEnabled: true,
        countInMode: 'beats',
        repeatCountInOnLoop: true,
        bpm: 128,
        beatCount: 8,
        countInTone: 'click',
        countInVolume: 0.7,
        pointA: 40,
        pointB: 56.5,
        loopEnabled: true,
      },
    };

    const hash = await encodeShareHash(track);
    assert.ok(hash.startsWith('#sharez=') || hash.startsWith('#share='));
    const decoded = await decodeShareHash(hash);
    assert.ok(decoded);
    assert.equal(decoded.youtubeId, 'dQw4w9WgXcQ');
    assert.equal(decoded.settings.speed, 0.75);
    assert.equal(decoded.settings.bpm, 128);
    assert.equal(decoded.settings.beatCount, 8);
    assert.equal(decoded.settings.loopEnabled, true);
    assert.equal(decoded.bookmarks.length, 1);
    assert.equal(decoded.bookmarks[0].name, 'Bridge');
  });

  it('rejects #share= hashes containing malformed or injected youtubeId', async () => {
    const malicious = Buffer.from(
      JSON.stringify({ v: 1, yt: '../../evil?autoplay=1', s: 1 })
    ).toString('base64url');
    assert.equal(await decodeShareHash(`#share=${malicious}`), null);
  });
});
