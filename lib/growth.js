// Growth / monetization helpers for the 90-day YPP push.
// Free-stack only: YouTube Data API + our LLM. No paid SEO tools.

/**
 * YouTube Partner Program (as of 2025–2026 public requirements):
 * - 1,000 subscribers
 * - AND either 4,000 public watch hours in 12 months
 *   OR 10 million valid public Shorts views in 90 days
 *
 * At 6 subs / ~9k lifetime views, the realistic automation path is:
 * Shorts velocity + ONE clear niche + PUBLIC uploads + NOT made-for-kids.
 */

export const YPP_TARGETS = {
  subscribers: 1000,
  watchHours12m: 4000,
  shortsViews90d: 10_000_000,
  days: 90
};

/**
 * Niche pivot (2026-07-24): the channel was thrashing across unrelated
 * India topics (food/money/history/places) with no coherent identity for
 * the algorithm to lock onto. New identity: universal, sketch/diagram-
 * friendly explainer content that needs no location-specific b-roll --
 * AI & ML, history turning points, daily-life hacks, and physics/logic
 * paradoxes. All four are naturally suited to whiteboard/diagram AI
 * visuals instead of stock photo/video search (see lib/ai-image.js).
 */
export const PROVEN_GROWTH_NICHES = [
  {
    id: 'ai-ml-explained',
    name: 'AI & ML Explained',
    weight: 3,
    why: 'Highest search demand + evergreen; diagram-native (no b-roll needed)',
    hooks: ['how it actually works', 'the part nobody explains', 'one idea that changed AI', 'simpler than you think']
  },
  {
    id: 'history-turning-point',
    name: 'History Turning Points',
    weight: 2,
    why: 'Proven format (one-decision framing) generalizes past India-only',
    hooks: ['one decision', 'the moment everything changed', 'what if', 'the detail they leave out']
  },
  {
    id: 'daily-life-hack',
    name: 'Daily Life Hacks',
    weight: 2,
    why: 'High rewatch/save rate on Shorts; universal audience, no region lock-in',
    hooks: ['the trick nobody taught you', 'do this instead', 'takes 10 seconds', 'why this actually works']
  },
  {
    id: 'physics-paradox',
    name: 'Physics & Logic Paradoxes',
    weight: 1,
    why: 'High curiosity-gap/watch-time; strongly diagram/sketch-native',
    hooks: ['sounds impossible but', 'breaks your brain', 'the paradox nobody can solve', 'wait, what?']
  }
];

/**
 * High-CTR title patterns used by large faceless/educational Shorts channels.
 * {topic} is replaced with the working title seed.
 */
const TITLE_PATTERNS_SHORT = [
  (t) => `${t} #Shorts`,
  (t) => `The real story of ${t} #Shorts`,
  (t) => `Why ${t} went crazy viral #Shorts`,
  (t) => `${t} in 30 seconds #Shorts`,
  (t) => `Nobody told you this about ${t} #Shorts`,
  (t) => `${t}? The part they skip #Shorts`
];

const TITLE_PATTERNS_LONG = [
  (t) => `${t} — Full Story Explained`,
  (t) => `The Truth About ${t}`,
  (t) => `${t}: What Actually Happened`,
  (t) => `Why ${t} Actually Matters`
];

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
    ? 'Follow for one sharp explainer every day. Like if this surprised you.'
    : 'If this helped, subscribe for more explainers with real sources. Comment your take below.';

  const sourceLines = (facts || [])
    .slice(0, 4)
    .map((f) => `• ${f.text}${f.source ? ` (${f.source})` : ''}`)
    .join('\n');

  const tags = [...new Set([
    ...(hashtags || []).map((h) => h.replace(/^#/, '')),
    ...(kind === 'short' ? ['Shorts', 'Explained', 'Facts'] : ['Explained', 'Documentary', 'Educational'])
  ])]
    .filter(Boolean)
    .slice(0, 8)
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
 * Large Shorts channels treat the first sentence as the entire ad.
 */
export function growthScriptDirectives(kind = 'long') {
  if (kind === 'short') {
    return `
GROWTH RULES (mandatory for Shorts shelf + retention):
- Sentence 1 must be a pattern-interrupt hook (question, shock fact, or "stop scrolling" curiosity). No intro, no "hey guys".
- Deliver ONE clear payoff before the 20-second mark.
- End with a soft loop CTA: ask a yes/no question or "follow for part 2" style line — never hard-sell.
- Spoken length target: 25-45 seconds (about 70-130 words). Tight beats long.
- Do not pad. Silence is better than filler.`;
  }
  return `
GROWTH RULES (mandatory for search + session time):
- Open with a concrete hook in the first 8 seconds (specific number, place, or decision).
- Mid-roll curiosity gap every ~90 seconds ("but that was not the real problem...").
- Before the final 20 seconds, one natural subscribe CTA tied to the value just delivered.
- Prefer one deep story over a list of shallow facts.`;
}

/** Score a research candidate higher if it matches proven niches (title keywords). */
export function nicheBoostForTitle(title = '') {
  const t = title.toLowerCase();
  let boost = 0;
  const aiMl = /\bai\b|machine learning|neural network|algorithm|chatgpt|llm|model training|deep learning|robot/;
  const history = /battle|empire|king|queen|ancient|dynasty|war|revolution|history|invention|discovery|turning point/;
  const hack = /hack|trick|habit|productivity|shortcut|do this instead|life hack|routine|mistake/;
  const physics = /paradox|physics|quantum|gravity|relativity|logic puzzle|infinity|impossible|thought experiment/;
  if (aiMl.test(t)) boost += 3.0;
  if (history.test(t)) boost += 2.0;
  if (hack.test(t)) boost += 2.0;
  if (physics.test(t)) boost += 1.0;
  // Penalize pure entertainment/local noise that rarely converts for this brand
  if (/trailer|box office|match score|full match|live score|celebrity gossip/.test(t)) boost -= 1.5;
  return boost;
}

export function pickGrowthNicheForDay(date = new Date()) {
  // Weighted rotation by day-of-year so content stays coherent week to week
  // without random niche thrash (algorithm hates random identity).
  const day = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const bag = [];
  for (const n of PROVEN_GROWTH_NICHES) {
    for (let i = 0; i < n.weight; i++) bag.push(n);
  }
  return bag[day % bag.length];
}
