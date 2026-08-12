// Stage 4: voiceover. One audio clip PER SCRIPT SEGMENT with human pacing:
// sentence-level synthesis, inter-sentence pauses, slowdown, and a clean
// end hold so Shorts never cut mid-thought.
//
// Providers (config.voice.*):
// - edge-tts: free Microsoft neural (fast fallback)
// - kokoro: local open-source
// - chatterbox: zero-shot clone from voice.reference_sample (Shorts primary)

import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm, stat, copyFile } from 'node:fs/promises';
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

const REVEAL_STARTERS = /^(but|however|turns out|actually|here'?s the thing|the truth is|what if i told you|and yet)\b/i;

function paceVariance(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return ((h % 61) - 30) / 10; // -3.0 .. +3.0
}

/**
 * Split narration into speakable sentences. Keeps ?! and periods as boundaries
 * so each unit can get its own prosody curve + a pause after it.
 */
export function splitIntoSentences(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  // Split after . ! ? when followed by space + capital/quote, or end.
  const parts = cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [cleaned];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

async function synthesizeEdgeTtsSegment(text, outDir, baseName, { voice, rateOffset }) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'ytauto-tts-'));
  const textFile = path.join(tmp, 'seg.txt');
  await writeFile(textFile, text, 'utf-8');

  const audioPath = path.join(outDir, `${baseName}.mp3`);
  const srtPath = path.join(outDir, `${baseName}.srt`);
  const roundedRate = Math.round(rateOffset) || 0;
  const rate = `${roundedRate >= 0 ? '+' : '-'}${Math.abs(roundedRate)}%`;

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
  return { audioPath, srtPath: null };
}

async function synthesizeChatterboxOnce(text, outDir, baseName, opts) {
  if (!opts.referencePath) {
    throw new Error('voice.provider is "chatterbox" but voice.reference_sample is not set in config.yaml');
  }
  const wavPath = path.join(outDir, `${baseName}.wav`);
  await synthesizeWithChatterbox({
    text,
    outputPath: wavPath,
    referencePath: opts.referencePath,
    exaggeration: opts.exaggeration,
    cfgWeight: opts.cfgWeight,
    temperature: opts.temperature
  });
  const audioPath = path.join(outDir, `${baseName}.mp3`);
  await runFfmpeg(['-i', wavPath, '-c:a', 'libmp3lame', '-b:a', '160k', audioPath]);
  await rm(wavPath, { force: true });
  return audioPath;
}

/**
 * Sentence-by-sentence clone synthesis so each thought gets its own
 * prosody curve (ups/downs) instead of one flat "reading the paragraph" pass.
 * Joins with silence between sentences.
 */
async function synthesizeChatterboxSegment(text, outDir, baseName, opts) {
  const sentences = opts.sentenceSplit === false
    ? [text.trim()].filter(Boolean)
    : splitIntoSentences(text);

  if (sentences.length === 0) throw new Error('empty narration for chatterbox');

  const pauseMs = opts.sentencePauseMs ?? 320;
  const piecePaths = [];

  for (let i = 0; i < sentences.length; i++) {
    let line = sentences[i].trim();
    // Slight emphasis markers help some TTS models land cadence (stripped if model reads them literally — Chatterbox usually handles plain text best)
    // Keep plain text; rely on sentence boundaries for prosody.
    if (!/[.!?]$/.test(line)) line += '.';

    console.log(`[tts] chatterbox sentence ${i + 1}/${sentences.length} (${line.split(/\s+/).length}w): "${line.slice(0, 70)}${line.length > 70 ? '…' : ''}"`);
    const piece = await synthesizeChatterboxOnce(line, outDir, `${baseName}-s${i}`, opts);
    piecePaths.push(piece);

    if (i < sentences.length - 1 && pauseMs > 0) {
      const silPath = path.join(outDir, `${baseName}-pause${i}.mp3`);
      await makeSilenceMp3(silPath, pauseMs / 1000);
      piecePaths.push(silPath);
    }
  }

  const audioPath = path.join(outDir, `${baseName}.mp3`);
  if (piecePaths.length === 1) {
    await copyFile(piecePaths[0], audioPath);
  } else {
    await concatMp3Files(piecePaths, audioPath);
  }
  return { audioPath, srtPath: null };
}

async function makeSilenceMp3(outPath, seconds) {
  const sec = Math.max(0.05, seconds);
  await runFfmpeg([
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
    '-t', sec.toFixed(3),
    '-c:a', 'libmp3lame', '-b:a', '160k',
    outPath
  ]);
}

