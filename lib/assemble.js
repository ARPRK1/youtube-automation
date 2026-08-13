import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg, escapeFilterPath, probeDurationSeconds } from './ffmpeg-util.js';
import { writeSrt } from './srt.js';

/** Resolve a bold TTF for drawtext (same rationale as thumbnail.js — fontfile
 * paths are far more reliable across Windows + Ubuntu runners than family
 * names). Returns null if none found, in which case the caller skips the
 * hook overlay rather than risk a "no font" render failure. */
async function resolveBoldFont() {
  const candidates = process.platform === 'win32'
    ? ['C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/segoeuib.ttf']
    : [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'
      ];
  for (const p of candidates) {
    try { await access(p); return p; } catch { /* next */ }
  }
  return null;
}

/** Wrap a hook line into a few short, punchy rows for a big on-screen card.
 * Uppercased for impact; capped so it never becomes a wall of text. */

export function wrapHookText(text, maxCharsPerLine = 16, maxLines = 3) {
  const cleaned = String(text || '')
    .replace(/#\w+/g, '')
    // Strip smart quotes (U+2018/19/1C/1D) + straight quotes so drawtext never
    // has to escape them. Explicit code points — a literal-glyph class is
    // fragile across editor encodings.
    .replace(/[\u2018\u2019\u201C\u201D'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxCharsPerLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length === maxLines - 1) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If we ran out of line budget mid-text, add an ellipsis to the last line.
  const usedWords = lines.join(' ').split(' ').length;
  if (usedWords < words.length) lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  return lines.join('\n');
}

/** Builds the drawtext filter for the opening hook card, or '' if it can't
 * be built (no font, no text). The card shows in the upper third for the
 * first `seconds`, with a soft fade-out, sitting clear of the bottom
 * captions. Uses textfile= to sidestep drawtext's brutal text escaping. */
async function buildHookDrawtext({ hookText, seconds, width, height, tmpDir }) {
  const wrapped = wrapHookText(hookText);
  if (!wrapped) return '';
  const font = await resolveBoldFont();
  if (!font) return '';

  const textFilePath = path.join(tmpDir, 'hook.txt');
  await writeFile(textFilePath, wrapped, 'utf-8');

  const fontSize = Math.round(height / 20);           // ~96px on a 1920-tall Short
  const fadeStart = Math.max(0.2, seconds - 0.4);
  const escFont = escapeFilterPath(font);
  const escText = escapeFilterPath(textFilePath);

  return [
    `drawtext=fontfile='${escFont}'`,
    `textfile='${escText}'`,
    'fontcolor=white',
    `fontsize=${fontSize}`,
    'borderw=6',
    'bordercolor=black@0.9',
    'box=1',
    'boxcolor=black@0.45',
    'boxborderw=28',
    'line_spacing=16',
    'x=(w-text_w)/2',
    `y=h*0.16`,
    // Smooth fade-out in the final ~0.4s of the window; hard on before that.
    `alpha='if(lt(t,${fadeStart.toFixed(2)}),1,max(0,(${seconds.toFixed(2)}-t)/${(seconds - fadeStart).toFixed(2)}))'`,
    `enable='lt(t,${seconds.toFixed(2)})'`
  ].join(':');
}

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
    // Shorts 1080x1920: tiny outline-only strip near the bottom edge.
    return [
      'FontName=Arial',
      'FontSize=22',
      'PrimaryColour=&H00FFFFFF',
      'OutlineColour=&H80000000',
      'BackColour=&H00000000',
      'BorderStyle=1',
      'Outline=1',
      'Shadow=0',
      'Alignment=2',
      'MarginV=36',
      'MarginL=40',
      'MarginR=40',
      'Bold=0'
    ].join(',');
  }
  // Long-form 1920x1080: very small, outline-only (no box), flush to bottom.
  // FontSize ~18 ≈ 1% of height — readable on desktop, does not cover the cut.
  return [
    'FontName=Arial',
    'FontSize=18',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H80000000',
    'BackColour=&H00000000',
    'BorderStyle=1',
    'Outline=1',
    'Shadow=0',
    'Alignment=2',
    'MarginV=12',
    'MarginL=40',
    'MarginR=40',
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
 *
 * `hookText` (optional): a short phrase shown as a big bold card in the upper
 * third for the first `hookSeconds` — the "scroll-stopper" faceless Shorts
 * lead with. It is purely additive: if the overlay can't be built or the
 * render errors with it, this falls back to the caption-only render so a
 * hook can never break a video.
 */
export async function renderFinalVideo({ backgroundClipPath, audioPath, srtPath, outPath, aspect, width, height, hookText = '', hookSeconds = 2.6 }) {
  const escapedSrt = escapeFilterPath(srtPath);
  const captionVf = `subtitles='${escapedSrt}':original_size=${width}x${height}:force_style='${captionStyle(aspect)}'`;

  const baseArgs = (vf) => [
    '-i', backgroundClipPath,
    '-i', audioPath,
    '-vf', vf,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    '-shortest',
    outPath
  ];

  // Hook overlay only on vertical Shorts and only when text is provided.
  if (hookText && aspect === 'vertical' && hookSeconds > 0) {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-hook-'));
    try {
      const hookVf = await buildHookDrawtext({ hookText, seconds: hookSeconds, width, height, tmpDir });
      if (hookVf) {
        try {
          await runFfmpeg(baseArgs(`${captionVf},${hookVf}`));
          return;
        } catch (err) {
          // Never lose the video over the hook card — retry captions-only.
          console.warn(`[assemble] hook overlay render failed, falling back to no-hook: ${err.message}`);
        }
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  await runFfmpeg(baseArgs(captionVf));
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
