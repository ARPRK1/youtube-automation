// Growth / monetization helpers for the 90-day YPP push.
// Free-stack only: YouTube Data API + our LLM. No paid SEO tools.

/**
 * YouTube Partner Program (as of 2025–2026 public requirements):
 * - 1,000 subscribers
 * - AND either 4,000 public watch hours in 12 months
 *   OR 10 million valid public Shorts views in 90 days
 *
 * LIVE AUDIT 2026-08-04 (ModernMonk @modernmonkshot):
 * - 16 subs / ~15k views / 117 videos / created 2026-07-02
 * - Top Shorts were ALL India food origin (1.0k–1.2k views, 27–42s)
 * - Physics/AI/China abstract pivot (2026-07-24) produced 0–67 view Shorts
 * - Conclusion: reverse the universal pivot. Double down on what already won.
 */

export const YPP_TARGETS = {
  subscribers: 1000,
  watchHours12m: 4000,
  shortsViews90d: 10_000_000,
  days: 90
};

/**
 * BOLD REVERT 2026-08-04: proven India pillars only.
 * Weights reflect actual view data — food origin Shorts dominate.
 * Specific named dishes/places beat abstract "history turning points".
 */
export const PROVEN_GROWTH_NICHES = [
  {
    id: 'indian-food-story',
    name: 'Indian Food Origin Stories',
    weight: 4,
    why: 'Top 4 Shorts all food: Butter Chicken 1169, Food Fight 1127, Fusion 1082, Spice Route 1047',
    hooks: [
      'why butter chicken was invented in a Delhi restaurant, not a royal kitchen',
      'the real origin of biryani and why every city claims it',
      'how black pepper from Kerala changed global trade routes forever',
      'the street food that became a national obsession in under 50 years',
      'why chai is India\'s real national drink, not coffee or lassi',
      'the colonial accident that created Indian Chinese cuisine',
      'how one spice mix recipe traveled from royal kitchens to every packet today',
      'the dish British soldiers loved that Indians reinvented after independence'
    ]
  },
  {
    id: 'indian-money-simple',
    name: 'Simple Indian Money Habits',
    weight: 2,
    why: 'Evergreen IN search demand + channel brand promise; SIP/RBI/tax hooks convert',
    hooks: [
      'the SIP mistake that quietly costs Indian investors lakhs over 10 years',
      'what one RBI rate decision actually does to your home loan EMI',
      'the hidden fee most mutual fund apps never explain clearly',
      'why your salary growth can still leave you poorer in real terms',
      'the one number on an Indian payslip most people never check',
      'index funds vs active funds in India — what the 10-year data actually shows'
    ]
  },
  {
    id: 'india-history-twist',
    name: 'India History With a Twist',
    weight: 2,
    why: 'Battle/one-decision Shorts cluster hit 300–777 views; India-specific beats generic history',
    hooks: [
      'the one decision at Haldighati that still divides historians',
      'how a forgotten Indian kingdom disappeared without a major battle',
      'the map decision that still shapes Indian borders and arguments today',
      'an ancient Indian technology we still do not fully understand',
      'the trade route that made one Indian port richer than most European cities',
      'why a single treaty clause mattered more than the war that followed it'
    ]
  },
  {
    id: 'india-place-secret',
    name: 'Hidden India Places',
    weight: 1,
    why: 'Visual Shorts fuel; mid-pack performers; strong for real photo/video b-roll',
    hooks: [
      'the hidden valley locals visit that tourists almost never find',
      'why one Indian fort was designed to confuse every invading army',
      'the beach town that stayed quiet while Goa got famous',
      'a temple town whose architecture still puzzles modern engineers',
      'the Himalayan route that was a secret trade path for centuries'
    ]
  }
];

