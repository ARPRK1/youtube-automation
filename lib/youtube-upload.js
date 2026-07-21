import { google } from 'googleapis';
import { createReadStream } from 'node:fs';
import { loadConfig } from './config.js';

const REDIRECT_URI = 'http://localhost:53682/oauth2callback';

export function hasYoutubeCredentials() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

export function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return oAuth2Client;
}

/** Cached after the first successful assert so a 6-video day doesn't burn
 * 6 channels.list quota units on the same check. */
let verifiedChannel = null;

/**
 * Confirms the OAuth token is bound to the channel we intend to upload to.
 * Multi-channel Google accounts (personal + Brand Account) silently bind
 * tokens to whichever channel was selected at consent time -- without this
 * check, videos can land on the wrong channel (confirmed live: uploads
 * went to @ranapratapa4100 instead of @modernmonkshot).
 * Returns { channelId, title, handle } or throws.
 */
export async function assertExpectedChannel() {
  if (verifiedChannel) return verifiedChannel;
  if (!hasYoutubeCredentials()) {
    throw new Error('Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN');
  }
  const config = loadConfig();
  const expectedId = process.env.YOUTUBE_CHANNEL_ID || config.upload?.channel_id || '';
  const expectedHandle = (process.env.YOUTUBE_CHANNEL_HANDLE || config.upload?.channel_handle || '')
    .replace(/^@/, '')
    .toLowerCase();

  const auth = getOAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const res = await youtube.channels.list({ part: ['snippet'], mine: true });
  const channel = res.data.items?.[0];
  if (!channel) {
    throw new Error('YouTube OAuth token works but channels.list(mine) returned no channel');
  }
  const channelId = channel.id;
  const title = channel.snippet?.title || '';
  const handle = (channel.snippet?.customUrl || '').replace(/^@/, '');

  if (expectedId && channelId !== expectedId) {
    throw new Error(
      `YouTube token is bound to the WRONG channel: "${title}" (@${handle || 'none'}, ${channelId}). ` +
      `Expected channel id ${expectedId}` +
      (expectedHandle ? ` (@${expectedHandle})` : '') +
      `. Re-run scripts/get-youtube-refresh-token.js and pick the Brand Account on the consent screen.`
    );
  }
  if (!expectedId && expectedHandle && handle.toLowerCase() !== expectedHandle) {
    throw new Error(
      `YouTube token is bound to the WRONG channel: "${title}" (@${handle || 'none'}). ` +
      `Expected @${expectedHandle}. Re-authorize selecting the correct Brand Account.`
    );
  }

  verifiedChannel = { channelId, title, handle };
  console.log(`[youtube-upload] authorized channel: "${title}" (@${handle || 'none'}) ${channelId}`);
  return verifiedChannel;
}

/**
 * Uploads a real video via the YouTube Data API v3 (googleapis), with an
 * optional custom thumbnail. Requires YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN
 * env vars (see scripts/get-youtube-refresh-token.js for one-time setup).
 * Returns { videoId, url }.
 */
export async function uploadVideo({
  filePath,
  title,
  description,
  tags = [],
  categoryId = '27', // Education
  privacyStatus = 'unlisted',
  thumbnailPath = null,
  containsSyntheticMedia = false
}) {
  if (!hasYoutubeCredentials()) {
    throw new Error('Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN env vars');
  }
  // Refuse to upload if the token is for a different channel than config.
  await assertExpectedChannel();
  const auth = getOAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: title.slice(0, 100), description, tags, categoryId },
      // containsSyntheticMedia (added by YouTube Oct 2024) isn't in this
      // googleapis package's bundled types yet, but the REST API accepts
      // it -- this is plain JS, so the field still reaches the real API.
      status: { privacyStatus, selfDeclaredMadeForKids: false, containsSyntheticMedia }
    },
    media: { body: createReadStream(filePath) }
  });

  const videoId = res.data.id;

  if (thumbnailPath) {
    await youtube.thumbnails.set({
      videoId,
      media: { body: createReadStream(thumbnailPath) }
    }).catch((err) => {
      console.warn(`[youtube-upload] thumbnail upload failed for ${videoId}: ${err.message}`);
    });
  }

  return { videoId, url: `https://youtu.be/${videoId}` };
}
