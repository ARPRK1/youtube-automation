// Stage 5 (visual assembly): renders each segment's already-sourced asset
// (from lib/media-sourcing.js -- real photo/video or AI fallback, already
// vision-verified) into a clip, then joins them with a mix of crossfades
// and hard cuts for pace, matching the exact real audio timeline with no
// drift (see the transition-budgeting comment on buildTransitionPlan).

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';
import { loadConfig } from './config.js';

const FPS = 25;
const XFADE_OVERLAP_SEC = 0.4;
// "Hard cuts" are also rendered via xfade (a very short one), not the
// concat filter -- see the note on buildTransitionPlan/the render loop
// below for why mixing concat and xfade in the same filter_complex is
// what actually broke long videos, not transition variety.
const HARD_CUT_XFADE_SEC = 0.05;
// More hard cuts than slow fades: professional editors cut on beats;
// wall-to-wall crossfades read as "slideshow template".
const HARD_CUT_PROBABILITY = 0.55;
// Every non-cut transition used to be a plain crossfade -- ffmpeg's xfade
// filter supports dozens of built-in transition styles for the same cost
// (one filter, no extra render pass), so picking from a real variety here
// is free visual polish, not a new dependency. A first attempt included
// the fancier styles (circleopen, dissolve, radial, smoothleft/right) and
// broke long-form video assembly: "const_values array too small for
// transition" / "Not yet implemented in FFmpeg, patches welcome". That
// turned out to be a red herring, though -- restricting to this
// "original" xfade set still failed the same way on longer scripts.
// Isolated live, with a battery of chained-filter tests directly against
// the GitHub Actions runner's ffmpeg (6.1.1): a long chain of ONLY xfade
// filters (even varying transition types) renders fine at 15+ clips, and
// a long chain of ONLY concat (hard cuts) renders fine -- but MIXING
// concat and xfade in the same filter_complex breaks partway through the
// chain every time, corrupting later xfade instances' own transition
// value into "undefined" regardless of what was actually requested. The
// real fix (see the render loop below) is to never use concat at all --
// every transition, including "cuts", goes through xfade, just with a
// very short duration for the cut case.
// Stick to transitions every Actions-runner ffmpeg (6.1.x) is known to
// support in long chains. A previous wider set (and even this wipe/slide
// set under some builds) produced filter_complex strings where every
// xfade showed `transition=undefined` and failed with "const_values array
// too small for transition" -- confirmed live on the 11-segment
// "Pythons Invade Florida" long-form render (run 29829542423). Plain
// `fade` is the universal baseline; wipes/slides are re-enabled only after
// an isolated runner check against the exact apt ffmpeg.
const FADE_TRANSITION_TYPES = ['fade'];

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
  // Snappier motion so short beats (3–5s) still feel alive, not frozen.
  const rate = 0.0035 + ((h >> 4) % 9) * 0.0005; // 0.0035 .. 0.0075
  const zoomOut = (h >> 8) % 3 === 0;
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

// "Draw-on" reveal for whiteboard/diagram AI beats (2026-07-29): viewer
// feedback was that these beats read as "an image popping up" rather than
// looking drawn/written like an actual whiteboard explainer. AI image
// models (Pollinations/Flux) only produce flat raster output, not stroke
// data, so there's no real pen path to animate -- the illusion instead
// comes from progressively uncovering the finished image behind a sliding
// white "cover" (like paper being pulled back) plus a small marker-colored
// bar riding the reveal edge as a pen/cursor cue, then handing off to the
// existing Ken Burns hold/pan for the rest of the beat. Deliberately NOT
// using xfade for this: the transition-plan comments above document that
// exotic xfade transition types (wipe/circle/etc.) broke on this exact
// Actions-runner ffmpeg build in long chains, so the reveal is built
// entirely from `overlay` + `drawbox` with `t`-based expressions instead --
// both proven safe, standard, per-frame-animatable filters (verified
// locally: crop's own w/h expressions do NOT re-evaluate per frame, which
// is why this uses a sliding overlay rather than an animated crop).
const WHITEBOARD_REVEAL_STYLES = new Set(['whiteboard', 'diagram']);
// Below this, a beat is too short for a reveal to read as anything but a
// flicker -- just fall through to the plain Ken Burns path.
const WHITEBOARD_REVEAL_MIN_BEAT_SEC = 3.2;
const WHITEBOARD_REVEAL_FRACTION = 0.45;
const WHITEBOARD_REVEAL_MIN_SEC = 1.4;
const WHITEBOARD_REVEAL_MAX_SEC = 3.5;
// How much of the beat must remain for the hold/pan phase after reveal.
const WHITEBOARD_REVEAL_HOLD_FLOOR_SEC = 0.8;
const WHITEBOARD_REVEAL_DIRECTIONS = ['left', 'right', 'top'];
const WHITEBOARD_PEN_COLOR = '2f6fed'; // marker-blue

/** Deterministic per-beat direction pick (same "vary by seed, not
 * Math.random()" reasoning as kenBurnsParamsFor -- reproducible reruns,
 * no visually-identical reveal on every whiteboard beat in a video). */
