import 'dotenv/config';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from './lib/config.js';
import { researchTodaysTopic } from './lib/research.js';
import { writeLongScript, writeShortScripts } from './lib/script-writer.js';
import { synthesizeSegmentAudio } from './lib/tts.js';
import { buildSegmentCaptions } from './lib/captions.js';
import { sourceMediaForSegment, expandSegmentVisualBeats, writeMediaManifest } from './lib/media-sourcing.js';
import { renderVisualTimeline } from './lib/visuals.js';
import { concatSegmentAudio, mergeSegmentCaptions, renderFinalVideo, prependIntro } from './lib/assemble.js';
import { renderIntro } from './lib/intro.js';
import { addBackgroundMusic } from './lib/music.js';
import { renderThumbnail, pickThumbnailKeyBuffer, accentForTitle } from './lib/thumbnail.js';
import { runQualityGate } from './lib/quality-gate.js';
import { uploadVideo, hasYoutubeCredentials, assertExpectedChannel } from './lib/youtube-upload.js';
import { probeDurationSeconds } from './lib/ffmpeg-util.js';

const DRY_RUN = process.argv.includes('--dry-run');
// Backfill knobs: --long-only skips the shorts batch (used to catch up on
// missed long-form videos without also duplicating that day's shorts);
// --long-count=N overrides config.video.long_count_per_day for one run.
const LONG_ONLY = process.argv.includes('--long-only');
const longCountArg = process.argv.find((a) => a.startsWith('--long-count='));
const LONG_COUNT_OVERRIDE = longCountArg ? parseInt(longCountArg.split('=')[1], 10) : null;
// --short-count=N overrides config.video.shorts_count_per_day for one run
// (e.g. a one-off "catch up on shorts" batch).
const shortCountArg = process.argv.find((a) => a.startsWith('--short-count='));
const SHORT_COUNT_OVERRIDE = shortCountArg ? parseInt(shortCountArg.split('=')[1], 10) : null;
// --niche=<pillar-id> pins today's pillar (see lib/growth.js's
// PROVEN_GROWTH_NICHES ids) instead of the date-keyed rotation -- for a
// same-day retry that needs a different pillar than one already used
// earlier today.
const nicheArg = process.argv.find((a) => a.startsWith('--niche='));
const NICHE_OVERRIDE = nicheArg ? nicheArg.split('=')[1] : null;
const config = loadConfig();
const today = new Date();
const dateStr = today.toISOString().slice(0, 10);
const runDir = path.join(config.paths?.runs_dir || 'runs', dateStr);
const readyDir = path.join(config.paths?.ready_to_upload_dir || 'ready_to_upload', dateStr);

function log(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `video-${Date.now()}`;
}

const ACCENT_COLORS = ['#e63946', '#2a9d8f', '#4361ee', '#9d4edd', '#f77f00', '#06a77d', '#ffb703'];
function accentColorForTopic(topic) {
  let h = 0;
  for (let i = 0; i < topic.length; i++) h = (h * 31 + topic.charCodeAt(i)) >>> 0;
  return ACCENT_COLORS[h % ACCENT_COLORS.length];
}

async function runDryRun() {
  const checks = [
    ['GROQ_API_KEY or GEMINI_API_KEY (script generation, topic scoring)', Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)],
    ['GEMINI_API_KEY (vision relevance verification)', Boolean(process.env.GEMINI_API_KEY)],
    ['YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN (upload)', hasYoutubeCredentials()],
    ['PEXELS_API_KEY (optional, real b-roll)', Boolean(process.env.PEXELS_API_KEY)],
    ['PIXABAY_API_KEY (optional, real b-roll)', Boolean(process.env.PIXABAY_API_KEY)]
  ];
  let ok = true;
  for (const [label, present] of checks) {
    log(`${present ? 'OK  ' : 'MISS'} - ${label}`);
    if (!present && label.startsWith('GROQ')) ok = false;
  }
  if (!ok) {
    log('Missing required config for script generation. Set GROQ_API_KEY or GEMINI_API_KEY.');
    process.exitCode = 1;
    return;
  }
  log('Dry run passed. No content generated, nothing uploaded, no cost incurred.');
}

