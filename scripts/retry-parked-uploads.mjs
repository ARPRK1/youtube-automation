#!/usr/bin/env node
// Retries uploading any videos parked from a previous run, in case
// whatever blocked the original upload (almost always YouTube's daily
// upload/thumbnail-count cap) has cleared since. Two independent sources,
// since a video can end up in either depending on its file size:
//
//  1. The `parked-videos` git branch (parked/<date>/<slug>.mp4 + sidecar
//     -metadata.json/-thumb.jpg) -- anything under git's 100MB limit.
//     Self-cleaning: a successful upload deletes its files from this
//     branch's worktree so it's never retried again.
//  2. GitHub Actions artifacts named videos-<run_id> -- the ONLY copy of
//     anything too large for the git branch (a long-form video routinely
//     exceeds 100MB; confirmed live 2026-07-28 with a 143MB long video).
//     These expire after 3 days regardless, so this script tracks which
//     artifact IDs it has already successfully uploaded from
//     (parked/.artifact-retry-state.json, committed alongside everything
//     else) to avoid re-uploading the same video twice across scheduled
//     runs.
//
// Expects PARKED_WORKTREE env var pointing at a checkout of the
// parked-videos branch (see .github/workflows/retry-parked-uploads.yml,
// which uses `git worktree add` rather than switching the main checkout's
// branch, so this script can still import lib/youtube-upload.js etc. from
// the main checkout while operating on parked-videos' files).

import { readdir, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { uploadVideo, hasYoutubeCredentials } from '../lib/youtube-upload.js';

const WORKTREE = process.env.PARKED_WORKTREE || '.';
const PARKED_DIR = path.join(WORKTREE, 'parked');
const STATE_FILE = path.join(PARKED_DIR, '.artifact-retry-state.json');
const REPO = process.env.GITHUB_REPOSITORY;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8' });
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf-8'));
  } catch {
    return { processedArtifactIds: [] };
  }
}

