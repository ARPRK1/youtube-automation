// Writes video scripts using a free-tier LLM (Groq or Gemini). Never calls
// Claude/Anthropic here — that's the whole point of this pipeline.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callFreeLLM, extractJson } from './llm.js';
import { loadConfig } from './config.js';
import {
  growthScriptDirectives,
  optimizeTitle,
  buildGrowthDescription,
  buildGrowthTags,
  topicHashtags
} from './growth.js';

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Phrases that read as obviously AI-generated. Checked and stripped after
// generation rather than trusted to the model's own restraint -- LLMs
// don't reliably avoid instructed-against phrases 100% of the time.
const BANNED_PHRASES = [
  /\bdelve(?:s|d|ing)?\b/gi,
  /\bin today'?s video,? we'?ll?\s+(?:be\s+)?explor(?:e|ing)\b/gi,
  /\bin conclusion\b/gi,
  /\bwhether you'?re an?\s+[\w\s]+?\s+or an?\s+[\w\s]+?[,.]/gi,
  /\blittle did (?:they|he|she|we|I)\s+know\b/gi,
  /\bbuckle up\b/gi
];

function stripBannedPhrases(text) {
  let cleaned = text;
  for (const pattern of BANNED_PHRASES) cleaned = cleaned.replace(pattern, '').replace(/\s{2,}/g, ' ');
  return cleaned.trim();
}

/** Detects the "ran out of real content and started padding" failure mode
 * (seen in testing on a thin topic: "closure, finality" and "game of
 * chance" each repeated 3x in the back half of a script) -- any 6-word
 * phrase appearing 3+ times is a strong signal of repetitive filler, not
 * a stylistic callback. */
function findRepeatedPhrases(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const counts = new Map();
  for (let i = 0; i <= words.length - 6; i++) {
    const gram = words.slice(i, i + 6).join(' ');
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= 3).map(([gram]) => gram);
}

/** Tokenize the same way findRepeatedPhrases does: strip non-alphanumerics
 * (so "it's"→"its", "world's"→"worlds", "well-known"→"wellknown") then
 * split on whitespace. Returns spans with original char offsets so a
 * token index can be mapped back for the sentence-end cut. */
function tokenSpansMatchingRepeats(text) {
  const lower = text.toLowerCase();
  const spans = [];
  let i = 0;
  while (i < lower.length) {
    if (!/[a-z0-9]/.test(lower[i])) { i++; continue; }
    const start = i;
    let token = '';
    while (i < lower.length) {
      if (/[a-z0-9]/.test(lower[i])) {
        token += lower[i];
        i++;
      } else if (
        // Punctuation inside a word (apostrophe, hyphen) is dropped by
        // findRepeatedPhrases without inserting a boundary -- keep joining.
        !/\s/.test(lower[i]) &&
        i + 1 < lower.length &&
        /[a-z0-9]/.test(lower[i + 1]) &&
        token.length > 0
      ) {
        i++;
      } else {
        break;
      }
    }
    spans.push({ start, end: i, token });
  }
  return spans;
}

/** Locate every word-level match of `phrase` in `text` (same tokenization
 * as findRepeatedPhrases). Returns [{ tokenStart, tokenEnd, charStart, charEnd }]. */
function findPhraseOccurrences(text, phrase) {
  const phraseTokens = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (phraseTokens.length === 0) return [];

  const tokenSpans = tokenSpansMatchingRepeats(text);
  const tokens = tokenSpans.map((s) => s.token);
  const hits = [];
  for (let t = 0; t <= tokens.length - phraseTokens.length; t++) {
    let ok = true;
    for (let k = 0; k < phraseTokens.length; k++) {
      if (tokens[t + k] !== phraseTokens[k]) { ok = false; break; }
    }
    if (ok) {
      hits.push({
        tokenStart: t,
        tokenEnd: t + phraseTokens.length,
        charStart: tokenSpans[t].start,
        charEnd: tokenSpans[t + phraseTokens.length - 1].end
      });
      t += phraseTokens.length - 1; // skip past this match
    }
  }
  return hits;
}

/** Prefer keeping the whole script: delete only the 3rd+ occurrences of a
 * repeated phrase (leave the first two, and everything around them). Much
 * less destructive than truncating the whole tail at the second hit --
 * confirmed live that hard-trim to second-occurrence often fell below
 * min_long_words (950) and threw away an otherwise usable long script. */
