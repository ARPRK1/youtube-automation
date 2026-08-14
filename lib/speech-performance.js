// Speech performance planner (P0). Turns flat narration text into a sequence
// of spoken "beats" — small units, each carrying its own emphasis type,
// pause timing, and prosody nudge — so Chatterbox synthesizes a PERFORMANCE
// instead of one flat pass reading the whole script at constant settings.
//
// Why this exists (owner feedback 2026-08-12/13, Islands Vanish / Reappearing
// Act / Now You See Me): sentence-level splitting with a single fixed pause
// and fixed exaggeration/cfg_weight for the whole script still reads as
// "fast reading with gaps between sentences", not a person telling you
// something. Real speech varies WITHIN a script: hooks land fast and punchy,
// reveals get a beat of silence before them and more lift, long sentences
// get a breath at a natural clause break, and closing lines settle down.
// None of that comes from atempo or one global config knob — it has to be
// decided per-beat, before synthesis, from the actual words.
//
// This is deliberately a plain heuristic classifier, not an LLM call: it
// has to run on every sentence of every Short with zero added latency/cost,
// and it only needs to be roughly right (hook vs. reveal vs. close vs.
// plain fact) to make an audible difference — getting the label exactly
// right doesn't matter as much as varying SOMETHING beat to beat.

