// Stage 3: sources real, correctly-licensed media for every segment,
// verifies it actually matches (vision check, not just title text), and
// only falls back to AI generation when nothing real and usable exists.
// This is the actual fix for wrong/irrelevant visuals -- everything here
// is either a real photo/video that's been checked to genuinely show what
// it claims to, or an AI image generated because nothing real was found
// (and tagged as such in the manifest for YouTube's disclosure setting).
//
// -------------------------------------------------------------------------
// 2026-08-02: two fixes for "visuals do not match the narration".
//
// FIX 1, the random-people bug. aiSubjectFor used to end every prompt for a
// person-ish subject with "not a photorealistic portrait of a real living
// person, no readable face likeness". Pollinations takes a single positive
// prompt string with no negative-prompt channel, so that clause was positive
// conditioning: portrait, real, living, person, face. It also fired on
// `style === 'pencil' || 'charcoal' || 'ink'` regardless of subject, and
// STYLE_CYCLE is ['whiteboard','diagram','ink','cinematic','pencil'], so two
// beats in every five got it whatever the video was about. Negation removed
// entirely; see ai-image.js for the positive framing that replaced it.
//
// FIX 2, the drift bug. Every beat in a segment was prompted with the SAME
// text (segment.text sliced to the first 100-140 chars), so on a 15-second
// segment the picture at second 12 still illustrated the opening sentence.
// Beats are now prompted with their own slice of the narration, proportional
// to where they sit in the segment's timeline.
//
// RETRACTED, so nobody re-investigates it: an earlier read of config.yaml
// suggested max_visual_beats_short (12) x visual_beat_seconds_short (3.2)
// left a 12-62 second uncovered gap on a 50-100s Short. That is wrong.
// splitDuration() below divides the FULL duration across however many beats
// there are, so the timeline is always exactly covered. Hitting the cap makes
// beats LONGER (slower pacing, a real but separate problem), it does not
// leave a hole and it does not insert filler. The cap is also applied per
// segment, not per video, so on a multi-segment Short it rarely binds at all.
// -------------------------------------------------------------------------

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchRealMediaCandidates, extractNamedEntities } from './visual-sources.js';
import { generateAiImage, styleForBeat, isAbstractConcept, isPersonSubject } from './ai-image.js';
import { verifyImageRelevance } from './vision-check.js';
import { runFfmpeg } from './ffmpeg-util.js';
import { loadConfig } from './config.js';

async function downloadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function meetsMinResolution(candidate, aspect, config) {
  const [minW, minH] = aspect === 'vertical'
    ? (config.media?.min_resolution_vertical ?? [1080, 1920])
    : (config.media?.min_resolution_landscape ?? [1920, 1080]);
  if (!candidate.width || !candidate.height) return true; // unknown -- don't block on missing metadata, vision check still runs
  return candidate.width >= minW * 0.9 && candidate.height >= minH * 0.9; // small tolerance for near-misses
}

/** For video candidates, vision-check a representative frame rather than
 * the whole clip (Gemini's vision input is images, not video). */
async function extractFrameForCheck(videoBuffer, tmpDir, index) {
  const srcPath = path.join(tmpDir, `check-src-${index}.mp4`);
  const framePath = path.join(tmpDir, `check-frame-${index}.jpg`);
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(srcPath, videoBuffer);
  await runFfmpeg(['-i', srcPath, '-ss', '1', '-frames:v', '1', framePath]);
  const { readFile } = await import('node:fs/promises');
  return readFile(framePath);
}

/** Tries one entity across all real-media sources, in priority order,
 * vision-verifying each candidate until one passes or everything is
 * exhausted. Returns a manifest-shaped result or null if nothing real
 * worked for this entity. */
