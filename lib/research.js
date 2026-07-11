// Stage 1: picks today's topic from free, live sources — fully
// topic-agnostic (no fixed subject per day), scored for YouTube potential,
// checked against recent history so topics don't repeat, and written to
// runs/<date>/research.md with real source URLs for every fact so the
// script writer has something to trace claims back to instead of
// inventing them.

import { google } from 'googleapis';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOAuthClient, hasYoutubeCredentials } from './youtube-upload.js';
import { fetchIndiaTrendingNow, fetchGoogleNewsHeadlines, sanitizeTopic } from './trends.js';
import { callFreeLLM, extractJson } from './llm.js';
import { loadConfig } from './config.js';

function historyPath(config) {
  return path.join(config.paths?.runs_dir || 'runs', 'topic-history.json');
}

/** YouTube's own trending list -- cheap on quota (videos.list is 1 unit,
 * nothing like the 1,600-unit upload cost) and reuses the same OAuth
 * credentials already set up for uploading, so no separate API key. */
async function fetchYoutubeTrending(limit = 15) {
  if (!hasYoutubeCredentials()) return [];
  try {
    const auth = getOAuthClient();
    const youtube = google.youtube({ version: 'v3', auth });
    const res = await youtube.videos.list({ part: ['snippet'], chart: 'mostPopular', regionCode: 'IN', maxResults: limit });
    return (res.data.items || []).map((v) => ({ title: v.snippet.title, channelTitle: v.snippet.channelTitle }));
  } catch (err) {
    console.warn(`[research] YouTube trending fetch failed: ${err.message}`);
    return [];
  }
}

async function loadHistory(config) {
  try {
    return JSON.parse(await readFile(historyPath(config), 'utf-8'));
  } catch {
    return [];
  }
}

async function saveHistory(config, history) {
  await mkdir(config.paths?.runs_dir || 'runs', { recursive: true });
  const trimmed = history.filter((h) => Date.now() - new Date(h.date).getTime() < 90 * 86400000);
  await writeFile(historyPath(config), JSON.stringify(trimmed, null, 2), 'utf-8');
  return trimmed;
}

/** Hard, deterministic pre-filter for the most severe categories -- checked
 * before a topic ever reaches LLM scoring, so it can't slip through on a
 * bad judgment call. This is a safety net, not the only check: the LLM
 * scoring prompt also flags subtler sensitive cases (see scoreCandidates). */
const HARD_EXCLUDE_PATTERN = /\b(rape|pocso|child (?:abuse|sexual)|molest|suicide|self[\s-]?harm|terroris|mass shoot|bomb blast|lynching|honour killing|femicide|acid attack|lottery|satta|matka|betting odds)\b/i;

function isHardExcluded(title) {
  return HARD_EXCLUDE_PATTERN.test(title);
}

function normalizeWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3);
}

/** Fuzzy repeat check: >50% word overlap with something covered in the
 * last `avoidDays` days counts as a repeat, not just an exact match. */
function isRepeat(title, history, avoidDays) {
  const cutoff = Date.now() - avoidDays * 86400000;
  const words = new Set(normalizeWords(title));
  if (words.size === 0) return false;
  for (const entry of history) {
    if (new Date(entry.date).getTime() < cutoff) continue;
    const entryWords = normalizeWords(entry.topic);
    if (entryWords.length === 0) continue;
    const overlap = entryWords.filter((w) => words.has(w)).length;
    if (overlap / Math.max(entryWords.length, words.size) > 0.5) return true;
  }
  return false;
}

async function scoreCandidates(candidates) {
  const list = candidates.map((c, i) => `${i}. ${c.title}`).join('\n');
  const prompt = `You are a YouTube content strategist picking today's best topic for a general-interest Indian YouTube channel making both long-form (5-15 min) and Shorts videos. This channel runs fully automatically with NO human review before publishing, so it must never pick anything that needs editorial judgment calls.

For each candidate below, first decide "sensitive": true if it involves any of: crime victims or the accused by name, sexual abuse/assault, self-harm/suicide, death/tragedy/disaster with real casualties, terrorism, minors in any crime or abuse context, or anything that would be tasteless or legally risky to cover in a punchy, casual, monetized video with no human review. When in doubt, mark it sensitive -- being overly cautious here is fine, missing a genuinely bad case is not.

Also mark "sensitive": true for gambling/lottery-result content (promotional/normalizing gambling is a policy risk) even though it's not violent or tragic.

For everything NOT sensitive, score 0-10 on overall potential for a genuinely good video, weighing:
- How VISUAL it is: can real photos/footage or a sensible illustration actually represent it, versus an abstract topic with nothing to show
- Evergreen potential: will this still get searched in a few weeks, versus 24-hour news that dies immediately
- General audience appeal as a video hook
- SUBSTANCE: is there enough real depth/nuance/history/controversy/detail to fill 5-15 minutes of genuinely non-repetitive content, or is this actually a thin, one-fact topic (like a single day's routine result/score/number) that a script would have to pad and repeat itself to reach length? Score thin topics low regardless of how visual or trendy they are.

Candidates:
${list}

Return ONLY a JSON array, no other text, one entry per candidate in the same order as given:
[{"index": 0, "sensitive": false, "score": 7, "reason": "one short sentence why"}]
(for sensitive candidates, still include the entry with "sensitive": true and "score": 0)`;

  const raw = await callFreeLLM(prompt, 2500);
  return extractJson(raw);
}