async function saveState(state) {
  await mkdir(PARKED_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Metadata doesn't store kind directly -- shorts always carry a
 * 'Shorts' tag/hashtag and/or #Shorts in the title (see
 * lib/script-writer.js), so infer from that instead of guessing from
 * aspect ratio. */
function inferKind(metadata) {
  if ((metadata.tags || []).some((t) => /shorts/i.test(t))) return 'short';
  if (/#shorts/i.test(metadata.title || '')) return 'short';
  return 'long';
}

async function tryUpload(videoPath, thumbPath, metadata, label) {
  const kind = inferKind(metadata);
  try {
    const res = await uploadVideo({
      filePath: videoPath,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      thumbnailPath: existsSync(thumbPath) ? thumbPath : null,
      containsSyntheticMedia: metadata.containsSyntheticMedia,
      kind
    });
    console.log(`[retry-parked] UPLOADED: "${metadata.title}" -> ${res.url} (${label})`);
    return { ok: true, url: res.url };
  } catch (err) {
    console.warn(`[retry-parked] still failing for "${label}": ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function retryGitBranchVideos() {
  if (!existsSync(PARKED_DIR)) return { attempted: 0, uploaded: [] };
  const entries = await readdir(PARKED_DIR, { withFileTypes: true });
  const dateDirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);

  const uploaded = [];
  let attempted = 0;

  for (const dateDir of dateDirs) {
    const dir = path.join(PARKED_DIR, dateDir);
    const files = await readdir(dir);
    const mp4s = files.filter((f) => f.endsWith('.mp4'));
    for (const mp4 of mp4s) {
      const base = mp4.slice(0, -4);
      const metaPath = path.join(dir, `${base}-metadata.json`);
      const thumbPath = path.join(dir, `${base}-thumb.jpg`);
      const videoPath = path.join(dir, mp4);
      if (!existsSync(metaPath)) continue;
      const metadata = JSON.parse(await readFile(metaPath, 'utf-8'));
      attempted++;
      const result = await tryUpload(videoPath, thumbPath, metadata, `git:${dateDir}/${base}`);
      if (result.ok) {
        uploaded.push({ title: metadata.title, url: result.url, source: `git:${dateDir}/${base}` });
        await rm(videoPath, { force: true });
        await rm(thumbPath, { force: true });
        await rm(metaPath, { force: true });
      } else {
        // Visible in the branch so a human glancing at the file can see how
        // long something has been stuck, without this script retrying
        // forever silently.
        metadata.retryAttempts = (metadata.retryAttempts || 0) + 1;
        metadata.lastRetryError = result.error;
        metadata.lastRetryAt = new Date().toISOString();
        await writeFile(metaPath, JSON.stringify(metadata, null, 2));
      }
    }
  }
  return { attempted, uploaded };
}

async function retryArtifactVideos() {
  if (!REPO) return { attempted: 0, uploaded: [] };
  const state = await loadState();
  const processed = new Set(state.processedArtifactIds);

  let artifacts = [];
  try {
    const raw = gh(['api', `repos/${REPO}/actions/artifacts?per_page=100`, '--jq', '.artifacts']);
    artifacts = JSON.parse(raw);
  } catch (err) {
    console.warn(`[retry-parked] could not list artifacts: ${err.message}`);
    return { attempted: 0, uploaded: [] };
  }

  const candidates = artifacts.filter(
    (a) => /^videos-\d+$/.test(a.name) && !a.expired && !processed.has(a.id)
  );

  const uploaded = [];
  let attempted = 0;

  for (const artifact of candidates) {
    const runId = artifact.workflow_run?.id;
    if (!runId) continue;
    const stageDir = `.artifact-stage-${artifact.id}`;
    try {
      gh(['run', 'download', String(runId), '--repo', REPO, '--name', artifact.name, '--dir', stageDir]);
    } catch (err) {
      console.warn(`[retry-parked] could not download artifact ${artifact.name}: ${err.message}`);
      continue;
    }

    const dateDirs = existsSync(stageDir)
      ? (await readdir(stageDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
      : [];

    let sawAny = false;
    let allOk = true;
    for (const dateDir of dateDirs) {
      const dir = path.join(stageDir, dateDir);
      const files = await readdir(dir);
      const mp4s = files.filter((f) => f.endsWith('.mp4'));
      for (const mp4 of mp4s) {
        const base = mp4.slice(0, -4);
        const metaPath = path.join(dir, `${base}-metadata.json`);
        const thumbPath = path.join(dir, `${base}-thumb.jpg`);
        const videoPath = path.join(dir, mp4);
        if (!existsSync(metaPath)) continue;
        sawAny = true;
        const metadata = JSON.parse(await readFile(metaPath, 'utf-8'));
        attempted++;
        const result = await tryUpload(videoPath, thumbPath, metadata, `artifact:${artifact.name}/${base}`);
        if (result.ok) {
          uploaded.push({ title: metadata.title, url: result.url, source: `artifact:${artifact.name}` });
        } else {
          allOk = false;
        }
      }
    }
    await rm(stageDir, { recursive: true, force: true }).catch(() => {});
    // Only mark processed once every video in the artifact uploaded clean --
    // a partial failure should keep the whole artifact eligible for the
    // next scheduled attempt.
    if (sawAny && allOk) state.processedArtifactIds.push(artifact.id);
  }

  await saveState(state);
  return { attempted, uploaded };
}

async function main() {
  if (!hasYoutubeCredentials()) {
    console.log('[retry-parked] No YouTube credentials configured, nothing to do.');
    return;
  }
  const fromGit = await retryGitBranchVideos();
  const fromArtifacts = await retryArtifactVideos();

  const allUploaded = [...fromGit.uploaded, ...fromArtifacts.uploaded];
  const totalAttempted = fromGit.attempted + fromArtifacts.attempted;

  console.log(`[retry-parked] Done. ${totalAttempted} attempted, ${allUploaded.length} uploaded.`);
  if (allUploaded.length > 0) {
    console.log('[retry-parked] Newly live:');
    for (const v of allUploaded) console.log(`  - "${v.title}" -> ${v.url} (from ${v.source})`);
  }
}

main().catch((err) => {
  console.error(`[retry-parked] fatal: ${err.message}`);
  process.exitCode = 1;
});
