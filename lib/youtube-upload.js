import { google } from 'googleapis';
import { createReadStream } from 'node:fs';

const REDIRECT_URI = 'http://localhost:53682/oauth2callback';

export function hasYoutubeCredentials() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return oAuth2Client;
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
  thumbnailPath = null
}) {
  if (!hasYoutubeCredentials()) {
    throw new Error('Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN env vars');
  }
  const auth = getOAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: title.slice(0, 100), description, tags, categoryId },
      status: { privacyStatus, selfDeclaredMadeForKids: false }
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
