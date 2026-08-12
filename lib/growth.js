// Growth / monetization helpers for the 90-day YPP push.
// Free-stack only: YouTube Data API + our LLM. No paid SEO tools.

/**
 * LIVE AUDIT 2026-08-12 (post food-first pivot of 2026-08-04):
 * - 16 subs still (no sub lift yet) / ~17.1k views / 159 videos
 * - Post-pivot: ~42 videos, Shorts views ~2k+; best "Biryani not Indian?" 789v
 * - Biryani cluster works; money days avg ~42 views (drag)
 * - Duplicate titles (Lawsuit Over Dish / Tandoor Goes Global) re-uploaded
 * - Ultra-short stubs (7s/13s) still leaked — raise min length
 * - Owner: edge-tts voice unwatchable → Chatterbox clone on Shorts
 */

export const YPP_TARGETS = {
  subscribers: 1000,
  watchHours12m: 4000,
  shortsViews90d: 10_000_000,
  days: 90
};

/**
 * Weights 2026-08-12: food dominates (only proven 500–1k path).
 * Money weight cut to 0 for 2 weeks — post-pivot money avg ~42 views.
 * History/places light rotation for variety without thrash.
 */
export const PROVEN_GROWTH_NICHES = [
  {
    id: 'indian-food-story',
    name: 'Indian Food Origin Stories',
    weight: 6,
    why: 'Only pillar with 1k-class hits; biryani batch hit 789 post-pivot',
    hooks: [
      // Avoid re-spamming biryani every day — expand the dish bank
      'why butter chicken was invented in a Delhi restaurant, not a royal kitchen',
      'how black pepper from Kerala changed global trade routes forever',
      'why chai is India\'s real national drink, not coffee or lassi',
      'the colonial accident that created Indian Chinese cuisine',
      'why dosa is a fermented science project, not just a breakfast crepe',
      'the real story behind samosa traveling from Central Asia to every Indian street',
      'how vada pav became Mumbai\'s working-class burger',
      'why idli was engineered for travel and temple kitchens',
      'the port that made Indian chili part of everyday cooking worldwide',
      'how jalebi became festival gold from a simple batter accident',
      'why filter coffee culture in South India never needed a cafe chain',
      'the railway snack that taught India how to eat on the move',
      'how pickle (achar) was India\'s original food preservation tech',
      'why paneer shows up in North Indian restaurants but not the same way in the South',
      'the street cart trick behind India\'s most ordered delivery kebab',
      'how mango pickle lasts months without a fridge — the real method'
    ]
  },
  {
    id: 'india-history-twist',
    name: 'India History With a Twist',
    weight: 1,
    why: 'Mid-pack when specific; keep light so food stays the identity',
    hooks: [
      'the one decision at Haldighati that still divides historians',
      'how a forgotten Indian kingdom disappeared without a major battle',
      'the map decision that still shapes Indian borders and arguments today',
      'an ancient Indian technology we still do not fully understand',
      'the trade route that made one Indian port richer than most European cities'
    ]
  },
  {
    id: 'india-place-secret',
    name: 'Hidden India Places',
    weight: 1,
    why: 'Visual variety; never the main identity',
    hooks: [
      'the hidden valley locals visit that tourists almost never find',
      'why one Indian fort was designed to confuse every invading army',
      'the beach town that stayed quiet while Goa got famous',
      'a temple town whose architecture still puzzles modern engineers'
    ]
  }
  // indian-money-simple paused (weight 0) after post-pivot avg ~42 views
];

