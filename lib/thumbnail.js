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

/** Renders a 1280x720 YouTube thumbnail from a still frame of the
 * background clip plus a bold wrapped title, using only ffmpeg drawtext
 * (no external image/font service). */
export async function renderThumbnail({ backgroundClipPath, title, outPath }) {
  const wrapped = escapeDrawtext(wrapTitle(title));
  await runFfmpeg([
    '-i', backgroundClipPath,
    '-vf',
    `scale=1280:720,drawbox=x=0:y=440:w=1280:h=280:color=black@0.55:t=fill,` +
    `drawtext=text='${wrapped}':fontcolor=white:fontsize=64:font=Arial:` +
    `x=(w-text_w)/2:y=470:line_spacing=14:borderw=3:bordercolor=black@0.8`,
    '-frames:v', '1',
    outPath
  ]);
}
