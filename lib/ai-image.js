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
    'vintage cartographic illustration, aged parchment map style, elegant line work, subtle sepia tones, no modern logos, no text labels that look like watermarks',
  whiteboard:
    'clean explainer diagram drawn on a white whiteboard with colored dry-erase markers, simple hand-drawn arrows and icons, minimalist, high contrast, no readable text or labels, no watermark, no logo',
  diagram:
    'minimalist infographic-style vector diagram, flat design, simple geometric shapes and arrows illustrating a concept, clean modern color palette, no readable text or labels, no watermark, no logo'
};

// Concept/explainer content (AI/ML, physics, hacks) reads best as diagrams
// it can't be photographed, so it leans whiteboard/diagram/ink first;
// history keeps a mix of narrative illustration styles since it often has
// a concrete scene (a battle, a place, a person) worth depicting.
const STYLE_CYCLE = ['whiteboard', 'diagram', 'ink', 'cinematic', 'pencil'];
const STYLE_CYCLE_HISTORY = ['cinematic', 'pencil', 'whiteboard', 'ink', 'charcoal'];

export function styleForBeat(beatIndex, entity = '') {
  const e = String(entity).toLowerCase();
  // Concepts with nothing physical to photograph -- diagram/whiteboard first.
  if (/\b(algorithm|neural network|model|paradox|equation|theory|concept|logic|quantum|gravity|relativity|habit|trick|hack|process|system)\b/.test(e)) {
    const concept = ['whiteboard', 'diagram', 'ink', 'cinematic'];
    return concept[beatIndex % concept.length];
  }
  // Places/battles/eras lean narrative illustration; people lean pencil/charcoal
  // (safer than photo-real likeness).
  if (/\b(map|route|empire|kingdom|border|region|city|fort|temple|river|mountain|coast|battle|war|dynasty)\b/.test(e)) {
    const place = ['map', 'pencil', 'ink', 'cinematic', 'watercolor'];
    return place[beatIndex % place.length];
  }
  if (/\b(king|queen|emperor|leader|person|man|woman|scientist|inventor|soldier|portrait)\b/.test(e)
    || /^[A-Z][a-z]+ [A-Z]/.test(entity)) {
    const people = ['pencil', 'charcoal', 'ink', 'cinematic', 'watercolor'];
    return people[beatIndex % people.length];
  }
  if (/\b(history|historical|ancient|civilization|dynasty|century)\b/.test(e)) {
    return STYLE_CYCLE_HISTORY[beatIndex % STYLE_CYCLE_HISTORY.length];
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