function buildDescription({ videoScript, research, attributionText, isShort }) {
  const sourceLines = (research.facts || []).slice(0, 4).map((f) => `- ${f.text}${f.url ? ` (${f.url})` : ''}`).join('\n');
  const parts = [
    videoScript.description,
    sourceLines ? `\nSources:\n${sourceLines}` : '',
    attributionText && !attributionText.startsWith('No attribution') ? `\n${attributionText}` : '',
    `\n${(videoScript.hashtags || []).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`
  ];
  return parts.filter(Boolean).join('\n').trim();
}

async function moveToReadyToUpload({ finalPath, thumbPath, title, description, tags, containsSyntheticMedia, reason }) {
  await mkdir(readyDir, { recursive: true });
  const base = slugify(title);
  const videoDest = path.join(readyDir, `${base}.mp4`);
  const thumbDest = path.join(readyDir, `${base}-thumb.jpg`);
  await copyFile(finalPath, videoDest);
  await copyFile(thumbPath, thumbDest);
  await writeFile(path.join(readyDir, `${base}-metadata.json`), JSON.stringify({
    title, description, tags, containsSyntheticMedia, reason, videoFile: `${base}.mp4`, thumbnailFile: `${base}-thumb.jpg`
  }, null, 2));
  return { videoDest, thumbDest };
}

/** Renders one full video (long or short) through Stages 3-6: media
 * sourcing, TTS, visuals, assembly, intro/music, thumbnail, quality gate,
 * upload-or-ready_to_upload fallback. Never throws for a single video's
 * problems reaching the caller uncaught -- always returns a manifest
 * entry so one bad video can't take down the rest of the day's batch. */
