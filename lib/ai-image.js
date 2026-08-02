// Free, keyless AI image generation via Pollinations.ai (Flux).
// Multiple art styles so a single segment can cut between photo-real,
// pencil sketch, ink, charcoal, etc. — the "one stock photo held for
// 40 seconds" look is the main amateur tell on auto-channels.
//
// -------------------------------------------------------------------------
// 2026-08-02 FIX: "random people sketches appear during segments that are
// not about people."
//
// Two compounding causes, both in this file's neighbourhood:
//
// 1. styleForBeat routed ordinary technical concepts into the PEOPLE style
//    branch. The old test was:
//        || /^[A-Z][a-z]+ [A-Z]/.test(entity)
//    which matches any string starting "Titlecase Word + space + Capital".
//    "Machine Learning", "Training Data", "Gradient Descent", "Turing Test",
//    "Silicon Valley" all matched and were handed pencil/charcoal/ink, the
//    styles reserved for depicting humans. The concept regex above it did not
//    list those terms, so they fell straight through to the people branch.
//
// 2. The prompt built for those beats (see media-sourcing.js#aiSubjectFor)
//    appended "not a photorealistic portrait of a real living person, no
//    readable face likeness". The Pollinations URL below has no negative
//    prompt parameter -- everything in `prompt` is POSITIVE conditioning.
//    Diffusion models do not reliably honour negation, so "not a portrait of
//    a real living person" reads to Flux mostly as "portrait, real, living,
//    person, face". Combine that with a pencil style and you get exactly the
//    reported symptom: a random pencil sketch of a person.
//
// The fix is not to write a better negation. It is to never put person tokens
// in a prompt for a subject that is not a person, and to express the likeness
// constraint for real people POSITIVELY (silhouette, from behind, symbolic)
// so there is nothing for the model to invert.
// -------------------------------------------------------------------------

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

// Appended for subjects that are ABSTRACT (a concept, a process, a system).
// Positive-only. Describes what the frame should contain, so there is no
// person token anywhere in the prompt for the model to pick up. Do not add a
// "no people" clause here -- that reintroduces the exact word we are trying
// to keep out of the conditioning.
const ABSTRACT_FRAMING =
  'schematic illustration of the concept itself, objects shapes arrows and symbols only, empty of characters, technical explainer aesthetic';

// Appended for subjects that genuinely ARE a person. The likeness constraint
// is expressed as a positive composition instruction rather than a negation,
// so the model has a concrete thing to draw instead of a thing to avoid.
const PERSON_SAFE_FRAMING =
  'anonymous stylised figure seen in silhouette or from behind, face turned away and unlit, symbolic rather than a likeness of any specific individual';

// Concept/explainer content (AI/ML, physics, hacks) reads best as diagrams
// it can't be photographed, so it leans whiteboard/diagram/ink first;
// history keeps a mix of narrative illustration styles since it often has
// a concrete scene (a battle, a place, a person) worth depicting.
const STYLE_CYCLE = ['whiteboard', 'diagram', 'ink', 'cinematic', 'pencil'];
const STYLE_CYCLE_HISTORY = ['cinematic', 'pencil', 'whiteboard', 'ink', 'charcoal'];

// Widened 2026-08-02. The old list was short enough that most of this
// channel's actual vocabulary fell through it into the people branch. If a
// term belongs on a whiteboard, it belongs here.
const CONCEPT_RE = new RegExp(
  '\\b(' +
    [
      // AI and computing
      'ai', 'a\\.i\\.', 'artificial intelligence', 'machine learning', 'deep learning',
      'neural network', 'neural net', 'network', 'algorithm', 'model', 'llm',
      'language model', 'transformer', 'training', 'training data', 'dataset',
      'data', 'inference', 'gradient', 'parameter', 'weight', 'token',
      'embedding', 'prompt', 'chatbot', 'agent', 'automation', 'automate',
      'workflow', 'pipeline', 'api', 'software', 'code', 'compute', 'server',
      'cloud', 'database', 'encryption', 'bug', 'hallucination', 'bias',
      // science and logic
      'paradox', 'equation', 'theory', 'theorem', 'concept', 'logic', 'quantum',
      'gravity', 'relativity', 'entropy', 'infinity', 'probability', 'physics',
      'experiment', 'hypothesis', 'formula', 'proof', 'energy', 'force',
      'particle', 'wave', 'orbit', 'dimension',
      // process and everyday
      'habit', 'trick', 'hack', 'process', 'system', 'method', 'technique',
      'routine', 'strategy', 'framework', 'principle', 'rule', 'law', 'effect',
      // money and business, abstract senses
      'profit', 'revenue', 'market', 'economy', 'inflation', 'interest',
      'investment', 'cost', 'price', 'growth', 'supply', 'demand'
    ].join('|') +
  ')\\b'
);

const PLACE_RE = /\b(map|route|empire|kingdom|border|region|city|fort|temple|river|mountain|coast|battle|war|dynasty|island|continent|valley|desert|ocean)\b/;

// Explicit person vocabulary only. The old `/^[A-Z][a-z]+ [A-Z]/` shortcut is
// gone: it classified any two-word Title Case phrase as a human, which is how
// "Machine Learning" ended up being drawn as a pencil portrait.
const PERSON_RE = /\b(king|queen|emperor|empress|leader|president|minister|person|people|man|woman|men|women|child|scientist|inventor|engineer|soldier|general|artist|writer|founder|ceo|worker|portrait|he|she|his|her)\b/;

