// Node wrapper around scripts/chatterbox_server.py -- a persistent Python
// subprocess so the ~0.5B Chatterbox model loads once per orchestrator run
// (lazily, on first use) rather than once per segment. Chatterbox does
// true zero-shot voice-cloning TTS (synthesizes speech directly in the
// target voice from a short reference clip), unlike OpenVoice's tone-color
// conversion which only re-colors an existing recording's timbre and
// doesn't capture accent/cadence -- confirmed too weak a match in practice.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

// Windows runners/local use `python`; Linux Actions often only has `python3`.
const PYTHON = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const SERVER_SCRIPT = path.join(process.cwd(), 'scripts', 'chatterbox_server.py');

let serverHandle = null;

function startServer() {
  if (serverHandle) return serverHandle;

  const child = spawn(PYTHON, [SERVER_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = [];
  let stderr = '';
  let gotReady = false;
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', (err) => { if (!gotReady) rejectReady(err); });
  child.on('exit', (code) => {
    if (!gotReady) rejectReady(new Error(`chatterbox server exited ${code} before ready: ${stderr.slice(-2000)}`));
    while (pending.length) pending.shift().reject(new Error(`chatterbox server exited ${code}: ${stderr.slice(-2000)}`));
    serverHandle = null;
  });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.ready && !gotReady) { gotReady = true; resolveReady(); return; }
    const next = pending.shift();
    if (!next) return;
    if (msg.ok) next.resolve(msg.output);
    else next.reject(new Error(msg.error));
  });

  serverHandle = { child, ready, pending };
  return serverHandle;
}

/**
 * Synthesizes one segment's narration directly in the cloned voice.
 * Returns the path to the generated WAV file.
 *
 * Prosody knobs (ResembleAI docs):
 * - exaggeration ↑ → more ups/downs/emotion (also tends to speed up)
 * - cfg_weight ↓ (~0.3) → slower, more deliberate, freer prosody
 */
export async function synthesizeWithChatterbox({
  text,
  outputPath,
  referencePath,
  exaggeration = 0.72,
  cfgWeight = 0.28,
  temperature = 0.8
}) {
  const server = startServer();
  await server.ready;
  return new Promise((resolve, reject) => {
    server.pending.push({ resolve, reject });
    server.child.stdin.write(JSON.stringify({
      text,
      output: outputPath,
      reference: referencePath,
      exaggeration,
      cfg_weight: cfgWeight,
      temperature
    }) + '\n');
  });
}
