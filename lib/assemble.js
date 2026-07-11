import { runFfmpeg, escapeFilterPath, probeDurationSeconds } from './ffmpeg-util.js';

const CAPTION_STYLE = "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=0,Alignment=2,MarginV=60";

/**
 * Muxes a silent background clip with narration audio and burns in
 * captions from an SRT file. Output length matches the audio (`-shortest`
 * with the background clip already rendered to the audio's duration).
 */
export async function renderFinalVideo({ backgroundClipPath, audioPath, srtPath, outPath }) {
  const escapedSrt = escapeFilterPath(srtPath);
  await runFfmpeg([
    '-i', backgroundClipPath,
    '-i', audioPath,
    '-vf', `subtitles='${escapedSrt}':force_style='${CAPTION_STYLE}'`,
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
