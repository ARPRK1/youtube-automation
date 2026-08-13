import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVisualBeats, splitDuration, sliceTextForBeat } from '../lib/media-sourcing.js';

const cfg = {
  media: {
    visual_beat_seconds_short: 3.8,
    max_visual_beats_short: 10,
    never_people: true
  }
};

test('splitDuration sums exactly to the total', () => {
  const parts = splitDuration(30, 7);
  const sum = parts.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 30) < 1e-6, `sum was ${sum}`);
  assert.equal(parts.length, 7);
});

test('beats cover the full duration and end at total', () => {
  const segment = { text: 'A country has no rivers but keeps a navy. Guess which one before the reveal.', visual_needs: ['world map', 'naval ship'] };
  const total = 20;
  const beats = planVisualBeats({ segment, aspect: 'vertical', durationSec: total, endHoldSec: 2, config: cfg });
  assert.ok(beats.length >= 1);
  assert.equal(beats[0].t0, 0);
  assert.ok(Math.abs(beats[beats.length - 1].t1 - total) < 0.05, `last beat ends at ${beats[beats.length - 1].t1}`);
});

test('the end hold is absorbed into the final beat, not a new beat', () => {
  const segment = { text: 'Short line one. Short line two.', visual_needs: ['map'] };
  // With a big hold, the spoken portion is small; beat count is driven by
  // spoken seconds, and the last beat should be noticeably longer (holds).
  const withHold = planVisualBeats({ segment, aspect: 'vertical', durationSec: 12, endHoldSec: 2, config: cfg });
  const spokenOnly = planVisualBeats({ segment, aspect: 'vertical', durationSec: 10, endHoldSec: 0, config: cfg });
  assert.equal(withHold.length, spokenOnly.length, 'hold must not add a beat');
  const lastWith = withHold[withHold.length - 1];
  const lastWithout = spokenOnly[spokenOnly.length - 1];
  assert.ok(lastWith.durationSec > lastWithout.durationSec, 'final beat should be extended by the hold');
});

test('anchor is beat 0', () => {
  const segment = { text: 'Facts about deserts and rivers here for testing purposes only.', visual_needs: ['desert', 'river'] };
  const beats = planVisualBeats({ segment, aspect: 'vertical', durationSec: 15, endHoldSec: 2, config: cfg });
  assert.ok(beats[0].isPrimarySlot);
  assert.ok(!beats.slice(1).some((b) => b.isPrimarySlot));
});

test('entities cycle across beats', () => {
  const segment = { text: 'One two three four five six seven eight nine ten eleven twelve thirteen.', visual_needs: ['alpha', 'beta'] };
  const beats = planVisualBeats({ segment, aspect: 'vertical', durationSec: 20, endHoldSec: 2, config: cfg });
  assert.equal(beats[0].entity, 'alpha');
  assert.equal(beats[1].entity, 'beta');
  assert.equal(beats[2].entity, 'alpha');
});

test('sliceTextForBeat returns different slices across the timeline', () => {
  const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november';
  const durations = splitDuration(12, 3);
  const first = sliceTextForBeat(text, 0, durations);
  const last = sliceTextForBeat(text, 2, durations);
  assert.notEqual(first, last);
  assert.ok(first.includes('alpha'));
  assert.ok(last.includes('november'));
});

test('never_people classification never yields a person subjectKind', () => {
  const segment = { text: 'The king and the emperor met the president at the temple gate.', visual_needs: ['emperor', 'temple'] };
  const beats = planVisualBeats({ segment, aspect: 'vertical', durationSec: 15, endHoldSec: 2, config: cfg });
  assert.ok(!beats.some((b) => b.subjectKind === 'person'), 'never_people must suppress person subjects');
});
