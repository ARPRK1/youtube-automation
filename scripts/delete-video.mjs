#!/usr/bin/env node
// One-off manual tool: deletes a specific video by ID from the channel.
// Not part of the daily pipeline -- only run via the "Delete a video"
// workflow_dispatch, which requires typing the exact video ID as input.
//
// Built 2026-07-29 after scripts/retry-parked-uploads.mjs's first live run
// double-uploaded "ai explained" (a dedup bug, since fixed) -- kept as a
// small reusable tool rather than a throwaway one-off, in case a similar
// cleanup is ever needed again.
//
// Usage: node scripts/delete-video.mjs <videoId>

import { google } from 'googleapis';
import { getOAuthClient, hasYoutubeCredentials, assertExpectedChannel } from '../lib/youtube-upload.js';

const videoId = process.argv[2];
if (!videoId) {
  console.error('Usage: node scripts/delete-video.mjs <videoId>');
  process.exitCode = 1;
} else {
  await main(videoId);
}

async function main(id) {
  if (!hasYoutubeCredentials()) {
    console.error('Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN env vars');
    process.exitCode = 1;
    return;
  }
  // Same wrong-channel guard as every real upload -- never delete on
  // whatever channel the token happens to be bound to without checking.
  const ch = await assertExpectedChannel();
  console.log(`[delete-video] Deleting ${id} from "${ch.title}" (@${ch.handle || 'none'})...`);

  const auth = getOAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });
  await youtube.videos.delete({ id });
  console.log(`[delete-video] Deleted https://youtu.be/${id}`);
}