async function tryRealMediaForEntity(entity, segmentText, aspect, config, tmpDir, candidateIndex, usedUrls) {
  const groups = await fetchRealMediaCandidates(entity, aspect);
  let attempted = 0;

  for (const group of groups) {
    for (const candidate of group) {
      if (!meetsMinResolution(candidate, aspect, config)) continue;

      // A generic entity (e.g. a country name) deterministically returns
      // the same top search result every time it's queried -- without this,
      // segments that happen to share a generic entity silently get the
      // identical photo, which both looks repetitive and, when it lands on
      // two adjacent segments, can make a cut/crossfade look frozen to the
      // quality gate's freeze detector (confirmed live: 4 of 11 segments in
      // one video reused the exact same Wikimedia photo).
      if (usedUrls?.has(candidate.url)) continue;

      attempted++;
      try {
        const buffer = await downloadBuffer(candidate.url);
        const checkBuffer = candidate.type === 'video' ? await extractFrameForCheck(buffer, tmpDir, candidateIndex + attempted) : buffer;

        const verification = config.media?.verify_relevance === false
          ? { relevant: true, hasWatermark: false, description: 'verification disabled in config', checked: false }
          : await verifyImageRelevance(checkBuffer, entity, segmentText);

        if (!verification.relevant || verification.hasWatermark) continue;

        usedUrls?.add(candidate.url);
        return {
          entity,
          type: candidate.type,
          source: candidate.source,
          license: candidate.license,
          author: candidate.author,
          url: candidate.url,
          landingUrl: candidate.landingUrl || null,
          width: candidate.width,
          height: candidate.height,
          credit: candidate.credit,
          aiGenerated: false,
          verified: verification.checked,
          visionDescription: verification.description,
          buffer
        };
      } catch (err) {
        console.warn(`[media-sourcing] candidate for "${entity}" (${candidate.source}) failed: ${err.message}`);
      }
    }
  }
  return null;
}

/**
 * Decide what KIND of thing we are drawing. This drives both the prompt
 * framing in ai-image.js and, indirectly, whether a human figure is allowed
 * in the frame at all.
 *
 * Order matters. Concept wins over everything: "agent", "worker process" and
 * "training data" all contain person-adjacent words but must still be drawn
 * as diagrams.
 */
function subjectKindFor(entity, config = null) {
  const cfg = config || loadConfig();
  // Owner rule 2026-08-12: random faces destroy trust. When never_people is
  // on (default for the universal channel), never emit person frames at all —
  // even named historical figures become objects/places/symbols.
  if (cfg.media?.never_people !== false) {
    if (isAbstractConcept(entity)) return 'abstract';
    return 'scene';
  }
  if (isAbstractConcept(entity)) return 'abstract';
  if (isPersonSubject(entity)) return 'person';
  // Do NOT promote Title-Case NER hits to "person" — that is how random
  // strangers appear over non-people lines. Only explicit person vocabulary.
  return 'scene';
}

/** Build the AI subject string for one beat.
 *
 * `beatText` is the slice of narration this specific beat sits over, not the
 * whole segment. That is the difference between a picture of what is being
 * said now and a picture of what was said at the start of the segment.
 *
 * No negation anywhere in here. See the header note. */
function aiSubjectFor(entity, beatText, kind) {
  const context = String(beatText || '').trim().slice(0, 180);
  // Always anchor on the spoken line so the frame matches the words.
  if (kind === 'abstract') {
    return `editorial explainer illustration of "${entity}", visualizing: ${context}, objects icons diagrams only`;
  }
  if (kind === 'person') {
    return `symbolic historical scene about "${entity}", empty streets or objects or silhouettes only, context: ${context}`;
  }
  // scene: concrete, documentary, human-effort look (not shiny AI faces)
  return `documentary-style photo of ${entity}, matching narration: ${context}, natural light, real-world texture, no posed portrait, no stock-model face`;
}