const HISTORY_RE = /\b(history|historical|ancient|civilization|civilisation|dynasty|century|medieval|renaissance|revolution|era)\b/;

/**
 * True when the entity is an abstract concept rather than something with a
 * body. Checked before everything else, because a concept that also contains
 * a person-ish word ("agent", "worker process") must still be drawn as a
 * diagram.
 */
export function isAbstractConcept(entity = '') {
  return CONCEPT_RE.test(String(entity).toLowerCase());
}

/**
 * True only when there is explicit evidence the subject is a human being.
 * Deliberately conservative: a false negative costs a slightly dull diagram,
 * a false positive costs a random stranger's face in the middle of a video
 * about neural networks.
 */
export function isPersonSubject(entity = '') {
  const e = String(entity).toLowerCase();
  if (isAbstractConcept(e)) return false;
  return PERSON_RE.test(e);
}

/**
 * @param {number} beatIndex
 * @param {string} entity
 * @param {'abstract'|'person'|'scene'} [kind] Optional pre-computed
 *   classification from media-sourcing.js#subjectKindFor. Pass it when you
 *   have it: that classifier also consults the NER-backed
 *   extractNamedEntities, which this file cannot import without a circular
 *   dependency. Without it, a real personal name like "Marie Curie" matches
 *   none of the vocabulary below and falls to the default cycle, so the style
 *   and the prompt framing end up disagreeing about whether the subject is a
 *   human. Harmless but sloppy, and it is free to get right.
 */
export function styleForBeat(beatIndex, entity = '', kind = null) {
  const e = String(entity).toLowerCase();

  if (kind === 'person') {
    const people = ['pencil', 'charcoal', 'ink', 'cinematic', 'watercolor'];
    return people[beatIndex % people.length];
  }
  if (kind === 'abstract') {
    const concept = ['whiteboard', 'diagram', 'ink', 'cinematic'];
    return concept[beatIndex % concept.length];
  }

  // Concepts with nothing physical to photograph -- diagram/whiteboard first.
  // Checked first and now with a vocabulary wide enough to actually catch
  // this channel's subject matter.
  if (isAbstractConcept(e)) {
    const concept = ['whiteboard', 'diagram', 'ink', 'cinematic'];
    return concept[beatIndex % concept.length];
  }

  // Places/battles/eras lean narrative illustration.
  if (PLACE_RE.test(e)) {
    const place = ['map', 'pencil', 'ink', 'cinematic', 'watercolor'];
    return place[beatIndex % place.length];
  }

  // People lean pencil/charcoal, which is safer than photo-real likeness.
  // Reaching this branch now requires an actual person word.
  if (PERSON_RE.test(e)) {
    const people = ['pencil', 'charcoal', 'ink', 'cinematic', 'watercolor'];
    return people[beatIndex % people.length];
  }

  if (HISTORY_RE.test(e)) {
    return STYLE_CYCLE_HISTORY[beatIndex % STYLE_CYCLE_HISTORY.length];
  }

  return STYLE_CYCLE[beatIndex % STYLE_CYCLE.length];
}

/**
 * @param {string} subject
 * @param {string} style
 * @param {{ subjectKind?: 'abstract'|'person'|'scene' }} [opts]
 */
function buildPrompt(subject, style = 'cinematic', { subjectKind = 'scene' } = {}) {
  const styleSuffix = STYLE_PROMPTS[style] || STYLE_PROMPTS.cinematic;
  const framing =
    subjectKind === 'abstract' ? `, ${ABSTRACT_FRAMING}`
    : subjectKind === 'person' ? `, ${PERSON_SAFE_FRAMING}`
    : '';
  return `${subject}${framing}, ${styleSuffix}`;
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
 * @param {{ width?: number, height?: number, timeoutMs?: number, attempts?: number, style?: keyof typeof STYLE_PROMPTS, seedExtra?: string, subjectKind?: 'abstract'|'person'|'scene', debugPrompts?: boolean }} [opts]
 */
export async function generateAiImage(subject, {
  width = 1920,
  height = 1080,
  timeoutMs = 60000,
  attempts = 3,
  style = 'cinematic',
  seedExtra = '',
  subjectKind = 'scene',
  debugPrompts = false
} = {}) {
  const prompt = buildPrompt(subject, style, { subjectKind });

  // Cheap forensics. The only way anyone found the bug this file was written
  // to fix was by reasoning backwards from the picture to the prompt. Log the
  // prompt and that stops being detective work. Off by default so it does not
  // spam a normal run; turn on with DEBUG_IMAGE_PROMPTS=1.
  if (debugPrompts || process.env.DEBUG_IMAGE_PROMPTS === '1') {
    console.log(`[ai-image] style=${style} kind=${subjectKind} prompt="${prompt}"`);
  }

  const seed = seedFromString(`${style}|${subject}|${seedExtra}`);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const buf = await fetchOnce(url, timeoutMs);
    if (buf) return buf;
    if (attempt < attempts) await sleep(2000 * attempt);
  }
  return null;
}

export { STYLE_PROMPTS, STYLE_CYCLE, buildPrompt };
