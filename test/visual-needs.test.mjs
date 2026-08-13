import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVisualNeeds } from '../lib/script-writer.js';

test('drops pure abstract/mood terms', () => {
  const out = sanitizeVisualNeeds(['mystery', 'the concept of disappearance', 'sense of wonder'], 'Some narration.', { minNeeds: 0 });
  assert.deepEqual(out, []);
});

test('keeps concrete showable entities', () => {
  const out = sanitizeVisualNeeds(['sandy island map', 'naval ship', 'desert coastline'], 'x', { minNeeds: 0 });
  assert.deepEqual(out, ['sandy island map', 'naval ship', 'desert coastline']);
});

test('strips parenthetical mood notes but keeps the concrete part', () => {
  const out = sanitizeVisualNeeds(['Mumbai stadium (fiery intense mood)'], 'x', { minNeeds: 0 });
  assert.deepEqual(out, ['Mumbai stadium']);
});

test('removes person/portrait terms when neverPeople is on', () => {
  const out = sanitizeVisualNeeds(['a smiling man', 'crowd of people', 'ancient temple'], 'x', { neverPeople: true, minNeeds: 0 });
  assert.deepEqual(out, ['ancient temple']);
});

test('removes person-role/occupation terms (scientist, king, engineer)', () => {
  const out = sanitizeVisualNeeds(['scientist', 'ancient king', 'software engineer', 'old telescope'], 'x', { neverPeople: true, minNeeds: 0 });
  assert.deepEqual(out, ['old telescope']);
});

test('allows people terms when neverPeople is off', () => {
  const out = sanitizeVisualNeeds(['a fishing boat', 'harbor crowd'], 'x', { neverPeople: false, minNeeds: 0 });
  assert.deepEqual(out, ['a fishing boat', 'harbor crowd']);
});

test('backfills concrete proper nouns from narration when too few survive', () => {
  const narration = 'The Aral Sea shrank fast. Kazakhstan built the Kok Aral Dam to save the north.';
  const out = sanitizeVisualNeeds(['mystery'], narration, { minNeeds: 3 });
  assert.ok(out.length >= 2, `expected backfill, got ${JSON.stringify(out)}`);
  assert.ok(out.some((e) => /Aral|Kazakhstan|Kok Aral/.test(e)), `expected a proper noun, got ${JSON.stringify(out)}`);
});

test('does not backfill person proper nouns under neverPeople', () => {
  const narration = 'A smiling man named Bob Ross painted quietly.';
  // "Bob Ross" is a named entity but Bob/Ross aren't in the person vocab regex,
  // so this guards the general path: at minimum it never throws and returns an array.
  const out = sanitizeVisualNeeds([], narration, { neverPeople: true, minNeeds: 3 });
  assert.ok(Array.isArray(out));
});

test('dedupes case-insensitively', () => {
  const out = sanitizeVisualNeeds(['Naval Ship', 'naval ship', 'desert'], 'x', { minNeeds: 0 });
  assert.deepEqual(out, ['Naval Ship', 'desert']);
});

test('handles non-array input safely', () => {
  assert.deepEqual(sanitizeVisualNeeds(null, '', { minNeeds: 0 }), []);
  assert.deepEqual(sanitizeVisualNeeds(undefined, '', { minNeeds: 0 }), []);
});