/** AI generation for fallback or multi-beat variety (pencil/ink/etc.). */
async function generateAiFallback(entity, beatText, aspect, { style = 'cinematic', seedExtra = '', kind: kindIn = null } = {}) {
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const kind = kindIn || subjectKindFor(entity);
  const subject = aiSubjectFor(entity, beatText, kind);
  const buffer = await generateAiImage(subject, { width: w, height: h, style, seedExtra, subjectKind: kind });
  if (!buffer) return null;
  return {
    entity,
    type: 'image',
    source: 'pollinations',
    license: 'AI-generated (Pollinations/Flux)',
    author: null,
    url: null,
    landingUrl: null,
    width: w,
    height: h,
    credit: null,
    aiGenerated: true,
    artStyle: style,
    subjectKind: kind,
    verified: false,
    // Recorded in the manifest so a bad frame can be traced back to the exact
    // narration window that produced it without re-running anything.
    visionDescription: `AI ${style} (${kind}): ${entity}`,
    promptContext: String(beatText || '').slice(0, 160),
    buffer
  };
}

/** Split total duration into n positive pieces that sum exactly to total. */
function splitDuration(totalSec, n) {
  if (n <= 1) return [totalSec];
  const base = totalSec / n;
  const parts = Array.from({ length: n }, () => base);
  // Keep tiny floating error on the last beat
  const sum = parts.reduce((a, b) => a + b, 0);
  parts[n - 1] += totalSec - sum;
  return parts.map((p) => Math.max(0.4, p));
}

/**
 * Return the slice of `text` that is being spoken during beat `b`.
 *
 * Narration rate is close enough to constant that splitting the segment's
 * words in proportion to each beat's share of the segment duration lands
 * within a word or two of the truth. That is far more accurate than what this
 * used to do, which was hand every beat the segment's opening sentence.
 *
 * A one-beat pad on each side keeps the image from being prompted on a
 * sentence fragment, which produces vaguer pictures than a whole clause.
 */
function sliceTextForBeat(text, beatIndex, durations) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= 0) return words.join(' ');

  const before = durations.slice(0, beatIndex).reduce((a, b) => a + b, 0);
  const startFrac = before / total;
  const endFrac = (before + durations[beatIndex]) / total;

  const pad = Math.ceil(words.length * 0.08); // ~8% overlap either side
  const start = Math.max(0, Math.floor(startFrac * words.length) - pad);
  const end = Math.min(words.length, Math.ceil(endFrac * words.length) + pad);

  const slice = words.slice(start, end).join(' ');
  return slice || words.join(' ');
}

/**
 * Turns one segment's primary asset into a multi-beat visual sequence so
 * a 30–60s stretch never holds a single still. Mixes the real/AI primary
 * with free Pollinations pencil sketches, ink, charcoal, cinematic, etc.
 *
 * @returns {Promise<Array>} timeline items with durationSec + buffer
 */
