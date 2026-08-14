import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVisualNeeds, NSFW_VISUAL_RE } from '../lib/script-writer.js';

// STRICT content-safety guard (owner 2026-08-14: a "belly button" topic pulled
// a nude medical image from stock search). These lock the deterministic layer
// so anatomical/explicit visual queries can never be sourced.

test('the belly-button / navel case is blocked from visual_needs', () => {
  const out = sanitizeVisualNeeds(
    ['belly button', 'navel close up', 'human anatomy diagram', 'a ship'],
    'A ship sailed across the ocean to a distant port.',
    { neverPeople: true, minNeeds: 1 }
  );
  assert.ok(!out.some((t) => /belly|navel|anatomy/i.test(t)), `explicit/anatomical terms leaked: ${JSON.stringify(out)}`);
});

test('explicit terms are all caught by NSFW_VISUAL_RE', () => {
  const bad = ['nude', 'naked woman', 'topless', 'genitalia', 'breast', 'nipple',
    'lingerie', 'bikini model', 'erotic scene', 'porn', 'belly button', 'navel',
    'buttocks', 'cleavage', 'autopsy', 'corpse', 'gore'];
  for (const t of bad) assert.ok(NSFW_VISUAL_RE.test(t), `should block: "${t}"`);
});

test('innocent object/place terms are NOT blocked', () => {
  const ok = ['sandy island map', 'naval ship', 'goldfish bowl', 'lightning bolt',
    'egg shell', 'google maps pin', 'whaling ship woodcut', 'desert coastline'];
  for (const t of ok) assert.ok(!NSFW_VISUAL_RE.test(t), `should NOT block: "${t}"`);
});

test('sanitize backfill also refuses explicit proper nouns', () => {
  // Narration mentions an anatomical term; backfill must not surface it.
  const out = sanitizeVisualNeeds([], 'The Navel Orange is grown in Naked Valley.', { neverPeople: true, minNeeds: 3 });
  assert.ok(!out.some((t) => NSFW_VISUAL_RE.test(t)), `backfill leaked explicit term: ${JSON.stringify(out)}`);
});
