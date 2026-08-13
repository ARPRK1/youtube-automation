import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapHookText } from '../lib/assemble.js';

test('strips #Shorts, uppercases, and wraps into short lines', () => {
  const out = wrapHookText('The Country With No Rivers #Shorts');
  const lines = out.split('\n');
  assert.ok(lines.length >= 1 && lines.length <= 3);
  assert.ok(!/#/.test(out));
  assert.equal(out, out.toUpperCase());
  for (const l of lines) assert.ok(l.length <= 17, `line too long: "${l}"`);
});

test('empty / falsy input yields empty string', () => {
  assert.equal(wrapHookText(''), '');
  assert.equal(wrapHookText(null), '');
  assert.equal(wrapHookText('   #Shorts '), '');
});

test('caps at maxLines and marks truncation with an ellipsis', () => {
  const out = wrapHookText('one two three four five six seven eight nine ten eleven twelve', 8, 2);
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(out.endsWith('…'), `expected ellipsis, got "${out}"`);
});

test('removes smart quotes so drawtext never chokes on them', () => {
  const out = wrapHookText('“Biryani” isn’t Indian');
  assert.ok(!/[“”‘’]/.test(out));
});
