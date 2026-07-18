// Free real-media sources, tried in priority order per entity (real media
// is always preferred over AI generation — see lib/media-sourcing.js for
// the full chain including the AI fallback):
// 1. Wikimedia Commons (no key — best for named people, places, landmarks,
//    historical events; strong license metadata)
// 2. Pexels photo/video (needs free PEXELS_API_KEY) and Pixabay photo/video
//    (needs free PIXABAY_API_KEY) — best for generic b-roll: cities,
//    nature, crowds, technology, lifestyle. No attribution required.
// 3. Openverse (no key — aggregates Flickr/museum collections and other
//    public-domain sources under CC licenses)
//
// Each search function returns up to N candidates (not just one) so the
// caller (lib/media-sourcing.js) can vision-verify each and move to the
// next candidate — or the next source entirely — on a mismatch, instead
// of committing to the first technically-licensed result.

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

/** Two-or-more consecutive capitalized words practically only happens for
 * real proper nouns (people, movies, teams, places) — plain sentence case
 * only auto-capitalizes the first word. AI image models generally cannot
 * render a specific real person's likeness accurately, so entities that
 * name someone/something specific are better served by a real photo
 * search than by AI generation. */
export function extractNamedEntities(text) {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  return [...new Set(matches)];
}

export function looksLikeNamedEntity(text) {
  return extractNamedEntities(text).length > 0;
}

/** Free-text keyword search engines can return technically-licensed but
 * topically unrelated results — a query for "stock market trading floor"
 * once matched a climate-protest photo just because "finance" appeared in
 * its title. Require most of the query's meaningful words to actually
 * appear in the candidate's title/description before accepting it as a
 * candidate worth vision-checking at all. */
function isRelevantTitle(query, title) {
  if (!title) return false;
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (words.length === 0) return true;
  const titleLower = title.toLowerCase();
  const matches = words.filter((w) => titleLower.includes(w)).length;
  return matches >= Math.ceil(words.length * 0.6);
}

function pexelsVideoLabel(video) {
  const slug = (video.url || '').split('/').filter(Boolean).pop() || '';
  const words = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
  const tags = (video.tags || []).join(' ');
  return `${words} ${tags}`.trim();
}

export async function searchPexelsVideos(query, aspect, limit = 4) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  const orientation = aspect === 'vertical' ? 'portrait' : 'landscape';
  const data = await safeFetchJson(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=8`,
    { headers: { Authorization: apiKey } }
  );
  return (data?.videos || [])
    .filter((v) => isRelevantTitle(query, pexelsVideoLabel(v)))
    .slice(0, limit)
    .map((video) => {
      const files = (video.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.width);
      const target = files.find((f) => f.width >= 1280 && f.width <= 1920) || files.sort((a, b) => b.width - a.width)[0];
      if (!target) return null;
      return { type: 'video', url: target.link, source: 'pexels', license: 'Pexels License', author: video.user?.name || null, width: target.width, height: target.height, credit: null };
    })
    .filter(Boolean);
}

export async function searchPexelsPhotos(query, aspect, limit = 4) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  const orientation = aspect === 'vertical' ? 'portrait' : 'landscape';
  const data = await safeFetchJson(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=8`,
    { headers: { Authorization: apiKey } }
  );
  return (data?.photos || [])
    .filter((p) => isRelevantTitle(query, p.alt))
    .slice(0, limit)
    .map((photo) => ({
      type: 'image', url: photo.src.large2x || photo.src.large, source: 'pexels', license: 'Pexels License',
      author: photo.photographer || null, width: photo.width, height: photo.height, credit: null
    }));
}

export async function searchPixabayPhotos(query, aspect, limit = 4) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return [];
  const orientation = aspect === 'vertical' ? 'vertical' : 'horizontal';
  const data = await safeFetchJson(
    `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${orientation}&safesearch=true&per_page=8`
  );
  return (data?.hits || [])
    .filter((p) => isRelevantTitle(query, p.tags))
    .slice(0, limit)
    .map((p) => ({
      type: 'image', url: p.largeImageURL, source: 'pixabay', license: 'Pixabay License',
      author: p.user || null, width: p.imageWidth, height: p.imageHeight, credit: null
    }));
}

