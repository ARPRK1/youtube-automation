import { runFfmpeg } from './ffmpeg-util.js';

// A small rotation of pleasant gradient colour pairs, cycled by topic hash,
// so consecutive videos don't all look identical when no stock image is used.
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

async function fetchPexelsImage(query, outPath) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return false;
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=1`, {
    headers: { Authorization: apiKey }
  });
  if (!res.ok) return false;
  const data = await res.json();
  const url = data.photos?.[0]?.src?.large2x;
  if (!url) return false;
  const imgRes = await fetch(url);
  if (!imgRes.ok) return false;
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outPath, buf);
  return true;
}

/**
 * Produces a silent background video clip of `durationSec` length, sized for
 * `aspect` ('landscape' 1920x1080 or 'vertical' 1080x1920), using a free
 * stock photo (if PEXELS_API_KEY is set) with a slow Ken Burns zoom/pan, or
 * a generated gradient background otherwise. No paid APIs, no signup
 * required for the gradient fallback.
 */
export async function renderBackgroundClip({ topic, seed, durationSec, aspect, outPath, tmpImagePath }) {
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const frames = Math.ceil(durationSec * 25);

  const gotImage = await fetchPexelsImage(topic, tmpImagePath).catch(() => false);

  if (gotImage) {
    // Ken Burns: slow zoom-in pan over the still image for the full duration.
    await runFfmpeg([
      '-loop', '1', '-i', tmpImagePath,
      '-vf', `scale=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0008,1.3)':d=${frames}:s=${w}x${h}:fps=25`,
      '-t', String(durationSec),
      '-pix_fmt', 'yuv420p',
      outPath
    ]);
    return;
  }

  const pairIdx = hashString(seed || topic) % GRADIENT_PAIRS.length;
  const [c1, c2] = GRADIENT_PAIRS[pairIdx];
  await runFfmpeg([
    '-f', 'lavfi',
    '-i', `gradients=s=${w}x${h}:c0=0x${c1}:c1=0x${c2}:d=${durationSec}:speed=0.01`,
    '-t', String(durationSec),
    '-pix_fmt', 'yuv420p',
    outPath
  ]);
}
