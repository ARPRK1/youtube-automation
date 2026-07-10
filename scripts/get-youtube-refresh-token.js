// One-time helper: run this locally (never in CI) to mint a YouTube
// refresh token. Requires a Google Cloud project with the YouTube Data API
// v3 enabled and an OAuth 2.0 Desktop client (client ID + secret) — see
// README.md for the exact console steps, all free.
//
// Usage:
//   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node scripts/get-youtube-refresh-token.js

import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET env vars first (from Google Cloud Console > APIs & Services > Credentials).');
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/youtube.upload']
});

console.log('\n1. Open this URL in a browser and approve access with the Google account that owns your YouTube channel:\n');
console.log(authUrl);
console.log('\n2. Waiting for the redirect back to localhost...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/oauth2callback') { res.end(); return; }
  const code = url.searchParams.get('code');
  res.end('Authorization received — you can close this tab and return to the terminal.');
  server.close();

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log('\nSuccess. Save this as the YOUTUBE_REFRESH_TOKEN secret (GitHub repo secret + local .env):\n');
    console.log(tokens.refresh_token);
    console.log('\nIf refresh_token is missing, revoke prior access at https://myaccount.google.com/permissions and re-run this script.');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    process.exit(1);
  }
});

server.listen(PORT);