function revealDirectionFor(seed) {
  const h = hashString(`${seed}-reveal`);
  return WHITEBOARD_REVEAL_DIRECTIONS[h % WHITEBOARD_REVEAL_DIRECTIONS.length];
}

function revealSecondsFor(durationSec) {
  const cap = Math.min(WHITEBOARD_REVEAL_MAX_SEC, durationSec - WHITEBOARD_REVEAL_HOLD_FLOOR_SEC);
  return Math.max(WHITEBOARD_REVEAL_MIN_SEC, Math.min(cap, durationSec * WHITEBOARD_REVEAL_FRACTION));
}

/** Builds the sliding-cover + pen-bar geometry for one direction. All
 * expressions use ffmpeg's own `t` (seconds into this phase's clip) --
 * `\,` escapes are for ffmpeg's filtergraph parser, not the shell (args
 * reach ffmpeg via spawn(), never a shell -- see runFfmpeg). */
function buildRevealGeometry(direction, w, h, revealSec) {
  const barPx = Math.max(4, Math.round(Math.min(w, h) * 0.012));
  const R = revealSec;
  if (direction === 'right') {
    return {
      coverX: `if(lt(t\\,${R})\\,-(t*${w}/${R})\\,-${w})`,
      coverY: '0',
      barX: `min(${w - barPx}\\,max(0\\,${w}-(t*${w}/${R})-${barPx / 2}))`,
      barY: '0',
      barW: barPx,
      barH: h
    };
  }
  if (direction === 'top') {
    return {
      coverX: '0',
      coverY: `if(lt(t\\,${R})\\,t*${h}/${R}\\,${h})`,
      barX: '0',
      barY: `min(${h - barPx}\\,max(0\\,t*${h}/${R}-${barPx / 2}))`,
      barW: w,
      barH: barPx
    };
  }
  // 'left' (default): cover slides right and off, revealing left-to-right.
  return {
    coverX: `if(lt(t\\,${R})\\,t*${w}/${R}\\,${w})`,
    coverY: '0',
    barX: `min(${w - barPx}\\,max(0\\,t*${w}/${R}-${barPx / 2}))`,
    barY: '0',
    barW: barPx,
    barH: h
  };
}

/** Renders just the reveal phase: the still image progressively uncovered
 * from behind a white cover, with a marker-bar cue riding the edge. */
