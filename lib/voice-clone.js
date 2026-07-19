// Optional post-processing step on top of edge-tts/kokoro output: re-colors
// the already-synthesized narration to match a reference voice sample via
// OpenVoice V2 (scripts/voice_convert.py). Off by default (voice.clone_enabled
// in config.yaml) -- this is new, unverified-in-production tech, so it must
// be explicitly turned on rather than silently changing every video's voice.

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg-util.js';

const PYTHON = process.env.PYTHON_BIN || 'python3';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

export function isVoiceCloneEnabled(config) {
  return Boolean(config.voice?.clone_enabled && config.voice?.reference_sample);
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`voice_convert.py exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Converts an already-synthesized speech clip to the cloned reference
 * voice. Returns the path to the converted clip (same container as the
 * input -- re-encoded via ffmpeg from OpenVoice's WAV output so callers
 * downstream don't need to care that a conversion happened).
 */
export async function convertToClonedVoice({ inputPath, config }) {
  const referencePath = config.voice.reference_sample;
  if (!(await fileExists(referencePath))) {
    throw new Error(`voice.reference_sample configured but not found on disk: ${referencePath}`);
  }

  const ext = path.extname(inputPath);
  const wavOut = inputPath.replace(new RegExp(`${ext}$`), '-cloned.wav');
  await runPython([
    path.join(process.cwd(), 'scripts', 'voice_convert.py'),
    '--input', inputPath,
    '--output', wavOut,
    '--reference', referencePath,
    ...(config.voice?.clone_checkpoint_dir ? ['--checkpoint-dir', config.voice.clone_checkpoint_dir] : [])
  ]);

  if (ext === '.wav') return wavOut;
  const finalOut = inputPath.replace(new RegExp(`${ext}$`), `-cloned${ext}`);
  await runFfmpeg(['-i', wavOut, '-c:a', ext === '.mp3' ? 'libmp3lame' : 'aac', finalOut]);
  return finalOut;
}
