// Day-of-week niches for universal curiosity Shorts.
// pillarId must match PROVEN_GROWTH_NICHES in lib/growth.js.

export const NICHE_BY_WEEKDAY = {
  1: {
    name: 'World Facts You Did Not Know',
    pillarId: 'world-facts',
    audience: 'Curious global mobile viewers who love shareable facts',
    region: 'global',
    accentColor: '#00bbf9',
    searchQueries: [
      'weird geography facts',
      'surprising world record explained',
      'strange animal adaptation science',
      'flag and country unusual facts',
      'everyday object invention history'
    ],
    fallbackTopics: [
      'A country that has no rivers but still has a navy',
      'The only flag in the world that is not a rectangle',
      'Why airplanes are almost always painted white',
      'The city that sits in two continents at once',
      'Why we still use QWERTY when better layouts exist',
      'The animal that can survive being frozen solid and walk away',
      'A law of the sea that still decides shipwreck treasure today',
      'A fruit that is technically a berry and a vegetable that is not'
    ]
  },
  2: {
    name: 'Top 5 / Top 10 Curiosities',
    pillarId: 'top-lists',
    audience: 'Viewers who love countdowns and ranked surprises',
    region: 'global',
    accentColor: '#ffb703',
    searchQueries: [
      'top inventions that were accidents',
      'most surprising historical myths',
      'unusual world capitals history',
      'foods that were once banned',
      'jobs of the future explained'
    ],
    fallbackTopics: [
      'Top 5 inventions that were accidents',
      'Top 5 countries that changed their capital city',
      'Top 5 foods that were once banned',
      'Top 5 deadliest animals that are not what you think',
      'Top 5 languages with sounds English cannot make',
      'Top 5 places on Earth where GPS quietly fails',
      'Top 5 jobs that did not exist 20 years ago',
      'Top 5 historical myths almost everyone still believes'
    ]
  },
  3: {
    name: 'History With a Twist',
    pillarId: 'history-twist',
    audience: 'Story-first history fans who hate dry textbooks',
    region: 'global',
    accentColor: '#9d4edd',
    searchQueries: [
      'overlooked history turning point',
      'historical myth busted research',
      'forgotten empire logistics history',
      'treaty that changed borders',
      'accidental invention history'
    ],
    fallbackTopics: [
      'The map decision that still starts arguments today',
      'A war that was decided by logistics, not the famous battle',
      'The invention that was a flop for decades then remade the world',
      'A treaty clause nobody noticed until it rewrote borders',
      'A library fire that erased more knowledge than any war',
      'The accident that created a modern national dish',
      'How one bureaucratic rule reshaped a whole society',
      'A historical near miss that hinged on one overlooked detail'
    ]
  },
  4: {
    name: 'Science & Logic Curiosities',
    pillarId: 'science-curiosity',
    audience: 'Anyone who likes "wait, how does that work?" without a lecture',
    region: 'global',
    accentColor: '#06d6a0',
    searchQueries: [
      'everyday physics explained simply',
      'optical illusion brain science',
      'science paradox explained simply',
      'weird chemistry fact daily life',
      'math riddle viral explained'
    ],
    fallbackTopics: [
      'Why ice is slippery — the answer is weirder than you were taught',
      'Why hot water can freeze faster than cold water',
      'The optical illusion that proves your brain edits reality live',
      'A paradox that still splits physicists into camps',
      'The riddle that stumped mathematicians for decades',
      'Why your phone battery myths refuse to die',
      'How a coin flip is less random than people think',
      'The science of why time feels faster as you age'
    ]
  },
  5: {
    name: 'Riddles, Quizzes & Brain Twists',
    pillarId: 'mind-quiz',
    audience: 'Viewers who pause, guess, and comment',
    region: 'global',
    accentColor: '#e63946',
    searchQueries: [
      'viral riddle explained answer',
      'logic puzzle most people get wrong',
      'geography quiz hard clues',
      'lateral thinking puzzle classic',
      'brain teaser science answer'
    ],
    fallbackTopics: [
      'A riddle 80 percent of adults get wrong on the first try',
      'Can you spot the pattern before the answer?',
      'The quiz question that goes viral every year',
      'A logic puzzle with only one honest answer',
      'Guess the country from three impossible clues',
      'Which liquid freezes first — the counterintuitive answer',
      'A classic lateral-thinking puzzle with a clean twist ending'
    ]
  },
  6: {
    name: 'World Facts You Did Not Know',
    pillarId: 'world-facts',
    audience: 'Weekend scroll curiosity audience',
    region: 'global',
    accentColor: '#00bbf9',
    searchQueries: [
      'amazing geography fact',
      'unusual animal fact science',
      'world history surprising fact',
      'technology everyday myth',
      'space earth surprising fact'
    ],
    fallbackTopics: [
      'Why the shortest war in history was over almost before it started',
      'A desert that is colder at night than most people expect',
      'The mountain that is taller than Everest depending how you measure',
      'Why some islands disappear from maps and reappear later',
      'The color that did not have a common name in many languages for centuries',
      'How a simple shipping container redesign remade global trade'
    ]
  },
  0: {
    name: 'Top 5 / Top 10 Curiosities',
    pillarId: 'top-lists',
    audience: 'Sunday binge countdown viewers',
    region: 'global',
    accentColor: '#ffb703',
    searchQueries: [
      'top surprising science facts',
      'top historical coincidences',
      'top mysterious places earth',
      'top mind blowing geography facts'
    ],
    fallbackTopics: [
      'Top 5 coincidences that shaped world history',
      'Top 5 places scientists still cannot fully explain',
      'Top 5 everyday myths school still teaches wrong',
      'Top 5 animals with superpowers that sound fake but are real',
      'Top 5 borders that make no sense on a map',
      'Top 5 inventions older than most people think'
    ]
  }
};

export function getTodayNiche(date = new Date()) {
  const niche = NICHE_BY_WEEKDAY[date.getDay()];
  if (!niche) throw new Error(`No niche configured for weekday ${date.getDay()}`);
  return niche;
}

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
