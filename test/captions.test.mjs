import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeSrt, parseSrt, splitIntoShortLines } from '../lib/srt.js';

// Guards the H1 fix: clone-voice caption cues (measured per beat, scaled by
// speech-rate) must round-trip through SRT and split into short lines that
// stay in sync — and must NOT be stretched over the end-hold silence.

test('beat cues round-trip through SRT and split into short lines in order', async () => {
  const scale = 1 / 0.9; // speech_rate 0.9 → timestamps ×1.111
  const beats = [
    { start: 0.0, end: 1.8, text: 'Here is something strange.' },
    { start: 2.06, end: 4.0, text: 'There is a country with no rivers at all.' },
    { start: 4.42, end: 6.1, text: 'But it still keeps a navy.' }
  ].map((c) => ({ start: c.start * scale, end: c.end * scale, text: c.text }));

  const dir = await mkdtemp(path.join(tmpdir(), 'cap-test-'));
  const srt = path.join(dir, 'c.srt');
  await writeSrt(beats, srt);
  const parsed = await parseSrt(srt);
  assert.equal(parsed.length, 3);

  const lines = splitIntoShortLines(parsed, 4);
  // Every line ≤ 4 words
  for (const l of lines) assert.ok(l.text.split(/\s+/).length <= 4, `too many words: "${l.text}"`);
  // Monotonic, non-overlapping starts
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i].start >= lines[i - 1].start - 1e-9);
  // Last caption ends at speech end (~6.78s after scaling), NOT dragged out.
  const lastEnd = lines[lines.length - 1].end;
  assert.ok(lastEnd > 6.5 && lastEnd < 7.0, `last caption end ${lastEnd} should ~= scaled speech end`);
});

test('captions do not extend past the provided speech window (no end-hold drag)', async () => {
  // A single beat ending at 5s must not produce captions past 5s even though
  // a real segment would append a 2s silent hold afterward.
  const beats = [{ start: 0, end: 5, text: 'One two three four five six seven eight.' }];
  const dir = await mkdtemp(path.join(tmpdir(), 'cap-test2-'));
  const srt = path.join(dir, 'c.srt');
  await writeSrt(beats, srt);
  const lines = splitIntoShortLines(await parseSrt(srt), 4);
  assert.ok(Math.max(...lines.map((l) => l.end)) <= 5.001);
});
