// Growth helpers — Universal curiosity Shorts channel (2026-08-12 owner pivot).
// Identity: "ModernMonk — one sharp fact you didn't know." Infinite niche via
// Top 5/10, world facts, history twists, science curiosities, quizzes.
// Food remains occasional seasoning, not the whole channel.

export const YPP_TARGETS = {
  subscribers: 1000,
  watchHours12m: 4000,
  shortsViews90d: 10_000_000,
  days: 90
};

/**
 * Universal pillars. Infinite supply (Top 5 of anything, riddles, history
 * moments, science "wait what?"). Designed for global mobile audience.
 * Visuals must be object/place/diagram — never random faces (see media-sourcing).
 */
export const PROVEN_GROWTH_NICHES = [
  {
    id: 'world-facts',
    name: 'World Facts You Did Not Know',
    weight: 3,
    why: 'Evergreen share hooks; infinite topics; visual object-friendly',
    hooks: [
      'a country that has no rivers but still has a navy',
      'the only flag in the world that is not a rectangle',
      'why airplanes are almost always painted white',
      'a fruit that is technically a berry and a vegetable that is not',
      'the city that sits in two continents at once',
      'why we still use QWERTY when better layouts exist',
      'the animal that can survive being frozen solid and walk away',
      'a law of the sea that still decides shipwreck treasure today'
    ]
  },
  {
    id: 'top-lists',
    name: 'Top 5 / Top 10 Curiosities',
    weight: 3,
    why: 'Infinite format; retention via countdown; works for any domain',
    hooks: [
      'top 5 inventions that were accidents',
      'top 5 countries that changed their capital city',
      'top 5 foods that were once banned',
      'top 5 deadliest animals that are not what you think',
      'top 5 languages with sounds English cannot make',
      'top 5 places on Earth where GPS quietly fails',
      'top 5 jobs that did not exist 20 years ago',
      'top 5 historical myths almost everyone still believes'
    ]
  },
  {
    id: 'history-twist',
    name: 'History With a Twist',
    weight: 2,
    why: 'Story retention; maps and objects visualize cleanly without faces',
    hooks: [
      'the map decision that still starts arguments today',
      'a war that was decided by logistics, not the famous battle',
      'the invention that was a flop for decades then remade the world',
      'a treaty clause nobody noticed until it rewrote borders',
      'the accident that created a modern national dish',
      'a library fire that erased more knowledge than any war'
    ]
  },
  {
    id: 'science-curiosity',
    name: 'Science & Logic Curiosities',
    weight: 2,
    why: 'High curiosity-gap; diagram-native; keep punchy not lecture-length',
    hooks: [
      'why ice is slippery — the answer is weirder than you were taught',
      'the riddle that stumped mathematicians for decades',
      'why hot water can freeze faster than cold water',
      'a paradox that still splits physicists into camps',
      'why your phone feels heavier when the battery is low (or does it?)',
      'the optical illusion that proves your brain edits reality live'
    ]
  },
  {
    id: 'mind-quiz',
    name: 'Riddles, Quizzes & Brain Twists',
    weight: 1,
    why: 'Comments + rewatch; perfect Shorts loop if timed right',
    hooks: [
      'a riddle 80 percent of adults get wrong on the first try',
      'can you spot the pattern before the answer?',
      'the quiz question that goes viral every year',
      'a logic puzzle with only one honest answer',
      'guess the country from three impossible clues'
    ]
  },
  {
    id: 'indian-food-story',
    name: 'Food Origin Stories',
    weight: 1,
    why: 'Proven 1k hits on this channel — keep as spice, not the whole menu',
    hooks: [
      'why butter chicken was invented in a restaurant, not a palace',
      'how black pepper changed global trade forever',
      'the real origin of a street food every city claims'
    ]
  }
];