async function produceVideo({ kind, videoScript, research, aspect }) {
  const baseName = slugify(videoScript.title);
  const entry = { kind, title: videoScript.title, baseName, structure: videoScript.structure, steps: {} };

  try {
    const audioPaths = [];
    const segmentCaptions = [];
    const mediaAssets = [];
    const usedMediaUrls = new Set();

    for (const [i, seg] of videoScript.segments.entries()) {
      // Confirmed live 2026-07-27 (run #48): a video died with "No real
      // media found... AI fallback also failed" after a 31-minute gap with
      // zero log output in between -- TTS + media sourcing for every
      // segment happens in this one loop with nothing printed per
      // iteration, so there was no way to tell which segment or which
      // stage (TTS vs. media) the time actually went to. One line per
      // segment costs nothing and makes the next one of these diagnosable
      // instead of a 31-minute blank spot in the log.
      log(`[produce] "${videoScript.title}" segment ${i + 1}/${videoScript.segments.length}: synthesizing audio + sourcing media`);
      const { audioPath, srtPath, durationSec, hadPause } = await synthesizeSegmentAudio(seg.text, runDir, `${baseName}-seg${i}`);
      audioPaths.push(audioPath);
      const capSrtPath = path.join(runDir, `${baseName}-seg${i}-cap.srt`);
      const lines = await buildSegmentCaptions({
        srtPath,
        text: seg.text,
        durationSec,
        outPath: capSrtPath,
        aspect // vertical Shorts → fewer words/line so captions stay small
      });
      segmentCaptions.push({ lines, durationSec });

      const asset = await sourceMediaForSegment(seg, aspect, runDir, i, usedMediaUrls);
      // Expand one asset into many visual beats (real photo + pencil/ink/etc.)
      // so a Short/long stretch never holds a single still for 20–40s.
      const beats = await expandSegmentVisualBeats({
        segment: seg,
        primaryAsset: asset,
        aspect,
        durationSec,
        seed: `${baseName}-${i}`,
        segmentIndex: i
      });
      mediaAssets.push(...beats.map((b) => ({ ...b, hadPause })));
    }
    entry.steps.tts = 'ok';
    entry.steps.media = 'ok';

    const totalNarrationSec = segmentCaptions.reduce((s, c) => s + c.durationSec, 0);
    entry.durationSec = totalNarrationSec;
    if (kind === 'long' && totalNarrationSec < (config.video?.long_min_minutes ?? 5) * 60) {
      throw new Error(`Narration too short for long-form: ${totalNarrationSec.toFixed(1)}s (need ${(config.video?.long_min_minutes ?? 5) * 60}s+)`);
    }
    if (kind === 'short' && totalNarrationSec > (config.video?.shorts_max_seconds ?? 120)) {
      throw new Error(`Narration too long for a Short: ${totalNarrationSec.toFixed(1)}s (must be <=${config.video?.shorts_max_seconds ?? 120}s)`);
    }
    // No lower bound existed here at all (confirmed live 2026-07-28: Shorts
    // were landing at 14-15s -- min_short_words/max_short_words only shaped
    // the generation PROMPT, nothing validated the LLM's actual word count
    // or the real post-TTS duration against a floor). Word-count-level
    // enforcement now exists in writeShortScripts; this is the second,
    // independent gate against real synthesized duration, same pattern as
    // the long-form floor above.
    if (kind === 'short' && totalNarrationSec < (config.video?.shorts_min_seconds ?? 50)) {
      throw new Error(`Narration too short for a Short: ${totalNarrationSec.toFixed(1)}s (need ${config.video?.shorts_min_seconds ?? 50}s+)`);
    }

    const fullAudioPath = path.join(runDir, `${baseName}-audio.mp3`);
    await concatSegmentAudio(audioPaths, fullAudioPath);

    const captionSrtPath = path.join(runDir, `${baseName}-captions.srt`);
    await mergeSegmentCaptions(segmentCaptions, captionSrtPath);
    entry.steps.captions = 'ok';

    const bgPath = path.join(runDir, `${baseName}-bg.mp4`);
    log(`[visuals] ${mediaAssets.length} beats across ${videoScript.segments.length} segments for "${videoScript.title}"`);
    await renderVisualTimeline({ items: mediaAssets, aspect, outPath: bgPath, seed: baseName });
    entry.steps.visuals = 'ok';

    const [w, h] = aspect === 'vertical' ? [1080, 1920] : [1920, 1080];
    let finalPath = path.join(runDir, `${baseName}.mp4`);
    await renderFinalVideo({ backgroundClipPath: bgPath, audioPath: fullAudioPath, srtPath: captionSrtPath, outPath: finalPath, aspect, width: w, height: h });
    entry.steps.assemble = 'ok';

    if (kind === 'long') {
      try {
        const introPath = path.join(runDir, `${baseName}-intro.mp4`);
        await renderIntro({ title: videoScript.title, niche: research.topic, accentColor: accentColorForTopic(research.topic), aspect, outPath: introPath });
        const withIntroPath = path.join(runDir, `${baseName}-with-intro.mp4`);
        await prependIntro({ introPath, mainPath: finalPath, outPath: withIntroPath, width: w, height: h });
        finalPath = withIntroPath;
        entry.steps.intro = 'ok';
      } catch (err) {
        entry.steps.intro = `failed: ${err.message}`;
        log(`[intro] skipped for "${videoScript.title}": ${err.message}`);
      }
    }

    const preMusicDuration = await probeDurationSeconds(finalPath);
    const musicResult = await addBackgroundMusic({
      videoPath: finalPath,
      outPath: finalPath.replace(/\.mp4$/, '-music.mp4'),
      durationSec: preMusicDuration,
      date: today,
      kind,
      moodHint: research.topic || ''
    });
    finalPath = musicResult.outPath;
    entry.steps.music = musicResult.credit ? 'ok' : 'skipped';

    const { manifest: mediaManifestEntries, attributionText, anyAiGenerated } = await writeMediaManifest(runDir, mediaAssets);
    entry.steps.manifest = 'ok';
    entry.mediaSummary = {
      total: mediaManifestEntries.length,
      real: mediaManifestEntries.filter((m) => !m.aiGenerated).length,
      aiGenerated: mediaManifestEntries.filter((m) => m.aiGenerated).length
    };

    const thumbPath = path.join(runDir, `${baseName}-thumb.jpg`);
    // Prefer a real (non-AI) still for the face of the video; fall back to
    // first buffer / bg frame. Accent color is deterministic per title so
    // re-runs stay consistent and shorts get a "SHORTS" badge for CTR.
    await renderThumbnail({
      keyImageBuffer: pickThumbnailKeyBuffer(mediaAssets) || mediaAssets[0]?.buffer,
      backgroundClipPath: bgPath,
      title: videoScript.title,
      outPath: thumbPath,
      accentColor: accentForTitle(videoScript.title),
      kind,
      badge: kind === 'short' ? 'SHORTS' : null
    });
    entry.steps.thumbnail = 'ok';

    const description = buildDescription({ videoScript, research, attributionText });

    let structureHistory = [];
    try {
      structureHistory = JSON.parse(await readFile(path.join(config.paths?.runs_dir || 'runs', 'script-structure-history.json'), 'utf-8')).map((h) => h.structure);
    } catch { /* no history yet */ }

    const gate = await runQualityGate({
      videoPath: finalPath,
      narration: videoScript.segments.map((s) => s.text).join(' '),
      mediaManifest: mediaManifestEntries,
      structure: videoScript.structure,
      previousStructures: structureHistory.slice(0, -1), // exclude today's own just-recorded pick
      title: videoScript.title,
      description,
      thumbnailPath: thumbPath
    });
    entry.qualityGate = { passed: gate.passed, failures: gate.failures, warnings: gate.warnings };
    if (gate.warnings.length > 0) log(`[quality-gate] warnings for "${videoScript.title}": ${gate.warnings.join(' | ')}`);

    const finalDuration = await probeDurationSeconds(finalPath);
    entry.finalDurationSec = finalDuration;
    entry.videoPath = finalPath;
    entry.thumbnailPath = thumbPath;

    if (!gate.passed) {
      const { videoDest } = await moveToReadyToUpload({
        finalPath, thumbPath, title: videoScript.title, description, tags: videoScript.tags,
        containsSyntheticMedia: anyAiGenerated, reason: `Quality gate failed: ${gate.failures.join('; ')}`
      });
      entry.upload = { skipped: true, readyToUpload: true, reason: 'quality gate failed', path: videoDest };
      return entry;
    }

    if (!config.upload?.enabled || !hasYoutubeCredentials()) {
      const { videoDest } = await moveToReadyToUpload({
        finalPath, thumbPath, title: videoScript.title, description, tags: videoScript.tags,
        containsSyntheticMedia: anyAiGenerated, reason: config.upload?.enabled === false ? 'upload disabled in config.yaml' : 'no YouTube credentials configured'
      });
      entry.upload = { skipped: true, readyToUpload: true, reason: 'upload disabled or no credentials', path: videoDest };
    } else {
      try {
        const privacyStatus = process.env.YOUTUBE_PRIVACY_STATUS || config.upload?.privacy_status || 'public';
        const uploadRes = await uploadVideo({
          filePath: finalPath,
          title: videoScript.title,
          description,
          tags: videoScript.tags,
          privacyStatus,
          thumbnailPath: thumbPath,
          containsSyntheticMedia: anyAiGenerated,
          kind
        });
        entry.upload = { ok: true, ...uploadRes };
        entry.steps.upload = 'ok';
        // Always print the live URL -- "N uploaded" alone is useless for
        // verifying which channel/account received the video, and log.txt
        // is discarded with the runner so Studio is the only other check.
        log(`UPLOADED (${kind}): "${videoScript.title}" -> ${uploadRes.url} (privacy=${privacyStatus})`);
      } catch (err) {
        // Never lose a finished video over an upload-time failure (quota,
        // auth expiry, transient API error) -- park it for manual/next-run retry.
        const { videoDest } = await moveToReadyToUpload({
          finalPath, thumbPath, title: videoScript.title, description, tags: videoScript.tags,
          containsSyntheticMedia: anyAiGenerated, reason: `Upload failed: ${err.message}`
        });
        entry.upload = { ok: false, readyToUpload: true, error: err.message, path: videoDest };
        log(`UPLOAD FAILED (${kind} "${videoScript.title}"): ${err.message} -- parked at ${videoDest}`);
      }
    }
  } catch (err) {
    entry.error = err.message;
    log(`FAILED (${kind} "${videoScript.title}"): ${err.message}`);
  }
  return entry;
}