/**
 * Runs Stage 1 end to end: gather candidates -> score -> filter repeats ->
 * pick the best-supported winner -> write research.md -> update history.
 * Returns { date, topic, score, reason, source, facts, allCandidates }.
 */
export async function researchTodaysTopic(date = new Date()) {
  const config = loadConfig();
  const dateStr = date.toISOString().slice(0, 10);
  const runDir = path.join(config.paths?.runs_dir || 'runs', dateStr);
  await mkdir(runDir, { recursive: true });

  const wantYoutube = config.topics?.sources?.youtube_trending !== false;
  const [trends, ytTrending] = await Promise.all([
    fetchIndiaTrendingNow(15).catch(() => []),
    wantYoutube ? fetchYoutubeTrending(15) : Promise.resolve([])
  ]);

  const seen = new Set();
  const candidates = [];
  const excludedForSafety = [];
  for (const t of trends) {
    const title = sanitizeTopic(t.title);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    if (isHardExcluded(title)) { excludedForSafety.push(title); continue; }
    candidates.push({ title, rawSource: 'google-trends' });
  }
  for (const v of ytTrending) {
    const title = sanitizeTopic(v.title);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    if (isHardExcluded(title)) { excludedForSafety.push(title); continue; }
    candidates.push({ title, rawSource: 'youtube-trending', channel: v.channelTitle });
  }

  if (candidates.length === 0) {
    throw new Error('No trending candidates found from any source -- cannot research a topic today');
  }

  const history = await loadHistory(config);
  const avoidDays = config.topics?.avoid_repeat_days ?? 30;

  const scored = await scoreCandidates(candidates);
  for (const s of scored) if (s.sensitive && candidates[s.index]) excludedForSafety.push(candidates[s.index].title);
  const ranked = scored
    .filter((s) => candidates[s.index] && !s.sensitive)
    .map((s) => ({ ...candidates[s.index], score: s.score, reason: s.reason }))
    .filter((c) => !isRepeat(c.title, history, avoidDays))
    .sort((a, b) => b.score - a.score);

  if (excludedForSafety.length > 0) {
    console.log(`[research] excluded ${excludedForSafety.length} sensitive candidate(s): ${excludedForSafety.join('; ')}`);
  }

  if (ranked.length === 0) {
    throw new Error('All candidate topics were filtered out as recent repeats or sensitive-content exclusions -- check sources or widen topics.avoid_repeat_days in config.yaml');
  }

  // Prefer a candidate with real corroborating news coverage (facts we can
  // cite); fall back to the top-ranked one even if coverage is thin rather
  // than blocking the whole run.
  let winner = null;
  let headlines = [];
  for (const candidate of ranked.slice(0, 5)) {
    const found = await fetchGoogleNewsHeadlines(candidate.title, 5).catch(() => []);
    if (found.length >= 2) {
      winner = candidate;
      headlines = found;
      break;
    }
  }
  if (!winner) {
    winner = ranked[0];
    headlines = await fetchGoogleNewsHeadlines(winner.title, 5).catch(() => []);
  }

  const research = {
    date: dateStr,
    topic: winner.title,
    score: winner.score,
    reason: winner.reason,
    source: winner.rawSource,
    facts: headlines.map((h) => ({ text: h.title, source: h.source, url: h.link })),
    allCandidates: ranked.map((c) => ({ title: c.title, score: c.score })),
    excludedForSafety
  };

  const md = [
    `# Research: ${research.topic}`,
    '',
    `**Date:** ${dateStr}`,
    `**Chosen from:** ${research.source}`,
    `**Score:** ${research.score}/10 — ${research.reason}`,
    '',
    '## Key facts (source of truth for the script — every claim in the script must trace back to one of these)',
    '',
    ...(research.facts.length > 0
      ? research.facts.map((f) => `- ${f.text}${f.source ? ` (${f.source})` : ''}\n  ${f.url || ''}`)
      : ['- (No corroborating news coverage found — script must stick to only what the topic title itself states.)']),
    '',
    '## Other candidates considered today',
    '',
    ...research.allCandidates.slice(0, 10).map((c) => `- [${c.score}/10] ${c.title}`),
    '',
    ...(excludedForSafety.length > 0 ? ['## Excluded as sensitive/inappropriate for an unsupervised channel', '', ...excludedForSafety.map((t) => `- ${t}`)] : [])
  ].join('\n');

  await writeFile(path.join(runDir, 'research.md'), md, 'utf-8');

  history.push({ topic: research.topic, date: dateStr });
  await saveHistory(config, history);

  return research;
}
