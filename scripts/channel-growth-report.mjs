// Free weekly growth dashboard for ModernMonk 90-day YPP push.
// Usage: node scripts/channel-growth-report.mjs
import 'dotenv/config';
import { google } from 'googleapis';

const auth = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const yt = google.youtube({ version: 'v3', auth });

const YPP_SUBS = 1000;
const YPP_SHORTS_90D = 10_000_000;
const YPP_WATCH_HOURS = 4000;

function parseDurationSec(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function classifyPillar(title = '') {
  const t = title.toLowerCase();
  if (/food|dish|spice|biryani|chicken|chai|curry|street|masala|pepper|cuisine|recipe|tandoor/.test(t)) return 'food';
  if (/sip|money|rbi|emi|invest|salary|tax|mutual|nifty|rupee|bank|ipo|wealth/.test(t)) return 'money';
  if (/battle|empire|king|history|fort|dynasty|mughal|war|kingdom|ancient/.test(t)) return 'history';
  if (/place|temple|travel|beach|valley|hidden|gem|goa|kerala|himalaya|landmark/.test(t)) return 'places';
  if (/quantum|black hole|einstein|spider|marvel|physics|paradox|zeigarnik/.test(t)) return 'off-brand-abstract';
  return 'other';
}

const chList = await yt.channels.list({
  part: ['snippet', 'statistics', 'status', 'contentDetails'],
  mine: true
});
const ch = chList.data.items?.[0];
if (!ch) throw new Error('No channel for this OAuth token');

const stats = ch.statistics;
const subs = Number(stats.subscriberCount || 0);
const views = Number(stats.viewCount || 0);
const videoCount = Number(stats.videoCount || 0);

const playlistId = ch.contentDetails.relatedPlaylists.uploads;
let pageToken;
const videoIds = [];
do {
  const pl = await yt.playlistItems.list({
    part: ['contentDetails'],
    playlistId,
    maxResults: 50,
    pageToken
  });
  for (const item of pl.data.items || []) videoIds.push(item.contentDetails.videoId);
  pageToken = pl.data.nextPageToken;
} while (pageToken && videoIds.length < 250);

const videos = [];
for (let i = 0; i < videoIds.length; i += 50) {
  const chunk = videoIds.slice(i, i + 50);
  const det = await yt.videos.list({
    part: ['snippet', 'statistics', 'status', 'contentDetails'],
    id: chunk
  });
  videos.push(...(det.data.items || []));
}

const now = Date.now();
const day90 = now - 90 * 86400000;
const day7 = now - 7 * 86400000;

let shortsViews90 = 0;
let shortsViews7 = 0;
let longViews90 = 0;
let publicShorts90 = 0;
const byPillar = {};
const recent7 = [];

for (const v of videos) {
  const published = new Date(v.snippet.publishedAt).getTime();
  const vCount = Number(v.statistics.viewCount || 0);
  const secs = parseDurationSec(v.contentDetails.duration);
  const isShort = secs > 0 && secs <= 60;
  const pillar = classifyPillar(v.snippet.title);
  byPillar[pillar] = byPillar[pillar] || { count: 0, views: 0 };
  byPillar[pillar].count++;
  byPillar[pillar].views += vCount;

  if (published >= day90) {
    if (isShort) {
      shortsViews90 += vCount;
      publicShorts90++;
    } else {
      longViews90 += vCount;
    }
  }
  if (published >= day7) {
    if (isShort) shortsViews7 += vCount;
    recent7.push({
      title: v.snippet.title.slice(0, 60),
      views: vCount,
      likes: Number(v.statistics.likeCount || 0),
      secs,
      pillar,
      privacy: v.status.privacyStatus,
      kids: v.status.madeForKids
    });
  }
}

recent7.sort((a, b) => b.views - a.views);
const topAll = [...videos]
  .sort((a, b) => Number(b.statistics.viewCount || 0) - Number(a.statistics.viewCount || 0))
  .slice(0, 8)
  .map((v) => ({
    title: v.snippet.title.slice(0, 55),
    views: Number(v.statistics.viewCount || 0),
    secs: parseDurationSec(v.contentDetails.duration),
    pillar: classifyPillar(v.snippet.title)
  }));

const subsLeft = Math.max(0, YPP_SUBS - subs);
const shortsLeft = Math.max(0, YPP_SHORTS_90D - shortsViews90);
const daysLeft = 90; // rolling window; directional only

console.log('══════════════════════════════════════════════════════');
console.log(' ModernMonk growth report —', new Date().toISOString().slice(0, 10));
console.log('══════════════════════════════════════════════════════');
console.log(`Channel: ${ch.snippet.title} (${ch.snippet.customUrl || ch.id})`);
console.log(`Kids flag: madeForKids=${ch.status?.madeForKids} selfDeclared=${ch.status?.selfDeclaredMadeForKids}`);
console.log(`Monetization enabled: ${ch.status?.isChannelMonetizationEnabled}`);
console.log('');
console.log('— Lifetime —');
console.log(`  Subscribers: ${subs}  (need ${YPP_SUBS} → ${subsLeft} left)`);
console.log(`  Views: ${views}`);
console.log(`  Videos: ${videoCount} (scanned ${videos.length})`);
console.log('');
console.log('— Rolling 90d Shorts path (YPP alt) —');
console.log(`  Shorts views (≤60s, last 90d): ${shortsViews90.toLocaleString()}`);
console.log(`  Need ~${YPP_SHORTS_90D.toLocaleString()} → ${shortsLeft.toLocaleString()} left`);
console.log(`  Public Shorts in window: ${publicShorts90}`);
console.log(`  Long views last 90d: ${longViews90}`);
console.log('');
console.log('— Last 7 days —');
console.log(`  Shorts views: ${shortsViews7}`);
console.log(`  Uploads: ${recent7.length}`);
console.log('  Top recent:');
for (const r of recent7.slice(0, 8)) {
  console.log(`    ${r.views}v | ${r.secs}s | ${r.pillar.padEnd(18)} | ${r.title}`);
}
console.log('');
console.log('— Pillar mix (all scanned) —');
for (const [pillar, data] of Object.entries(byPillar).sort((a, b) => b[1].views - a[1].views)) {
  const avg = data.count ? Math.round(data.views / data.count) : 0;
  console.log(`  ${pillar.padEnd(20)} n=${String(data.count).padStart(3)}  views=${String(data.views).padStart(6)}  avg=${avg}`);
}
console.log('');
console.log('— All-time top —');
for (const t of topAll) {
  console.log(`  ${t.views}v | ${t.secs}s | ${t.pillar.padEnd(18)} | ${t.title}`);
}
console.log('');
console.log('— Directional daily need (if chasing Shorts YPP in ~90d) —');
console.log(`  ~${Math.ceil(shortsLeft / daysLeft).toLocaleString()} Shorts views/day remaining (viral tail required)`);
console.log(`  OR focus subs: ~${Math.ceil(subsLeft / 90)} new subs/day + watch hours via long`);
console.log('══════════════════════════════════════════════════════');