/** Attempts long_count_per_day scripts against one research/topic. Returns
 * { longScripts, videos } -- videos includes an entry (success or error)
 * for every attempt, same shape as the manifest expects. `longScripts` only
 * includes scripts that actually became a finished video (uploaded OR
 * parked -- either way a real file exists), NOT every script that merely
 * got written: pushing here unconditionally right after writeLongScript()
 * meant a script that was written fine but then failed during TTS/render/
 * duration-gate still counted as "succeeded" everywhere longScripts is
 * used downstream -- both the backup-topic-retry trigger (which then never
 * fired) and the shorts-generation gate (which could try to derive Shorts
 * from a long video that was never actually produced). Confirmed live
 * 2026-07-25: 3 of 4 pillar runs hit exactly the first case, each silently
 * producing zero videos with no retry after a ~50-60 min pipeline run. */
async function attemptLongScripts(research) {
  const longScripts = [];
  const videos = [];
  for (let i = 0; i < (LONG_COUNT_OVERRIDE ?? config.video?.long_count_per_day ?? 2); i++) {
    try {
      const script = await writeLongScript(research);
      log(`Long script #${i + 1}: "${script.title}" (${script.structure}, ${script.segments.length} segments)`);
      const entry = await produceVideo({ kind: 'long', videoScript: script, research, aspect: 'landscape' });
      videos.push(entry);
      if (!entry.error) longScripts.push(script);
    } catch (err) {
      log(`FAILED (long script #${i + 1}): ${err.message}`);
      videos.push({ kind: 'long', error: err.message });
    }
  }
  return { longScripts, videos };
}

