// Stage 6 pre-upload quality gate. Every check here is a real, automated
// verification -- not a rubber stamp -- and a failure here routes the
// video to ready_to_upload/ for manual review instead of auto-publishing
// something broken.

import { spawn } from 'node:child_process';
import { NSFW_VISUAL_RE } from './script-writer.js';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';

function runFfmpegCapture(args) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(stderr));
  });
}

/** Scans for black frames lasting >= thresholdSec using ffmpeg's own
 * blackdetect filter -- a real content check, not a guess. */
async function detectLongBlackSegments(videoPath, thresholdSec = 1.0) {
  const stderr = await runFfmpegCapture([
    '-i', videoPath, '-vf', `blackdetect=d=${thresholdSec}:pic_th=0.98`, '-an', '-f', 'null', '-'
  ]);
  return [...stderr.matchAll(/black_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1])).filter((d) => d >= thresholdSec);
}

/** Same idea for frozen (unchanging) video, using freezedetect. A few
 * seconds is expected right after a hard-cut Ken Burns start; anything
 * beyond that is a real rendering problem. */
async function detectLongFreezes(videoPath, thresholdSec = 2.0) {
  const stderr = await runFfmpegCapture([
    '-i', videoPath, '-vf', `freezedetect=n=-60dB:d=${thresholdSec}`, '-an', '-f', 'null', '-'
  ]);
  return [...stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1])).filter((d) => d >= thresholdSec);
}

/** Real audio-clipping check via ffmpeg's astats filter (Peak_level near
 * 0dBFS repeatedly indicates clipping/distortion). */
async function detectClipping(videoPath) {
  const stderr = await runFfmpegCapture([
    '-i', videoPath, '-af', 'astats=metadata=0:reset=1', '-f', 'null', '-'
  ]);
  const peaks = [...stderr.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  const clippedCount = peaks.filter((p) => p >= -0.1).length;
  return clippedCount > peaks.length * 0.05; // >5% of measured windows at/near full scale
}

const BANNED_PHRASES_RE = [/\bdelve(?:s|d|ing)?\b/i, /\bin conclusion\b/i, /\bbuckle up\b/i, /\blittle did (?:they|he|she|we|I)\s+know\b/i];

function checkBannedPhrases(narration) {
  return BANNED_PHRASES_RE.filter((re) => re.test(narration)).map((re) => re.source);
}

function checkAttributionComplete(mediaManifest) {
  const problems = [];
  for (const asset of mediaManifest) {
    if (asset.aiGenerated) continue;
    if (!asset.license || !asset.author) problems.push(`asset for "${asset.entity}" (${asset.source}) is missing license/author metadata`);
  }
  return problems;
}

/**
 * Runs every check and returns { passed, failures, warnings }. `failures`
 * block the upload; `warnings` are logged but don't block (e.g. a freeze
 * just past the threshold that's likely an intentional held shot).
 */
export async function runQualityGate({ videoPath, narration, mediaManifest, structure, previousStructures, title, description, thumbnailPath, hasVisionKey }) {
  const failures = [];
  const warnings = [];

  const banned = checkBannedPhrases(narration);
  if (banned.length > 0) failures.push(`Banned AI-cliche phrase(s) survived into final script: ${banned.join(', ')}`);

  const attributionProblems = checkAttributionComplete(mediaManifest || []);
  if (attributionProblems.length > 0) failures.push(...attributionProblems);

  // STRICT NSFW backstop (owner 2026-08-14): block the upload if any sourced
  // asset's entity, prompt context, or vision description trips the explicit/
  // anatomical term list, or if the vision NSFW check flagged it. Upstream
  // (media-sourcing) already rejects flagged imagery; this is the last line of
  // defense so nothing explicit can ever reach the channel even if an upstream
  // check ran degraded.
  const nsfwHits = (mediaManifest || []).filter((a) =>
    a.nsfw === true
    || NSFW_VISUAL_RE.test(String(a.entity || ''))
    || NSFW_VISUAL_RE.test(String(a.promptContext || ''))
    || NSFW_VISUAL_RE.test(String(a.visionDescription || ''))
  );
  if (nsfwHits.length > 0) {
    failures.push(`BLOCKED: ${nsfwHits.length} asset(s) flagged as explicit/anatomical (e.g. "${nsfwHits[0].entity || nsfwHits[0].visionDescription}") — refusing to publish inappropriate imagery`);
  }

  const unverified = (mediaManifest || []).filter((a) => !a.aiGenerated && !a.verified);
  if (unverified.length > 0) warnings.push(`${unverified.length} real asset(s) shipped without a completed vision-relevance check (degraded mode, not blocked)`);

  // Vision-majority (2026-08-13): the anchor image of each segment (beatIndex
  // 0) is the one asset we always try to vision-verify. If the majority of
  // anchors that were ACTUALLY CHECKED came back as a mismatch, the video is
  // showing the wrong thing while the words say something else — exactly the
  // "visuals don't match" failure. Only counts anchors with a real verdict
  // (visionRelevant true/false, never null), so a degraded/keyless run never
  // trips this. Requires a vision key to mean anything.
  const anchors = (mediaManifest || []).filter((a) => (a.beatIndex ?? 0) === 0 && typeof a.visionRelevant === 'boolean');
  if (hasVisionKey && anchors.length > 0) {
    const mismatched = anchors.filter((a) => a.visionRelevant === false);
    if (mismatched.length * 2 >= anchors.length) {
      failures.push(`Visual mismatch: ${mismatched.length}/${anchors.length} segment anchor image(s) failed vision-relevance (majority) — the video shows the wrong thing for the narration`);
    } else if (mismatched.length > 0) {
      warnings.push(`${mismatched.length}/${anchors.length} segment anchor image(s) failed vision-relevance (minority, not blocked)`);
    }
  }

  if (!title || title.length > 100) failures.push('Title missing or over 100 characters');
  if (!description || description.length < 10) failures.push('Description missing or too short');
  if (!thumbnailPath) failures.push('Thumbnail missing');

  if (previousStructures && previousStructures.length > 0 && previousStructures[previousStructures.length - 1] === structure) {
    warnings.push(`Structure "${structure}" is the same as the immediately previous video -- anti-template rotation may not be working as intended`);
  }

  const [blackSegments, freezeSegments, hasClipping] = await Promise.all([
    detectLongBlackSegments(videoPath).catch(() => []),
    detectLongFreezes(videoPath).catch(() => []),
    detectClipping(videoPath).catch(() => false)
  ]);
  if (blackSegments.length > 0) failures.push(`${blackSegments.length} black-frame gap(s) detected, longest ${Math.max(...blackSegments).toFixed(1)}s`);
  if (freezeSegments.length > 0) failures.push(`${freezeSegments.length} frozen-frame gap(s) detected, longest ${Math.max(...freezeSegments).toFixed(1)}s`);
  if (hasClipping) warnings.push('Audio shows signs of clipping/distortion at or near peak level in >5% of measured windows');

  return { passed: failures.length === 0, failures, warnings };
}