function removeExtraPhraseOccurrences(text, phrase, maxKeep = 2) {
  const hits = findPhraseOccurrences(text, phrase);
  if (hits.length <= maxKeep) return text;
  // Delete from the end so earlier char offsets stay valid.
  let out = text;
  for (let i = hits.length - 1; i >= maxKeep; i--) {
    const { charStart, charEnd } = hits[i];
    // Expand left to eat a leading space/comma so we don't leave double spaces.
    let from = charStart;
    while (from > 0 && /[\s,]/.test(out[from - 1])) from--;
    out = out.slice(0, from) + out.slice(charEnd);
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

/** Graceful degradation when a retry still repeats itself: rather than
 * losing the whole video, cut the narration right after the SECOND
 * occurrence of the offending phrase (keeping the first real usage and
 * one natural callback, dropping only the padding beyond that).
 *
 * Matching is word-level on punctuation-stripped tokens so contractions
 * and possessives still hit the same phrase findRepeatedPhrases detected.
 * Returns null if the trim would fall below `minWords`, so the caller
 * still has a real failure signal rather than shipping something too short. */
function trimAfterSecondOccurrence(text, phrase, minWords) {
  const hits = findPhraseOccurrences(text, phrase);
  if (hits.length < 2) return null;

  const phraseEndChar = hits[1].charEnd;
  // Keep through the end of the sentence containing the second occurrence.
  const sentenceEnd = text.indexOf('.', phraseEndChar);
  const cut = sentenceEnd === -1 ? phraseEndChar : sentenceEnd + 1;
  const trimmed = text.slice(0, cut).trim();
  return wordCount(trimmed) >= minWords ? trimmed : null;
}

function findBannedPhrases(text) {
  const found = [];
  for (const pattern of BANNED_PHRASES) {
    const matches = text.match(pattern);
    if (matches) found.push(...matches);
  }
  // Em-dash overuse is itself a tell, independent of any single phrase.
  const emDashCount = (text.match(/—/g) || []).length;
  if (emDashCount > Math.ceil(wordCount(text) / 300)) found.push(`${emDashCount} em-dashes (overused)`);
  return found;
}

const STRUCTURE_GUIDE = {
  'story-led': 'Open with a specific moment or scene, told like a story with a beginning, a turn, and a payoff. Weave the facts into the narrative rather than listing them.',
  'question-led': 'Open with a genuine, specific question the viewer probably wonders about, then answer it piece by piece, letting each answer raise the next question.',
  countdown: 'Structure as a countdown or ranked list of specific points (framed narratively, not as dry bullet points), building to the most important one.',
  mystery: 'Open with an unresolved puzzle or contradiction, withhold the full picture, and reveal it in pieces as the video progresses.'
};

const STRUCTURE_HISTORY_FILE = 'script-structure-history.json';

async function pickStructure(config) {
  const structures = config.script?.structures || Object.keys(STRUCTURE_GUIDE);
  const runsDir = config.paths?.runs_dir || 'runs';
  const historyPath = path.join(runsDir, STRUCTURE_HISTORY_FILE);
  let history = [];
  try {
    history = JSON.parse(await readFile(historyPath, 'utf-8'));
  } catch { /* first run, no history yet */ }

  // Pick whichever configured structure was used least recently (or never).
  const lastUsedIndex = Object.fromEntries(structures.map((s) => [s, -1]));
  history.forEach((h, i) => { if (h.structure in lastUsedIndex) lastUsedIndex[h.structure] = i; });
  const chosen = structures.reduce((best, s) => (lastUsedIndex[s] < lastUsedIndex[best] ? s : best), structures[0]);

  await mkdir(runsDir, { recursive: true });
  const updated = [...history, { structure: chosen, date: new Date().toISOString().slice(0, 10) }].slice(-30);
  await writeFile(historyPath, JSON.stringify(updated, null, 2), 'utf-8');

  return chosen;
}

function factsBlock(facts) {
  if (!facts || facts.length === 0) return '';
  return `\nReal, sourced facts you may use (do not state anything as fact beyond what's here and general common knowledge -- no invented statistics, quotes, or events):\n${facts.map((f) => `- ${f.text}${f.source ? ` (${f.source})` : ''}`).join('\n')}\n`;
}

/** Plain-text narration call, kept separate from JSON/segment generation —
 * models reliably undershoot requested word counts when also asked to
 * produce structured output in the same response. Retries once with a
 * more forceful prompt if the first attempt comes in short, and once more
 * if banned AI-cliché phrases survive into the text. */
async function generateNarration(research, structure, minWords, targetWords, { kind = 'long' } = {}) {
  const config = loadConfig();
  const structureNote = STRUCTURE_GUIDE[structure] || '';
  const growthExtra = config.script?.growth_mode !== false ? growthScriptDirectives(kind) : '';
  const basePrompt = (extra) => `Write a spoken YouTube video narration script about: "${research.topic}".
${factsBlock(research.facts)}
Style: conversational spoken English with a light natural Indian-English flavor is fine (not forced slang). Contractions (it's, don't, you're), short punchy sentences, occasional rhetorical questions, a clear point of view. This is a real script a human host would say out loud — not a Wikipedia article.
Today's structure: ${structure} -- ${structureNote}
The first sentence must hook attention immediately -- no throat-clearing, no "in today's video." Get straight into it.
Never use: "delve", "in today's video we will explore", "in conclusion", "whether you're a ... or a ...", "little did they/we/he/she know", "buckle up". Do not overuse em-dashes.
${growthExtra}
Output ONLY the plain narration text -- no title, no headers, no markdown, no stage directions.
Aim for around ${targetWords} words, covering the topic with real depth and specific detail -- but it MUST be at least ${minWords} words, and it is far more important to never repeat a point than to hit the target: if the topic runs out of genuinely new material before ${targetWords} words, a shorter script that stays fresh throughout beats a longer one that starts repeating itself. ${extra}`;

  let narration = await callFreeLLM(basePrompt(''), 3000);
  if (wordCount(narration) < minWords) {
    narration = await callFreeLLM(
      basePrompt(`Your previous attempt was too short. Cover additional DISTINCT angles, examples, or specifics you haven't mentioned yet until you clearly exceed ${minWords} words -- don't restate earlier points in different words.`),
      3800
    );
  }

  const banned = findBannedPhrases(narration);
  if (banned.length > 0) {
    const retry = await callFreeLLM(
      basePrompt(`Your previous attempt used banned phrasing (${banned.join(', ')}). Do not use any of the banned phrases or patterns listed above anywhere in this new version.`),
      3800
    );
    narration = findBannedPhrases(retry).length < banned.length ? retry : stripBannedPhrases(narration);
  }

  let repeated = findRepeatedPhrases(narration);
  if (repeated.length > 0) {
    // Asking for "more elaboration" here tends to make repetition worse,
    // not better (the model doesn't have new material, so "elaborate"
    // just restates what it already said) -- ask it to cover NEW ground
    // instead, and allow the result to come in shorter if that's what
    // stopping the repetition costs, rather than forcing padding again.
    const retry = await callFreeLLM(
      basePrompt(`Your previous attempt repeated itself -- these phrases each appeared 3+ times: ${repeated.slice(0, 3).join(' | ')}. Do not repeat any point, phrase, or beat under any circumstances. If you run out of genuinely new material before reaching the word count, stop -- a shorter script that never repeats itself is better than a longer one that does.`),
      3800
    );
    const retryRepeats = findRepeatedPhrases(retry);
    if (retryRepeats.length === 0) {
      narration = retry;
      repeated = [];
    }
  }

  if (repeated.length > 0) {
    // The targeted retry above tells the model what it did wrong, but
    // repetition is often just sampling variance on a thin topic rather
    // than a genuine ceiling on material -- a clean regeneration (no
    // "fix your mistake" framing at all) sometimes lands fresh where the
    // targeted retry didn't. One bounded extra attempt before giving up.
    const freshTry = await callFreeLLM(basePrompt(''), 3800);
    if (findRepeatedPhrases(freshTry).length === 0 && wordCount(freshTry) >= minWords) {
      narration = freshTry;
      repeated = [];
    }
  }

  if (repeated.length > 0) {
    // Prefer surgically deleting 3rd+ occurrences of each repeated phrase
    // so unique material after the padding stays in the script. Only fall
    // back to hard-trim-at-second-occurrence if that still leaves 3+ hits
    // (overlapping grams) or drops us below a soft word floor.
    // 0.72/650 previously let a script ship with real spoken duration under
    // long_min_minutes' hard gate (confirmed live 2026-07-25: 3 of 4 pillar
    // runs wrote scripts that "proceeded" under this floor, ran the FULL
    // ~50-60 min script+TTS+visual pipeline, then failed orchestrator.js's
    // post-TTS duration check anyway -- wasted, not saved, work). Measured
    // real speech rate on this voice is ~170 wpm, not the 200wpm planning
    // assumption baked into words_per_minute; 0.85/900 keeps a real margin
    // above the 360s (6 min) floor even at a slightly slower real rate.
    const softMin = Math.max(Math.floor(minWords * 0.85), 900);
    let cleaned = narration;
    for (const phrase of repeated.slice(0, 5)) {
      cleaned = removeExtraPhraseOccurrences(cleaned, phrase, 2);
    }
    const stillRepeated = findRepeatedPhrases(cleaned);
    if (stillRepeated.length === 0 && wordCount(cleaned) >= softMin) {
      console.warn(`[script-writer] removed extra repeated-phrase occurrences instead of failing (${wordCount(narration)} -> ${wordCount(cleaned)} words)`);
      narration = cleaned;
      repeated = [];
    } else {
      const trimmed = trimAfterSecondOccurrence(cleaned, (stillRepeated[0] || repeated[0]), softMin)
        || trimAfterSecondOccurrence(narration, repeated[0], softMin);
      if (trimmed && findRepeatedPhrases(trimmed).length === 0) {
        console.warn(`[script-writer] trimmed narration after repeated phrase instead of failing outright (${wordCount(narration)} -> ${wordCount(trimmed)} words, softMin=${softMin})`);
        narration = trimmed;
        repeated = [];
      } else if (trimmed && wordCount(trimmed) >= softMin) {
        // Still has some 6-grams repeating but is shippable length -- strip
        // extras once more on the trimmed text and accept.
        let finalText = trimmed;
        for (const phrase of findRepeatedPhrases(finalText).slice(0, 5)) {
          finalText = removeExtraPhraseOccurrences(finalText, phrase, 2);
        }
        console.warn(`[script-writer] accepted de-repeated narration at soft floor (${wordCount(narration)} -> ${wordCount(finalText)} words)`);
        narration = finalText;
        repeated = [];
      } else {
        throw new Error(`Narration keeps repeating itself even after a retry (e.g. "${repeated[0]}") -- this topic likely doesn't have enough real substance for a full-length script`);
      }
    }
  }

  return narration.trim();
}

/** Locates each segment's start_cue in the narration and slices the real
 * text out programmatically. Far more token-efficient and reliable than
 * asking the model to reproduce the whole narration verbatim inside JSON
 * (which was both expensive -- roughly doubling output tokens -- and
 * fragile: long verbatim text inside JSON strings truncates and breaks on
 * unescaped quotes). If a cue can't be found (the model paraphrased it
 * slightly), that boundary is dropped and its text merges into the
 * previous segment rather than failing the whole script. */
function sliceSegmentsByStartCues(narration, cues) {
  const positions = [];
  let searchFrom = 0;
  for (const cue of cues) {
    const needle = cue.start_cue?.trim();
    if (!needle) continue;
    let idx = narration.indexOf(needle, searchFrom);
    if (idx === -1) idx = narration.toLowerCase().indexOf(needle.toLowerCase(), searchFrom);
    if (idx === -1) continue; // drop this boundary, its text stays with the previous segment
    positions.push({ idx, visual_needs: cue.visual_needs || [] });
    searchFrom = idx + needle.length;
  }
  if (positions.length === 0 || positions[0].idx > 0) positions.unshift({ idx: 0, visual_needs: positions[0]?.visual_needs || [] });

  return positions.map((p, i) => ({
    text: narration.slice(p.idx, positions[i + 1]?.idx ?? narration.length).trim(),
    visual_needs: p.visual_needs
  })).filter((s) => s.text.length > 0);
}

/** Splits the finished narration into content-aware segments (natural
 * breaks, not fixed-length chunks) and, for each one, the concrete
 * entities that should be shown on screen -- this is what lib/visuals.js
 * uses to source media per segment instead of one query for a whole
 * chapter or the whole video. */
async function segmentNarration(narration) {
  const prompt = `Here is a video narration script. Break it into segments at natural content breaks (not fixed length). For each segment, give the exact first 5-8 words (verbatim, to mark where it starts) and the concrete visual entities it needs on screen -- real people's names, place names, specific objects or events, not vague concepts like "excitement" or "an important moment".

Script:
"""
${narration}
"""

Return ONLY JSON, no other text -- do NOT repeat the full script, only the short start cues:
{"segments": [{"start_cue": "first 5-8 words of this segment verbatim", "visual_needs": ["entity 1", "entity 2"]}]}

Rules:
- segments must be in order covering the entire script, each roughly 15-30 seconds of spoken narration (about 35-70 words)
- visual_needs entries must be SHORT (2-4 words max) -- just the name, e.g. "Gautam Gambhir" or "Mumbai stadium". Never add parenthetical descriptions, moods, or camera directions like "(fiery glares, intense eyes)".`;

  const raw = await callFreeLLM(prompt, 3500);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    throw new Error('Segmentation returned no segments');
  }

  const segments = sliceSegmentsByStartCues(narration, parsed.segments);
  const originalWords = wordCount(narration);
  const segmentWords = segments.reduce((sum, s) => sum + wordCount(s.text), 0);
  if (segmentWords < originalWords * 0.8) {
    throw new Error(`Segmentation only recovered ${segmentWords}/${originalWords} words -- too many start cues failed to match`);
  }

  return segments;
}

/** Assigns a duration_estimate to each segment proportional to its own
 * word share of the narration, scaled against the REAL total audio
 * duration once known (see orchestrator.js, after TTS) -- kept here as a
 * text-only estimate for anything that needs it before audio exists. */
export function estimateSegmentDurations(segments, wordsPerMinute) {
  return segments.map((s) => ({ ...s, duration_estimate: (wordCount(s.text) / wordsPerMinute) * 60 }));
}

const METADATA_SHAPE = `{
  "title": "curiosity-driven, SEO-friendly title under 60 characters, no clickbait-spam caps",
  "description": "an opening hook line (1 sentence), then 2-3 natural sentences summarizing the video",
  "tags": ["tag1", "tag2", ... up to 15 SEO tags],
  "hashtags": ["5 to 8 short trending-style hashtags WITHOUT the # symbol, specific to this video's actual topic"]
}`;

function assembleDescription(base, hashtags) {
  const tagLine = hashtags.map((h) => `#${h.replace(/^#/, '').replace(/\s+/g, '')}`).join(' ');
  return `${base}\n\n${tagLine}`.trim();
}

/**
 * Writes one long-form script from a Stage 1 research result ({ topic,
 * facts, ... } from lib/research.js). Picks and records today's structure
 * style, writes human-sounding narration grounded only in research.facts,
 * then segments it with per-segment visual entities.
 *
 * Returns { title, description, tags, hashtags, structure, narration, segments }
 */
export async function writeLongScript(research) {
  const config = loadConfig();
  const minWords = config.script?.min_long_words ?? 700;
  const targetWords = config.script?.target_long_words ?? 1600;
  const wpm = config.script?.words_per_minute ?? 140;

  const structure = await pickStructure(config);
  const narration = await generateNarration(research, structure, minWords, targetWords, { kind: 'long' });
  // Soft floor matches generateNarration's de-repeat path (~0.85 * min, see
  // its comment for why -- real spoken duration, not just word count, has
  // to clear produceVideo's post-TTS duration gate) so a surgically
  // de-repeated script that lands slightly under the hard target still ships.
  const softMin = Math.max(Math.floor(minWords * 0.85), 900);
  if (wordCount(narration) < softMin) {
    throw new Error(`Generated narration is too short (${wordCount(narration)} words, need ${softMin}+) -- refusing to proceed with a thin script`);
  }
  if (wordCount(narration) < minWords) {
    console.warn(`[script-writer] narration is under hard min (${wordCount(narration)} < ${minWords}) but above soft floor ${softMin} -- proceeding`);
  }

  const rawSegments = await segmentNarration(narration);
  const segments = estimateSegmentDurations(rawSegments, wpm);

  const metaPrompt = `Here is a YouTube video narration script:
"""
${narration.slice(0, 4000)}
"""
Return ONLY a JSON object, no other text, matching this shape exactly:
${METADATA_SHAPE}`;
  let meta;
  try {
    meta = extractJson(await callFreeLLM(metaPrompt, 1200));
  } catch (err) {
    console.warn(`[script-writer] metadata JSON was cut off or malformed, retrying with more headroom: ${err.message}`);
    meta = extractJson(await callFreeLLM(`${metaPrompt}\nKeep it brief so the whole JSON response fits comfortably.`, 1800));
  }
  // Topic-derived hashtags first (survive buildGrowthDescription's cap
  // ahead of generic branded ones), then whatever the LLM added on top --
  // guarantees real topic coverage even if the LLM under-delivers on count.
  const hashtags = [...new Set([...topicHashtags(research.topic), ...(Array.isArray(meta.hashtags) ? meta.hashtags : [])])];
  const title = optimizeTitle(meta.title || research.topic, { kind: 'long' });
  const tags = buildGrowthTags({
    kind: 'long',
    topic: research.topic,
    extra: [...(Array.isArray(meta.tags) ? meta.tags : []), ...hashtags]
  });
  const description = buildGrowthDescription({
    kind: 'long',
    hookLine: meta.description?.split(/[.!?]/)[0] || title,
    body: meta.description || '',
    facts: research.facts,
    hashtags
  });

  return {
    ...meta,
    title,
    tags,
    hashtags,
    description,
    structure,
    narration,
    segments
  };
}

/**
 * Writes N short-form scripts derived from the long script's best hook(s),
 * each independently structured (own hook, own segments/visual_needs) so
 * it works standalone without having seen the long video. Every short
 * forcibly gets #Shorts in its hashtags -- YouTube uses that tag to route
 * uploads into the Shorts shelf, so it's not left to the model.
 */
export async function writeShortScripts(research, longScript, count) {
  const config = loadConfig();
  const maxSeconds = config.video?.shorts_max_seconds ?? 120;
  const wpm = config.script?.words_per_minute ?? 140;
  const maxWords = Math.floor((maxSeconds / 60) * wpm * 0.85); // headroom below the hard cap

  const minShort = config.script?.min_short_words ?? 70;
  const maxShort = config.script?.max_short_words ?? Math.min(maxWords, 130);
  const growthExtra = config.script?.growth_mode !== false ? growthScriptDirectives('short') : '';

  const prompt = `You are writing YouTube Shorts scripts derived from this long-form video's best hooks/moments for a global explainer growth channel (ModernMonk).
Long-form title: "${longScript.title}"
Topic: "${research.topic}"
${factsBlock(research.facts)}
Write ${count} standalone Shorts (9:16 vertical, under ${maxSeconds}s ≈ ${maxShort} words max, at least ~${minShort} words).
${growthExtra}
Same voice rules: conversational, contractions, no AI-cliché phrases ("delve", "in conclusion", "buckle up", "little did they know", "whether you're a... or a..."), no em-dash overuse. Each must work standalone.

Return ONLY JSON, no other text:
{
  "shorts": [
    {
      "title": "curiosity hook under 55 chars (do NOT include #Shorts, we add it)",
      "narration": "spoken script ${minShort}-${maxShort} words",
      "visual_needs": ["entity 1", "entity 2"],
      "hashtags": ["5 to 7 tags WITHOUT #, specific to this short's actual topic"]
    }
  ]
}`;

  // 2200 was tuned for the default count of 5 (~440 tokens/short, generous
  // headroom for a ~130-word narration + title + hashtags + JSON overhead).
  // Scale with count so a larger one-off batch (e.g. --short-count=8) doesn't
  // get silently truncated mid-JSON under the same fixed budget.
  const raw = await callFreeLLM(prompt, Math.max(2200, Math.ceil(count * 450)));
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.shorts) || parsed.shorts.length < count) {
    throw new Error(`Expected ${count} shorts, got ${parsed.shorts?.length ?? 0}`);
  }
  return parsed.shorts.slice(0, count).map((s) => {
    let narration = stripBannedPhrases(s.narration || '');
    // Hard-trim runaway shorts so we stay under Shorts shelf + retention sweet spot.
    const words = narration.trim().split(/\s+/).filter(Boolean);
    if (words.length > maxShort) narration = words.slice(0, maxShort).join(' ');
    // Topic-derived hashtags first (see writeLongScript's comment), then
    // the LLM's own, then the mandatory Shorts-shelf tag last.
    const hashtags = [...new Set([...topicHashtags(research.topic), ...(s.hashtags || []), 'Shorts'])];
    const title = optimizeTitle(s.title || research.topic, { kind: 'short' });
    return {
      ...s,
      title,
      narration,
      hashtags,
      tags: buildGrowthTags({ kind: 'short', topic: research.topic, extra: hashtags }),
      description: buildGrowthDescription({
        kind: 'short',
        hookLine: narration.split(/[.!?]/)[0] || title,
        body: '',
        facts: research.facts?.slice(0, 2),
        hashtags
      })
    };
  });
}