async function runFull() {
  await mkdir(runDir, { recursive: true });

  // Fail fast if YouTube auth is missing or bound to the wrong channel,
  // before spending 30-60 min of LLM/TTS/render on a batch that can't
  // land on ModernMonkShot. Upload-time assertExpectedChannel still runs
  // per video as a second line of defense.
  if (config.upload?.enabled !== false && hasYoutubeCredentials()) {
    try {
      const ch = await assertExpectedChannel();
      log(`YouTube upload target: "${ch.title}" (@${ch.handle || 'none'}) ${ch.channelId}`);
    } catch (err) {
      log(`YouTube channel check FAILED: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  } else if (config.upload?.enabled !== false) {
    log('WARNING: YouTube credentials missing -- finished videos will be parked in ready_to_upload/ only');
  }

  let research = await researchTodaysTopic(today, { forceNicheId: NICHE_OVERRIDE });
  log(`Topic: ${research.topic} (score ${research.score}/10 -- ${research.reason})`);

  const manifest = { date: dateStr, topic: research.topic, videos: [] };
  let { longScripts, videos } = await attemptLongScripts(research);
  manifest.videos.push(...videos);

  // Zero long scripts succeeding on this topic (both attempts failing the
  // same "narration keeps repeating"/"too short" way) is strong evidence
  // the topic itself lacks real substance, not that generation got
  // unlucky twice on the same fact pool -- retrying script generation
  // again on identical thin material is unlikely to help, but a fresh
  // topic with its own facts is a genuinely different shot. Confirmed
  // live as a recurring cause of entire days producing zero long videos
  // (and therefore zero Shorts, which depend on a successful long script).
  // (longScripts now only counts scripts that became a real finished
  // video -- see attemptLongScripts' comment -- so this check is accurate
  // for both a script that never got written and one that did but never
  // finished.)
  // Two backup attempts, not one: the depth-focused pillars (2026-07-28)
  // pick specific, advanced, narrow topics on purpose (mechanistic
  // interpretability, catastrophic forgetting, etc.) instead of generic
  // 101-level ones -- confirmed live that these have a real, higher
  // repetition-failure rate than a broad survey topic would, since a free-
  // tier model has less redundant material to draw on for a narrow subject.
  // A single backup wasn't enough margin against that; two keeps the "give
  // up for the day" case rare without endlessly retrying.
  const triedTitles = new Set([research.topic.toLowerCase()]);
  for (let attempt = 1; longScripts.length === 0 && attempt <= 2; attempt++) {
    log(`No long videos succeeded on "${research.topic}" -- trying backup topic ${attempt}/2 instead of giving up for the day`);
    try {
      const backupResearch = await researchTodaysTopic(today, { excludeTitles: triedTitles, forceNicheId: NICHE_OVERRIDE });
      log(`Backup topic ${attempt}/2: ${backupResearch.topic} (score ${backupResearch.score}/10 -- ${backupResearch.reason})`);
      triedTitles.add(backupResearch.topic.toLowerCase());
      research = backupResearch;
      manifest.topic = research.topic;
      const retry = await attemptLongScripts(research);
      longScripts = retry.longScripts;
      manifest.videos.push(...retry.videos);
    } catch (err) {
      log(`Backup topic ${attempt}/2 attempt failed: ${err.message}`);
    }
  }

  if (!LONG_ONLY && longScripts.length > 0) {
    const shortCount = SHORT_COUNT_OVERRIDE ?? config.video?.shorts_count_per_day ?? 4;
    const perLong = Math.ceil(shortCount / longScripts.length);
    let made = 0;
    for (const longScript of longScripts) {
      if (made >= shortCount) break;
      const want = Math.min(perLong, shortCount - made);
      try {
        const shorts = await writeShortScripts(research, longScript, want);
        for (const short of shorts) {
          const shortScript = {
            title: short.title,
            description: short.description,
            tags: [...new Set([...(short.tags || []), ...(short.hashtags || []), ...(longScript.tags || []), 'Shorts'])].slice(0, 15),
            hashtags: short.hashtags,
            structure: longScript.structure,
            segments: [{ text: short.narration, visual_needs: short.visual_needs || [] }]
          };
          const entry = await produceVideo({ kind: 'short', videoScript: shortScript, research, aspect: 'vertical' });
          manifest.videos.push(entry);
          made++;
        }
      } catch (err) {
        log(`FAILED (shorts for "${longScript.title}"): ${err.message}`);
        manifest.videos.push({ kind: 'short', error: err.message });
      }
    }
  }

  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const succeeded = manifest.videos.filter((v) => !v.error);
  const uploaded = manifest.videos.filter((v) => v.upload?.ok);
  const readyForManual = manifest.videos.filter((v) => v.upload?.readyToUpload);
  const realAssets = succeeded.reduce((s, v) => s + (v.mediaSummary?.real ?? 0), 0);
  const aiAssets = succeeded.reduce((s, v) => s + (v.mediaSummary?.aiGenerated ?? 0), 0);

  const logText = [
    `Run: ${dateStr}`,
    `Topic: ${research.topic} (score ${research.score}/10)`,
    `Videos attempted: ${manifest.videos.length} | succeeded: ${succeeded.length} | failed: ${manifest.videos.length - succeeded.length}`,
    `Uploaded: ${uploaded.length} | parked in ready_to_upload/: ${readyForManual.length}`,
    `Media assets: ${realAssets} real, ${aiAssets} AI-generated`,
    '',
    ...manifest.videos.map((v) => `- [${v.kind}] "${v.title || '(failed before titling)'}" -- ${v.error ? `ERROR: ${v.error}` : v.upload?.ok ? `uploaded: ${v.upload.url}` : v.upload?.readyToUpload ? `ready_to_upload: ${v.upload.reason}` : 'unknown'}`)
  ].join('\n');
  await writeFile(path.join(runDir, 'log.txt'), logText, 'utf-8');

  log(`Done. ${succeeded.length}/${manifest.videos.length} videos produced. ${uploaded.length} uploaded, ${readyForManual.length} parked for manual upload.`);
  // Only hard-fail the Actions job when the day produced nothing shippable.
  // Partial days (e.g. 4/6 or 1/2 longs) used to exit 1 and paint the run
  // red even when videos were already uploaded to YouTube -- confirmed live
  // on runs 29829542423 (4 uploaded) and 29831073266 (1 uploaded). A red
  // X on a day that shipped content is noise, not a signal.
  if (succeeded.length === 0) {
    process.exitCode = 1;
  } else if (succeeded.length < manifest.videos.length) {
    log(`Partial success (${succeeded.length}/${manifest.videos.length}) -- treating as non-fatal so shipped videos still count as a green run.`);
  }
}

if (DRY_RUN) {
  await runDryRun();
} else {
  await runFull();
}
