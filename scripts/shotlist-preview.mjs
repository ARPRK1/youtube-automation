// Shot-list preview (P1 debug dump). Prints the full per-beat visual plan
// for a Short — the exact narration slice each image sits over, the entity
// it will search for, the subject classification, and the intended style —
// with NO network calls, NO image generation, and NO video render. This is
// the fast way to see "does the plan point at the right thing for each
// second of narration" before spending a full pipeline run to find out it
// didn't.
//
// Two modes:
//   Offline (no keys needed) — supply the narration and visual_needs directly:
//     node scripts/shotlist-preview.mjs \
//       --narration "There is a country with no rivers. It still has a navy. Guess which." \
//       --needs "world map, naval ship, desert country"
//
//   Live — generate a real Short script from a topic via the LLM (needs a key):
//     node scripts/shotlist-preview.mjs --topic "countries with no rivers"
//     node scripts/shotlist-preview.mjs --niche world-facts
//
// It also runs the same speech-beat planner the voice uses, so you see the
// audio performance plan and the visual plan side by side.

import 'dotenv/config';
import { planVisualBeats } from '../lib/media-sourcing.js';
import { planSpeechBeats } from '../lib/speech-performance.js';
import { sanitizeVisualNeeds, writeShortScripts } from '../lib/script-writer.js';
import { loadConfig } from '../lib/config.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

// Estimate spoken seconds the same way the pipeline plans word counts
// (config.script.words_per_minute), plus the configured end hold — good
// enough to preview beat geometry without running TTS.
function estimateDurationSec(narration, config) {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  const wpm = config.script?.words_per_minute ?? 150;
  // Real clone speech runs slower than the planning wpm and pauses add time;
  // approximate with the configured speech_rate and a per-sentence pause budget.
  const rate = config.voice?.speech_rate ?? 0.9;
  const sentences = (narration.match(/[.!?]+/g) || []).length || 1;
  const pauseSec = (sentences - 1) * ((config.voice?.sentence_pause_ms ?? 360) / 1000);
  const spoken = (words / (wpm * rate)) * 60 + pauseSec;
  const hold = config.voice?.end_silence_sec ?? 2.0;
  return { spoken, hold, total: spoken + hold, words };
}

function printPlan(title, narration, visualNeeds, config) {
  const neverPeople = config.media?.never_people !== false;
  const cleanNeeds = sanitizeVisualNeeds(visualNeeds, narration, { neverPeople });
  const { spoken, hold, total, words } = estimateDurationSec(narration, config);

  console.log('='.repeat(72));
  console.log(`TITLE: ${title}`);
  console.log(`NARRATION (${words}w, ~${spoken.toFixed(1)}s spoken + ${hold.toFixed(1)}s hold = ~${total.toFixed(1)}s):`);
  console.log(`  ${narration}`);
  console.log('');
  console.log(`visual_needs (raw):   ${JSON.stringify(visualNeeds)}`);
  console.log(`visual_needs (clean): ${JSON.stringify(cleanNeeds)}`);
  if (cleanNeeds.length === 0) console.log('  !! WARNING: no showable visual_needs survived — sourcing will fall back to raw narration text');
  console.log('');

  console.log('SPEECH BEATS (voice performance):');
  for (const b of planSpeechBeats(narration)) {
    console.log(`  [${b.emphasis.padEnd(6)}] before=${String(b.pauseBeforeMs).padStart(3)}ms after=${String(b.pauseAfterMs).padStart(3)}ms exagΔ=${b.exaggerationDelta >= 0 ? '+' : ''}${b.exaggerationDelta.toFixed(3)}  "${b.text.slice(0, 56)}"`);
  }
  console.log('');

  console.log('VISUAL BEATS (shot list):');
  const segment = { text: narration, visual_needs: cleanNeeds };
  const beats = planVisualBeats({ segment, aspect: 'vertical', durationSec: total, endHoldSec: hold, config });
  for (const b of beats) {
    const flags = [b.isPrimarySlot ? 'ANCHOR' : '', b.subjectKind].filter(Boolean).join(' ');
    console.log(`  #${String(b.index).padStart(2)} ${b.t0.toFixed(1).padStart(5)}–${b.t1.toFixed(1).padStart(5)}s  [${b.style.padEnd(9)}] ${flags.padEnd(15)} entity="${b.entity}"`);
    console.log(`        over: "${b.beatText.slice(0, 64)}${b.beatText.length > 64 ? '…' : ''}"`);
  }
  console.log('');
  console.log('QA: does each entity match the words on the "over:" line? Anchor (#0) is the one image vision-verified at render time.');
  console.log('');
}

async function main() {
  const config = loadConfig();
  const narration = arg('narration');
  const topic = arg('topic');
  const niche = arg('niche');

  if (narration) {
    const needs = (arg('needs') || '').split(',').map((s) => s.trim()).filter(Boolean);
    printPlan(arg('title') || '(manual preview)', narration, needs, config);
    return;
  }

  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error('Live mode needs GROQ_API_KEY or GEMINI_API_KEY. For an offline preview, pass --narration "..." [--needs "a, b, c"].');
    process.exitCode = 1;
    return;
  }

  const { researchTodaysTopic } = await import('../lib/research.js');
  const research = topic
    ? { topic, facts: [], score: 0, reason: 'manual --topic' }
    : await researchTodaysTopic(new Date(), { forceNicheId: niche || undefined });
  console.log(`Topic: ${research.topic}\n`);

  const count = parseInt(arg('count') || '2', 10);
  const shorts = await writeShortScripts(research, null, count);
  for (const s of shorts) {
    printPlan(s.title, s.narration, s.visual_needs, config);
  }
}

main();
