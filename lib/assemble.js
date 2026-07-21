import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg, escapeFilterPath, probeDurationSeconds } from './ffmpeg-util.js';
import { writeSrt } from './srt.js';

// The ffmpeg `subtitles` filter needs `original_size` set to the real output
// resolution; without it libass uses a tiny default PlayRes and FontSize
// scales up aggressively (especially on 1080x1920 Shorts).
//
// Style goals (viewer feedback 2026-07): captions must stay small and never
// cover half the frame. Use outline-only (BorderStyle=1), not opaque boxes
// (BorderStyle=3), short phrases, and a modest FontSize relative to height.
// MarginV = distance from bottom for Alignment=2 (bottom-center) -- keeps
// text in the lower safe zone without floating mid-screen.
function captionStyle(aspect) {
  if (aspect === 'vertical') {
    // Shorts 1080x1920: ~1.5% of height per glyph (~28px). 1–2 short lines
    // sit as a thin strip near the bottom, clear of most of the visual.
    return [
      'FontName=Arial',
      'FontSize=28',
      'PrimaryColour=&H00FFFFFF',
      'OutlineColour=&H80000000',
      'BackColour=&H80000000',
      'BorderStyle=1',
      'Outline=2',
      'Shadow=1',
      'Alignment=2',
      'MarginV=120',
      'MarginL=48',
      'MarginR=48',
      'Bold=0'
    ].join(',');
  }
  // Long-form 1920x1080
  return [
    'FontName=Arial',
    'FontSize=30',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H80000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=1',
    'Alignment=2',
    'MarginV=48',
    'MarginL=64',
    'MarginR=64',
    'Bold=0'
  ].join(',');
}

/**
 * Concatenates per-segment narration audio clips (see lib/tts.js -- one
 * clip per script segment, already includes reveal pauses/rate variation)
 * into a single continuous narration track. Plain sequential concat, no
 * overlap -- this track is the master timeline everything else (visual
 * crossfade budgeting, caption offsets) is built to match exactly.
 */
export async function concatSegmentAudio(audioPaths, outPath) {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-audio-'));
  try {
    // outPath is always a .mp3 -- encode with libmp3lame to match, not aac
    // (aac audio inside an .mp3-extensioned container made ffmpeg's mp3
    // muxer reject it outright: "Exactly one MP3 audio stream is
    // required", confirmed live -- every Short failed on this).
    if (audioPaths.length === 1) {
      await runFfmpeg(['-i', audioPaths[0], '-c:a', 'libmp3lame', '-b:a', '160k', outPath]);
      return outPath;
    }
    const listPath = path.join(tmpDir, 'concat.txt');
    // ffmpeg's concat demuxer resolves relative paths in the list file
    // against the list file's OWN directory, not the process cwd --
    // confirmed live: relative segment paths resolved to
    // "<tmpDir>/runs/<date>/...", which doesn't exist. Must be absolute.
    const listContent = audioPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n');
    await writeFile(listPath, listContent, 'utf-8');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-b:a', '160k', outPath]);
    return outPath;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Merges each segment's own caption lines (timed 0..segmentDuration,
 * relative to that segment's own audio) into one SRT for the whole video,
 * offsetting each segment's lines by the cumulative real duration of the
 * segments before it -- matching concatSegmentAudio's master timeline
 * exactly since both are built from the same real per-segment durations.
 */
export async function mergeSegmentCaptions(segmentCaptionLines, outPath) {
  let offset = 0;
  const merged = [];
  for (const { lines, durationSec } of segmentCaptionLines) {
    for (const line of lines) merged.push({ start: line.start + offset, end: line.end + offset, text: line.text });
    offset += durationSec;
  }
  await writeSrt(merged, outPath);
  return outPath;
}

/**
 * Muxes a silent background clip with narration audio and burns in
 * captions from an SRT file. Output length matches the audio (`-shortest`
 * with the background clip already rendered to the audio's duration).
 */
export async function renderFinalVideo({ backgroundClipPath, audioPath, srtPath, outPath, aspect, width, height }) {
  const escapedSrt = escapeFilterPath(srtPath);
  await runFfmpeg([
    '-i', backgroundClipPath,
    '-i', audioPath,
    '-vf', `subtitles='${escapedSrt}':original_size=${width}x${height}:force_style='${captionStyle(aspect)}'`,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    '-shortest',
    outPath
  ]);
}

/**
 * Prepends a (silent, video-only) Remotion-rendered intro clip onto the
 * main narrated video. Uses a re-encoding filter_complex concat rather
 * than stream-copy concat: the intro comes from a different encoder
 * (Remotion/Chromium) than the rest of the pipeline (our own ffmpeg
 * calls), and stream-copy concat is fragile across encoder boundaries
 * even when the codec name matches. A silent audio bed (anullsrc) is
 * generated for the intro's duration so both clips have an audio stream
 * to concatenate.
 */
export async function prependIntro({ introPath, mainPath, outPath, width, height }) {
  const introDuration = await probeDurationSeconds(introPath);
  await runFfmpeg([
    '-i', introPath,
    '-i', mainPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex',
    `[0:v]scale=${width}:${height},setsar=1,fps=25[v0];` +
    `[1:v]scale=${width}:${height},setsar=1,fps=25[v1];` +
    `[2:a]atrim=0:${introDuration},asetpts=PTS-STARTPTS[a0];` +
    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];` +
    `[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`,
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    outPath
  ]);
}