export async function expandSegmentVisualBeats({
  segment,
  primaryAsset,
  aspect,
  durationSec,
  seed,
  segmentIndex = 0
}) {
  const config = loadConfig();
  const beatTarget = aspect === 'vertical'
    ? (config.media?.visual_beat_seconds_short ?? 3.2)
    : (config.media?.visual_beat_seconds_long ?? 4.8);
  const maxBeats = aspect === 'vertical'
    ? (config.media?.max_visual_beats_short ?? 10)
    : (config.media?.max_visual_beats_long ?? 14);

  const count = Math.max(1, Math.min(maxBeats, Math.ceil(durationSec / beatTarget)));
  const durations = splitDuration(durationSec, count);

  // Surfaced because it is invisible otherwise: when the cap bites, beats get
  // stretched well past the intended pacing and the video reads as slow. It
  // is not a correctness bug (the timeline is still fully covered) but it is
  // worth knowing which videos it happened on.
  const actualBeatSeconds = durationSec / count;
  if (actualBeatSeconds > beatTarget * 1.5) {
    console.warn(
      `[media-sourcing] segment ${segmentIndex}: beat cap (${maxBeats}) forced ${actualBeatSeconds.toFixed(1)}s beats against a ${beatTarget}s target over ${durationSec.toFixed(1)}s. Pacing will look slow. Raise max_visual_beats_${aspect === 'vertical' ? 'short' : 'long'} to fix.`
    );
  }

  const entities = segment.visual_needs?.length > 0
    ? segment.visual_needs
    : [primaryAsset?.entity || segment.text.slice(0, 50)];

  const items = [];

  for (let b = 0; b < count; b++) {
    const entity = entities[b % entities.length];
    const beatSeed = `${seed}-b${b}`;
    // The narration this beat actually sits over. This is the whole point of
    // the 2026-08-02 drift fix.
    const beatText = sliceTextForBeat(segment.text, b, durations);

    // Beat 0: always the real/verified primary when we have one.
    if (b === 0 && primaryAsset?.buffer) {
      items.push({
        ...primaryAsset,
        segmentIndex,
        durationSec: durations[b],
        seed: beatSeed,
        beatIndex: b
      });
      continue;
    }

    // Prefer reusing a verified real still with a new Ken Burns seed over
    // generating a fresh AI frame that may introduce random faces / style thrash.
    // Human editors re-use B-roll; slideshows of 12 different AI styles read as slop.
    if (
      config.media?.prefer_reuse_real_over_ai !== false &&
      primaryAsset?.buffer &&
      !primaryAsset.aiGenerated &&
      b > 0 &&
      b % 2 === 1
    ) {
      items.push({
        ...primaryAsset,
        segmentIndex,
        durationSec: durations[b],
        seed: beatSeed,
        beatIndex: b,
        artStyle: 'reuse-real-kb'
      });
      continue;
    }

    // Classify once, then use the same answer for BOTH the art style and the
    // prompt framing. Passing it in keeps styleForBeat from disagreeing with
    // aiSubjectFor about whether this beat is drawing a human.
    const kind = subjectKindFor(entity, config);
    // Prefer photo/cinematic for "human made" feel; diagrams only for abstract.
    const style = kind === 'abstract'
      ? styleForBeat(b, entity, kind)
      : (['photo', 'cinematic', 'watercolor', 'ink'][b % 4]);
    let asset = null;

    if (config.media?.ai_fallback_enabled !== false) {
      asset = await generateAiFallback(entity, beatText, aspect, {
        style,
        seedExtra: beatSeed,
        kind
      });
    }

    if (!asset?.buffer && primaryAsset?.buffer) {
      // Reuse primary with a different Ken-Burns seed rather than blank.
      asset = { ...primaryAsset, artStyle: 'reuse-primary' };
    }

    if (!asset?.buffer) {
      items.push({
        entity,
        type: 'image',
        buffer: null,
        durationSec: durations[b],
        seed: beatSeed,
        segmentIndex,
        beatIndex: b,
        aiGenerated: true
      });
      continue;
    }

    items.push({
      ...asset,
      segmentIndex,
      durationSec: durations[b],
      seed: beatSeed,
      beatIndex: b
    });
  }

  return items;
}

/**
 * Sources one asset for a script segment: tries each of its visual_needs
 * entities in order (primary first) through the real-media chain, falls
 * back to the next entity if a given one has nothing usable, and only
 * generates AI media if none of the segment's entities turned up
 * anything real and verified.
 */
