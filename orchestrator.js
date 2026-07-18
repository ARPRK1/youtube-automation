import 'dotenv/config';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from './lib/config.js';
import { researchTodaysTopic } from './lib/research.js';
import { writeLongScript, writeShortScripts } from './lib/script-writer.js';
import { synthesizeSegmentAudio } from './lib/tts.js';
import { buildSegmentCaptions } from './lib/captions.js';
import { sourceMediaForSegment, writeMediaManifest } from './lib/media-sourcing.js';
import { renderVisualTimeline } from './lib/visuals.js';
import { concatSegmentAudio, mergeSegmentCaptions, renderFinalVideo, prependIntro } from './lib/assemble.js';
import { renderIntro } from './lib/intro.js';
import { addBackgroundMusic } from './lib/music.js';
import { renderThumbnail } from './lib/thumbnail.js';
import { runQualityGate } from './lib/quality-gate.js';
import { uploadVideo, hasYoutubeCredentials } from './lib/youtube-upload.js';
import { probeDurationSeconds } from './lib/ffmpeg-util.js';

const DRY_RUN = process.argv.includes('--dry-run');
// Backfill knobs: --long-only skips the shorts batch (used to catch up on
// missed long-form videos without also duplicating that day's shorts);
// --long-count=N overrides config.video.long_count_per_day for one run.
const LONG_ONLY = process.argv.includes('--long-only');
const longCountArg = process.argv.find((a) => a.startsWith('--long-count='));
const LONG_COUNT_OVERRIDE = longCountArg ? parseInt(longCountArg.split('=')[1], 10) : null;
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
      const { audioPath, srtPath, durationSec, hadPause } = await synthesizeSegmentAudio(seg.text, runDir, `${baseName}-seg${i}`);
      audioPaths.push(audioPath);
      const capSrtPath = path.join(runDir, `${baseName}-seg${i}-cap.srt`);
      const lines = await buildSegmentCaptions({ srtPath, text: seg.text, durationSec, outPath: capSrtPath });
      segmentCaptions.push({ lines, durationSec });

      const asset = await sourceMediaForSegment(seg, aspect, runDir, i, usedMediaUrls);
      mediaAssets.push({ ...asset, segmentIndex: i, durationSec, seed: `${baseName}-${i}`, hadPause });
    }
    entry.steps.tts = 'ok';
    entry.steps.media = 'ok';

    const totalNarrationSec = mediaAssets.reduce((s, a) => s + a.durationSec, 0);
    entry.durationSec = totalNarrationSec;
    if (kind === 'long' && totalNarrationSec < (config.video?.long_min_minutes ?? 5) * 60) {
      throw new Error(`Narration too short for long-form: ${totalNarrationSec.toFixed(1)}s (need ${(config.video?.long_min_minutes ?? 5) * 60}s+)`);
    }
    if (kind === 'short' && totalNarrationSec > (config.video?.shorts_max_seconds ?? 120)) {
      throw new Error(`Narration too long for a Short: ${totalNarrationSec.toFixed(1)}s (must be <=${config.video?.shorts_max_seconds ?? 120}s)`);
    }

    const fullAudioPath = path.join(runDir, `${baseName}-audio.mp3`);
    await concatSegmentAudio(audioPaths, fullAudioPath);

    const captionSrtPath = path.join(runDir, `${baseName}-captions.srt`);
    await mergeSegmentCaptions(segmentCaptions, captionSrtPath);
    entry.steps.captions = 'ok';

    const bgPath = path.join(runDir, `${baseName}-bg.mp4`);
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
    const musicResult = await addBackgroundMusic({ videoPath: finalPath, outPath: finalPath.replace(/\.mp4$/, '-music.mp4'), durationSec: preMusicDuration, date: today });
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
    await renderThumbnail({ keyImageBuffer: mediaAssets[0]?.buffer, backgroundClipPath: bgPath, title: videoScript.title, outPath: thumbPath });
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
        const uploadRes = await uploadVideo({
          filePath: finalPath, title: videoScript.title, description, tags: videoScript.tags,
          privacyStatus: config.upload?.privacy_status || 'unlisted', thumbnailPath: thumbPath,
          containsSyntheticMedia: anyAiGenerated
        });
        entry.upload = { ok: true, ...uploadRes };
        entry.steps.upload = 'ok';
      } catch (err) {
        // Never lose a finished video over an upload-time failure (quota,
        // auth expiry, transient API error) -- park it for manual/next-run retry.
        const { videoDest } = await moveToReadyToUpload({
          finalPath, thumbPath, title: videoScript.title, description, tags: videoScript.tags,
          containsSyntheticMedia: anyAiGenerated, reason: `Upload failed: ${err.message}`
        });
        entry.upload = { ok: false, readyToUpload: true, error: err.message, path: videoDest };
      }
    }
  } catch (err) {
    entry.error = err.message;
    log(`FAILED (${kind} "${videoScript.title}"): ${err.message}`);
  }
  return entry;
}

async function runFull() {
  await mkdir(runDir, { recursive: true });
  const research = await researchTodaysTopic(today);
  log(`Topic: ${research.topic} (score ${research.score}/10 -- ${research.reason})`);

  const manifest = { date: dateStr, topic: research.topic, videos: [] };
  const longScripts = [];

  for (let i = 0; i < (LONG_COUNT_OVERRIDE ?? config.video?.long_count_per_day ?? 2); i++) {
    try {
      const script = await writeLongScript(research);
      longScripts.push(script);
      log(`Long script #${i + 1}: "${script.title}" (${script.structure}, ${script.segments.length} segments)`);
      const entry = await produceVideo({ kind: 'long', videoScript: script, research, aspect: 'landscape' });
      manifest.videos.push(entry);
    } catch (err) {
      log(`FAILED (long script #${i + 1}): ${err.message}`);
      manifest.videos.push({ kind: 'long', error: err.message });
    }
  }

  if (!LONG_ONLY && longScripts.length > 0) {
    const shortCount = config.video?.shorts_count_per_day ?? 4;
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
            tags: [...new Set([...(short.hashtags || []), ...longScript.tags])].slice(0, 15),
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
  if (succeeded.length < manifest.videos.length) process.exitCode = 1;
}

if (DRY_RUN) {
  await runDryRun();
} else {
  await runFull();
}
