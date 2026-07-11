// Background music, free and CC-BY licensed (Kevin MacLeod / incompetech.com
// -- a stable, long-running source of direct-downloadable royalty-free
// tracks; verified live before use, no API/signup needed). Pixabay's API
// was the spec's original suggestion, but it turns out Pixabay has no
// documented music/audio search endpoint (confirmed against their docs) --
// music browsing there is website-only, not automatable. Rotated daily so
// consecutive videos don't all use the same bed, and always attributed
// (CC BY requires it) via the same manifest/ATTRIBUTION.txt mechanism as
// Stage 3's visual assets.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';

const TRACKS = [
  { name: 'Wallpaper', mood: 'upbeat' },
  { name: 'Investigations', mood: 'curious' },
  { name: 'Local Forecast', mood: 'cheerful' },
  { name: 'Sneaky Snitch', mood: 'playful' },
  { name: 'Impact Prelude', mood: 'dramatic' }
];

function trackUrl(name) {
  return `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(name)}.mp3`;
}

export function pickDailyTrack(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const track = TRACKS[dayOfYear % TRACKS.length];
  return {
    ...track,
    url: trackUrl(track.name),
    credit: `Music: "${track.name}" by Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 3.0 — http://creativecommons.org/licenses/by/3.0/`
  };
}

async function downloadTrack(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`music download failed ${res.status}: ${url}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

/**
 * Mixes background music under an existing narration+visuals video, ducked
 * well below the voice (-15dB, per spec) and looped/trimmed to the video's
 * length. Returns the output path, or the original videoPath unchanged if
 * music fetch fails (never block a finished video over a music download
 * hiccup).
 */
export async function addBackgroundMusic({ videoPath, outPath, durationSec, date = new Date() }) {
  const track = pickDailyTrack(date);
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-music-'));
  try {
    const musicPath = path.join(tmpDir, 'track.mp3');
    await downloadTrack(track.url, musicPath);

    await runFfmpeg([
      '-i', videoPath,
      '-stream_loop', '-1', '-i', musicPath,
      '-filter_complex',
      `[1:a]volume=-15dB,atrim=0:${durationSec}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[outa]`,
      '-map', '0:v', '-map', '[outa]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      outPath
    ]);
    return { outPath, credit: track.credit };
  } catch (err) {
    console.warn(`[music] background music failed, shipping without it: ${err.message}`);
    return { outPath: videoPath, credit: null };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
