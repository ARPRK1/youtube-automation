// Free, keyless AI image generation via Pollinations.ai (Flux).
// Multiple art styles so a single segment can cut between photo-real,
// pencil sketch, ink, charcoal, etc. — the "one stock photo held for
// 40 seconds" look is the main amateur tell on auto-channels.

const STYLE_PROMPTS = {
  cinematic:
    'cinematic digital illustration, dramatic lighting, detailed, vibrant but tasteful colors, professional composition, family-friendly, no text, no watermark, no logo, no signature',
  photo:
    'photorealistic documentary still, natural lighting, high detail, shallow depth of field, editorial photography, family-friendly, no text, no watermark, no logo',
  pencil:
    'detailed pencil sketch on textured paper, graphite drawing, fine cross-hatching, hand-drawn look, black and white, professional illustrator quality, no text, no watermark, no logo, no signature',
  ink:
    'bold ink illustration, clean black line art with soft grey washes, graphic novel style, high contrast, elegant, no text, no watermark, no logo',
  charcoal:
    'expressive charcoal drawing, rich blacks and soft smudges, gallery sketch quality, monochrome, dramatic, no text, no watermark, no logo',
  watercolor:
    'soft watercolor painting, loose brush strokes, paper texture, muted elegant palette, artistic, no text, no watermark, no logo',
  map:
    'vintage cartographic illustration, aged parchment map style, elegant line work, subtle sepia tones, no modern logos, no text labels that look like watermarks'
};

const STYLE_CYCLE = ['cinematic', 'pencil', 'photo', 'ink', 'charcoal', 'watercolor'];

export function styleForBeat(beatIndex, entity = '') {
  const e = String(entity).toLowerCase();
  // Places lean map/sketch; people lean pencil/charcoal (safer than photo-real likeness).
  if (/\b(map|route|empire|kingdom|border|region|city|fort|temple|river|mountain|coast)\b/.test(e)) {
    const place = ['map', 'pencil', 'ink', 'cinematic', 'watercolor'];
    return place[beatIndex % place.length];
  }
  if (/\b(king|queen|emperor|leader|person|man|woman|chef|trader|soldier|portrait)\b/.test(e)
    || /^[A-Z][a-z]+ [A-Z]/.test(entity)) {
    const people = ['pencil', 'charcoal', 'ink', 'cinematic', 'watercolor'];
    return people[beatIndex % people.length];
  }
  return STYLE_CYCLE[beatIndex % STYLE_CYCLE.length];
}

function buildPrompt(subject, style = 'cinematic') {
  const styleSuffix = STYLE_PROMPTS[style] || STYLE_PROMPTS.cinematic;
  return `${subject}, ${styleSuffix}`;
}

function seedFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 1000000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generates one AI image for `subject` at the given pixel size and art style.
 * @param {string} subject
 * @param {{ width?: number, height?: number, timeoutMs?: number, attempts?: number, style?: keyof typeof STYLE_PROMPTS, seedExtra?: string }} [opts]
 */
export async function generateAiImage(subject, {
  width = 1920,
  height = 1080,
  timeoutMs = 60000,
  attempts = 3,
  style = 'cinematic',
  seedExtra = ''
} = {}) {
  const prompt = buildPrompt(subject, style);
  const seed = seedFromString(`${style}|${subject}|${seedExtra}`);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const buf = await fetchOnce(url, timeoutMs);
    if (buf) return buf;
    if (attempt < attempts) await sleep(2000 * attempt);
  }
  return null;
}

export { STYLE_PROMPTS, STYLE_CYCLE };
