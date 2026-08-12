// Stage 4: voiceover. Synthesizes one audio clip PER SEGMENT (not the whole
// narration in one call) -- this gives an exact, real duration per segment
// with no estimation needed for visual sync, and makes per-segment
// humanization (rate variation, a beat of silence before a "reveal")
// straightforward. Three providers, chosen in config.yaml (voice.provider):
// - edge-tts: free, no key, cloud-based (Microsoft neural voices), fast.
// - kokoro: free, open-source (Apache 2.0), runs locally on CPU, no key,
//   no GPU needed -- meaningfully slower (real-time-ish vs edge-tts's
//   near-instant cloud response) but a genuinely different voice/quality
//   worth having as an option.
// - chatterbox: free, MIT-licensed zero-shot voice cloning (true synthesis
//   in the target voice, not post-hoc conversion -- OpenVoice's tone-color
//   conversion approach was tried first and confirmed too weak a match,
//   since it only re-colors an existing recording's timbre and leaves the
//   source TTS's own accent/cadence untouched). Needs voice.reference_sample.
// All three were verified to actually run.

import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg, probeDurationSeconds } from './ffmpeg-util.js';
import { loadConfig } from './config.js';
import { synthesizeWithChatterbox } from './chatterbox-tts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PYTHON = process.env.PYTHON_BIN || 'python';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr}`));
    });
  });
}

/** Segments that open with a contrast/reveal word get a beat of silence
 * before them -- a small, deliberate pacing choice a human editor would
 * make, and one of the "small imperfections" that reads as produced
 * rather than templated. */
const REVEAL_STARTERS = /^(but|however|turns out|actually|here'?s the thing|the truth is|what if i told you|and yet)\b/i;

/** Deterministic (not truly random) small rate/speed variance derived from
 * the segment's own text, so re-running the same script twice produces the
 * same result (reproducible builds) while still varying naturally segment
 * to segment within a script. Range: -3% to +3%. */
function paceVariance(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return ((h % 61) - 30) / 10; // -3.0 .. +3.0
}

async function synthesizeEdgeTtsSegment(text, outDir, baseName, { voice, rateOffset }) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'ytauto-tts-'));
  const textFile = path.join(tmp, 'seg.txt');
  await writeFile(textFile, text, 'utf-8');

  const audioPath = path.join(outDir, `${baseName}.mp3`);
  const srtPath = path.join(outDir, `${baseName}.srt`);
  // Sign must be decided AFTER rounding, not before: a small negative
  // value like -0.4 rounds to -0, which JS stringifies as "0" (no sign),
  // producing an invalid "0%" that edge-tts's strict [+-]\d+% regex rejects.
  const roundedRate = Math.round(rateOffset) || 0; // normalizes -0 to 0
  const rate = `${roundedRate >= 0 ? '+' : '-'}${Math.abs(roundedRate)}%`;

  // Prefer India-locale neural voices for IN audience; fall back if the
  // edge-tts package on the runner doesn't ship that voice name yet.
  const voiceFallback = [voice, 'en-IN-NeerjaNeural', 'en-IN-PrabhatNeural', 'en-US-AndrewNeural']
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  let lastErr;
  for (const v of voiceFallback) {
    try {
      await run(PYTHON, [
        '-m', 'edge_tts',
        '--file', textFile,
        '--voice', v,
        // Python's argparse misreads a negative-looking value ("-2%") as a new
        // flag rather than --rate's argument, when passed as two separate
        // argv entries -- confirmed live ("argument --rate: expected one
        // argument"). The --rate=VALUE form sidesteps that ambiguity entirely.
        `--rate=${rate}`,
        '--write-media', audioPath,
        '--write-subtitles', srtPath
      ]);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`[tts] edge-tts voice "${v}" failed, trying next: ${err.message}`);
    }
  }
  if (lastErr) {
    await rm(tmp, { recursive: true, force: true });
    throw lastErr;
  }

  await rm(tmp, { recursive: true, force: true });

  // Same transient flush issue noted earlier -- give it one grace period.
  let srtSize = (await stat(srtPath).catch(() => ({ size: 0 }))).size;
  if (srtSize === 0) { await sleep(1200); srtSize = (await stat(srtPath).catch(() => ({ size: 0 }))).size; }

  return { audioPath, srtPath: srtSize > 0 ? srtPath : null };
}

let kokoroInstance = null;
async function getKokoro() {
  if (!kokoroInstance) {
    const { KokoroTTS } = await import('kokoro-js');
    kokoroInstance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' });
  }
  return kokoroInstance;
}

