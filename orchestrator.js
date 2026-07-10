import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getTodayNiche, pickTopic } from './niches.js';
import { writeLongScript, writeShortScripts } from './lib/script-writer.js';
import { synthesizeSpeech } from './lib/tts.js';
import { parseSrt, splitIntoShortLines, writeSrt } from './lib/srt.js';
import { renderBackgroundClip } from './lib/visuals.js';
import { renderFinalVideo } from './lib/assemble.js';
import { renderThumbnail } from './lib/thumbnail.js';
import { uploadVideo, hasYoutubeCredentials } from './lib/youtube-upload.js';
import { probeDurationSeconds } from './lib/ffmpeg-util.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LONG_COUNT = Number(process.env.DAILY_LONG_COUNT || 2);
const SHORT_COUNT = Number(process.env.DAILY_SHORT_COUNT || 4);

const today = new Date();
const dateStr = today.toISOString().slice(0, 10);
const outDir = path.join('output', dateStr);

function log(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }

async function runDryRun() {
  const niche = getTodayNiche(today);
  log(`Today's niche: ${niche.name}`);
  const checks = [
    ['GROQ_API_KEY or GEMINI_API_KEY (script generation)', Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)],
    ['YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN (upload)', hasYoutubeCredentials()],
    ['PEXELS_API_KEY (optional, stock backgrounds)', Boolean(process.env.PEXELS_API_KEY)]
  ];
  let ok = true;
  for (const [label, present] of checks) {
    log(`${present ? 'OK  ' : 'MISS'} - ${label}`);
    if (!present && label.includes('script generation')) ok = false;
  }
  if (!ok) {
    log('Missing required config for script generation. Set GROQ_API_KEY or GEMINI_API_KEY.');
    process.exit(1);
  }
  log('Dry run passed. No content generated, nothing uploaded, no cost incurred.');
}

/** Renders one video (long or short) end-to-end and returns a manifest entry. */
async function produceVideo({ kind, title, narration, description, tags, seed, aspect, durationHint }) {
  const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || `${kind}-${seed}`;
  const entry = { kind, title, baseName, steps: {} };

  try {
    const { audioPath, srtPath } = await synthesizeSpeech(narration, outDir, baseName);
    entry.steps.tts = 'ok';

    const sentenceCues = await parseSrt(srtPath);
    const shortLines = splitIntoShortLines(sentenceCues);
    const captionSrtPath = path.join(outDir, `${baseName}-captions.srt`);
    await writeSrt(shortLines, captionSrtPath);
    entry.steps.captions = 'ok';

    const durationSec = await probeDurationSeconds(audioPath);
    entry.durationSec = durationSec;
    if (durationHint === 'long' && durationSec < 480) {
      throw new Error(`Narration too short for a long-form video: ${durationSec.toFixed(1)}s (need 8+ min)`);
    }

    const bgPath = path.join(outDir, `${baseName}-bg.mp4`);
    const tmpImagePath = path.join(outDir, `${baseName}-src.jpg`);
    await renderBackgroundClip({ topic: title, seed, durationSec, aspect, outPath: bgPath, tmpImagePath });
    entry.steps.visuals = 'ok';

    const finalPath = path.join(outDir, `${baseName}.mp4`);
    await renderFinalVideo({ backgroundClipPath: bgPath, audioPath, srtPath: captionSrtPath, outPath: finalPath });
    entry.steps.assemble = 'ok';
    entry.videoPath = finalPath;

    const thumbPath = path.join(outDir, `${baseName}-thumb.jpg`);
    await renderThumbnail({ backgroundClipPath: bgPath, title, outPath: thumbPath });
    entry.steps.thumbnail = 'ok';
    entry.thumbnailPath = thumbPath;

    const finalDuration = await probeDurationSeconds(finalPath);
    entry.finalDurationSec = finalDuration;
    if (finalDuration < 5) throw new Error(`Rendered video suspiciously short (${finalDuration}s) — treating as failure`);

    if (!hasYoutubeCredentials()) {
      entry.upload = { skipped: true, reason: 'no YouTube credentials configured' };
    } else {
      const uploadRes = await uploadVideo({
        filePath: finalPath,
        title,
        description,
        tags,
        privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || 'unlisted',
        thumbnailPath: thumbPath
      });
      entry.upload = { ok: true, ...uploadRes };
      entry.steps.upload = 'ok';
    }
  } catch (err) {
    entry.error = err.message;
    log(`FAILED (${kind} "${title}"): ${err.message}`);
  }
  return entry;
}

async function runFull() {
  await mkdir(outDir, { recursive: true });
  const niche = getTodayNiche(today);
  log(`Today's niche: ${niche.name}`);

  const manifest = { date: dateStr, niche: niche.name, videos: [] };
  const longScripts = [];

  for (let i = 0; i < LONG_COUNT; i++) {
    const topic = pickTopic(niche, today, i);
    log(`Writing long script #${i + 1}: ${topic}`);
    try {
      const script = await writeLongScript(niche, topic);
      longScripts.push({ topic, script });
      const entry = await produceVideo({
        kind: 'long',
        title: script.title,
        narration: script.narration,
        description: script.description,
        tags: script.tags,
        seed: `long-${i}-${dateStr}`,
        aspect: 'landscape',
        durationHint: 'long'
      });
      manifest.videos.push(entry);
    } catch (err) {
      log(`FAILED (long script #${i + 1}, topic "${topic}"): ${err.message}`);
      manifest.videos.push({ kind: 'long', title: topic, error: err.message });
    }
  }

  if (longScripts.length > 0) {
    const perLong = Math.ceil(SHORT_COUNT / longScripts.length);
    let shortsMade = 0;
    for (const { topic, script } of longScripts) {
      if (shortsMade >= SHORT_COUNT) break;
      const want = Math.min(perLong, SHORT_COUNT - shortsMade);
      try {
        const shorts = await writeShortScripts(niche, topic, script, want);
        for (const [idx, short] of shorts.entries()) {
          const entry = await produceVideo({
            kind: 'short',
            title: short.title,
            narration: short.narration,
            description: `${short.title}\n\nFrom our video: ${script.title}`,
            tags: script.tags,
            seed: `short-${topic}-${idx}-${dateStr}`,
            aspect: 'vertical',
            durationHint: 'short'
          });
          manifest.videos.push(entry);
          shortsMade++;
        }
      } catch (err) {
        log(`FAILED (shorts for topic "${topic}"): ${err.message}`);
        manifest.videos.push({ kind: 'short', title: `shorts for ${topic}`, error: err.message });
      }
    }
  }

  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const hardFailures = manifest.videos.filter((v) => v.error || (v.upload && v.upload.ok === false));
  log(`Done. ${manifest.videos.length - hardFailures.length}/${manifest.videos.length} videos produced successfully.`);
  if (hardFailures.length > 0) {
    log(`${hardFailures.length} video(s) failed — see output/${dateStr}/manifest.json`);
    process.exitCode = 1;
  }
}

if (DRY_RUN) {
  await runDryRun();
} else {
  await runFull();
}
