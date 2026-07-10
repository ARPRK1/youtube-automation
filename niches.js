// Day-of-week -> niche map. getDay(): 0=Sun ... 6=Sat.
// Per user direction: content is India-focused by default; a niche is only
// kept global/universal where the subject itself is inherently global (AI).
//
// `searchQueries` are rotated daily and fed to Google News to find today's
// real, current topic for that niche (see lib/trends.js) — the static
// `fallbackTopics` below are only used if that live lookup fails.
export const NICHE_BY_WEEKDAY = {
  1: {
    name: 'Indian Stock Market & Finance',
    audience: 'Indian retail investors and young professionals building wealth',
    region: 'IN',
    searchQueries: [
      'Indian stock market today',
      'Nifty Sensex news',
      'India mutual funds personal finance',
      'RBI interest rate India',
      'Indian IPO news'
    ],
    fallbackTopics: [
      'How compound interest builds wealth in Indian mutual funds',
      'Reading a candlestick chart for Nifty/Sensex beginners',
      'What a P/E ratio tells you about an Indian stock',
      'Index funds vs individual stocks for Indian investors',
      'How RBI rate changes move Indian markets',
      'Common mistakes Indian beginner investors make',
      'How to read an Indian company earnings report',
      'SIP and dollar-cost averaging explained for India'
    ]
  },
  2: {
    name: 'AI & Education',
    audience: 'Students, lifelong learners, and tech-curious professionals worldwide',
    region: 'global',
    searchQueries: [
      'AI news today',
      'new AI tool launch',
      'artificial intelligence breakthrough',
      'AI in India jobs education',
      'machine learning explained'
    ],
    fallbackTopics: [
      'How large language models actually work',
      'AI tools that save hours every week',
      'The history of a major AI breakthrough',
      'How neural networks learn from data',
      'AI vs automation: what is the real difference',
      'How AI is changing jobs and education in India',
      'The math behind machine learning, explained simply',
      'What jobs AI can and cannot replace'
    ]
  },
  3: {
    name: 'Indian Mystery & History',
    audience: 'Indian history buffs and true-mystery/documentary fans',
    region: 'IN',
    searchQueries: [
      'unsolved mystery India',
      'Indian history discovery',
      'ancient India archaeology news',
      'India true crime cold case',
      'lost Indian kingdom history'
    ],
    fallbackTopics: [
      'An unsolved Indian mystery and its leading theories',
      'A lost Indian kingdom or dynasty and why it vanished',
      'A historical event in India that changed the subcontinent',
      'A famous Indian cold case and what the evidence says',
      'A rediscovered ancient Indian artifact or site',
      'A conspiracy theory from Indian history examined against facts',
      'A battle in Indian history that turned on one decision',
      'An ancient Indian technology we still do not fully understand'
    ]
  },
  4: {
    name: 'Indian Food & Culture',
    audience: 'Indian home cooks, travelers, and culture enthusiasts',
    region: 'IN',
    searchQueries: [
      'Indian food trend news',
      'Indian festival celebration',
      'regional Indian cuisine',
      'street food India',
      'Indian culture tradition story'
    ],
    fallbackTopics: [
      'The history and origin story of a famous Indian dish',
      'How a regional Indian cuisine developed its flavors',
      'A street food tradition from an Indian city',
      'The science of why an Indian cooking technique works',
      'An Indian festival and the food traditions behind it',
      'How a spice from India changed world trade and history',
      'Comfort food traditions across different Indian states',
      'The story behind a beloved Indian national dish'
    ]
  },
  5: {
    name: 'Indian Tourism & Places',
    audience: 'Travelers and armchair explorers interested in India',
    region: 'IN',
    searchQueries: [
      'India travel destination',
      'hidden gem place India',
      'Indian tourism news',
      'best places to visit India',
      'India heritage site'
    ],
    fallbackTopics: [
      'An underrated Indian destination worth visiting',
      'The story behind a famous Indian landmark',
      'A hidden natural wonder in India few people know about',
      'What makes a specific Indian city unique to visit',
      'A budget travel guide to a popular Indian region',
      'An Indian island or region shaped by its geography',
      'The history behind a famous Indian travel route',
      'An Indian destination best visited in a specific season'
    ]
  },
  6: {
    name: 'Bollywood, Cricket & Entertainment',
    audience: 'Indian movie fans, cricket fans, and pop-culture followers',
    region: 'IN',
    searchQueries: [
      'Bollywood news today',
      'India cricket news',
      'Indian entertainment industry',
      'Bollywood movie box office',
      'Indian sports news'
    ],
    fallbackTopics: [
      'The making of an iconic Bollywood film scene',
      'A cricket rivalry and the story behind it',
      'How a Bollywood franchise built its fan base over decades',
      'An underdog story from Indian sports history',
      'The evolution of Bollywood cinema over time',
      'A behind-the-scenes story from a famous Indian production',
      'A record-breaking moment in Indian cricket and why it mattered',
      'How a Bollywood soundtrack shaped a film\'s legacy'
    ]
  },
  0: {
    name: 'India Week Updates & Trending',
    audience: 'Indian audience wanting a quick, sharp recap of the week',
    region: 'IN-trending',
    searchQueries: [
      'India news this week',
      'India trending today'
    ],
    fallbackTopics: [
      'This week\'s biggest India headlines, explained simply',
      'What trended in India this week and why it mattered',
      'A weekly recap of major Indian technology news',
      'A weekly recap of major Indian business and market news',
      'What to know before the week ahead in India',
      'This week\'s most talked-about Indian story, explained',
      'A roundup of interesting smaller stories from India this week'
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
