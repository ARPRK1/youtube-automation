// One-shot free repair: unmark channel as made-for-kids, fix legacy videos,
// optimize channel description for the 90-day push.
import 'dotenv/config';
import { google } from 'googleapis';

const auth = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'http://localhost:53682/oauth2callback'
);
auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const yt = google.youtube({ version: 'v3', auth });

const CHANNEL_DESC = `ModernMonk — India stories that actually stick.

Food origin secrets. Simple money habits. History with a twist. Hidden places.
Every claim sourced. Zero fluff. Built for curious Indians (and anyone who loves India).

What you get:
• Food origin Shorts that surprise you in under 45 seconds
• Money lessons without guru nonsense
• "One decision" history moments
• Places locals know and tourists miss

Subscribe for one sharp India story a day — not noise.

#India #Shorts #Food #Money #History`;

console.log('=== 1) Channel made-for-kids + branding ===');
const chList = await yt.channels.list({ part: ['snippet', 'status', 'brandingSettings'], mine: true });
const ch = chList.data.items?.[0];
if (!ch) throw new Error('No channel');
console.log('Before:', {
  title: ch.snippet.title,
  madeForKids: ch.status?.madeForKids,
  selfDeclared: ch.status?.selfDeclaredMadeForKids
});

try {
  await yt.channels.update({
    part: ['status'],
    requestBody: {
      id: ch.id,
      status: { selfDeclaredMadeForKids: false }
    }
  });
  console.log('Channel status OK (madeForKids=false)');
} catch (err) {
  console.error('Channel status update failed:', err.message);
}
try {
  // YouTube requires a fuller snippet object on update (title alone is not enough).
  await yt.channels.update({
    part: ['snippet'],
    requestBody: {
      id: ch.id,
      snippet: {
        title: ch.snippet.title,
        description: CHANNEL_DESC,
        defaultLanguage: ch.snippet.defaultLanguage || 'en',
        country: ch.snippet.country || 'IN'
      }
    }
  });
  console.log('Channel description OK');
} catch (err) {
  console.error('Channel description update failed:', err.message);
  console.error('  Fix manually in Studio → Customization → Basic info if needed.');
}
try {
  await yt.channels.update({
    part: ['brandingSettings'],
    requestBody: {
      id: ch.id,
      brandingSettings: {
        channel: {
          ...(ch.brandingSettings?.channel || {}),
          description: CHANNEL_DESC,
          keywords: 'India Shorts money food history travel facts ModernMonk SIP street food Indian culture explained'
        }
      }
    }
  });
  console.log('Channel branding/keywords OK');
} catch (err) {
  console.error('Channel branding update failed:', err.message);
}

console.log('\n=== 2) Fix videos still marked made-for-kids ===');
const uploads = chList.data.items[0];
const ch2 = await yt.channels.list({ part: ['contentDetails'], mine: true });
const playlistId = ch2.data.items[0].contentDetails.relatedPlaylists.uploads;
let pageToken;
let fixed = 0;
let scanned = 0;
do {
  const pl = await yt.playlistItems.list({
    part: ['contentDetails'],
    playlistId,
    maxResults: 50,
    pageToken
  });
  const ids = (pl.data.items || []).map((i) => i.contentDetails.videoId);
  if (ids.length === 0) break;
  const det = await yt.videos.list({ part: ['status', 'snippet'], id: ids });
  for (const v of det.data.items || []) {
    scanned++;
    if (v.status?.selfDeclaredMadeForKids === true || v.status?.madeForKids === true) {
      try {
        await yt.videos.update({
          part: ['status'],
          requestBody: {
            id: v.id,
            status: {
              privacyStatus: v.status.privacyStatus || 'public',
              selfDeclaredMadeForKids: false,
              embeddable: true
            }
          }
        });
        fixed++;
        console.log('Fixed kids flag:', v.snippet.title.slice(0, 50));
      } catch (e) {
        console.warn('Could not fix', v.id, e.message);
      }
    }
  }
  pageToken = pl.data.nextPageToken;
} while (pageToken);

console.log(`\nScanned ${scanned} videos, fixed ${fixed} made-for-kids flags.`);

const after = await yt.channels.list({ part: ['status', 'statistics'], mine: true });
console.log('After channel status:', JSON.stringify(after.data.items[0].status, null, 2));
console.log('Stats:', after.data.items[0].statistics);
console.log('\nDone. In Studio also verify: Settings → Channel → Advanced → Audience is NOT made for kids.');
