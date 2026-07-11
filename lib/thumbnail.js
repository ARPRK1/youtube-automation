import { writeFile } from 'node:fs/promises';
import { runFfmpeg } from './ffmpeg-util.js';

function wrapTitle(title, maxCharsPerLine = 22) {
  const words = title.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxCharsPerLine) {
      lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3).join('\n');
}

function escapeDrawtext(text) {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "’");
}

/**
 * Renders a 1280x720 YouTube thumbnail from the video's real key image
 * (the first segment's actual sourced asset -- a real photo when one was
 * found, or the AI fallback -- not a random mid-clip frame, which can
 * land mid-zoom/mid-transition) plus a bold wrapped title. Falls back to
 * grabbing a frame from the rendered background clip if no key image
 * buffer is available.
 */
export async function renderThumbnail({ keyImageBuffer, backgroundClipPath, title, outPath }) {
  const wrapped = escapeDrawtext(wrapTitle(title));
  const textFilter =
    `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `drawbox=x=0:y=440:w=1280:h=280:color=black@0.55:t=fill,` +
    `drawtext=text='${wrapped}':fontcolor=white:fontsize=64:font=Arial:` +
    `x=(w-text_w)/2:y=470:line_spacing=14:borderw=3:bordercolor=black@0.8`;

  if (keyImageBuffer) {
    const srcPath = outPath.replace(/\.jpg$/, '-src.jpg');
    await writeFile(srcPath, keyImageBuffer);
    await runFfmpeg(['-i', srcPath, '-vf', textFilter, '-frames:v', '1', outPath]);
    return;
  }

  await runFfmpeg(['-i', backgroundClipPath, '-ss', '1', '-vf', textFilter, '-frames:v', '1', outPath]);
}
