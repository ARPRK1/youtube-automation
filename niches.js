// Day-of-week -> niche map. getDay(): 0=Sun ... 6=Sat.
export const NICHE_BY_WEEKDAY = {
  1: {
    name: 'Stock Market & Finance',
    audience: 'Retail investors, young professionals building wealth',
    topics: [
      'How compound interest actually builds wealth',
      'Reading a candlestick chart for beginners',
      'What a P/E ratio tells you about a stock',
      'Index funds vs individual stocks',
      'How interest rate changes move the market',
      'Common beginner investing mistakes',
      'How to read a company earnings report',
      'Dollar-cost averaging explained'
    ]
  },
  2: {
    name: 'AI & Education',
    audience: 'Students, lifelong learners, tech-curious professionals',
    topics: [
      'How large language models actually work',
      'AI tools that save hours every week',
      'The history of a major AI breakthrough',
      'How neural networks learn from data',
      'AI vs automation: what is the real difference',
      'How to learn any skill faster using AI tools',
      'The math behind machine learning, explained simply',
      'What jobs AI can and cannot replace'
    ]
  },
  3: {
    name: 'Mystery & History',
    audience: 'History buffs, true-mystery and documentary fans',
    topics: [
      'An unsolved mystery from history and its leading theories',
      'A civilization that vanished without a clear explanation',
      'A historical event that changed the world in one day',
      'A famous cold case and what evidence says',
      'A lost city or artifact and its rediscovery',
      'A conspiracy theory examined against the facts',
      'A war or battle that turned on one decision',
      'An ancient technology we still do not fully understand'
    ]
  },
  4: {
    name: 'Food & Culture',
    audience: 'Home cooks, travelers, culture enthusiasts',
    topics: [
      'The history and origin story of a famous dish',
      'How a regional cuisine developed its flavors',
      'A street food tradition from around the world',
      'The science of why a cooking technique works',
      'A cultural festival and the food behind it',
      'How a spice changed world trade and history',
      'Comfort food traditions across different cultures',
      'The story behind a beloved national dish'
    ]
  },
  5: {
    name: 'Tourism & Places',
    audience: 'Travelers and armchair explorers',
    topics: [
      'An underrated destination worth visiting',
      'The story behind a famous landmark',
      'A hidden natural wonder few people know about',
      'What makes a specific city unique to visit',
      'A budget travel guide to a popular region',
      'An island or region shaped by its geography',
      'The history behind a famous travel route',
      'A destination best visited in a specific season'
    ]
  },
  6: {
    name: 'Movies, Sports & Entertainment',
    audience: 'Movie fans, sports fans, pop-culture followers',
    topics: [
      'The making of an iconic film scene',
      'A sports rivalry and the story behind it',
      'How a franchise built its fan base over decades',
      'An underdog story from sports history',
      'The evolution of a film genre over time',
      'A behind-the-scenes story from a famous production',
      'A record-breaking moment in sports and why it mattered',
      'How a soundtrack shaped a movie\'s legacy'
    ]
  },
  0: {
    name: 'Week Updates, Trending & News',
    audience: 'General audience wanting a quick recap of the week',
    topics: [
      'This week\'s biggest global headlines, explained simply',
      'What trended online this week and why it mattered',
      'A weekly recap of major technology news',
      'A weekly recap of major business and market news',
      'What to know before the week ahead',
      'This week\'s most talked-about story, explained',
      'A roundup of interesting smaller stories from this week'
    ]
  }
};

export function getTodayNiche(date = new Date()) {
  const niche = NICHE_BY_WEEKDAY[date.getDay()];
  if (!niche) throw new Error(`No niche configured for weekday ${date.getDay()}`);
  return niche;
}

export function pickTopic(niche, date = new Date(), offset = 0) {
  // Deterministic rotation through the topic bank based on day-of-year, so
  // consecutive runs (long #1, long #2) don't repeat the same topic.
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const idx = (dayOfYear + offset) % niche.topics.length;
  return niche.topics[idx];
}
