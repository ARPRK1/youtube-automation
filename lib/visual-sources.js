// Free contextual visual sources, tried in priority order per segment:
// 1. Pexels video (best — real motion b-roll), needs a free PEXELS_API_KEY
// 2. Pexels photo, same key
// 3. Openverse (no key — aggregates Flickr/museums under CC licenses)
// 4. Wikimedia Commons (no key — strong for heritage/history/culture)
// Both no-key sources are filtered to licenses that permit commercial use
// and derivatives (we crop/zoom the images), and we carry attribution
// through so it can be credited in the video description as required by
// most CC-BY-style licenses. Pexels' own license needs no attribution.

async function safeFetchJson(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const STOPWORDS = new Set(['this', 'that', 'with', 'from', 'india', 'indian', 'their', 'about', 'which', 'these', 'those']);

/** Free-text keyword search engines (Openverse/Wikimedia) can return
 * technically-licensed but topically unrelated results — a query for
 * "stock market trading floor" once matched a climate protest photo just
 * because "finance" appeared in its title. Require most of the query's
 * meaningful words to actually appear in the candidate's title before
 * accepting it; otherwise treat it as no match and let the caller fall
 * through to the next source (ultimately the generated gradient). */
function isRelevantTitle(query, title) {
  if (!title) return false;
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (words.length === 0) return true;
  const titleLower = title.toLowerCase();
  const matches = words.filter((w) => titleLower.includes(w)).length;
  // >=60% rather than a plain majority — a 4-word query matching on only
  // 2 generic words (e.g. "time" + "travel" out of "Virtual Reality Time
  // Travel") was enough to slip an unrelated WWII VR photo through at 50%.
  return matches >= Math.ceil(words.length * 0.6);
}

export async function searchPexelsVideo(query, aspect) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  const orientation = aspect === 'vertical' ? 'portrait' : 'landscape';
  const data = await safeFetchJson(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=1`,
    { headers: { Authorization: apiKey } }
  );
  const video = data?.videos?.[0];
  if (!video) return null;
  // Prefer a moderate-resolution HD file to keep downloads/renders fast.
  const files = (video.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.width);
  const target = files.find((f) => f.width >= 1280 && f.width <= 1920) || files.sort((a, b) => b.width - a.width)[0];
  if (!target) return null;
  return { type: 'video', url: target.link, credit: null };
}

export async function searchPexelsPhoto(query, aspect) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  const orientation = aspect === 'vertical' ? 'portrait' : 'landscape';
  const data = await safeFetchJson(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=1`,
    { headers: { Authorization: apiKey } }
  );
  const photo = data?.photos?.[0];
  if (!photo) return null;
  return { type: 'image', url: photo.src.large2x || photo.src.large, credit: null };
}

const OPENVERSE_LICENSE_OK = /^(cc0|pdm|by|by-sa)$/i;

export async function searchOpenverseImage(query) {
  const data = await safeFetchJson(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&mature=false&page_size=10`
  );
  const candidates = (data?.results || []).filter((r) => r.url && OPENVERSE_LICENSE_OK.test(r.license || ''));
  const pick = candidates.find((r) => isRelevantTitle(query, r.title));
  if (!pick) return null;
  return {
    type: 'image',
    url: pick.url,
    credit: `"${pick.title || query}" by ${pick.creator || 'unknown'} (CC ${String(pick.license).toUpperCase()} ${pick.license_version || ''}) via Openverse`.trim()
  };
}

const WIKIMEDIA_LICENSE_OK = /(cc0|cc[\s-]?by(?!.*nc)(?!.*nd)|public domain)/i;

export async function searchWikimediaImage(query) {
  const data = await safeFetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=1920`
  );
  const pages = Object.values(data?.query?.pages || {});
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl) continue;
    if (!isRelevantTitle(query, page.title)) continue;
    const license = info.extmetadata?.LicenseShortName?.value || '';
    if (!WIKIMEDIA_LICENSE_OK.test(license)) continue;
    const artist = (info.extmetadata?.Artist?.value || 'unknown').replace(/<[^>]+>/g, '').trim();
    return {
      type: 'image',
      url: info.thumburl,
      credit: `"${page.title.replace(/^File:/, '')}" by ${artist} (${license}) via Wikimedia Commons`
    };
  }
  return null;
}

/** Tries all sources in priority order for one segment query. Returns
 * { type, url, credit } or null if nothing usable was found anywhere
 * (caller falls back to a generated gradient). */
export async function fetchVisualAsset(query, aspect) {
  const attempts = [
    () => searchPexelsVideo(query, aspect),
    () => searchPexelsPhoto(query, aspect),
    () => searchOpenverseImage(query),
    () => searchWikimediaImage(query)
  ];
  for (const attempt of attempts) {
    const result = await attempt().catch(() => null);
    if (result) return result;
  }
  return null;
}