/** Hard reject topics that proved toxic for this channel's growth. */
export const OFF_BRAND_PATTERN =
  /\b(quantum|black hole|einstein|spider[\s-]?man|marvel|mcu|entropy|bell'?s theorem|zeigarnik|attention residue|mechanistic interpretability|catastrophic forgetting|five[\s-]?year plan|fermi paradox|g[oö]del|newcomb|measurement problem|hallucinati(?:on|ng)s?\b.*\b(?:llm|model)|bitter lesson)\b/i;

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

  if (kind === 'short') {
    // Prefer punchy: if title is already short and specific, just append #Shorts.
    if (base.length <= 48) return `${base} #Shorts`.slice(0, 100);
    // Truncate cleanly at word boundary then tag.
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
 * Pinned-comment style CTA lives in the first 2 lines (shown above fold).
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
    ? 'Follow for one sharp India story every day. Like if this surprised you.'
    : 'If this helped, subscribe for more India stories with real sources. Comment your take below.';

  const sourceLines = (facts || [])
    .slice(0, 4)
    .map((f) => `• ${f.text}${f.source ? ` (${f.source})` : ''}`)
    .join('\n');

  const tags = [...new Set([
    ...(hashtags || []).map((h) => h.replace(/^#/, '')),
    ...(kind === 'short' ? ['Shorts', 'India', 'Facts'] : ['India', 'Explained', 'Documentary'])
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
 * Winners on this channel were 25–45s — NOT 50–90s abstract lectures.
 */
export function growthScriptDirectives(kind = 'long') {
  if (kind === 'short') {
    return `
GROWTH RULES (mandatory for Shorts shelf + retention):
- Sentence 1 must be a pattern-interrupt hook (shock fact, question, or "stop scrolling" curiosity). No intro, no "hey guys", no "in this video".
- Deliver ONE clear payoff before the 15-second mark.
- Spoken length target: 25-45 seconds (about 70-120 words at real speech rate). Tight beats long.
- End with a soft loop CTA: yes/no question or "follow for the next India story" — never hard-sell.
- Do not pad. One specific story beats a list of vague facts.
- Prefer concrete Indian names, places, dishes, rupees, years — never abstract theory.`;
  }
  return `
GROWTH RULES (mandatory for search + session time):
- Open with a concrete hook in the first 8 seconds (specific number, place, dish, or decision).
- Mid-roll curiosity gap every ~90 seconds ("but that was not the real problem...").
- Before the final 20 seconds, one natural subscribe CTA tied to the value just delivered.
- Prefer one deep India story over a list of shallow facts.`;
}

/** Score a research candidate higher if it matches proven niches (title keywords). */
export function nicheBoostForTitle(title = '') {
  const t = title.toLowerCase();
  let boost = 0;
  const food = /food|dish|spice|cuisine|biryani|chicken|street food|recipe|flavor|curry|pepper|chef|chai|masala|tandoor|dosa|samosa|paneer|naan|kebab|thali|pickle|ghee/;
  const money = /sip|mutual fund|rupee|rbi|nifty|sensex|invest|salary|tax|ipo|bank|emi|wealth|money|inflation|fd |ppf|nps|budget/;
  const history = /battle|empire|king|queen|ancient|dynasty|war|mughal|akbar|history|kingdom|lost|fort|maurya|chola|maratha|partition|treaty/;
  const place = /temple|fort|city|beach|valley|himalaya|kerala|rajasthan|goa|landmark|travel|hidden gem|ladakh|varanasi|hampi|udaipur/;
  if (food.test(t)) boost += 3.5;
  if (money.test(t)) boost += 2.5;
  if (history.test(t)) boost += 2.0;
  if (place.test(t)) boost += 1.5;
  // Penalize pure entertainment noise + proven dead abstract topics
  if (/trailer|box office|ipl match score|full match|live score|celebrity gossip/.test(t)) boost -= 2.0;
  if (isOffBrandTopic(t)) boost -= 5.0;
  return boost;
}

/** `forceId` lets a manual/backfill run pin a specific pillar for one run. */
export function pickGrowthNicheForDay(date = new Date(), forceId = null) {
  if (forceId) {
    const forced = PROVEN_GROWTH_NICHES.find((n) => n.id === forceId);
    if (forced) return forced;
    console.warn(`[growth] --niche="${forceId}" did not match any pillar id, falling back to the day's rotation`);
  }
  // Weighted rotation by day-of-year so content stays coherent week to week
  // without random niche thrash (algorithm hates random identity).
  const day = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const bag = [];
  for (const n of PROVEN_GROWTH_NICHES) {
    for (let i = 0; i < n.weight; i++) bag.push(n);
  }
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
