// Reference-voice curation (P0). Analyzes voice-sample/reference.wav and
// exports voice-sample/reference-clean.wav — a single clean, continuous
// 8–15s slice of the owner's speech, normalized, for Chatterbox to clone
// from. Zero-shot cloning conditions on the WHOLE reference prompt, so a
// long clip padded with silence, breaths, or room noise dilutes the style
// it captures. A tight clean take is measurably a better prompt than the
// raw 57s file.
//
// Strategy (all via ffmpeg + ffprobe, no extra deps):
// 1. Probe duration + mean/max volume (sanity: is there real signal?).
// 2. Use silencedetect to find non-silent spans.
// 3. Pick the longest continuous voiced span; take a window from it that is
//    at least MIN_SEC and at most MAX_SEC, starting a beat after the span
//    begins (skip the initial attack/breath).
// 4. Trim → mono 24kHz (Chatterbox's native rate) → gentle loudnorm.
//
// Usage:
//   node scripts/prepare-reference-voice.mjs            # default in/out
//   node scripts/prepare-reference-voice.mjs in.wav out.wav
//   node scripts/prepare-reference-voice.mjs --start 12.5 --dur 11
//     (manual override: take exactly this window — use after listening)

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';

const MIN_SEC = 8;
const MAX_SEC = 15;
const SILENCE_DB = -34;         // below this is "silence" for span detection
const SILENCE_MIN_GAP = 0.35;   // a gap must last this long to split spans
const LEAD_SKIP = 0.15;         // skip this much at the start of a voiced span

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      // ffmpeg writes analysis to stderr and exits 0 on the null muxer.
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--start') opts.start = parseFloat(argv[++i]);
    else if (argv[i] === '--dur') opts.dur = parseFloat(argv[++i]);
    else positional.push(argv[i]);
  }
  return { positional, opts };
}

async function probeDuration(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file
  ]);
  return parseFloat(stdout.trim());
}

async function probeVolume(file) {
  const { stderr } = await run(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  const max = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  return { meanDb: mean ? parseFloat(mean[1]) : null, maxDb: max ? parseFloat(max[1]) : null };
}

/** Returns voiced [start,end] spans by inverting ffmpeg silencedetect. */
async function detectVoicedSpans(file, totalDur) {
  const { stderr } = await run(FFMPEG, [
    '-hide_banner', '-i', file,
    '-af', `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN_GAP}`,
    '-f', 'null', '-'
  ]);
  const silences = [];
  const startRe = /silence_start:\s*(-?[\d.]+)/g;
  const endRe = /silence_end:\s*([\d.]+)/g;
  const starts = [...stderr.matchAll(startRe)].map((m) => parseFloat(m[1]));
  const ends = [...stderr.matchAll(endRe)].map((m) => parseFloat(m[1]));
  for (let i = 0; i < starts.length; i++) {
    silences.push({ start: Math.max(0, starts[i]), end: ends[i] ?? totalDur });
  }
  // Invert: voiced spans are the gaps between silences.
  const voiced = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor + 0.05) voiced.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < totalDur - 0.05) voiced.push({ start: cursor, end: totalDur });
  return voiced.filter((v) => v.end - v.start > 0.4);
}

function pickWindow(spans, totalDur) {
  if (spans.length === 0) {
    // No silence structure detected — just take a centered window.
    const dur = Math.min(MAX_SEC, Math.max(MIN_SEC, totalDur * 0.5));
    const start = Math.max(0, (totalDur - dur) / 2);
    return { start, dur, reason: 'no silence structure; centered window' };
  }
  // Longest voiced span is the most likely to be a fluent, continuous take.
  const longest = spans.reduce((best, s) => (s.end - s.start > best.end - best.start ? s : best), spans[0]);
  const spanLen = longest.end - longest.start;
  const start = longest.start + LEAD_SKIP;
  const dur = Math.min(MAX_SEC, Math.max(MIN_SEC, Math.min(spanLen - LEAD_SKIP, MAX_SEC)));
  // If the longest span is shorter than MIN_SEC, widen to neighbors by just
  // taking a window from its start capped to what's available.
  const safeDur = Math.max(2, Math.min(dur, totalDur - start));
  return { start, dur: safeDur, reason: `longest voiced span ${longest.start.toFixed(1)}–${longest.end.toFixed(1)}s (${spanLen.toFixed(1)}s)` };
}

async function exportClip(inFile, outFile, start, dur) {
  await run(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', inFile,
    '-ac', '1', '-ar', '24000',
    '-af', 'loudnorm=I=-18:TP=-2:LRA=11',
    '-c:a', 'pcm_s16le',
    outFile
  ]);
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const inFile = positional[0] || 'voice-sample/reference.wav';
  const outFile = positional[1] || 'voice-sample/reference-clean.wav';

  try {
    await access(inFile);
  } catch {
    console.error(`[prepare-reference] input not found: ${inFile}`);
    process.exitCode = 1;
    return;
  }

  const totalDur = await probeDuration(inFile);
  const vol = await probeVolume(inFile);
  console.log(`[prepare-reference] ${path.basename(inFile)}: ${totalDur.toFixed(1)}s, mean ${vol.meanDb ?? '?'}dB, max ${vol.maxDb ?? '?'}dB`);

  if (vol.maxDb !== null && vol.maxDb < -20) {
    console.warn('[prepare-reference] WARNING: recording is quiet (max < -20dB). Re-record closer to the mic; loudnorm will lift it but a quiet source clones worse.');
  }

  let start; let dur; let reason;
  if (Number.isFinite(opts.start)) {
    start = opts.start;
    dur = Number.isFinite(opts.dur) ? opts.dur : Math.min(MAX_SEC, Math.max(MIN_SEC, totalDur - start));
    reason = 'manual --start/--dur override';
  } else {
    const spans = await detectVoicedSpans(inFile, totalDur);
    console.log(`[prepare-reference] ${spans.length} voiced span(s) detected`);
    ({ start, dur, reason } = pickWindow(spans, totalDur));
  }

  start = Math.max(0, Math.min(start, Math.max(0, totalDur - 2)));
  dur = Math.max(2, Math.min(dur, totalDur - start));

  console.log(`[prepare-reference] taking ${start.toFixed(2)}s → ${(start + dur).toFixed(2)}s (${dur.toFixed(1)}s) — ${reason}`);
  await exportClip(inFile, outFile, start, dur);
  const outDur = await probeDuration(outFile);
  console.log(`[prepare-reference] wrote ${outFile} (${outDur.toFixed(1)}s, mono 24kHz, normalized)`);
  console.log('[prepare-reference] LISTEN to it. If it caught a bad phrase or a breath, re-run with e.g. --start 14 --dur 11');
}

main();
