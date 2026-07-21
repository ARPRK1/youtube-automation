// Stage 3: sources real, correctly-licensed media for every segment,
// verifies it actually matches (vision check, not just title text), and
// only falls back to AI generation when nothing real and usable exists.
// This is the actual fix for wrong/irrelevant visuals -- everything here
// is either a real photo/video that's been checked to genuinely show what
// it claims to, or an AI image generated because nothing real was found
// (and tagged as such in the manifest for YouTube's disclosure setting).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchRealMediaCandidates, extractNamedEntities } from './visual-sources.js';
import { generateAiImage, styleForBeat } from './ai-image.js';
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

/** Build a safe AI subject string (never photo-real specific living people). */
function aiSubjectFor(entity, segmentText, style) {
  const isRealPerson = extractNamedEntities(entity).length > 0
    || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(String(entity || '').trim());
  if (isRealPerson || style === 'pencil' || style === 'charcoal' || style === 'ink') {
    return `artistic depiction related to "${entity}", scene and context from: ${segmentText.slice(0, 100)}, not a photorealistic portrait of a real living person, no readable face likeness`;
  }
  return `${entity}: ${segmentText.slice(0, 140)}`;
}

/** AI generation for fallback or multi-beat variety (pencil/ink/etc.). */
async function generateAiFallback(entity, segmentText, aspect, { style = 'cinematic', seedExtra = '' } = {}) {
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const subject = aiSubjectFor(entity, segmentText, style);
  const buffer = await generateAiImage(subject, { width: w, height: h, style, seedExtra });
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
    verified: false,
    visionDescription: `AI ${style}: ${entity}`,
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
  const entities = segment.visual_needs?.length > 0
    ? segment.visual_needs
    : [primaryAsset?.entity || segment.text.slice(0, 50)];

  const items = [];
  for (let b = 0; b < count; b++) {
    const entity = entities[b % entities.length];
    const beatSeed = `${seed}-b${b}`;
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

    const style = styleForBeat(b, entity);
    let asset = null;
    if (config.media?.ai_fallback_enabled !== false) {
      asset = await generateAiFallback(entity, segment.text, aspect, {
        style,
        seedExtra: beatSeed
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

  for (const entity of entities) {
    const result = await tryRealMediaForEntity(entity, segment.text, aspect, config, tmpDir, index, usedUrls);
    if (result) return result;
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