/** Hard reject topics that proved toxic for this channel's growth. */
export const OFF_BRAND_PATTERN =
  /\b(quantum|black hole|einstein|spider[\s-]?man|marvel|mcu|entropy|bell'?s theorem|zeigarnik|attention residue|mechanistic interpretability|catastrophic forgetting|five[\s-]?year plan|fermi paradox|g[oö]del|newcomb|measurement problem|hallucinati(?:on|ng)s?\b.*\b(?:llm|model)|bitter lesson|wealth (?:gap|myth|transfer|creation|disparity)|gen z wealth|self made|bank statement)\b/i;

export function isOffBrandTopic(title = '') {
  return OFF_BRAND_PATTERN.test(String(title));
}

/** Strip trailing #Shorts so we can re-apply cleanly. */
export function stripShortsTag(title) {
  return String(title || '').replace(/\s*#Shorts\b/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Optimize a model-written title for CTR + Shorts shelf.
 * Keeps under 70 chars before #Shorts when possible (mobile truncation).
 */
export function optimizeTitle(rawTitle, { kind = 'long' } = {}) {
  let base = stripShortsTag(rawTitle)
    .replace(/\|/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = kind === 'short' ? 'You need to see this' : 'The story nobody explains';

  // Drop weak openers models love.
  base = base.replace(/^(incredible|amazing|unbelievable|wow)[:\s-]+/i, '');
  // Generic titles that repeatedly underperformed post-pivot
  base = base
    .replace(/^globalization of food\b/i, 'How Indian food went global')
    .replace(/^lawsuit over dish\b/i, 'The dish that sparked a lawsuit')
    .replace(/^comfort food\b/i, 'India\'s real comfort food secret');

  if (kind === 'short') {
    if (base.length <= 48) return `${base} #Shorts`.slice(0, 100);
    let cut = base.slice(0, 48);
    const sp = cut.lastIndexOf(' ');
    if (sp > 20) cut = cut.slice(0, sp);
    return `${cut.trim()} #Shorts`.slice(0, 100);
  }

  if (base.length > 70) {
    let cut = base.slice(0, 68);
    const sp = cut.lastIndexOf(' ');
    if (sp > 30) cut = cut.slice(0, sp);
    base = cut.trim();
  }
  return base.slice(0, 100);
}

/**
 * Description template: hook + value + CTA + hashtags.
 */
export function buildGrowthDescription({
  kind = 'long',
  hookLine = '',
  body = '',
  facts = [],
  attributionText = '',
  hashtags = []
}) {
  const cta = kind === 'short'
    ? 'Follow for one sharp India food story every day. Like if this surprised you.'
    : 'If this helped, subscribe for more India stories with real sources. Comment your take below.';

  const sourceLines = (facts || [])
    .slice(0, 4)
    .map((f) => `• ${f.text}${f.source ? ` (${f.source})` : ''}`)
    .join('\n');

  const tags = [...new Set([
    ...(hashtags || []).map((h) => h.replace(/^#/, '')),
    ...(kind === 'short' ? ['Shorts', 'India', 'Food', 'Facts'] : ['India', 'Explained', 'Documentary'])
  ])]
    .filter(Boolean)
    .slice(0, 10)
    .map((h) => `#${h.replace(/\s+/g, '')}`)
    .join(' ');

  const parts = [
    hookLine || body?.split(/[.!?]/)[0] || '',
    cta,
    '',
    body && body !== hookLine ? body : '',
    sourceLines ? `\nSources:\n${sourceLines}` : '',
    attributionText && !String(attributionText).startsWith('No attribution') ? `\n${attributionText}` : '',
    '',
    tags
  ];
  return parts.filter((p) => p !== '' && p != null).join('\n').trim().slice(0, 4900);
}

/** SEO tags: mix branded + niche + format. Max 15 for YouTube. */
export function buildGrowthTags({ kind, topic, extra = [] }) {
  const base = [
    'India',
    'ModernMonk',
    'Indian food',
    'explained',
    kind === 'short' ? 'Shorts' : 'documentary style',
    'facts',
    'story'
  ];
  const topicBits = String(topic || '')
    .split(/[\s,/|-]+/)
    .filter((w) => w.length > 3)
    .slice(0, 6);
  return [...new Set([...extra, ...topicBits, ...base].map((t) => String(t).slice(0, 30)))].slice(0, 15);
}

/**
 * Script prompt add-on: first-second hook + soft subscribe CTA.
 * Owner feedback: generic TTS + flat delivery kills interest — scripts must
 * open hard and stay concrete so clone voice has energy to work with.
 */
export function growthScriptDirectives(kind = 'long') {
  if (kind === 'short') {
    return `
GROWTH RULES (mandatory for Shorts shelf + retention):
- Sentence 1 MUST be a pattern-interrupt: a shock fact, myth-bust, or "most people get this wrong" line. No "hey", no "today we talk about", no soft wind-up.
- Name a real dish, city, year, person, or spice in the first 8 seconds.
- ONE clear payoff by ~15s, then one twist or concrete detail — no lists of fluff.
- Spoken length target: 28-45 seconds (about 80-110 words). Punchy > long.
- End with a soft loop CTA: yes/no question about the dish/story, or "follow for the next food secret".
- Sound like a sharp friend telling a secret, not a textbook or news anchor.
- Never invent sources; if unsure of a year/name, stay qualitative rather than fake-precise.`;
  }
  return `
GROWTH RULES (mandatory for search + session time):
- Open with a concrete hook in the first 8 seconds (specific dish, place, or decision).
- Mid-roll curiosity gap every ~90 seconds.
- Before the final 20 seconds, one natural subscribe CTA tied to the value just delivered.
- Prefer one deep India story over a list of shallow facts.`;
}

/** Score a research candidate higher if it matches proven niches. */
export function nicheBoostForTitle(title = '') {
  const t = title.toLowerCase();
  let boost = 0;
  const food = /food|dish|spice|cuisine|biryani|chicken|street food|recipe|flavor|curry|pepper|chef|chai|masala|tandoor|dosa|samosa|paneer|naan|kebab|thali|pickle|ghee|idli|vada|jalebi|sambar|rasam|paratha|lassi|kachori|pani puri|chaat|filter coffee|achar|mango/;
  const history = /battle|empire|king|queen|ancient|dynasty|war|mughal|akbar|history|kingdom|lost|fort|maurya|chola|maratha|partition|treaty/;
  const place = /temple|fort|city|beach|valley|himalaya|kerala|rajasthan|goa|landmark|travel|hidden gem|ladakh|varanasi|hampi|udaipur/;
  // Money deprioritized post-pivot (avg ~42 views)
  const money = /sip|mutual fund|rupee|rbi|nifty|sensex|invest|salary|tax|ipo|bank|emi|wealth|money|inflation/;
  if (food.test(t)) boost += 4.0;
  if (history.test(t)) boost += 1.5;
  if (place.test(t)) boost += 1.2;
  if (money.test(t)) boost -= 1.5;
  // Biryani was good once — but post-pivot overuse. Mild penalty if title is only biryani again.
  if (/\bbiryani\b/.test(t)) boost -= 0.5;
  if (/trailer|box office|ipl match score|full match|live score|celebrity gossip/.test(t)) boost -= 2.0;
  if (isOffBrandTopic(t)) boost -= 5.0;
  return boost;
}

/** `forceId` lets a manual/backfill run pin a specific pillar for one run. */
export function pickGrowthNicheForDay(date = new Date(), forceId = null) {
  if (forceId) {
    const forced = PROVEN_GROWTH_NICHES.find((n) => n.id === forceId);
    if (forced) return forced;
    // Allow money if explicitly forced even when weight is 0
    if (forceId === 'indian-money-simple') {
      return {
        id: 'indian-money-simple',
        name: 'Simple Indian Money Habits',
        weight: 0,
        why: 'manual force only',
        hooks: [
          'the SIP mistake that quietly costs Indian investors lakhs over 10 years',
          'what one RBI rate decision actually does to your home loan EMI'
        ]
      };
    }
    console.warn(`[growth] --niche="${forceId}" did not match any pillar id, falling back to the day's rotation`);
  }
  const day = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const bag = [];
  for (const n of PROVEN_GROWTH_NICHES) {
    for (let i = 0; i < n.weight; i++) bag.push(n);
  }
  if (bag.length === 0) return PROVEN_GROWTH_NICHES[0];
  return bag[day % bag.length];
}

/** Programmatic, topic-derived hashtags as a guaranteed supplement. */
export function topicHashtags(topic = '', max = 5) {
  const stopwords = new Set(['this', 'that', 'with', 'from', 'your', 'about', 'into', 'they', 'them', 'what', 'when', 'their', 'have', 'were', 'been', 'will', 'more', 'than']);
  const words = String(topic)
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return [...new Set(words)].slice(0, max);
}
