// Unlist dead/off-brand videos so the channel face is curiosity-first.
// Does NOT delete (reversible). Protects videos with views >= PROTECT_VIEWS.
// Usage: node scripts/unlist-slop.mjs [--dry-run]
import 'dotenv/config';
import { google } from 'googleapis';

const DRY = process.argv.includes('--dry-run');
const PROTECT_VIEWS = 300;

const auth = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const yt = google.youtube({ version: 'v3', auth });

function parseSec(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

function reasonsFor(title, views, secs) {
  const t = title.toLowerCase();
  const r = [];
  if (/spider[\s-]?man|marvel|mcu|mephisto/.test(t)) r.push('marvel');
  if (/quantum|black hole|einstein|zeigarnik|mechanistic|catastrophic forgetting|five[\s-]?year plan|bitter lesson|attention residue/.test(t)) r.push('dead-abstract');
  if (/\bai\b|machine learning|neural|llm|chatgpt|ai forgetting|ai decision|ai magic|ai brain|ai start|ai limit|ai explained|ml mistake|ml secret/.test(t) && views < 150) r.push('dead-ai-lecture');
  if (/wealth (myth|gap|transfer|creation|disparity)|gen z wealth|self made|bank statement|sip mistake|rich vs wealthy|wealth drain/.test(t) && views < 150) r.push('dead-money');
  if (/bollywood|cricket|india wins|shreyas|nolan|pixel 11|super series|nfl/.test(t) && views < 100) r.push('off-identity-noise');
  if (secs > 0 && secs < 18 && views < 100) r.push('stub-short');
  if (views <= 8 && secs <= 180) r.push('near-zero');
  // Duplicate-looking generic titles with no traction
  if (/^(ai explained|physics breakthroughs|globalization of food|tandoor goes global|lawsuit over dish)\b/i.test(title) && views < 50) r.push('generic-dupe');
  return r;
}

const ch = await yt.channels.list({ part: ['contentDetails'], mine: true });
const uploadsId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
const ids = [];
let pageToken;
do {
  const pl = await yt.playlistItems.list({
    part: ['contentDetails', 'snippet'],
    playlistId: uploadsId,
    maxResults: 50,
    pageToken
  });
  for (const i of pl.data.items || []) {
    ids.push({ id: i.contentDetails.videoId, title: i.snippet.title });
  }
  pageToken = pl.data.nextPageToken;
} while (pageToken);

const videos = [];
for (let i = 0; i < ids.length; i += 50) {
  const det = await yt.videos.list({
    part: ['statistics', 'snippet', 'contentDetails', 'status'],
    id: ids.slice(i, i + 50).map((x) => x.id)
  });
  videos.push(...(det.data.items || []));
}

const toUnlist = [];
const protected_ = [];
for (const v of videos) {
  if (v.status.privacyStatus !== 'public') continue;
  const views = Number(v.statistics.viewCount || 0);
  const secs = parseSec(v.contentDetails.duration);
  const reasons = reasonsFor(v.snippet.title, views, secs);
  if (!reasons.length) continue;
  if (views >= PROTECT_VIEWS) {
    protected_.push({ title: v.snippet.title.slice(0, 50), views, reasons });
    continue;
  }
  // Need a strong reason: not only near-zero for recent food winners path
  const strong = reasons.some((r) =>
    ['marvel', 'dead-abstract', 'dead-ai-lecture', 'dead-money', 'off-identity-noise', 'stub-short', 'generic-dupe'].includes(r)
  );
  if (!strong && views > 5) continue;
  toUnlist.push({
    id: v.id,
    title: v.snippet.title,
    views,
    secs,
    reasons,
    privacy: v.status.privacyStatus,
    madeForKids: v.status.selfDeclaredMadeForKids
  });
}

console.log(`Candidates to unlist: ${toUnlist.length} (protected high-view: ${protected_.length})`);
if (DRY) {
  for (const v of toUnlist) {
    console.log(`[dry] ${v.views}v ${v.secs}s [${v.reasons.join(',')}] ${v.title.slice(0, 60)}`);
  }
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const v of toUnlist) {
  try {
    await yt.videos.update({
      part: ['status'],
      requestBody: {
        id: v.id,
        status: {
          privacyStatus: 'unlisted',
          selfDeclaredMadeForKids: false,
          embeddable: true
        }
      }
    });
    ok++;
    console.log(`UNLISTED ${v.views}v [${v.reasons.join(',')}] ${v.title.slice(0, 55)}`);
    await new Promise((r) => setTimeout(r, 200));
  } catch (err) {
    fail++;
    console.warn(`FAIL ${v.id}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log(`\nDone. Unlisted ${ok}, failed ${fail}. Channel face cleaned.`);
