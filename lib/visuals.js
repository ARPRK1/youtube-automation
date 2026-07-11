import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';
import { fetchVisualAsset } from './visual-sources.js';
import { generateAiImage } from './ai-image.js';

const GRADIENT_PAIRS = [
  ['1a1a2e', '16213e'],
  ['0f2027', '2c5364'],
  ['232526', '414345'],
  ['1e130c', '9a8478'],
  ['141e30', '243b55'],
  ['200122', '6f0000']
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

async function downloadTo(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
}

async function renderVideoSegment(sourcePath, durationSec, w, h, outPath) {
  await runFfmpeg([
    '-stream_loop', '-1', '-i', sourcePath,
    '-t', String(durationSec),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=25`,
    '-an', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

async function renderImageSegment(sourcePath, durationSec, w, h, outPath) {
  const frames = Math.ceil(durationSec * 25);
  await runFfmpeg([
    '-loop', '1', '-i', sourcePath,
    '-vf', `scale=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0008,1.3)':d=${frames}:s=${w}x${h}:fps=25`,
    '-t', String(durationSec),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

async function renderGradientSegment(seed, durationSec, w, h, outPath) {
  const [c1, c2] = GRADIENT_PAIRS[hashString(seed) % GRADIENT_PAIRS.length];
  await runFfmpeg([
    '-f', 'lavfi',
    '-i', `gradients=s=${w}x${h}:c0=0x${c1}:c1=0x${c2}:d=${durationSec}:speed=0.01`,
    '-t', String(durationSec),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath
  ]);
}

/**
 * Renders one segment of the background. Priority order:
 * 1. AI-generated image (Pollinations, free, no key) — the prompt IS the
 *    query, so relevance is guaranteed by construction rather than hoping
 *    a search engine finds something close. This is now the primary path.
 * 2. Real stock photo/video (Pexels/Openverse/Wikimedia) if AI generation
 *    is unavailable/slow/erroring — a free community service has no
 *    uptime guarantee, so this keeps the pipeline from stalling.
 * 3. A generated gradient, so a segment can never fail outright.
 * Returns a credit string (only for the stock-photo path) or null.
 */
async function renderSegment({ query, fallbackQuery, durationSec, w, h, outPath, tmpDir, index }) {
  const aiImage = await generateAiImage(query, { width: w, height: h }).catch(() => null);
  if (aiImage) {
    try {
      const srcPath = path.join(tmpDir, `ai-${index}.jpg`);
      await writeFile(srcPath, aiImage);
      await renderImageSegment(srcPath, durationSec, w, h, outPath);
      return null;
    } catch (err) {
      console.warn(`[visuals] failed to render AI image for "${query}", trying stock fallback: ${err.message}`);
    }
  }

  let asset = await fetchVisualAsset(query, w > h ? 'landscape' : 'vertical');
  if (!asset && fallbackQuery && fallbackQuery !== query) {
    asset = await fetchVisualAsset(fallbackQuery, w > h ? 'landscape' : 'vertical');
  }

  if (asset) {
    try {
      const ext = asset.type === 'video' ? 'mp4' : 'jpg';
      const srcPath = path.join(tmpDir, `src-${index}.${ext}`);
      await downloadTo(asset.url, srcPath);
      if (asset.type === 'video') await renderVideoSegment(srcPath, durationSec, w, h, outPath);
      else await renderImageSegment(srcPath, durationSec, w, h, outPath);
      return asset.credit;
    } catch (err) {
      console.warn(`[visuals] failed to render fetched asset for "${query}", using gradient: ${err.message}`);
    }
  }

  await renderGradientSegment(query, durationSec, w, h, outPath);
  return null;
}

/**
 * Builds the full background clip out of contextual segments — each one
 * ideally a real photo/video relevant to that part of the script, rather
 * than a single static image or gradient for the whole video.
 *
 * `segments`: [{ query, fallbackQuery, durationSec }]
 * Returns { credits: string[] } (attribution lines for any CC-licensed
 * assets used; Pexels/gradient contribute nothing here since no
 * attribution is required).
 */
export async function renderBackgroundClip({ segments, aspect, outPath }) {
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-visuals-'));
  const credits = [];

  try {
    const segPaths = [];
    for (const [i, seg] of segments.entries()) {
      const segPath = path.join(tmpDir, `seg-${i}.mp4`);
      const credit = await renderSegment({ ...seg, w, h, outPath: segPath, tmpDir, index: i });
      if (credit) credits.push(credit);
      segPaths.push(segPath);
    }

    if (segPaths.length === 1) {
      await runFfmpeg(['-i', segPaths[0], '-c', 'copy', outPath]);
    } else {
      const listPath = path.join(tmpDir, 'concat.txt');
      const listContent = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
      await writeFile(listPath, listContent, 'utf-8');
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return { credits };
}