export async function sourceMediaForSegment(segment, aspect, tmpDir, index, usedUrls) {
  const config = loadConfig();
  const entities = segment.visual_needs?.length > 0 ? segment.visual_needs : [segment.text.slice(0, 60)];

  // AI-only mode (config.media.mode: 'ai-only'): skip the real-media search
  // + vision-verify chain entirely. Confirmed live (2026-07-22/23 daily
  // runs) that this chain -- up to 16 vision-LLM round trips per entity,
  // across every segment -- is the actual bottleneck that blew a 90-minute
  // budget on one content-heavy video.
  //
  // 2026-08-02, correcting the rest of this comment. It used to claim "an AI
  // image generated straight from the segment's own text is relevant by
  // construction, so there's nothing to verify against". That was the
  // assumption that let the random-people bug live for two weeks unnoticed.
  // An AI image is only as relevant as the prompt, and the prompt was wrong.
  // Relevant by construction is not a property you get for free, it is one
  // you have to keep earning in aiSubjectFor above.
  if (config.media?.mode !== 'ai-only') {
    for (const entity of entities) {
      const result = await tryRealMediaForEntity(entity, segment.text, aspect, config, tmpDir, index, usedUrls);
      if (result) return result;
    }
  } else if (config.media?.verify_relevance && !global.__warnedVerifyRelevanceDead) {
    // config.yaml sets verify_relevance: true, which reads as if a safety
    // check is running. In ai-only mode nothing calls verifyImageRelevance at
    // all. Say so once per run rather than letting the config quietly lie.
    global.__warnedVerifyRelevanceDead = true;
    console.warn('[media-sourcing] config.media.verify_relevance is true but mode is "ai-only", so no vision verification runs. The setting has no effect in this mode.');
  }

  if (config.media?.ai_fallback_enabled === false) {
    throw new Error(`No real media found for any of [${entities.join(', ')}] and AI fallback is disabled in config`);
  }

  // Same "try every entity, not just the primary one" resilience as the
  // real-media loop above -- generateAiImage already retries transient
  // failures internally, but only trying entities[0] meant a single
  // stubborn prompt (or one that Pollinations' safety filter rejects)
  // failed the whole segment even when a later entity would have worked.
  for (const entity of entities) {
    const aiResult = await generateAiFallback(entity, segment.text, aspect);
    if (aiResult) return aiResult;
  }

  throw new Error(`No real media found for [${entities.join(', ')}] and AI fallback also failed`);
}

/** Writes runs/<date>/assets/manifest.json and ATTRIBUTION.txt. The
 * manifest records source/license/author/real-vs-AI per asset (used for
 * the YouTube synthetic-content disclosure and for a legal paper trail);
 * ATTRIBUTION.txt is the CC BY / CC BY-SA credit block required by those
 * licenses, meant to be pasted into the video description. */
export async function writeMediaManifest(runDir, assetResults) {
  const assetsDir = path.join(runDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const manifest = assetResults.map((r, i) => ({
    index: i,
    segmentIndex: r.segmentIndex,
    beatIndex: r.beatIndex ?? 0,
    entity: r.entity,
    type: r.type,
    source: r.source,
    license: r.license,
    author: r.author,
    url: r.url,
    aiGenerated: r.aiGenerated,
    artStyle: r.artStyle || null,
    // Added 2026-08-02. subjectKind tells you whether the generator thought
    // it was drawing a concept or a human; promptContext tells you which
    // words it was looking at. Between them, a wrong frame in the finished
    // video is traceable to its cause from the manifest alone.
    subjectKind: r.subjectKind || null,
    promptContext: r.promptContext || null,
    verified: r.verified,
    resolution: r.width && r.height ? `${r.width}x${r.height}` : null,
    visionDescription: r.visionDescription
  }));

  await writeFile(path.join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  const needsAttribution = assetResults.filter((r) => !r.aiGenerated && /\bby\b|\bby-sa\b|cc by/i.test(r.license || '') && !/pexels|pixabay/i.test(r.source));
  const attributionLines = needsAttribution.map((r) => `"${r.entity}" — ${r.credit || `${r.license} by ${r.author}`}${r.landingUrl ? ` — ${r.landingUrl}` : ''}`);
  const attributionText = attributionLines.length > 0
    ? `Media credits (required by license):\n\n${attributionLines.join('\n')}\n`
    : 'No attribution-required assets used in this video.\n';

  await writeFile(path.join(assetsDir, 'ATTRIBUTION.txt'), attributionText, 'utf-8');

  const anyAiGenerated = assetResults.some((r) => r.aiGenerated);
  return { manifest, attributionText, anyAiGenerated };
}
