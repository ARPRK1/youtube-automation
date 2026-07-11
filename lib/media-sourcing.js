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
import { generateAiImage } from './ai-image.js';
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
async function tryRealMediaForEntity(entity, segmentText, aspect, config, tmpDir, candidateIndex) {
  const groups = await fetchRealMediaCandidates(entity, aspect);
  let attempted = 0;

  for (const group of groups) {
    for (const candidate of group) {
      if (!meetsMinResolution(candidate, aspect, config)) continue;
      attempted++;
      try {
        const buffer = await downloadBuffer(candidate.url);
        const checkBuffer = candidate.type === 'video' ? await extractFrameForCheck(buffer, tmpDir, candidateIndex + attempted) : buffer;

        const verification = config.media?.verify_relevance === false
          ? { relevant: true, hasWatermark: false, description: 'verification disabled in config', checked: false }
          : await verifyImageRelevance(checkBuffer, entity, segmentText);

        if (!verification.relevant || verification.hasWatermark) continue;

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

/** AI generation, only reached when no real media worked. Never asks for
 * a specific real person's likeness -- for a named-person entity, the
 * prompt is de-personalized to a related scene/stylized description
 * instead of the name itself. */
async function generateAiFallback(entity, segmentText, aspect) {
  const isRealPerson = extractNamedEntities(entity).length > 0;
  const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
  const subject = isRealPerson
    ? `a stylized artistic silhouette representing ${segmentText.slice(0, 120)}, no realistic facial features, not a photorealistic depiction of a specific identifiable person`
    : `${entity}: ${segmentText.slice(0, 150)}`;

  const buffer = await generateAiImage(subject, { width: w, height: h });
  if (!buffer) return null;
  return {
    entity, type: 'image', source: 'pollinations', license: 'AI-generated (Pollinations/Flux)', author: null,
    url: null, landingUrl: null, width: w, height: h, credit: null, aiGenerated: true, verified: false,
    visionDescription: isRealPerson ? 'stylized/de-personalized (no free real photo found for this person)' : 'AI-generated, no real media found', buffer
  };
}

/**
 * Sources one asset for a script segment: tries each of its visual_needs
 * entities in order (primary first) through the real-media chain, falls
 * back to the next entity if a given one has nothing usable, and only
 * generates AI media if none of the segment's entities turned up
 * anything real and verified.
 */
export async function sourceMediaForSegment(segment, aspect, tmpDir, index) {
  const config = loadConfig();
  const entities = segment.visual_needs?.length > 0 ? segment.visual_needs : [segment.text.slice(0, 60)];

  for (const entity of entities) {
    const result = await tryRealMediaForEntity(entity, segment.text, aspect, config, tmpDir, index);
    if (result) return result;
  }

  if (config.media?.ai_fallback_enabled === false) {
    throw new Error(`No real media found for any of [${entities.join(', ')}] and AI fallback is disabled in config`);
  }
  const aiResult = await generateAiFallback(entities[0], segment.text, aspect);
  if (!aiResult) throw new Error(`No real media found for [${entities.join(', ')}] and AI fallback also failed`);
  return aiResult;
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
    entity: r.entity,
    type: r.type,
    source: r.source,
    license: r.license,
    author: r.author,
    url: r.url,
    aiGenerated: r.aiGenerated,
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
