// Voice QA smoke test (P0 acceptance path). Synthesizes 2–3 sample Shorts
// lines straight to WAV using the REAL production voice path (beat planner
// + Chatterbox + per-beat prosody + loudnorm + end hold), with NO research,
// script generation, visuals, or video render. Lets you hear whether the
// clone sounds like the owner and lands its pauses in ~1 minute instead of
// waiting out a full pipeline run.
//
// Output: voice-smoke/<n>-<slug>.mp3 (+ the raw beats kept for inspection).
//
// Usage:
//   node scripts/voice-smoke.mjs
//   node scripts/voice-smoke.mjs "Your own custom line to test."
//   node scripts/voice-smoke.mjs --provider edge-tts        # A/B vs clone
//
// Listen for (owner QA checklist):
//   - Does it sound like YOU, not a generic reader?
//   - Breath/pause AFTER the hook, BEFORE the reveal?
//   - The surprising word gets stress; connectors go quicker?
//   - Clean complete final sentence + ~2s silence hold at the end?

import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { synthesizeSegmentAudio } from '../lib/tts.js';
import { probeDurationSeconds } from '../lib/ffmpeg-util.js';
import { planSpeechBeats } from '../lib/speech-performance.js';
import { loadConfig } from '../lib/config.js';

const DEFAULT_LINES = [
  // Hook → fact → reveal → cta arc, so every emphasis type gets exercised.
  "Here's something strange. There is a country with no rivers at all. But it still keeps a navy. Guess which one before I tell you.",
  "Most people think glass is a solid. Actually, it's neither a solid nor a liquid. It's an amorphous solid, frozen mid-flow. Wild, right?",
  "Top of the list of things schools got wrong: you do not have five senses. You have far more than that, including balance and temperature. Now you know."
];

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function main() {
  const args = process.argv.slice(2);
  const providerOverride = (() => {
    const i = args.indexOf('--provider');
    if (i !== -1) { const v = args[i + 1]; args.splice(i, 2); return v; }
    return null;
  })();
  const custom = args.filter((a) => !a.startsWith('--'));
  const lines = custom.length > 0 ? custom : DEFAULT_LINES;

  if (providerOverride) {
    // Force a provider for this run without editing config.yaml — used to
    // A/B the clone against edge-tts. loadConfig() caches, so mutate in place.
    const cfg = loadConfig();
    cfg.voice = { ...cfg.voice, shorts_provider: providerOverride };
    console.log(`[voice-smoke] provider override: shorts_provider=${providerOverride}`);
  }

  const outDir = 'voice-smoke';
  await mkdir(outDir, { recursive: true });

  console.log(`[voice-smoke] ${lines.length} line(s). Config: exag=${loadConfig().voice?.chatterbox_exaggeration}, cfg=${loadConfig().voice?.chatterbox_cfg_weight}, rate=${loadConfig().voice?.speech_rate}, beats=${loadConfig().voice?.beat_performance_enabled !== false}`);
  console.log('');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const base = `${i + 1}-${slugify(line) || 'line'}`;

    // Show the beat plan so a bad prosody choice is visible without a listen.
    const beats = planSpeechBeats(line);
    console.log(`[voice-smoke] line ${i + 1}: "${line}"`);
    for (const b of beats) {
      console.log(`    [${b.emphasis.padEnd(6)}] pauseBefore=${b.pauseBeforeMs}ms pauseAfter=${b.pauseAfterMs}ms exagΔ=${b.exaggerationDelta.toFixed(3)} cfgΔ=${b.cfgWeightDelta.toFixed(2)} — "${b.text.slice(0, 60)}"`);
    }

    try {
      const { audioPath, durationSec, provider } = await synthesizeSegmentAudio(
        line, outDir, base, { kind: 'short', isLastSegment: true }
      );
      const dur = durationSec ?? await probeDurationSeconds(audioPath);
      console.log(`[voice-smoke] -> ${audioPath} (${dur.toFixed(1)}s, provider=${provider})\n`);
    } catch (err) {
      console.error(`[voice-smoke] FAILED line ${i + 1}: ${err.message}`);
      if (/chatterbox/i.test(err.message)) {
        console.error('[voice-smoke] Chatterbox unavailable? Install with: pip install chatterbox-tts   (or run with --provider edge-tts to test pacing only)');
      }
      console.log('');
    }
  }

  console.log('[voice-smoke] Done. Play the files in voice-smoke/ and run the QA checklist at the top of this file.');
  // The chatterbox server is a persistent child; nothing keeps the event
  // loop alive after synthesis, but be explicit so the process exits clean.
  process.exit(process.exitCode || 0);
}

main();
