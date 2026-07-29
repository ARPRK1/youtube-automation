#!/usr/bin/env node
// One-off smoke test for the whiteboard/diagram draw-on reveal effect
// (lib/visuals.js#renderWhiteboardRevealClip). Not part of the daily
// pipeline -- only run via the "Whiteboard reveal smoke test"
// workflow_dispatch, to validate the ffmpeg filter chain (overlay+drawbox
// with t-based expressions) against this repo's actual Actions-runner
// ffmpeg build (apt's 6.1.x), separate from local dev machines that may
// run a much newer ffmpeg. Uses a synthetic test-pattern image instead of
// a real Pollinations call, so it costs no LLM/API quota.

import { execFileSync } from 'node:child_process';
import { renderVisualTimeline } from '../lib/visuals.js';
import { readFile } from 'node:fs/promises';

const SRC = 'wb-smoke-src.jpg';
const OUT = 'wb-smoke-out.mp4';

execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=1:duration=1', '-frames:v', '1', '-update', '1', SRC]);
const buffer = await readFile(SRC);

const items = [
  { type: 'image', buffer, durationSec: 5, seed: 'seg0-b0', artStyle: 'cinematic' }, // primary -- must NOT reveal
  { type: 'image', buffer, durationSec: 4.5, seed: 'seg0-b1', artStyle: 'whiteboard' }, // must reveal
  { type: 'image', buffer, durationSec: 4.5, seed: 'seg0-b2', artStyle: 'diagram' }, // must reveal
  { type: 'image', buffer, durationSec: 2.0, seed: 'seg0-b3', artStyle: 'whiteboard' } // too short -- must NOT reveal
];

console.log('[wb-smoke] rendering...');
await renderVisualTimeline({ items, aspect: 'landscape', outPath: OUT, seed: 'wb-smoke' });
console.log(`[wb-smoke] done: ${OUT}`);