export async function searchPixabayVideos(query, aspect, limit = 4) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return [];
  const data = await safeFetchJson(
    `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&safesearch=true&per_page=8`
  );
  return (data?.hits || [])
    .filter((v) => isRelevantTitle(query, v.tags))
    .slice(0, limit)
    .map((v) => {
      const file = v.videos?.large?.width ? v.videos.large : v.videos?.medium;
      if (!file) return null;
      if (aspect === 'vertical' && file.width > file.height) return null; // Pixabay videos are landscape-only
      return { type: 'video', url: file.url, source: 'pixabay', license: 'Pixabay License', author: v.user || null, width: file.width, height: file.height, credit: null };
    })
    .filter(Boolean);
}

const OPENVERSE_LICENSE_OK = /^(cc0|pdm|by|by-sa)$/i;

export async function searchOpenverseImages(query, limit = 4) {
  const data = await safeFetchJson(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&mature=false&page_size=10`
  );
  return (data?.results || [])
    .filter((r) => r.url && OPENVERSE_LICENSE_OK.test(r.license || '') && isRelevantTitle(query, r.title))
    .slice(0, limit)
    .map((pick) => ({
      type: 'image', url: pick.url, source: 'openverse',
      license: `CC ${String(pick.license).toUpperCase()} ${pick.license_version || ''}`.trim(),
      author: pick.creator || 'unknown', width: pick.width || null, height: pick.height || null,
      credit: `"${pick.title || query}" by ${pick.creator || 'unknown'} (CC ${String(pick.license).toUpperCase()} ${pick.license_version || ''}) via Openverse`.trim(),
      landingUrl: pick.foreign_landing_url
    }));
}

const WIKIMEDIA_LICENSE_OK = /(cc0|cc[\s-]?by(?!.*nc)(?!.*nd)|public domain|pdm)/i;

export async function searchWikimediaImages(query, limit = 4) {
  const data = await safeFetchJson(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=1920`
  );
  const pages = Object.values(data?.query?.pages || {});
  const results = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl) continue;
    if (!isRelevantTitle(query, page.title)) continue;
    const license = info.extmetadata?.LicenseShortName?.value || '';
    if (!WIKIMEDIA_LICENSE_OK.test(license)) continue;
    const artist = (info.extmetadata?.Artist?.value || 'unknown').replace(/<[^>]+>/g, '').trim();
    results.push({
      type: 'image', url: info.thumburl, source: 'wikimedia', license, author: artist,
      width: info.thumbwidth || null, height: info.thumbheight || null,
      credit: `"${page.title.replace(/^File:/, '')}" by ${artist} (${license}) via Wikimedia Commons`,
      landingUrl: info.descriptionurl
    });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Returns candidates from ALL real-media sources for one query, grouped in
 * priority order. For a named entity (a specific person, place, landmark)
 * Wikimedia goes first -- stock video essentially never has that specific
 * subject, so a real photo is the actually-correct match. For a generic
 * concept (the far more common case -- "hydrogen train", "city street",
 * "technology"), real stock VIDEO is tried first instead: motion footage
 * reads as far less "this was auto-generated" than a Ken-Burns pan over a
 * still, and the previous fixed Wikimedia-always-first order meant most
 * segments used stills even when matching video footage existed. Each
 * group is itself an array of candidates (richest first) so the caller
 * can vision-verify and fall through both within and across sources
 * instead of committing to the first technically-licensed hit.
 */
export async function fetchRealMediaCandidates(query, aspect) {
  const [wikimedia, pexelsVideo, pexelsPhoto, pixabayVideo, pixabayPhoto, openverse] = await Promise.all([
    searchWikimediaImages(query).catch(() => []),
    searchPexelsVideos(query, aspect).catch(() => []),
    searchPexelsPhotos(query, aspect).catch(() => []),
    searchPixabayVideos(query, aspect).catch(() => []),
    searchPixabayPhotos(query, aspect).catch(() => []),
    searchOpenverseImages(query).catch(() => [])
  ]);
  const video = [...pexelsVideo, ...pixabayVideo];
  const photo = [...pexelsPhoto, ...pixabayPhoto];
  const groups = looksLikeNamedEntity(query)
    ? [wikimedia, video, photo, openverse]
    : [video, wikimedia, photo, openverse];
  return groups.filter((g) => g.length > 0);
}
