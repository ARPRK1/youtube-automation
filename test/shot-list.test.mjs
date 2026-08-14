import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../lib/script-writer.js';

// The sentence splitter is the alignment contract: media-sourcing times the
// visuals off the SAME split the shot list is generated from, so shot i lines
// up with sentence i's audio window. If this drifts, visuals desync.

test('splits narration into whole sentences', () => {
  const out = splitSentences('Most people think glass is a solid. Actually, it flows. The myth is busted.');
  assert.equal(out.length, 3);
  assert.equal(out[0], 'Most people think glass is a solid.');
  assert.equal(out[2], 'The myth is busted.');
});

test('handles ! and ? and a missing final period', () => {
  const out = splitSentences('Can you guess? Most people cannot! Here is the twist');
  assert.equal(out.length, 3);
  assert.equal(out[2], 'Here is the twist');
});

test('empty / whitespace input yields no sentences', () => {
  assert.deepEqual(splitSentences('   '), []);
  assert.deepEqual(splitSentences(''), []);
});

test('collapses internal whitespace/newlines', () => {
  const out = splitSentences('One thing.\n\n  Another   thing.');
  assert.deepEqual(out, ['One thing.', 'Another thing.']);
});
