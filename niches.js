// Day-of-week -> niche map. getDay(): 0=Sun ... 6=Sat.
// Niche pivot (2026-07-24): replaced the old India-only food/money/history/
// places rotation with a universal, sketch/diagram-friendly identity - AI &
// ML, history turning points, daily-life hacks, physics/logic paradoxes -
// so every day stays visually generatable without location-specific b-roll
// (see lib/ai-image.js's whiteboard/diagram styles) and the audience isn't
// region-locked. Distribution roughly follows lib/growth.js's pillar
// weights (AI/ML and history/hacks get 2 days each, physics gets 1).
//
// `searchQueries` are rotated daily and fed to Google News to find today's
// real, current topic for that niche (see lib/trends.js) — the static
// `fallbackTopics` below are only used if that live lookup fails.
export const NICHE_BY_WEEKDAY = {
  1: {
    name: 'AI & ML Explained',
    pillarId: 'ai-ml-explained',
    audience: 'Students, builders, and tech-curious professionals worldwide',
    region: 'global',
    accentColor: '#4361ee',
    searchQueries: [
      'AI news today',
      'new AI tool launch',
      'artificial intelligence breakthrough',
      'machine learning explained',
      'how does AI work'
    ],
    fallbackTopics: [
      'How large language models actually work',
      'AI tools that save hours every week',
      // Was 'The history of a major AI breakthrough' -- too vague for the
      // LLM to write 1300+ substantive words without repeating itself
      // (confirmed live 2026-07-25/27: failed 3 separate generation
      // attempts on repetition/thinness). A named, well-documented event
      // gives it real specific facts to draw on instead.
      'How the 2017 "Attention Is All You Need" paper invented the Transformer and made ChatGPT possible',
      'How neural networks learn from data',
      'AI vs automation: what is the real difference',
      'How AI is changing jobs and education worldwide',
      'The math behind machine learning, explained simply',
      'What jobs AI can and cannot replace'
    ]
  },
  2: {
    name: 'History Turning Points',
    pillarId: 'history-turning-point',
    audience: 'Curious learners who love a good "one decision changed everything" story',
    region: 'global',
    accentColor: '#9d4edd',
    searchQueries: [
      'history discovery news',
      'ancient history archaeology news',
      'lost civilization history',
      'history this day',
      'historical turning point'
    ],
    fallbackTopics: [
      'A lost civilization and why it vanished',
      'A historical event that changed the world in one decision',
      'A rediscovered ancient artifact or site and what it reveals',
      'A conspiracy theory from history examined against the facts',
      'A battle in history that turned on one small decision',
      'An ancient technology we still do not fully understand',
      'The invention that changed history by accident',
      'A historical figure whose one choice changed everything'
    ]
  },
  3: {
    name: 'AI & ML Explained',
    pillarId: 'ai-ml-explained',
    audience: 'Students, builders, and tech-curious professionals worldwide',
    region: 'global',
    accentColor: '#4361ee',
    searchQueries: [
      'AI research news',
      'AI breakthrough explained',
      'machine learning concept explained',
      'how neural networks work',
      'AI tool comparison'
    ],
    fallbackTopics: [
      'How image-generating AI actually works',
      'Why AI models hallucinate and what causes it',
      'How AI learns to recognize faces or objects',
      'The difference between AI, machine learning, and deep learning',
      'How chatbots actually understand (or don\'t understand) you',
      'The breakthrough that made modern AI possible',
      'How self-driving cars "see" the road',
      'What a "parameter" in an AI model actually means'
    ]
  },
  4: {
    name: 'Daily Life Hacks',
    pillarId: 'daily-life-hack',
    audience: 'Anyone who wants small, high-leverage tricks for everyday life',
    region: 'global',
    accentColor: '#f77f00',
    searchQueries: [
      'life hack trending',
      'productivity trick',
      'science-backed habit',
      'daily routine hack',
      'psychology trick everyday life'
    ],
    fallbackTopics: [
      'A science-backed trick that makes a daily task easier',
      'Why a common habit is secretly working against you',
      'A memory trick that actually works, explained',
      'The psychology behind why a simple trick works',
      'A time-saving trick most people never learn',
      'A cheap fix for a problem everyone has',
      'How to break a bad habit using one small change',
      'A counterintuitive trick that saves real time or money'
    ]
  },
  5: {
    name: 'Physics & Logic Paradoxes',
    pillarId: 'physics-paradox',
    audience: 'Curious minds who love "wait, what?" ideas',
    region: 'global',
    accentColor: '#06a77d',
    searchQueries: [
      'physics paradox explained',
      'logic puzzle mind bending',
      'quantum physics explained simply',
      'thought experiment physics',
      'physics discovery news'
    ],
    fallbackTopics: [
      'A physics paradox that sounds impossible but is real',
      'A logic puzzle that breaks most people\'s intuition',
      'A thought experiment that reveals something deep about reality',
      'Why a basic assumption about time or space is wrong',
      'A quantum physics idea explained without the jargon',
      'An "impossible" result that is actually true, and why',
      'A famous unsolved paradox and the leading explanations',
      'How a simple question in physics led to a huge discovery'
    ]
  },
  6: {
    name: 'History Turning Points',
    pillarId: 'history-turning-point',
    audience: 'Curious learners who love a good "one decision changed everything" story',
    region: 'global',
    accentColor: '#9d4edd',
    searchQueries: [
      'history mystery unsolved',
      'historical discovery news',
      'history one decision',
      'forgotten history story',
      'history that changed the world'
    ],
    fallbackTopics: [
      'An unsolved historical mystery and its leading theories',
      'A forgotten historical figure who changed everything',
      'A historical "what if" and how differently things could have gone',
      'The single decision that decided a famous historical outcome',
      'A historical technology or idea that was ahead of its time',
      'A moment in history that was almost completely different',
      'How one accident changed the course of history',
      'A historical rivalry and the decision that ended it'
    ]
  },
  0: {
    name: 'Daily Life Hacks',
    pillarId: 'daily-life-hack',
    audience: 'Anyone who wants small, high-leverage tricks for everyday life',
    region: 'global',
    accentColor: '#f77f00',
    searchQueries: [
      'weekly life hack roundup',
      'productivity trick trending',
      'best life hacks this week',
      'science-backed hack'
    ],
    fallbackTopics: [
      'This week\'s most useful life hack, explained simply',
      'A weekly roundup of small tricks that add up',
      'What to know before the week ahead: one useful habit',
      'A science-backed trick worth starting this week',
      'A roundup of interesting small hacks people are trying',
      'One habit change that compounds over a week',
      'A quick recap of hacks worth remembering'
    ]
  }
};

export function getTodayNiche(date = new Date()) {
  const niche = NICHE_BY_WEEKDAY[date.getDay()];
  if (!niche) throw new Error(`No niche configured for weekday ${date.getDay()}`);
  return niche;
}

/** Deterministic daily rotation through a niche's fallback topic bank or
 * search queries, so consecutive same-day runs (long #1, long #2) don't
 * repeat, and topics still vary day to day even without live trend data. */
export function pickFallbackTopic(niche, date = new Date(), offset = 0) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const idx = (dayOfYear + offset) % niche.fallbackTopics.length;
  return niche.fallbackTopics[idx];
}

export function pickSearchQuery(niche, date = new Date(), offset = 0) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const idx = (dayOfYear + offset) % niche.searchQueries.length;
  return niche.searchQueries[idx];
}
