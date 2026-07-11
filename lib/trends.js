import { XMLParser } from 'fast-xml-parser';
import { pickFallbackTopic, pickSearchQuery } from '../niches.js';

const parser = new XMLParser({ ignoreAttributes: false });

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Live headlines (especially sports live-score tickers) can be long,
 * pipe-delimited scoreboard strings rather than a clean topic sentence.
 * Truncate at a word boundary so it stays usable as an LLM prompt seed. */
export function sanitizeTopic(title, maxLen = 140) {
  const cleaned = String(title).split('|')[0].trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).replace(/\s+\S*$/, '')}...`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchXml(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; youtube-automation/1.0)' } });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    return parser.parse(await res.text());
  } catch (err) {
    if (attempt >= 2) throw err;
    await sleep(1000);
    return fetchXml(url, attempt + 1);
  }
}

/** Google News RSS search — free, no API key, real current English headlines. */
export async function fetchGoogleNewsHeadlines(query, limit = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const data = await fetchXml(url);
  const items = asArray(data?.rss?.channel?.item).slice(0, limit);
  return items.map((item) => {
    // Google News titles are "Headline - Source"; split off the source.
    const raw = String(item.title ?? '').trim();
    const m = raw.match(/^(.*)\s-\s([^-]+)$/);
    return {
      title: m ? m[1].trim() : raw,
      source: m ? m[2].trim() : undefined,
      link: item.link,
      pubDate: item.pubDate
    };
  }).filter((h) => h.title);
}

/** Google's "Trending Now" daily RSS for India — real trending searches with
 * approx traffic and related news items. Mixed languages (regional Indian
 * languages included), so we only use items that carry an English-looking
 * news headline. Free, no API key. */
export async function fetchIndiaTrendingNow(limit = 8) {
  const url = 'https://trends.google.com/trending/rss?geo=IN';
  const data = await fetchXml(url);
  const items = asArray(data?.rss?.channel?.item);
  const isAscii = (s) => /^[\x00-\x7F\s.,'"!?:;()&-]+$/.test(s || '');

  const results = [];
  for (const item of items) {
    const newsItems = asArray(item['ht:news_item']);
    const englishNews = newsItems.find((n) => isAscii(n['ht:news_item_title']));
    const title = isAscii(item.title) ? item.title : englishNews?.['ht:news_item_title'];
    if (!title) continue;
    results.push({
      title: String(title).trim(),
      approxTraffic: item['ht:approx_traffic'],
      source: englishNews?.['ht:news_item_source'],
      link: englishNews?.['ht:news_item_url']
    });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Picks today's topic for a niche, preferring a real live trend/news signal
 * over the static fallback bank. Never throws — always returns something
 * usable, falling back to the curated topic bank on any network/parse
 * failure so a bad day for Google's RSS feeds can't block the whole job.
 *
 * Returns { topic, context: string[], source: 'google-news'|'google-trends'|'fallback-bank' }
 */
export async function pickTrendingTopic(niche, date = new Date(), offset = 0) {
  try {
    if (niche.region === 'IN-trending') {
      const trends = await fetchIndiaTrendingNow(8);
      const pick = trends[offset % Math.max(trends.length, 1)];
      if (pick) {
        return {
          topic: sanitizeTopic(pick.title),
          context: trends.slice(0, 5).map((t) => `${t.title}${t.source ? ` (${t.source})` : ''}`),
          source: 'google-trends'
        };
      }
    } else {
      const query = pickSearchQuery(niche, date, offset);
      const headlines = await fetchGoogleNewsHeadlines(query, 6);
      if (headlines.length > 0) {
        return {
          topic: sanitizeTopic(headlines[0].title),
          context: headlines.map((h) => `${h.title}${h.source ? ` (${h.source})` : ''}`),
          source: 'google-news'
        };
      }
    }
  } catch (err) {
    console.warn(`[trends] live trend lookup failed, using fallback topic bank: ${err.message}`);
  }

  return {
    topic: pickFallbackTopic(niche, date, offset),
    context: [],
    source: 'fallback-bank'
  };
}