async function synthesizeKokoroSegment(text, outDir, baseName, { voice, speed }) {
  const tts = await getKokoro();
  const audio = await tts.generate(text, { voice, speed });
  const wavPath = path.join(outDir, `${baseName}.wav`);
  await audio.save(wavPath);
  const audioPath = path.join(outDir, `${baseName}.mp3`);
  await runFfmpeg(['-i', wavPath, '-c:a', 'libmp3lame', '-b:a', '160k', audioPath]);
  await rm(wavPath, { force: true });
  return { audioPath, srtPath: null }; // no native word timing -- caller estimates caption lines from duration
}

async function synthesizeChatterboxSegment(text, outDir, baseName, { referencePath, exaggeration }) {
  if (!referencePath) throw new Error('voice.provider is "chatterbox" but voice.reference_sample is not set in config.yaml');
  const wavPath = path.join(outDir, `${baseName}.wav`);
  await synthesizeWithChatterbox({ text, outputPath: wavPath, referencePath, exaggeration });
  const audioPath = path.join(outDir, `${baseName}.mp3`);
  await runFfmpeg(['-i', wavPath, '-c:a', 'libmp3lame', '-b:a', '160k', audioPath]);
  await rm(wavPath, { force: true });
  return { audioPath, srtPath: null }; // no native word timing -- caller estimates caption lines from duration
}

/** Prepends a brief silence to an already-synthesized clip (for reveal
 * pacing). Re-encodes via a silent lavfi source + concat rather than
 * stream-copy, so it composes safely regardless of source encoder. */
async function prependSilence(audioPath, ms) {
  const withSilencePath = audioPath.replace(/\.mp3$/, '-paused.mp3');
  await runFfmpeg([
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
    '-i', audioPath,
    '-filter_complex', `[0:a]atrim=0:${(ms / 1000).toFixed(2)}[sil];[sil][1:a]concat=n=2:v=0:a=1[out]`,
    '-map', '[out]',
    withSilencePath
  ]);
  await rm(audioPath, { force: true });
  return withSilencePath;
}

/**
 * Picks TTS provider for this clip.
 * 2026-08-12: owner wants cloned voice — Chatterbox on Shorts (growth path).
 * Long-form stays on edge-tts by default: free CPU runners need ~3.7–4.4s/word
 * for Chatterbox, so a 1500-word long alone can burn 90–110 min of TTS.
 * Override with voice.long_provider / voice.shorts_provider in config.yaml.
 */
function resolveProvider(config, kind = 'long') {
  if (kind === 'short') {
    return config.voice?.shorts_provider || config.voice?.provider || 'edge-tts';
  }
  return config.voice?.long_provider || config.voice?.provider || 'edge-tts';
}

/**
 * Synthesizes one segment's narration. Returns { audioPath, srtPath,
 * durationSec, hadPause, provider }. `srtPath` is null for Kokoro and
 * Chatterbox (no native word timing -- lib/captions.js falls back to even
 * distribution across the known real duration in that case).
 *
 * @param {string} text
 * @param {string} outDir
 * @param {string} baseName
 * @param {{ kind?: 'long'|'short' }} [opts]
 */
export async function synthesizeSegmentAudio(text, outDir, baseName, opts = {}) {
  const config = loadConfig();
  const kind = opts.kind || 'long';
  let provider = resolveProvider(config, kind);
  const isReveal = REVEAL_STARTERS.test(text.trim());
  const variance = paceVariance(text);

  let result;
  try {
    if (provider === 'chatterbox') {
      console.log(`[tts] chatterbox clone (${kind}) → ${baseName} (${text.split(/\s+/).length} words)`);
      result = await synthesizeChatterboxSegment(text, outDir, baseName, {
        referencePath: config.voice?.reference_sample,
        exaggeration: config.voice?.chatterbox_exaggeration ?? 0.5
      });
    } else if (provider === 'kokoro') {
      result = await synthesizeKokoroSegment(text, outDir, baseName, {
        voice: config.voice?.kokoro_voice || 'af_heart',
        speed: 1 + variance / 100
      });
    } else {
      result = await synthesizeEdgeTtsSegment(text, outDir, baseName, {
        voice: config.voice?.edge_tts_voice || 'en-US-AndrewNeural',
        rateOffset: variance
      });
    }
  } catch (err) {
    // Cloned voice must not kill a whole day if the model fails on one segment.
    if (provider === 'chatterbox') {
      console.warn(`[tts] chatterbox failed for ${baseName}, falling back to edge-tts: ${err.message}`);
      provider = 'edge-tts';
      result = await synthesizeEdgeTtsSegment(text, outDir, baseName, {
        voice: config.voice?.edge_tts_voice || 'en-IN-NeerjaNeural',
        rateOffset: variance
      });
    } else {
      throw err;
    }
  }

  let audioPath = result.audioPath;
  if (isReveal) audioPath = await prependSilence(audioPath, 450);

  const durationSec = await probeDurationSeconds(audioPath);
  return { audioPath, srtPath: result.srtPath, durationSec, hadPause: isReveal, provider };
}
