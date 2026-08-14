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

// Per-beat structure is expressed ONLY through pauses now — NOT through
// per-beat exaggeration/cfg/rate changes.
//
// Why (owner QA 2026-08-14): the earlier version nudged exaggeration/cfg/rate
// per beat AND synthesized each beat separately, so each independent Chatterbox
// call picked its own speaking rate and the pace audibly jumped ("too pacy,
// then slowing down, not consistent"). Chatterbox's own docs also note higher
// exaggeration tends to speed speech up — so per-beat exaggeration was itself a
// pace wobble. The fix: hold exaggeration/cfg/rate CONSTANT across the whole
// narration (the owner's tuned base) and get all the "performance" from where
// the pauses fall — a real gap before a reveal, a clean landing before the CTA.
// Deltas are kept in the shape (all zero) so re-enabling gentle variation later
// is a one-number change, not a refactor.
const EMPHASIS_PROFILE = {
  hook: { exagDelta: 0, cfgDelta: 0, rateDelta: 0, pauseBeforeMs: 0, pauseAfterMs: 240 },
  fact: { exagDelta: 0, cfgDelta: 0, rateDelta: 0, pauseBeforeMs: 0, pauseAfterMs: 300 },
  // Reveal/twist: a real pause BEFORE it lands (the "wait for it") — the pause
  // does the emphasis, not a parameter change that would shift the pace.
  reveal: { exagDelta: 0, cfgDelta: 0, rateDelta: 0, pauseBeforeMs: 380, pauseAfterMs: 300 },
  // Closing line / CTA: a small pause before it so it reads as a deliberate
  // landing. No pauseAfter — the end-of-video hold is handled in tts.js.
  cta: { exagDelta: 0, cfgDelta: 0, rateDelta: 0, pauseBeforeMs: 240, pauseAfterMs: 0 }
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

  // One beat per WHOLE sentence — not per breath-clause. Synthesizing a full
  // sentence in a single Chatterbox call keeps its internal pace consistent;
  // splitting mid-sentence made each fragment its own call with its own pace
  // (the "pacy then slow" wobble the owner heard). Chatterbox handles the
  // commas inside a sentence naturally.
  const rawBeats = sentences.map((sentence) => ({ text: sentence, isMidSentenceBreath: false }));

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
    const emphasis = classifyBeat(b.text, {
      beatIndex: i,
      isFirstRealBeat: i === firstRealIdx,
      isLastRealBeat: i === lastRealIdx,
      wordsBeforeThisBeat: b.wordsBeforeThisBeat
    });
    const profile = EMPHASIS_PROFILE[emphasis];

    // No exaggeration jitter and no rate/cfg deltas: every sentence is
    // synthesized at the SAME base settings so the speaking pace stays
    // consistent across the whole Short. All structure comes from the pauses.
    return {
      text: b.text,
      emphasis,
      pauseBeforeMs: profile.pauseBeforeMs,
      pauseAfterMs: profile.pauseAfterMs,
      exaggerationDelta: 0,
      cfgWeightDelta: 0,
      rateDelta: 0
    };
  });
}

export { wordCount as speechPerformanceWordCount };
