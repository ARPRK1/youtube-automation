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
import { NICHE_BY_WEEKDAY } from '../niches.js';
import { nicheBoostForTitle, pickGrowthNicheForDay, isOffBrandTopic } from './growth.js';

/** Curated, substantial evergreen topics (still in niches.js from the
 * earlier day-of-week build) as ADDITIONAL candidates every run, not just
 * an emergency fallback -- live trending days can be genuinely thin (a
 * chess player name, a single day's gold price, a lottery result), and
 * real production testing showed the scorer correctly marking those low
 * but still picking them when nothing else was on offer, then failing at
 * the script stage for lack of real substance. Letting these compete in
 * the same scoring pass means a well-formed evergreen topic naturally
 * outranks a thin trending one instead of needing a brittle score cutoff. */
/** `pillarId` scopes the pool to only niches.js entries tagged for that
 * pillar (see niches.js's pillarId field) -- without this, a forced niche
 * (orchestrator.js's --niche= flag) still had every OTHER pillar's fallback
 * topics competing in the same scoring pass, and the scorer only "prefers"
 * the forced pillar rather than being restricted to it. Confirmed live
 * 2026-07-25: 3 separate runs forced to 3 different pillars (physics,
 * history, daily-hack) all landed on the exact same physics fallback-bank
 * topic, because it's a deterministic day-of-year pick that was in every
 * pool regardless of which pillar was supposedly preferred. */
function allFallbackTopics(pillarId = null) {
  const topics = [];
  for (const niche of Object.values(NICHE_BY_WEEKDAY)) {
    if (pillarId && niche.pillarId !== pillarId) continue;
    for (const t of niche.fallbackTopics || []) topics.push(t);
  }
  return topics;
}

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
    // India region — channel is India-stories again (2026-08-04 revert).
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
  // Safety + growth: drop policy-risk content AND proven dead abstract topics
  // that wrecked reach after the 2026-07-24 physics/AI pivot.
  return HARD_EXCLUDE_PATTERN.test(title) || isOffBrandTopic(title);
}

function normalizeWords(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3);
}

/** Fuzzy repeat check: >45% word overlap with something covered in the
 * last `avoidDays` days counts as a repeat, not just an exact match.
 * Tightened 2026-08-12 after post-pivot re-uploads of near-identical
 * titles ("Lawsuit Over Dish", "Tandoor Goes Global", biryani spam). */
function isRepeat(title, history, avoidDays) {
  const cutoff = Date.now() - avoidDays * 86400000;
  const words = new Set(normalizeWords(title));
  if (words.size === 0) return false;
  const titleNorm = String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const entry of history) {
    if (new Date(entry.date).getTime() < cutoff) continue;
    const entryTopic = String(entry.topic || '');
    const entryNorm = entryTopic.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // Exact / near-exact title reuse
    if (entryNorm && (entryNorm === titleNorm || entryNorm.includes(titleNorm) || titleNorm.includes(entryNorm))) {
      if (Math.min(entryNorm.length, titleNorm.length) >= 12) return true;
    }
    const entryWords = normalizeWords(entryTopic);
    if (entryWords.length === 0) continue;
    const overlap = entryWords.filter((w) => words.has(w)).length;
    if (overlap / Math.max(entryWords.length, words.size) > 0.45) return true;
  }
  return false;
}

