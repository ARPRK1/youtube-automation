// Stage 5 (visual assembly): renders each segment's already-sourced asset
// (from lib/media-sourcing.js -- real photo/video or AI fallback, already
// vision-verified) into a clip, then joins them with a mix of crossfades
// and hard cuts for pace, matching the exact real audio timeline with no
// drift (see the transition-budgeting comment on buildTransitionPlan).

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';

const FPS = 25;
const XFADE_OVERLAP_SEC = 0.4;
const HARD_CUT_PROBABILITY = 0.3; // ~30% of transitions are cuts, not fades -- "no two look alike" needs some rhythm variation too

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const GRADIENT_PAIRS = [
  ['1a1a2e', '16213e'], ['0f2027', '2c5364'], ['232526', '414345'],
  ['1e130c', '9a8478'], ['141e30', '243b55'], ['200122', '6f0000']
];

/** Five Ken Burns variants (zoom toward a different anchor point each
 * time) plus a small deterministic-but-varied zoom rate per segment, so
 * consecutive images don't all pan the same way -- a flat, uniform Ken
 * Burns effect across every segment is itself a "this was auto-generated"
 * tell. Deterministic (seeded by the segment's own text) rather than
 * Math.random() so re-running the same script twice reproduces the same
 * video, which matters for debugging. */
