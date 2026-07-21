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

// youtube.upload alone is enough to insert videos, but the pipeline also
// calls channels.list(mine) for startup verification and videos.list
// (chart=mostPopular) for topic research -- those need readonly/force-ssl.
// Request the full manage scope so one consent covers upload + research
// + channel identity checks. prompt=consent forces a refresh_token even
// when this Google account has authorized the app before.
// login_hint steers the account chooser; the user must still pick the
// correct YouTube CHANNEL if the Google account has multiple (Brand
// Account / Advanced features channels). prompt=select_account+consent
// forces both account and consent screens so a previous wrong-channel
// grant is not silently reused.
const loginHint = process.env.YOUTUBE_LOGIN_HINT || '';
// Full youtube scope is more likely to surface the brand-account /
// channel picker than upload-only. Without that picker Google silently
// binds the token to the default personal channel (confirmed live:
// rp271187@gmail.com kept authorizing "Ranapratap A" instead of the
// ModernMonkShot brand channel).
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'select_account consent',
  scope: ['https://www.googleapis.com/auth/youtube'],
  ...(loginHint ? { login_hint: loginHint } : {})
});

const expectedHandle = (process.env.YOUTUBE_EXPECTED_HANDLE || '').replace(/^@/, '').toLowerCase();
const expectedTitle = (process.env.YOUTUBE_EXPECTED_CHANNEL || '').toLowerCase();

console.log('\n1. Open this URL in a browser.\n');
console.log('   CRITICAL — multi-channel Google accounts:');
console.log('   a) Choose the Google account' + (loginHint ? ` (${loginHint})` : '') + '.');
console.log('   b) If Google shows "Choose a channel" / Brand Account list,');
console.log('      pick that channel (NOT a personal default like ranapratapa4100).');
console.log('   c) Click Allow.\n');
if (expectedHandle || expectedTitle) {
  console.log(`   Will REJECT the token unless the authorized channel matches:`);
  if (expectedTitle) console.log(`     title contains: "${expectedTitle}"`);
  if (expectedHandle) console.log(`     handle: @${expectedHandle}`);
  console.log('');
}
console.log(authUrl);
console.log('\n2. Waiting for the redirect back to localhost...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/oauth2callback') { res.end(); return; }
  const code = url.searchParams.get('code');
  const errParam = url.searchParams.get('error');
  if (errParam) {
    res.end(`Authorization failed: ${errParam}`);
    server.close();
    console.error('OAuth error from Google:', errParam);
    process.exit(1);
  }
  res.end('Authorization received — you can close this tab and return to the terminal.');
  server.close();

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.error('\nNo refresh_token returned. Revoke app access at https://myaccount.google.com/permissions and re-run.');
      process.exit(1);
    }
    oAuth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });
    const ch = await youtube.channels.list({ part: ['snippet', 'statistics'], mine: true });
    const channel = ch.data.items?.[0];
    if (!channel) {
      console.error('Token works but channels.list(mine) returned nothing.');
      process.exit(1);
    }
    const title = channel.snippet?.title || '';
    const handle = (channel.snippet?.customUrl || '').replace(/^@/, '');
    console.log('\nAuthorized channel:');
    console.log(`  title:  ${title}`);
    console.log(`  handle: ${channel.snippet?.customUrl || '(none)'}`);
    console.log(`  id:     ${channel.id}`);
    console.log(`  videos: ${channel.statistics?.videoCount}`);

    const titleOk = !expectedTitle || title.toLowerCase().includes(expectedTitle);
    const handleOk = !expectedHandle || handle.toLowerCase() === expectedHandle;
    if (!titleOk || !handleOk) {
      console.error('\nREJECTED: this token is for the WRONG channel.');
      console.error('Re-run and select the correct Brand Account on the Google consent screen.');
      console.error('Tip: open YouTube Studio as that channel first, then re-authorize.');
      process.exit(2);
    }

    console.log('\nSuccess — channel matches. Save this as YOUTUBE_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
  } catch (err) {
    console.error('Token exchange / channel check failed:', err.message);
    process.exit(1);
  }
});

server.listen(PORT);
