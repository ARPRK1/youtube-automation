// Free, keyless AI image generation via Pollinations.ai. Runs entirely on
// their servers -- no GPU needed on our end, works fine from a plain
// GitHub Actions CPU runner. This is what actually solves the "irrelevant
// stock photo" problem: we control the prompt, so relevance is guaranteed
// by construction instead of hoping a search engine finds something close.

const STYLE_SUFFIX = 'cinematic digital illustration, detailed, vibrant colors, professional, tasteful, family-friendly, no text, no watermark, no logo';

function buildPrompt(subject) {
  return `${subject}, ${STYLE_SUFFIX}`;
}

function seedFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 1000000;
}

/**
 * Generates one AI image for `subject` (a short visual description, e.g. a
 * chapter title) at the given pixel size. Returns a Buffer, or null if the
 * free service is unavailable/slow/erroring -- callers should fall back to
 * a stock photo/gradient rather than block the whole pipeline on a free
 * community service with no uptime guarantee.
 */
export async function generateAiImage(subject, { width = 1920, height = 1080, timeoutMs = 60000 } = {}) {
  const prompt = buildPrompt(subject);
  const seed = seedFromString(subject);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null; // suspiciously small -- likely an error page, not an image
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