const HOOK_WORD_BUDGET = 12; // beats that start within this many words of the top of the narration are "the hook"
const REVEAL_STARTERS = /^(but|however|turns out|actually|here'?s the thing|the truth is|what if i told you|and yet|except|until|nobody tells you)\b/i;
const CTA_MARKERS = /\b(follow|comment|subscribe|what do you think|were you right|which one|tell me|nobody tells you|now you know|remember that)\b/i;
// Splits a long clause at its first natural breath point: a comma before a
// connective, a semicolon/colon, or an em-dash. Captured so the delimiter
// stays attached to the clause before it (that's where the breath goes).
const BREATH_SPLIT = /(,\s+(?:and|but|so|because|which|that|or|when|while)\s+|;\s+|:\s+|\s+—\s*)/i;

// Deltas applied ON TOP OF config.yaml's base exaggeration/cfg_weight/speech_rate
// for the beat's synthesis call — not replacements. Keeps the owner's tuned
// base pairing (exaggeration ~0.72-0.75, cfg_weight ~0.28) as the center of
// gravity and only pushes individual beats away from it.
const EMPHASIS_PROFILE = {
  // Hook: slightly more lift, a touch faster/tighter cfg, short landing pause.
  hook: { exagDelta: 0.06, cfgDelta: -0.02, rateDelta: 0.00, pauseBeforeMs: 0, pauseAfterMs: 260 },
  // Plain fact/explain beat: the owner's tuned baseline, untouched.
  fact: { exagDelta: 0.00, cfgDelta: 0.00, rateDelta: 0.00, pauseBeforeMs: 0, pauseAfterMs: 340 },
  // Reveal/twist: a real pause BEFORE it lands (the "wait for it"), more
  // emotional lift, and a slightly slower cfg for deliberate delivery.
  reveal: { exagDelta: 0.09, cfgDelta: -0.04, rateDelta: -0.03, pauseBeforeMs: 420, pauseAfterMs: 420 },
  // Closing line / CTA: settle down, small pause before it so it reads as
  // a deliberate landing rather than one more list item. No pauseAfter here
  // -- the end-of-video hold is handled separately (tts.js appendSilence).
  cta: { exagDelta: -0.03, cfgDelta: 0.03, rateDelta: 0.02, pauseBeforeMs: 260, pauseAfterMs: 0 },
  // Mid-sentence breath: not a real beat boundary, just a clause break in a
  // long sentence. Small pause, pulled slightly toward calmer delivery.
  breath: { exagDelta: -0.02, cfgDelta: 0.02, rateDelta: 0.00, pauseBeforeMs: 0, pauseAfterMs: 160 }
};

function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function classifyBeat(text, { beatIndex, isFirstRealBeat, isLastRealBeat, wordsBeforeThisBeat }) {
  const t = text.trim();
  if (isFirstRealBeat && wordsBeforeThisBeat < HOOK_WORD_BUDGET) return 'hook';
  if (REVEAL_STARTERS.test(t)) return 'reveal';
  if (isLastRealBeat && (CTA_MARKERS.test(t) || /\?\s*$/.test(t))) return 'cta';
  return 'fact';
}

/** Splits one sentence into breath-clauses when it's long enough that a real
 * speaker would take a breath partway through. Short/punchy sentences stay
 * whole — fragmenting a one-liner kills its punch instead of adding rhythm. */
function splitLongSentenceAtBreath(sentence) {
  if (wordCount(sentence) < 14) return [sentence];
  const parts = sentence.split(BREATH_SPLIT).filter(Boolean);
  if (parts.length <= 1) return [sentence];
  // The delimiter comes back as its own array element from the capturing
  // group — fold it onto the end of the preceding clause so each clause
  // keeps its connective tissue and the pause lands after the comma/dash,
  // not before it.
  const merged = [];
  for (const part of parts) {
    if (BREATH_SPLIT.test(part) && merged.length > 0) {
      merged[merged.length - 1] += part;
    } else {
      merged.push(part);
    }
  }
  return merged.map((p) => p.trim()).filter(Boolean);
}

/**
 * Splits narration into performance beats ready for per-beat TTS synthesis.
 * @param {string} text
 * @returns {Array<{
 *   text: string,
 *   emphasis: 'hook'|'fact'|'reveal'|'cta'|'breath',
 *   pauseBeforeMs: number,
 *   pauseAfterMs: number,
 *   exaggerationDelta: number,
 *   cfgWeightDelta: number,
 *   rateDelta: number
 * }>}
 */
export function planSpeechBeats(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const sentences = (cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [cleaned])
    .map((s) => s.trim())
    .filter(Boolean);

  const rawBeats = [];
  sentences.forEach((sentence) => {
    const clauses = splitLongSentenceAtBreath(sentence);
    clauses.forEach((clause, cIdx) => {
      rawBeats.push({
        text: clause,
        isMidSentenceBreath: cIdx < clauses.length - 1
      });
    });
  });

  // Merge tiny fragments (<= 2 words) into a neighbor so we never make a
  // 1-word Chatterbox call — those are wasteful on the slow CPU runner and
  // synthesize clipped, unnatural audio (confirmed live 2026-08-13: a
  // "beat 2/7 [fact] (1w)"). Absorb backward into the previous beat; if the
  // very first beat is tiny, pull the next beat into it instead.
  const MIN_BEAT_WORDS = 3;
  const mergedBeats = [];
  for (const b of rawBeats) {
    if (wordCount(b.text) < MIN_BEAT_WORDS && mergedBeats.length > 0) {
      const prev = mergedBeats[mergedBeats.length - 1];
      prev.text = `${prev.text} ${b.text}`.replace(/\s+/g, ' ').trim();
      // The merged unit ends a sentence unless the absorbed fragment was itself
      // mid-sentence (a trailing clause fragment keeps the sentence open).
      prev.isMidSentenceBreath = b.isMidSentenceBreath;
    } else {
      mergedBeats.push({ ...b });
    }
  }
  if (mergedBeats.length > 1 && wordCount(mergedBeats[0].text) < MIN_BEAT_WORDS) {
    mergedBeats[1].text = `${mergedBeats[0].text} ${mergedBeats[1].text}`.replace(/\s+/g, ' ').trim();
    mergedBeats.shift();
  }
  // Recompute cumulative word offsets on the merged beats (used to spot the hook).
  let acc = 0;
  for (const b of mergedBeats) { b.wordsBeforeThisBeat = acc; acc += wordCount(b.text); }
  rawBeats.length = 0;
  rawBeats.push(...mergedBeats);

  const realBeatIndices = rawBeats.reduce((acc, b, i) => { if (!b.isMidSentenceBreath) acc.push(i); return acc; }, []);
  const firstRealIdx = realBeatIndices[0];
  const lastRealIdx = realBeatIndices[realBeatIndices.length - 1];

  return rawBeats.map((b, i) => {
    const emphasis = b.isMidSentenceBreath
      ? 'breath'
      : classifyBeat(b.text, {
        beatIndex: i,
        isFirstRealBeat: i === firstRealIdx,
        isLastRealBeat: i === lastRealIdx,
        wordsBeforeThisBeat: b.wordsBeforeThisBeat
      });
    const profile = EMPHASIS_PROFILE[emphasis];

    // Small deterministic jitter (hash of the clause text) so consecutive
    // "fact" beats don't all land at the exact identical exaggeration --
    // real speech has micro-variance even within one register. Deterministic
    // rather than Math.random() so re-running the same script reproduces
    // the same audio.
    let h = 0;
    for (let k = 0; k < b.text.length; k++) h = (h * 31 + b.text.charCodeAt(k)) >>> 0;
    const jitter = ((h % 21) - 10) / 1000; // +/- 0.010

    return {
      text: b.text,
      emphasis,
      pauseBeforeMs: profile.pauseBeforeMs,
      pauseAfterMs: profile.pauseAfterMs,
      exaggerationDelta: profile.exagDelta + jitter,
      cfgWeightDelta: profile.cfgDelta,
      rateDelta: profile.rateDelta
    };
  });
}

export { wordCount as speechPerformanceWordCount };