/** Off-brand / low-conversion noise (not the same as "no science" — science is allowed when curiosity-packaged). */
export const OFF_BRAND_PATTERN =
  /\b(spider[\s-]?man|marvel|mcu|trailer|box office|live score|full match|celebrity gossip|lottery|satta)\b/i;

export function isOffBrandTopic(title = '') {
  return OFF_BRAND_PATTERN.test(String(title));
}

export function stripShortsTag(title) {
  return String(title || '').replace(/\s*#Shorts\b/gi, '').replace(/\s+/g, ' ').trim();
}

export function optimizeTitle(rawTitle, { kind = 'long' } = {}) {
  let base = stripShortsTag(rawTitle)
    .replace(/\|/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = kind === 'short' ? 'You need to see this' : 'The story nobody explains';
  base = base.replace(/^(incredible|amazing|unbelievable|wow)[:\s-]+/i, '');

  // Prefer concrete curiosity framing over bland generics
  base = base
    .replace(/^globalization of food\b/i, 'How this food went global')
    .replace(/^comfort food\b/i, 'The comfort food secret')
    .replace(/^facts about\b/i, '')
    .trim();

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

export function buildGrowthDescription({
  kind = 'long',
  hookLine = '',
  body = '',
  facts = [],
  attributionText = '',
  hashtags = []
}) {
  const cta = kind === 'short'
    ? 'Follow for one sharp fact a day. Comment if this surprised you.'
    : 'If this helped, subscribe for more stories with real sources. Comment your take below.';

  const sourceLines = (facts || [])
    .slice(0, 4)
    .map((f) => `• ${f.text}${f.source ? ` (${f.source})` : ''}`)
    .join('\n');

  const tags = [...new Set([
    ...(hashtags || []).map((h) => h.replace(/^#/, '')),
    ...(kind === 'short' ? ['Shorts', 'Facts', 'DidYouKnow', 'History'] : ['Explained', 'Documentary', 'Facts'])
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

export function buildGrowthTags({ kind, topic, extra = [] }) {
  const base = [
    'ModernMonk',
    'facts',
    'did you know',
    kind === 'short' ? 'Shorts' : 'documentary style',
    'explained',
    'curiosity'
  ];
  const topicBits = String(topic || '')
    .split(/[\s,/|-]+/)
    .filter((w) => w.length > 3)
    .slice(0, 6);
  return [...new Set([...extra, ...topicBits, ...base].map((t) => String(t).slice(0, 30)))].slice(0, 15);
}

export function growthScriptDirectives(kind = 'long', structureHint = '') {
  const formatExtra = /top\s*[0-9]|countdown|list/i.test(structureHint)
    ? `
FORMAT: This is a COUNTDOWN / TOP-N Short.
- Open with the list promise in sentence 1 ("Top 5 … that will surprise you").
- Number each item clearly ("Number 5…", "Number 4…") so captions can show #5 #4.
- Save the best item for last.
- End with: which one shocked you? Comment the number.`
    : /quiz|riddle|puzzle|guess/i.test(structureHint)
      ? `
FORMAT: This is a QUIZ / RIDDLE Short.
- Sentence 1 states the puzzle.
- Give 2–3 seconds of thinking space in the wording ("pause… most people say…").
- Reveal the answer clearly, then one-line why.
- End with: were you right? Yes or no in the comments.`
      : `
FORMAT: One sharp fact or story — myth-bust or "wait, what?"
- Sentence 1 is the pattern interrupt.
- ONE clear payoff by ~15s, then a twist or concrete detail.
- End with a soft yes/no or "follow for the next one".`;

  if (kind === 'short') {
    return `
GROWTH RULES (universal curiosity Shorts — global audience):
- NO "hey guys", no soft wind-up, no "in this video".
- Spoken length: ~30–42 seconds of speech (~70–95 words). Short complete sentences.
- Sound like a sharp friend telling a secret — NOT a teleprompter reading a paragraph.
- Prefer concrete nouns: objects, places, numbers, animals, inventions — easy to SHOW on screen.
- Never invent fake statistics; if unsure, stay qualitative.

CLOSURE (mandatory — owner feedback: many Shorts cut mid-thought):
- The narration MUST be a complete mini-story with a clear ending. Never trail off mid-clause.
- Last sentence MUST be a full closing line that lands (payoff restated OR soft CTA).
- Examples of good last lines: "That's the part nobody tells you." / "Follow if you want the next one." / "Were you right? Comment yes or no."
- Every sentence ends with . ! or ? — no dangling "and then—" or unfinished lists.
- Do NOT stop at "Number 3 is…" without finishing the item and wrapping the Short.
${formatExtra}`;
  }
  return `
GROWTH RULES:
- Hook in first 8 seconds with a concrete fact or decision.
- Curiosity gaps mid-roll; natural subscribe CTA near the end.
- One deep story over shallow lists.`;
}

export function nicheBoostForTitle(title = '') {
  const t = title.toLowerCase();
  let boost = 0;
  if (/top\s*\d|countdown|ranked|best \d|worst \d/.test(t)) boost += 3.5;
  if (/fact|did you know|nobody told|secret|myth|actually|wait what|surprising/.test(t)) boost += 3.0;
  if (/history|ancient|empire|war|treaty|century|kingdom|map/.test(t)) boost += 2.5;
  if (/riddle|quiz|puzzle|guess|can you|brain/.test(t)) boost += 2.5;
  if (/science|physics|paradox|experiment|brain|illusion|math/.test(t)) boost += 2.0;
  if (/food|dish|spice|cuisine|biryani|chicken|chai/.test(t)) boost += 1.5;
  if (/sip|mutual fund|emi|salary|tax|ipo|wealth gap|gen z wealth/.test(t)) boost -= 1.0;
  if (isOffBrandTopic(t)) boost -= 5.0;
  if (/trailer|box office|live score|celebrity gossip/.test(t)) boost -= 2.0;
  return boost;
}

export function pickGrowthNicheForDay(date = new Date(), forceId = null) {
  if (forceId) {
    const forced = PROVEN_GROWTH_NICHES.find((n) => n.id === forceId);
    if (forced) return forced;
    console.warn(`[growth] --niche="${forceId}" unknown, using day rotation`);
  }
  const day = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const bag = [];
  for (const n of PROVEN_GROWTH_NICHES) {
    for (let i = 0; i < n.weight; i++) bag.push(n);
  }
  return bag[day % bag.length];
}

export function topicHashtags(topic = '', max = 5) {
  const stopwords = new Set(['this', 'that', 'with', 'from', 'your', 'about', 'into', 'they', 'them', 'what', 'when', 'their', 'have', 'were', 'been', 'will', 'more', 'than']);
  const words = String(topic)
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return [...new Set(words)].slice(0, max);
}

/** Classify a published video title into a playlist bucket (for channel cleanup). */
export function classifyVideoPlaylist(title = '') {
  const t = String(title).toLowerCase();
  if (/food|dish|spice|biryani|chicken|chai|cuisine|tandoor|dosa|samosa|street food|recipe|masala|pickle|jamun|comfort food/.test(t)) return 'food';
  if (/sip|money|wealth|bank|emi|rbi|invest|salary|tax|mutual|nifty|rupee|finance|rich vs|gen z wealth|self made/.test(t)) return 'finance';
  if (/\bai\b|machine learning|neural|chatgpt|llm|algorithm|robot|quantum|black hole|einstein|physics|paradox|entropy|science|gravity/.test(t)) return 'science-ai';
  if (/history|battle|empire|king|war|fort|dynasty|mughal|ancient|treaty|haldighati|biryani war|waterway wars/.test(t)) return 'history';
  if (/top\s*\d|riddle|quiz|puzzle|fact|did you know|myth|secret/.test(t)) return 'curiosity';
  return 'curiosity';
}