const KEN_BURNS_ANCHORS = [
  { x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2' }, // center
  { x: '0', y: '0' }, // top-left
  { x: 'iw-iw/zoom', y: '0' }, // top-right
  { x: '0', y: 'ih-ih/zoom' }, // bottom-left
  { x: 'iw-iw/zoom', y: 'ih-ih/zoom' } // bottom-right
];

function kenBurnsParamsFor(seed) {
  const h = hashString(seed);
  const anchor = KEN_BURNS_ANCHORS[h % KEN_BURNS_ANCHORS.length];
  const rate = 0.0005 + ((h >> 4) % 7) * 0.0001; // 0.0005 .. 0.0011
  const zoomOut = (h >> 8) % 3 === 0; // ~1/3 of segments zoom out instead of in
  return { anchor, rate, zoomOut };
}

async function downloadTo(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

async function renderVideoClip(sourcePath, durationSec, w, h, outPath) {
  await runFfmpeg([
    '-stream_loop', '-1', '-i', sourcePath,
    '-t', String(durationSec),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS}`,
    '-an', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

async function renderImageClip(sourcePath, durationSec, w, h, outPath, seed) {
  const { anchor, rate, zoomOut } = kenBurnsParamsFor(seed);
  const frames = Math.ceil(durationSec * FPS);
  const maxZoom = 1 + rate * frames;
  // zoompan's `zoom` expr is evaluated per-frame and must reference its own
  // previous value via `zoom` to animate; zoomOut just runs the same ramp
  // starting near max and counting down.
  const zExpr = zoomOut ? `if(eq(on,0),${maxZoom.toFixed(4)},max(zoom-${rate},1))` : `min(zoom+${rate},${maxZoom.toFixed(4)})`;
  await runFfmpeg([
    '-loop', '1', '-i', sourcePath,
    '-vf', `scale=${w * 2}:${h * 2},zoompan=z='${zExpr}':x='${anchor.x}':y='${anchor.y}':d=${frames}:s=${w}x${h}:fps=${FPS},setsar=1`,
    '-t', String(durationSec),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

async function renderGradientClip(seed, durationSec, w, h, outPath) {
  const [c1, c2] = GRADIENT_PAIRS[hashString(seed) % GRADIENT_PAIRS.length];
  await runFfmpeg([
    '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=0x${c1}:c1=0x${c2}:d=${durationSec}:speed=0.01`,
    '-vf', 'setsar=1',
    '-t', String(durationSec), '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

/**
 * Decides fade-vs-cut per transition (deterministic per video via `seed`)
 * and how much extra tail each clip needs rendered so crossfading doesn't
 * shorten (or drift) the timeline. The xfade filter overlaps the last
 * `overlap` seconds of the outgoing clip with the first `overlap` seconds
 * of the incoming one, producing combined length = lenA + lenB - overlap.
 * To keep each segment's VISIBLE duration equal to its real audio
 * duration despite that overlap, only the INCOMING clip of a fade
 * transition is rendered `overlap` seconds longer than its nominal
 * duration -- that extra material is exactly what gets consumed by the
 * blend, leaving `durationSec` of unique visible time afterward. Without
 * this, N crossfades would drift the video `overlap * N` seconds out of
 * sync with the (exactly, sequentially concatenated) audio track.
 */
function buildTransitionPlan(segmentCount, seed) {
  const transitions = [];
  for (let i = 0; i < segmentCount - 1; i++) {
    const isCut = (hashString(`${seed}-t${i}`) % 100) / 100 < HARD_CUT_PROBABILITY;
    transitions.push(isCut ? 'cut' : 'fade');
  }
  return transitions;
}

/**
 * Renders the full background video for a set of already-sourced assets.
 * `items`: [{ buffer, type: 'image'|'video', durationSec, seed }]
 * Returns the output path.
 */
export async function renderVisualTimeline({ items, aspect, outPath, seed = 'timeline' }) {
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-visuals-'));
  const transitions = buildTransitionPlan(items.length, seed);

  try {
    const clipPaths = [];
    for (const [i, item] of items.entries()) {
      const incomingIsFade = i > 0 && transitions[i - 1] === 'fade';
      const renderDuration = item.durationSec + (incomingIsFade ? XFADE_OVERLAP_SEC : 0);
      const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
      const itemSeed = item.seed || `${seed}-${i}`;

      if (item.buffer && item.type === 'video') {
        const srcPath = path.join(tmpDir, `src-${i}.mp4`);
        await writeFile(srcPath, item.buffer);
        await renderVideoClip(srcPath, renderDuration, w, h, clipPath);
      } else if (item.buffer && item.type === 'image') {
        const srcPath = path.join(tmpDir, `src-${i}.jpg`);
        await writeFile(srcPath, item.buffer);
        await renderImageClip(srcPath, renderDuration, w, h, clipPath, itemSeed);
      } else {
        await renderGradientClip(itemSeed, renderDuration, w, h, clipPath);
      }
      clipPaths.push(clipPath);
    }

    if (clipPaths.length === 1) {
      await runFfmpeg(['-i', clipPaths[0], '-c', 'copy', outPath]);
      return outPath;
    }

    // Fold the clips together left-to-right: cuts via concat demuxer would
    // be simplest, but mixing cut and fade transitions in one pass means
    // building a single filter_complex chain so ffmpeg only has to decode
    // each clip once.
    const inputs = clipPaths.flatMap((p) => ['-i', p]);
    const filterParts = [];
    let current = '[0:v]';
    let runningTotal = items[0].durationSec;

    for (let i = 1; i < clipPaths.length; i++) {
      const next = `[${i}:v]`;
      const out = i === clipPaths.length - 1 ? '[outv]' : `[m${i}]`;
      if (transitions[i - 1] === 'fade') {
        const offset = Math.max(0, runningTotal - XFADE_OVERLAP_SEC);
        filterParts.push(`${current}${next}xfade=transition=fade:duration=${XFADE_OVERLAP_SEC}:offset=${offset.toFixed(3)}${out}`);
        runningTotal += items[i].durationSec;
      } else {
        // Hard cut inside a filter_complex: concat expects matching
        // formats, which our clips already share (same fps/pix_fmt/size).
        filterParts.push(`${current}${next}concat=n=2:v=1:a=0${out}`);
        runningTotal += items[i].durationSec;
      }
      current = out;
    }

    await runFfmpeg([
      ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      outPath
    ]);
    return outPath;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
