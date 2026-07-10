import { runFfmpeg, escapeFilterPath } from './ffmpeg-util.js';

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
