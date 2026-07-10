import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';

export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export function probeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(parseFloat(stdout.trim()));
      else reject(new Error(`ffprobe exited ${code}: ${stderr}`));
    });
  });
}

/** Escapes a filesystem path for safe use inside an ffmpeg filtergraph
 * argument (subtitles=, etc). Handles Windows drive-letter colons and
 * backslashes; harmless no-op on POSIX paths. */
export function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
