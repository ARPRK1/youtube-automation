// Background music: free CC-BY (Kevin MacLeod / incompetech.com).
// Shorts ship WITHOUT music by default (voice-forward Shorts retain better).
// Long-form gets a quiet bed only when the video is long enough to need it.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';
import { loadConfig } from './config.js';

const TRACKS = [
  { name: 'Wallpaper', mood: 'upbeat' },
  { name: 'Investigations', mood: 'curious' },
  { name: 'Local Forecast', mood: 'cheerful' },
  { name: 'Impact Prelude', mood: 'dramatic' },
  { name: 'Crypto', mood: 'modern' },
  { name: 'Dreams Become Real', mood: 'reflective' },
  { name: 'Carefree', mood: 'light' },
  { name: 'Evening Fall Harp', mood: 'calm' }
];

function trackUrl(name) {
  return `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(name)}.mp3`;
}

export function pickDailyTrack(date = new Date(), moodHint = '') {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  let pool = TRACKS;
  if (moodHint) {
    const m = moodHint.toLowerCase();
    const filtered = TRACKS.filter((t) => m.includes(t.mood) || t.mood.includes(m));
    if (filtered.length) pool = filtered;
  }
  const track = pool[dayOfYear % pool.length];
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
 * Decide whether this video should get a music bed.
 * - Shorts: never (default) — wall-to-wall beds make auto-Shorts feel spammy
 * - Long: only if enabled and longer than config threshold
 */
export function shouldAddMusic({ kind = 'long', durationSec = 0 } = {}) {
  const config = loadConfig();
  const music = config.music || {};
  if (music.enabled === false) return false;
  if (kind === 'short') return music.shorts === true; // default false
  const minSec = music.long_min_seconds ?? 90;
  return durationSec >= minSec;
}

/**
 * Mixes background music under narration when appropriate. Returns
 * { outPath, credit } — credit null means no music applied.
 */
export async function addBackgroundMusic({
  videoPath,
  outPath,
  durationSec,
  date = new Date(),
  kind = 'long',
  moodHint = ''
}) {
  if (!shouldAddMusic({ kind, durationSec })) {
    console.log(`[music] skipped (${kind}, ${durationSec.toFixed?.(1) ?? durationSec}s) — voice-forward / not needed`);
    return { outPath: videoPath, credit: null };
  }

  const config = loadConfig();
  const volumeDb = config.music?.volume_db ?? -18;
  const track = pickDailyTrack(date, moodHint);
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-music-'));
  try {
    const musicPath = path.join(tmpDir, 'track.mp3');
    await downloadTrack(track.url, musicPath);

    // Soft fade in/out on the bed so it doesn't slam under the first word.
    const fade = Math.min(2.5, Math.max(0.8, durationSec * 0.04));
    await runFfmpeg([
      '-i', videoPath,
      '-stream_loop', '-1', '-i', musicPath,
      '-filter_complex',
      `[1:a]volume=${volumeDb}dB,afade=t=in:st=0:d=${fade.toFixed(2)},afade=t=out:st=${Math.max(0, durationSec - fade).toFixed(2)}:d=${fade.toFixed(2)},atrim=0:${durationSec}[music];` +
      `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[outa]`,
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
