// High-CTR YouTube thumbnail renderer (1280x720). Pure ffmpeg -- no paid
// design APIs. Built for click-through on mobile: punchy 1-3 line title,
// dark readable overlay, accent color bar, contrast-boosted real keyframe.

import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';

const W = 1280;
const H = 720;

const ACCENT_PALETTE = [
  '#e63946', // red
  '#ffb703', // gold
  '#00bbf9', // electric blue
  '#06d6a0', // mint
  '#9d4edd', // purple
  '#f77f00', // orange
  '#ff006e', // hot pink
  '#80ffdb'  // aqua
];

/** Deterministic accent from title so the same video always gets the same look. */
export function accentForTitle(title = '') {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return ACCENT_PALETTE[h % ACCENT_PALETTE.length];
}

/**
 * Prefer a bold TrueType file path (drawtext fontfile= is more reliable
 * across Windows runners and Ubuntu GH Actions than font family names).
 */
async function resolveBoldFont() {
  const candidates = process.platform === 'win32'
    ? [
        'C:/Windows/Fonts/impact.ttf',       // classic thumbnail face
        'C:/Windows/Fonts/arialbd.ttf',
        'C:/Windows/Fonts/ArialBd.ttf',
        'C:/Windows/Fonts/segoeuib.ttf'
      ]
    : [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'
      ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch { /* try next */ }
  }
  return null;
}

/** Split into up to `maxLines` short lines for mobile-readable type. */
function wrapTitle(title, maxCharsPerLine = 16, maxLines = 3) {
  const cleaned = String(title || '')
    .replace(/#\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'WATCH THIS';

  const words = cleaned.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // If we still overflowed words, hard-cut the last line.
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    if (last.length > maxCharsPerLine) lines[maxLines - 1] = `${last.slice(0, maxCharsPerLine - 1)}…`;
  }
  return lines.slice(0, maxLines);
}

/** Escape for ffmpeg drawtext=text='...' (single-quoted). */
function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019") // curly apostrophe avoids quote breakage
    .replace(/%/g, '\\%');
}

/** ffmpeg drawbox/drawtext color: 0xRRGGBB@alpha */
function hexToFfmpegColor(hex, alpha = 1) {
  const h = String(hex).replace('#', '').slice(0, 6);
  const a = Math.min(1, Math.max(0, alpha));
  return `0x${h}@${a}`;
}

/**
 * Font size scales with line count so 1-line titles stay huge and 3-line
 * titles still fit inside the bottom panel without clipping.
 */
function fontSizeFor(lines) {
  if (lines.length <= 1) return 92;
  if (lines.length === 2) return 72;
  return 58;
}

/**
 * Renders a click-optimized 1280x720 thumbnail.
 *
 * @param {object} opts
 * @param {Buffer} [opts.keyImageBuffer]  First real/AI keyframe for the video
 * @param {string} [opts.backgroundClipPath]  Fallback: grab a frame from bg clip
 * @param {string} opts.title
 * @param {string} opts.outPath  .jpg path
 * @param {string} [opts.accentColor]  #rrggbb
 * @param {'long'|'short'} [opts.kind]
 * @param {string} [opts.badge]  Optional small corner label (e.g. "NEW")
 */