async function concatMp3Files(paths, outPath) {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-tts-join-'));
  try {
    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = paths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n');
    await writeFile(listPath, listContent, 'utf-8');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-b:a', '160k', outPath]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Slow/speed without pitch change. speech_rate 0.9 = 10% slower. */
async function applySpeechRate(audioPath, speechRate) {
  const rate = Number(speechRate);
  if (!rate || Math.abs(rate - 1) < 0.02) return audioPath;
  // atempo accepts 0.5–2.0; chain if needed
  let r = rate;
  const filters = [];
  while (r < 0.5) { filters.push('atempo=0.5'); r /= 0.5; }
  while (r > 2.0) { filters.push('atempo=2.0'); r /= 2.0; }
  filters.push(`atempo=${r.toFixed(3)}`);
  const outPath = audioPath.replace(/\.mp3$/i, '-paced.mp3');
  await runFfmpeg([
    '-i', audioPath,
    '-filter:a', filters.join(','),
    '-c:a', 'libmp3lame', '-b:a', '160k',
    outPath
  ]);
  await rm(audioPath, { force: true });
  return outPath;
}

async function appendSilence(audioPath, seconds) {
  const sec = Number(seconds);
  if (!sec || sec < 0.1) return audioPath;
  const outPath = audioPath.replace(/\.mp3$/i, '-endhold.mp3');
  await runFfmpeg([
    '-i', audioPath,
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
    '-filter_complex',
    `[1:a]atrim=0:${sec.toFixed(2)},asetpts=PTS-STARTPTS[sil];` +
    `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[main];` +
    `[main][sil]concat=n=2:v=0:a=1[out]`,
    '-map', '[out]',
    '-c:a', 'libmp3lame', '-b:a', '160k',
    outPath
  ]);
  await rm(audioPath, { force: true });
  return outPath;
}

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

function resolveProvider(config, kind = 'long') {
  if (kind === 'short') {
    return config.voice?.shorts_provider || config.voice?.provider || 'edge-tts';
  }
  return config.voice?.long_provider || config.voice?.provider || 'edge-tts';
}

/**
 * Synthesizes one segment's narration.
 * Shorts get: sentence splits, pauses, slowdown, 2s end hold (when isLastSegment).
 *
 * @param {string} text
 * @param {string} outDir
 * @param {string} baseName
 * @param {{ kind?: 'long'|'short', isLastSegment?: boolean }} [opts]
 */
export async function synthesizeSegmentAudio(text, outDir, baseName, opts = {}) {
  const config = loadConfig();
  const kind = opts.kind || 'long';
  let provider = resolveProvider(config, kind);
  const isReveal = REVEAL_STARTERS.test(text.trim());
  const variance = paceVariance(text);

  // Owner feedback 2026-08-12: clone was flat + fast. Defaults favor
  // expressive + deliberate pacing (ResembleAI recommended pairing).
  const exaggeration = config.voice?.chatterbox_exaggeration ?? 0.72;
  const cfgWeight = config.voice?.chatterbox_cfg_weight ?? 0.28;
  const temperature = config.voice?.chatterbox_temperature ?? 0.8;
  const speechRate = config.voice?.speech_rate ?? (kind === 'short' ? 0.90 : 1.0);
  const sentencePauseMs = config.voice?.sentence_pause_ms ?? (kind === 'short' ? 350 : 200);
  const endSilenceSec = config.voice?.end_silence_sec ?? (kind === 'short' ? 2.0 : 0.4);
  const sentenceSplit = config.voice?.sentence_split !== false;

  let result;
  try {
    if (provider === 'chatterbox') {
      console.log(`[tts] chatterbox clone (${kind}) → ${baseName} | exag=${exaggeration} cfg=${cfgWeight} rate=${speechRate} pauseMs=${sentencePauseMs}`);
      result = await synthesizeChatterboxSegment(text, outDir, baseName, {
        referencePath: config.voice?.reference_sample,
        exaggeration,
        cfgWeight,
        temperature,
        sentencePauseMs,
        sentenceSplit: sentenceSplit && kind === 'short'
      });
    } else if (provider === 'kokoro') {
      result = await synthesizeKokoroSegment(text, outDir, baseName, {
        voice: config.voice?.kokoro_voice || 'af_heart',
        // kokoro speed: lower = slower
        speed: Math.max(0.7, Math.min(1.2, (1 + variance / 100) * speechRate))
      });
    } else {
      // edge-tts: negative rate = slower
      const baseSlow = kind === 'short' ? -12 : -4; // ~12% slower on Shorts
      result = await synthesizeEdgeTtsSegment(text, outDir, baseName, {
        voice: config.voice?.edge_tts_voice || 'en-US-AndrewNeural',
        rateOffset: baseSlow + variance
      });
    }
  } catch (err) {
    if (provider === 'chatterbox') {
      console.warn(`[tts] chatterbox failed for ${baseName}, falling back to edge-tts: ${err.message}`);
      provider = 'edge-tts';
      result = await synthesizeEdgeTtsSegment(text, outDir, baseName, {
        voice: config.voice?.edge_tts_voice || 'en-IN-NeerjaNeural',
        rateOffset: -12 + variance
      });
    } else {
      throw err;
    }
  }

  let audioPath = result.audioPath;
  if (isReveal) audioPath = await prependSilence(audioPath, 450);

  // Extra slowdown for clone if speech_rate set (atempo after synthesis)
  if (provider === 'chatterbox' || provider === 'kokoro') {
    audioPath = await applySpeechRate(audioPath, speechRate);
  }

  // Clean end: 2s hold on Shorts so the last line lands and the cut isn't mid-breath.
  // Only on last segment of a multi-segment video, or always for single-segment Shorts.
  if (kind === 'short' && (opts.isLastSegment !== false)) {
    audioPath = await appendSilence(audioPath, endSilenceSec);
  } else if (kind === 'long' && opts.isLastSegment) {
    audioPath = await appendSilence(audioPath, Math.min(endSilenceSec, 0.8));
  }

  const durationSec = await probeDurationSeconds(audioPath);
  return { audioPath, srtPath: result.srtPath, durationSec, hadPause: isReveal, provider };
}
