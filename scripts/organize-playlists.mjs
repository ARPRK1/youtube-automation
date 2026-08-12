// Create and fill ModernMonk playlists from existing uploads.
// Buckets: Food Origins | Money & Finance | Science & AI | History Twists | Curiosity Facts
// Usage: node scripts/organize-playlists.mjs
import 'dotenv/config';
import { google } from 'googleapis';
import { classifyVideoPlaylist } from '../lib/growth.js';

const auth = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
const yt = google.youtube({ version: 'v3', auth });

const PLAYLIST_DEFS = [
  {
    key: 'food',
    title: 'Food Origins',
    description: 'Origin stories, street food secrets, and dishes that rewrote history. From ModernMonk.'
  },
  {
    key: 'finance',
    title: 'Money & Finance',
    description: 'Simple money habits, SIPs, and wealth myths — archived from early ModernMonk uploads.'
  },
  {
    key: 'science-ai',
    title: 'Science & AI',
    description: 'Physics curiosities, AI explainers, and mind-bending science Shorts.'
  },
  {
    key: 'history',
    title: 'History Twists',
    description: 'One-decision history moments, forgotten battles, and map stories.'
  },
  {
    key: 'curiosity',
    title: 'Curiosity Facts',
    description: 'World facts, Top 5s, riddles, and shareable "wait, what?" Shorts. The main ModernMonk shelf.'
  }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listMinePlaylists() {
  const out = [];
  let pageToken;
  do {
    const res = await yt.playlists.list({
      part: ['snippet', 'contentDetails'],
      mine: true,
      maxResults: 50,
      pageToken
    });
    out.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function ensurePlaylists() {
  const existing = await listMinePlaylists();
  const byTitle = new Map(existing.map((p) => [p.snippet.title.toLowerCase(), p]));
  const map = {};
  for (const def of PLAYLIST_DEFS) {
    const hit = byTitle.get(def.title.toLowerCase());
    if (hit) {
      map[def.key] = hit.id;
      console.log(`Playlist exists: ${def.title} (${hit.id})`);
      continue;
    }
    const created = await yt.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: def.title,
          description: def.description
        },
        status: { privacyStatus: 'public' }
      }
    });
    map[def.key] = created.data.id;
    console.log(`Created playlist: ${def.title} (${created.data.id})`);
    await sleep(400);
  }
  return map;
}

async function listAllUploads() {
  const ch = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const playlistId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
  const ids = [];
  let pageToken;
  do {
    const pl = await yt.playlistItems.list({
      part: ['contentDetails', 'snippet'],
      playlistId,
      maxResults: 50,
      pageToken
    });
    for (const item of pl.data.items || []) {
      ids.push({
        id: item.contentDetails.videoId,
        title: item.snippet.title
      });
    }
    pageToken = pl.data.nextPageToken;
  } while (pageToken);
  return ids;
}

async function listPlaylistVideoIds(playlistId) {
  const set = new Set();
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: ['contentDetails'],
      playlistId,
      maxResults: 50,
      pageToken
    });
    for (const item of res.data.items || []) set.add(item.contentDetails.videoId);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return set;
}

async function main() {
  console.log('=== Organize ModernMonk playlists ===');
  const playlistIds = await ensurePlaylists();

  // Cache existing members so we don't re-insert (saves quota + avoids 409 noise)
  const existingMembers = {};
  for (const [key, id] of Object.entries(playlistIds)) {
    existingMembers[key] = await listPlaylistVideoIds(id);
    console.log(`  ${key}: already has ${existingMembers[key].size} items`);
  }

  const uploads = await listAllUploads();
  console.log(`\nScanning ${uploads.length} uploads…`);

  const counts = { food: 0, finance: 0, 'science-ai': 0, history: 0, curiosity: 0, skipped: 0, errors: 0 };

  for (const v of uploads) {
    const bucket = classifyVideoPlaylist(v.title);
    const plId = playlistIds[bucket];
    if (!plId) {
      counts.skipped++;
      continue;
    }
    if (existingMembers[bucket]?.has(v.id)) {
      counts.skipped++;
      continue;
    }
    try {
      await yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId: plId,
            resourceId: { kind: 'youtube#video', videoId: v.id }
          }
        }
      });
      existingMembers[bucket].add(v.id);
      counts[bucket]++;
      console.log(`+ [${bucket}] ${v.title.slice(0, 60)}`);
      await sleep(250); // soft rate limit
    } catch (err) {
      counts.errors++;
      console.warn(`! failed ${v.id}: ${err.message}`);
      await sleep(800);
    }
  }

  console.log('\n=== Done ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log('\nPlaylist IDs:', playlistIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