export async function renderThumbnail({
  keyImageBuffer,
  backgroundClipPath,
  title,
  outPath,
  accentColor,
  kind = 'long',
  badge = null
}) {
  const accent = accentColor || accentForTitle(title);
  const lines = wrapTitle(title, kind === 'short' ? 14 : 16, 3);
  const fontSize = fontSizeFor(lines);
  const fontFile = await resolveBoldFont();
  const fontOpt = fontFile
    ? `fontfile='${fontFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'`
    : 'font=Arial';

  // Uppercased for max mobile readability (classic high-CTR style). Keep
  // original casing only if the title is already mostly caps/short brand.
  const displayLines = lines.map((l) => {
    const letters = l.replace(/[^a-zA-Z]/g, '');
    const upperRatio = letters ? [...letters].filter((c) => c === c.toUpperCase()).length / letters.length : 1;
    return upperRatio > 0.6 ? l : l.toUpperCase();
  });
  const textBlock = escapeDrawtext(displayLines.join('\n'));

  // Panel height scales with lines so short titles don't sit in empty black.
  const panelH = displayLines.length <= 1 ? 200 : displayLines.length === 2 ? 250 : 300;
  const panelY = H - panelH;
  const textY = panelY + 28;
  const lineSpacing = Math.round(fontSize * 0.22);

  // Layered look:
  // 1) Fill frame, slight overscan crop (feels tighter / more intentional)
  // 2) Boost contrast + saturation (dull stock photos kill CTR)
  // 3) Soft vignette so edges don't compete with the title
  // 4) Bottom dark gradient panel (stacked semi-opaque boxes)
  // 5) Accent bar + left stripe
  // 6) Optional badge pill
  // 7) Bold title with thick black border for legibility on any background
  const filters = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    `eq=contrast=1.18:saturation=1.35:brightness=0.03`,
    `vignette=PI/5`,
    // layered bottom shade (reads as a gradient without geq complexity)
    `drawbox=x=0:y=${panelY - 40}:w=${W}:h=${panelH + 40}:color=black@0.35:t=fill`,
    `drawbox=x=0:y=${panelY}:w=${W}:h=${panelH}:color=black@0.62:t=fill`,
    `drawbox=x=0:y=${panelY}:w=${W}:h=6:color=${hexToFfmpegColor(accent, 1)}:t=fill`,
    `drawbox=x=0:y=0:w=16:h=${H}:color=${hexToFfmpegColor(accent, 1)}:t=fill`,
    `drawbox=x=0:y=${H - 10}:w=${W}:h=10:color=${hexToFfmpegColor(accent, 1)}:t=fill`,
    `drawtext=${fontOpt}:text='${textBlock}':fontcolor=white:fontsize=${fontSize}:` +
      `x=(w-text_w)/2:y=${textY}:line_spacing=${lineSpacing}:` +
      `borderw=5:bordercolor=black@0.9:shadowx=3:shadowy=3:shadowcolor=black@0.55`
  ];

  if (badge) {
    const label = escapeDrawtext(String(badge).toUpperCase().slice(0, 12));
    const badgeW = Math.max(120, label.length * 18 + 40);
    const badgeX = W - badgeW - 28;
    filters.push(
      `drawbox=x=${badgeX}:y=24:w=${badgeW}:h=48:color=${hexToFfmpegColor(accent, 0.95)}:t=fill`,
      `drawtext=${fontOpt}:text='${label}':fontcolor=white:fontsize=28:` +
        `x=${badgeX}+(${badgeW}-text_w)/2:y=34:` +
        `borderw=1:bordercolor=black@0.4`
    );
  }

  const vf = filters.join(',');

  if (keyImageBuffer && keyImageBuffer.length > 500) {
    const srcPath = outPath.replace(/(\.[^.]+)?$/, '-src.jpg');
    await writeFile(srcPath, keyImageBuffer);
    await runFfmpeg([
      '-i', srcPath,
      '-vf', vf,
      '-frames:v', '1',
      '-q:v', '2',
      outPath
    ]);
    return outPath;
  }

  if (!backgroundClipPath) {
    throw new Error('renderThumbnail needs keyImageBuffer or backgroundClipPath');
  }

  // Prefer a frame a few seconds in so we skip pure black intro/hold frames.
  await runFfmpeg([
    '-ss', '2.5',
    '-i', backgroundClipPath,
    '-vf', vf,
    '-frames:v', '1',
    '-q:v', '2',
    outPath
  ]);
  return outPath;
}

/**
 * Pick the best buffer to use as the thumbnail background: first real
 * (non-AI) image/video still if one exists, otherwise first available.
 * Callers can pass mediaAssets from produceVideo.
 */
export function pickThumbnailKeyBuffer(mediaAssets = []) {
  if (!Array.isArray(mediaAssets) || mediaAssets.length === 0) return null;
  const real = mediaAssets.find((a) => a?.buffer && !a.aiGenerated);
  if (real?.buffer) return real.buffer;
  const any = mediaAssets.find((a) => a?.buffer);
  return any?.buffer || null;
}
