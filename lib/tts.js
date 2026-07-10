import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_VOICE = process.env.TTS_VOICE || 'en-US-AndrewNeural';
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

/**
 * Synthesizes narration text to free, local-key-free TTS (Microsoft Edge
 * voices via edge-tts). Produces an mp3 plus an SRT file with real
 * word-timed captions, so downstream caption rendering doesn't have to
 * estimate durations.
 *
 * Returns { audioPath, srtPath }
 */
export async function synthesizeSpeech(text, outDir, baseName, { voice = DEFAULT_VOICE } = {}) {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ytauto-tts-'));
  const textFile = path.join(tmpDir, 'narration.txt');
  await writeFile(textFile, text, 'utf-8');

  const audioPath = path.join(outDir, `${baseName}.mp3`);
  const srtPath = path.join(outDir, `${baseName}.srt`);

  await run(PYTHON, [
    '-m', 'edge_tts',
    '--file', textFile,
    '--voice', voice,
    '--write-media', audioPath,
    '--write-subtitles', srtPath
  ]);

  // edge-tts has occasionally been observed to exit before its subtitle
  // file write is fully flushed to disk (Windows-only quirk seen in
  // testing). Give it one short grace period rather than silently shipping
  // a video with no captions.
  let srtSize = (await stat(srtPath).catch(() => ({ size: 0 }))).size;
  if (srtSize === 0) {
    await sleep(1500);
    srtSize = (await stat(srtPath).catch(() => ({ size: 0 }))).size;
  }
  if (srtSize === 0) {
    throw new Error(`edge-tts produced an empty subtitles file at ${srtPath}`);
  }

  await rm(tmpDir, { recursive: true, force: true });
  return { audioPath, srtPath };
}