async function renderRevealPhase(sourcePath, revealSec, w, h, outPath, direction) {
  const geo = buildRevealGeometry(direction, w, h, revealSec);
  const filter =
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[img];` +
    `[1:v]setpts=PTS-STARTPTS[cover];` +
    `[img][cover]overlay=x='${geo.coverX}':y='${geo.coverY}':eval=frame[base];` +
    `[base]drawbox=x='${geo.barX}':y='${geo.barY}':w=${geo.barW}:h=${geo.barH}:color=0x${WHITEBOARD_PEN_COLOR}@0.85:t=fill:enable='lt(t\\,${revealSec})'[revealed]`;
  await runFfmpeg([
    '-loop', '1', '-i', sourcePath,
    '-f', 'lavfi', '-i', `color=white:size=${w}x${h}:d=${revealSec}`,
    '-t', String(revealSec),
    '-filter_complex', filter,
    '-map', '[revealed]',
    '-r', String(FPS), '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

/** Joins the reveal-phase clip and the Ken-Burns hold-phase clip into one
 * beat clip. Safe to use the concat FILTER here (unlike renderVisualTimeline
 * below) because this is an isolated 2-input graph with no xfade in it --
 * the documented concat+xfade breakage only showed up mixing the two
 * filter families across one long many-clip chain. */
async function concatPhaseClips(clipPaths, outPath) {
  const inputs = clipPaths.flatMap((p) => ['-i', p]);
  const filterParts = clipPaths.map((_, i) => `[${i}:v]${COMMON_TIMEBASE}[c${i}]`);
  filterParts.push(`${clipPaths.map((_, i) => `[c${i}]`).join('')}concat=n=${clipPaths.length}:v=1:a=0[outv]`);
  await runFfmpeg([
    ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

/** Full two-phase whiteboard clip: draw-on reveal, then the existing Ken
 * Burns hold/pan on the now-complete image for the rest of the beat. */
async function renderWhiteboardRevealClip(sourcePath, durationSec, w, h, outPath, seed) {
  const direction = revealDirectionFor(seed);
  const revealSec = revealSecondsFor(durationSec);
  const holdSec = durationSec - revealSec;
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-wbreveal-'));
  try {
    const phaseAPath = path.join(tmpDir, 'phaseA.mp4');
    const phaseBPath = path.join(tmpDir, 'phaseB.mp4');
    await renderRevealPhase(sourcePath, revealSec, w, h, phaseAPath, direction);
    await renderImageClip(sourcePath, holdSec, w, h, phaseBPath, `${seed}-hold`);
    await concatPhaseClips([phaseAPath, phaseBPath], outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function shouldApplyWhiteboardReveal(item, durationSec, config) {
  if (config.video?.whiteboard_reveal_enabled === false) return false;
  if (!item.artStyle || !WHITEBOARD_REVEAL_STYLES.has(item.artStyle)) return false;
  return durationSec >= WHITEBOARD_REVEAL_MIN_BEAT_SEC;
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
 * duration despite that overlap, only the INCOMING clip of a transition
 * is rendered `overlap` seconds longer than its nominal duration -- that
 * extra material is exactly what gets consumed by the blend, leaving
 * `durationSec` of unique visible time afterward. Without this, N
 * crossfades would drift the video `overlap * N` seconds out of sync
 * with the (exactly, sequentially concatenated) audio track. 'cut'
 * entries get the same treatment with a much smaller overlap (see
 * overlapFor) -- they're a real xfade too, not a concat, so the same
 * bookkeeping applies just with a near-zero duration.
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

function overlapFor(transition) {
  return transition === 'cut' ? HARD_CUT_XFADE_SEC : XFADE_OVERLAP_SEC;
}

/**
 * Renders the full background video for a set of already-sourced assets.
 * `items`: [{ buffer, type: 'image'|'video', durationSec, seed }]
 * Returns the output path.
 */
export async function renderVisualTimeline({ items, aspect, outPath, seed = 'timeline' }) {
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const config = loadConfig();
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-visuals-'));
  const transitions = buildTransitionPlan(items.length, seed);

  try {
    const clipPaths = [];
    for (const [i, item] of items.entries()) {
      const renderDuration = item.durationSec + (i > 0 ? overlapFor(transitions[i - 1]) : 0);
      const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
      const itemSeed = item.seed || `${seed}-${i}`;

      if (item.buffer && item.type === 'video') {
        const srcPath = path.join(tmpDir, `src-${i}.mp4`);
        await writeFile(srcPath, item.buffer);
        await renderVideoClip(srcPath, renderDuration, w, h, clipPath);
      } else if (item.buffer && item.type === 'image') {
        const srcPath = path.join(tmpDir, `src-${i}.jpg`);
        await writeFile(srcPath, item.buffer);
        if (shouldApplyWhiteboardReveal(item, item.durationSec, config)) {
          await renderWhiteboardRevealClip(srcPath, renderDuration, w, h, clipPath, itemSeed);
        } else {
          await renderImageClip(srcPath, renderDuration, w, h, clipPath, itemSeed);
        }
      } else {
        await renderGradientClip(itemSeed, renderDuration, w, h, clipPath);
      }
      clipPaths.push(clipPath);
    }

    if (clipPaths.length === 1) {
      await runFfmpeg(['-i', clipPaths[0], '-c', 'copy', outPath]);
      return outPath;
    }

    // Fold the clips together left-to-right with xfade for EVERY
    // transition, including "cuts" (a very short xfade, see
    // HARD_CUT_XFADE_SEC) -- never concat. Mixing concat and xfade in the
    // same filter_complex is what actually broke longer videos: isolated
    // live with direct chained-filter tests against this exact ffmpeg
    // build, a long chain of only-xfade (even with varied transition
    // types) renders fine, and a long chain of only-concat renders fine,
    // but alternating between the two corrupts later xfade instances in
    // the chain (their transition value reads back as "undefined",
    // regardless of what was requested) once enough alternations
    // accumulate. Staying in one filter family avoids it entirely.
    const inputs = clipPaths.flatMap((p) => ['-i', p]);
    const filterParts = [];
    // `settb` baked into each source clip's OWN render (see COMMON_TIMEBASE
    // above) does not reliably survive being muxed to MP4 and re-demuxed --
    // confirmed live: a zoompan-sourced clip still reports its native
    // 1/12800 timebase when read back as an input here, despite the
    // trailing settb filter used when it was rendered. The only place
    // settb reliably sticks is applied fresh, inside THIS filter graph,
    // immediately on each input before it touches xfade.
    filterParts.push(`[0:v]${COMMON_TIMEBASE}[v0n]`);
    let current = '[v0n]';
    let runningTotal = items[0].durationSec;

    for (let i = 1; i < clipPaths.length; i++) {
      const isLast = i === clipPaths.length - 1;
      const next = `[v${i}n]`;
      filterParts.push(`[${i}:v]${COMMON_TIMEBASE}${next}`);
      const out = isLast ? '[outv]' : `[m${i}]`;
      // Always resolve to a known-good xfade name. An undefined/unknown
      // value stringifies into the filtergraph as the literal "undefined",
      // which is exactly the failure mode seen on long-form chains.
      const rawTransition = transitions[i - 1];
      const transitionType =
        rawTransition === 'cut' || !FADE_TRANSITION_TYPES.includes(rawTransition)
          ? 'fade'
          : rawTransition;
      const overlap = overlapFor(rawTransition === 'cut' ? 'cut' : transitionType);
      const offset = Math.max(0, runningTotal - overlap);
      filterParts.push(`${current}${next}xfade=transition=${transitionType}:duration=${overlap}:offset=${offset.toFixed(3)}${out}`);
      runningTotal += items[i].durationSec;
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
