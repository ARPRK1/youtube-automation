import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSpeechBeats } from '../lib/speech-performance.js';

test('empty input yields no beats', () => {
  assert.deepEqual(planSpeechBeats(''), []);
  assert.deepEqual(planSpeechBeats('   '), []);
  assert.deepEqual(planSpeechBeats(null), []);
});

test('first beat within the hook budget is classified as hook', () => {
  const beats = planSpeechBeats('Glass is not a solid. It is an amorphous solid. Wild, right?');
  assert.equal(beats[0].emphasis, 'hook');
});

test('a reveal starter gets the reveal profile with a pause before it', () => {
  const beats = planSpeechBeats('Most people think glass is a solid. But it is actually a frozen liquid.');
  const reveal = beats.find((b) => b.emphasis === 'reveal');
  assert.ok(reveal, 'expected a reveal beat');
  assert.ok(reveal.pauseBeforeMs > 0, 'reveal should have a pause before it');
  assert.ok(reveal.exaggerationDelta > 0, 'reveal should lift exaggeration');
});

test('closing CTA line is classified as cta', () => {
  const beats = planSpeechBeats('There is a country with no rivers. It still has a navy. Follow if you want the next one.');
  const last = beats[beats.length - 1];
  assert.equal(last.emphasis, 'cta');
});

test('a question ending counts as a cta close', () => {
  const beats = planSpeechBeats('Water can freeze faster when hot. That is the Mpemba effect. Wild, right?');
  const last = beats[beats.length - 1];
  assert.equal(last.emphasis, 'cta');
});

test('long sentences are broken at a breath and marked breath', () => {
  const long = 'The city sits in two continents at once, and that single fact reshaped its entire history over many centuries.';
  const beats = planSpeechBeats(long);
  assert.ok(beats.length >= 2, 'a long sentence should split into >= 2 beats');
  assert.ok(beats.some((b) => b.emphasis === 'breath'), 'expected a mid-sentence breath beat');
});

test('short punchy sentences are not fragmented', () => {
  const beats = planSpeechBeats('Ice is slippery. Nobody knows exactly why.');
  // Two short sentences → two beats, neither a mid-sentence breath.
  assert.equal(beats.length, 2);
  assert.ok(!beats.some((b) => b.emphasis === 'breath'));
});

test('no beat is a tiny fragment (<3 words) when the input has real content', () => {
  const inputs = [
    'Glass is not a solid. No. It is an amorphous solid. Wild, right?',
    'Ok. Here is the twist nobody expects in this whole story today.',
    'There is a country with no rivers. But it keeps a navy. Guess which.'
  ];
  for (const text of inputs) {
    const beats = planSpeechBeats(text);
    // A single-beat result can be short (nothing to merge into); multi-beat
    // results must never contain a 1–2 word Chatterbox call.
    if (beats.length > 1) {
      for (const b of beats) {
        assert.ok(b.text.trim().split(/\s+/).length >= 3, `tiny beat survived: "${b.text}"`);
      }
    }
  }
});

test('output is deterministic for the same input', () => {
  const line = 'Here is a strange fact. But the reason is stranger. Guess before I tell you.';
  assert.deepEqual(planSpeechBeats(line), planSpeechBeats(line));
});

test('every beat carries the full prosody contract', () => {
  const beats = planSpeechBeats('A fact. But a twist. Now you know.');
  for (const b of beats) {
    for (const key of ['text', 'emphasis', 'pauseBeforeMs', 'pauseAfterMs', 'exaggerationDelta', 'cfgWeightDelta', 'rateDelta']) {
      assert.ok(key in b, `beat missing ${key}`);
    }
    assert.equal(typeof b.pauseBeforeMs, 'number');
    assert.equal(typeof b.exaggerationDelta, 'number');
  }
});