async function scoreCandidates(candidates, forceNicheId = null) {
  const list = candidates.map((c, i) => `${i}. ${c.title}`).join('\n');
  const growthNiche = pickGrowthNicheForDay(new Date(), forceNicheId);
  const prompt = `You are a YouTube growth strategist for ModernMonk — an India-focused Shorts-first channel aiming for monetization in 90 days. Preferred pillars (BOOST these hard): Indian food origin stories (highest weight — proven 1k+ view winners), simple Indian money habits, India history with a twist, hidden India places. Today's preferred pillar: ${growthNiche.name} (${growthNiche.why}).
The channel runs fully automatically with NO human review before publishing, so it must never pick anything that needs editorial judgment calls.

POSITIONING: punchy, specific India stories a mobile IN audience will finish and share. Prefer a named dish, rupee amount, battle, city, or RBI decision over abstract theory. REJECT / score near 0: quantum physics, black holes, Spider-Man/Marvel, generic productivity science, China five-year plans, and other off-brand abstract explainer topics that already failed on this channel (0–67 views).

For each candidate below, first decide "sensitive": true if it involves any of: crime victims or the accused by name, sexual abuse/assault, self-harm/suicide, death/tragedy/disaster with real casualties, terrorism, minors in any crime or abuse context, or anything that would be tasteless or legally risky to cover in a punchy, casual, monetized video with no human review. When in doubt, mark it sensitive.

Also mark "sensitive": true for gambling/lottery-result content even though it's not violent.

For everything NOT sensitive, score 0-10 for Shorts growth, weighing:
- Fit to food / money / India-history / places pillars (score these much higher)
- Specific named entity (dish, place, person, policy) vs vague abstract concept
- Pattern-interrupt hook potential in the first second of a 30s Short
- Evergreen share potential for Indian mobile audience
- SUBSTANCE: enough for 3 distinct Short angles + one 6–12 min long if needed. Thin one-fact topics score low.

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
 *
 * `excludeTitles` (a Set of lowercased titles) lets the orchestrator ask
 * for a genuinely different topic after the day's first pick turned out
 * to lack real substance -- both long scripts failing from repetition on
 * the SAME topic is strong evidence the topic itself is thin, not that
 * generation got unlucky twice, and retrying script generation on the
 * exact same limited fact pool a third time is very unlikely to help. See
 * orchestrator.js's backup-topic retry.
 *
 * `forceNicheId` (from orchestrator.js's --niche= flag) pins both the
 * candidate-seeding hooks below and the scoring prompt's preferred pillar
 * to one specific pillar id for this run, instead of the date-keyed
 * rotation -- for a same-day retry that needs a different pillar than
 * whatever already ran earlier that day.
 */
export async function researchTodaysTopic(date = new Date(), { excludeTitles, forceNicheId } = {}) {
  const config = loadConfig();
  const dateStr = date.toISOString().slice(0, 10);
  const runDir = path.join(config.paths?.runs_dir || 'runs', dateStr);
  await mkdir(runDir, { recursive: true });

  // 2026-08-04: India trends re-enabled — channel is India-stories again.
  // Off-brand/abstract noise is stripped by isHardExcluded / isOffBrandTopic.
  const wantIndiaTrends = config.topics?.sources?.google_trends_india === true;
  const wantYoutube = config.topics?.sources?.youtube_trending === true;
  const [trends, ytTrending] = await Promise.all([
    wantIndiaTrends ? fetchIndiaTrendingNow(15).catch(() => []) : Promise.resolve([]),
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

  // Growth-focused evergreen bank dominates the pool so food/money/history
  // always outnumber noisy headlines. Seed ALL hooks from preferred pillar
  // plus a large fallback slice — live data showed abstract trending noise
  // outscored thin banks when banks were only 4 hooks + 10 fallbacks.
  const growthNiche = pickGrowthNicheForDay(date, forceNicheId);
  const fallbackPool = allFallbackTopics(forceNicheId || null);
  const dayOfYear = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  for (const hook of (growthNiche.hooks || [])) {
    const title = hook;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    candidates.push({ title, rawSource: 'growth-pillar', growthNiche: growthNiche.id });
  }
  // Prefer today's pillar fallbacks first, then cross-pillar bank.
  const pillarFirst = allFallbackTopics(growthNiche.id);
  const mixedPool = pillarFirst.length > 0 ? [...pillarFirst, ...fallbackPool] : fallbackPool;
  for (let i = 0; i < 16 && mixedPool.length > 0; i++) {
    const title = mixedPool[(dayOfYear + i) % mixedPool.length];
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    candidates.push({ title, rawSource: 'fallback-bank' });
  }

  if (candidates.length === 0) {
    throw new Error('No trending candidates found from any source -- cannot research a topic today');
  }

  const history = await loadHistory(config);
  const avoidDays = config.topics?.avoid_repeat_days ?? 30;

  const scored = await scoreCandidates(candidates, forceNicheId);
  for (const s of scored) if (s.sensitive && candidates[s.index]) excludedForSafety.push(candidates[s.index].title);
  const excluded = excludeTitles instanceof Set ? excludeTitles : new Set();
  const ranked = scored
    .filter((s) => candidates[s.index] && !s.sensitive)
    .map((s) => {
      const base = { ...candidates[s.index], score: Number(s.score) || 0, reason: s.reason };
      // Deterministic boost toward niches that already produced 500–1k+ views
      // on this channel (food origin Shorts dominate the audit).
      const boost = nicheBoostForTitle(base.title);
      return { ...base, score: base.score + boost, nicheBoost: boost };
    })
    .filter((c) => !isRepeat(c.title, history, avoidDays))
    .filter((c) => !excluded.has(c.title.toLowerCase()))
    .sort((a, b) => b.score - a.score);

  if (excludedForSafety.length > 0) {
    console.log(`[research] excluded ${excludedForSafety.length} sensitive candidate(s): ${excludedForSafety.join('; ')}`);
  }

  if (ranked.length === 0) {
    throw new Error('All candidate topics were filtered out as recent repeats or sensitive-content exclusions -- check sources or widen topics.avoid_repeat_days in config.yaml');
  }

  // Prefer a candidate with real corroborating news coverage (facts we can
  // cite); fall back to the top-ranked one even if coverage is thin rather
  // than blocking the whole run. Threshold raised from >=2 to >=4: a
  // script needs to reach 950-1900 words citing only these facts plus
  // general knowledge, and 2 headlines routinely wasn't enough real
  // material -- confirmed live as the dominant cause of "narration keeps
  // repeating itself" failures (both long-script attempts fail the same
  // way since they draw on the same thin fact pool, so more generation
  // retries don't help; the topic itself needs to be more substantial).
  let winner = null;
  let headlines = [];
  let bestChecked = null; // best-supported candidate seen so far, even if under the bar
  let bestCheckedHeadlines = [];
  for (const candidate of ranked.slice(0, 8)) {
    const found = await fetchGoogleNewsHeadlines(candidate.title, 5).catch(() => []);
    // Use >= so the first candidate is always recorded even when it has 0
    // headlines. The previous `>` check left bestChecked null when every
    // candidate returned an empty result set (confirmed live: TypeError
    // reading winner.title after Google News returned nothing for all 8).
    if (!bestChecked || found.length > bestCheckedHeadlines.length) {
      bestChecked = candidate;
      bestCheckedHeadlines = found;
    }
    if (found.length >= 4) {
      winner = candidate;
      headlines = found;
      break;
    }
  }
  if (!winner) {
    // Nothing hit the substantial bar -- take the best-supported of what
    // was actually checked rather than gambling on an unchecked candidate
    // or re-fetching one already tried in the loop above. ranked is
    // guaranteed non-empty above; bestChecked should always be set after
    // the loop, but fall back to ranked[0] so a future logic slip never
    // hard-crashes the whole daily run again.
    winner = bestChecked || ranked[0];
    headlines = bestChecked ? bestCheckedHeadlines : [];
    if (!bestChecked) {
      console.warn(`[research] coverage check left bestChecked unset -- falling back to top-ranked "${winner.title}"`);
    } else if (headlines.length === 0) {
      console.warn(`[research] no corroborating headlines for any of the top candidates -- proceeding with "${winner.title}" on thin coverage`);
    }
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
