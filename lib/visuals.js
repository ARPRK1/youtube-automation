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
// Every non-cut transition used to be a plain crossfade -- ffmpeg's xfade
// filter supports dozens of built-in transition styles for the same cost
// (one filter, no extra render pass), so picking from a real variety here
// is free visual polish, not a new dependency. A first attempt included
// the fancier styles (circleopen, dissolve, radial, smoothleft/right) and
// broke long-form video assembly outright: "const_values array too small
// for transition" / "Not yet implemented in FFmpeg, patches welcome" on
// the GitHub Actions runner's ffmpeg (6.1.1), confirmed live -- despite
// all of them being listed as valid options by `ffmpeg -h filter=xfade`
// on that same build. The reproducible factor is chaining multiple xfade
// instances in one filter_complex (each one's input is the PREVIOUS
// xfade's output, not a raw decoded stream, which is exactly what
// rendering N>2 clips together requires) -- the newer/fancier transition
// implementations are known to be more fragile under that pattern.
// Restricted to the original xfade transition set (introduced together
// when the filter first shipped in ffmpeg 4.3), which is the most
// battle-tested and didn't reproduce the failure.
const FADE_TRANSITION_TYPES = ['fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown'];

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
  // The original 0.0005-0.0011 range shifts edge pixels well under 1px per
  // frame at 1080p -- confirmed live: ffmpeg's freezedetect (noise floor
  // -60dB) flagged nearly continuous freeze gaps throughout a real video
  // because the actual per-frame motion was too subtle to register at all,
  // not because of any duplicate/static content. This range give a still-
  // gentle but clearly-registering pan/zoom.
  const rate = 0.0022 + ((h >> 4) % 7) * 0.0004; // 0.0022 .. 0.0046
  const zoomOut = (h >> 8) % 3 === 0; // ~1/3 of segments zoom out instead of in
  return { anchor, rate, zoomOut };
}

async function downloadTo(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

// zoompan generates frames on an internal high-precision timebase for
// smooth sub-frame zoom interpolation (observed live: 1/12800, i.e.
// 1/(fps*512)) that doesn't match the plain 1/1000000 timebase plain
// scale/lavfi clips get from the encoder -- xfade refuses to blend two
// inputs with different timebases outright ("First input link main
// timebase... do not match"). Forcing every clip to the same explicit
// timebase before output means all of them agree regardless of which
// filter chain produced them.
const COMMON_TIMEBASE = `settb=1/${FPS}`;

async function renderVideoClip(sourcePath, durationSec, w, h, outPath) {
  await runFfmpeg([
    '-stream_loop', '-1', '-i', sourcePath,
    '-t', String(durationSec),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},${COMMON_TIMEBASE}`,
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
    '-vf', `scale=${w * 2}:${h * 2},zoompan=z='${zExpr}':x='${anchor.x}':y='${anchor.y}':d=${frames}:s=${w}x${h}:fps=${FPS},setsar=1,${COMMON_TIMEBASE}`,
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
    '-vf', `setsar=1,${COMMON_TIMEBASE}`,
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
    const h = hashString(`${seed}-t${i}`);
    const isCut = (h % 100) / 100 < HARD_CUT_PROBABILITY;
    transitions.push(isCut ? 'cut' : FADE_TRANSITION_TYPES[(h >> 8) % FADE_TRANSITION_TYPES.length]);
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
      const incomingIsFade = i > 0 && transitions[i - 1] !== 'cut';
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
    // `settb` baked into each source clip's OWN render (see COMMON_TIMEBASE
    // above) does not reliably survive being muxed to MP4 and re-demuxed --
    // confirmed live: a zoompan-sourced clip still reports its native
    // 1/12800 timebase when read back as an input here, despite the
    // trailing settb filter used when it was rendered. The only place
    // settb reliably sticks is applied fresh, inside THIS filter graph,
    // immediately on each input before it touches xfade/concat.
    filterParts.push(`[0:v]${COMMON_TIMEBASE}[v0n]`);
    let current = '[v0n]';
    let runningTotal = items[0].durationSec;

    for (let i = 1; i < clipPaths.length; i++) {
      const isLast = i === clipPaths.length - 1;
      const next = `[v${i}n]`;
      filterParts.push(`[${i}:v]${COMMON_TIMEBASE}${next}`);
      const out = isLast ? '[outv]' : `[m${i}]`;
      if (transitions[i - 1] !== 'cut') {
        const offset = Math.max(0, runningTotal - XFADE_OVERLAP_SEC);
        filterParts.push(`${current}${next}xfade=transition=${transitions[i - 1]}:duration=${XFADE_OVERLAP_SEC}:offset=${offset.toFixed(3)}${out}`);
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
