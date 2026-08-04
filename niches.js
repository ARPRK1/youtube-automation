// Day-of-week -> niche map. getDay(): 0=Sun ... 6=Sat.
//
// BOLD REVERT 2026-08-04: India food / money / history / places only.
// Live audit proved food-origin Shorts are the only cluster that hit 1k+ views.
// Abstract AI/physics/daily-hack pillars (2026-07-24 pivot) averaged <70 views.
//
// `searchQueries` feed Google News (hl=en-IN) for real current topics.
// `fallbackTopics` compete in scoring every day so thin news days still ship.
// `pillarId` must match PROVEN_GROWTH_NICHES ids in lib/growth.js.

export const NICHE_BY_WEEKDAY = {
  1: {
    name: 'Simple Indian Money Habits',
    pillarId: 'indian-money-simple',
    audience: 'Indian retail investors and young professionals building wealth',
    region: 'IN',
    accentColor: '#2a9d8f',
    searchQueries: [
      'Indian stock market today',
      'Nifty Sensex mutual funds India',
      'RBI interest rate India EMI',
      'India SIP personal finance',
      'Indian IPO tax budget news'
    ],
    fallbackTopics: [
      'The SIP mistake that quietly costs Indian investors lakhs over 10 years',
      'What one RBI rate decision actually does to your home loan EMI',
      'Index funds vs active funds in India — what the 10-year data actually shows',
      'The hidden fee most mutual fund apps never explain clearly',
      'Why your salary growth can still leave you poorer in real terms',
      'How compound interest builds real wealth in Indian mutual funds',
      'Common mistakes Indian beginner investors make with SIPs',
      'The one number on an Indian payslip most people never check'
    ]
  },
  2: {
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians and anyone who loves Indian cuisine stories',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'Indian food origin history',
      'street food India story',
      'Indian spice trade history',
      'regional Indian cuisine history',
      'butter chicken biryani origin'
    ],
    fallbackTopics: [
      'Why butter chicken was invented in a Delhi restaurant, not a royal kitchen',
      'The real origin of biryani and why every city claims it',
      'How black pepper from Kerala changed global trade routes forever',
      'The colonial accident that created Indian Chinese cuisine',
      'Why chai is India\'s real national drink, not coffee or lassi',
      'How one spice mix recipe traveled from royal kitchens to every packet today',
      'The dish British soldiers loved that Indians reinvented after independence',
      'The street food that became a national obsession in under 50 years'
    ]
  },
  3: {
    name: 'India History With a Twist',
    pillarId: 'india-history-twist',
    audience: 'Indian history buffs and documentary Shorts fans',
    region: 'IN',
    accentColor: '#9d4edd',
    searchQueries: [
      'Indian history discovery news',
      'ancient India archaeology find',
      'lost Indian kingdom history',
      'Mughal Maratha history explained',
      'Indian fort battle history'
    ],
    fallbackTopics: [
      'The one decision at Haldighati that still divides historians',
      'How a forgotten Indian kingdom disappeared without a major battle',
      'An ancient Indian technology we still do not fully understand',
      'The trade route that made one Indian port richer than most European cities',
      'Why a single treaty clause mattered more than the war that followed it',
      'A battle in Indian history that turned on one overlooked decision',
      'The map decision that still shapes Indian borders and arguments today',
      'A rediscovered Indian site that rewrote what historians thought they knew'
    ]
  },
  4: {
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians and anyone who loves Indian cuisine stories',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'Indian festival food tradition',
      'regional Indian dish origin',
      'Indian street food history',
      'spice India world history',
      'Indian cooking technique science'
    ],
    fallbackTopics: [
      'The science of why a classic Indian cooking technique actually works',
      'How a regional Indian cuisine developed its signature flavors',
      'An Indian festival and the food traditions behind it',
      'Comfort food traditions across different Indian states',
      'The story behind a beloved Indian national dish',
      'Why mango pickle lasts months without a fridge — the real method',
      'How tandoor cooking traveled and changed restaurant menus worldwide',
      'The forgotten grain India almost abandoned and is now rediscovering'
    ]
  },
  5: {
    name: 'Hidden India Places',
    pillarId: 'india-place-secret',
    audience: 'Travelers and armchair explorers interested in India',
    region: 'IN',
    accentColor: '#06a77d',
    searchQueries: [
      'hidden gem place India travel',
      'underrated India destination',
      'India heritage site secret',
      'Indian fort temple hidden',
      'best places visit India locals'
    ],
    fallbackTopics: [
      'The hidden valley locals visit that tourists almost never find',
      'Why one Indian fort was designed to confuse every invading army',
      'The beach town that stayed quiet while Goa got famous',
      'A temple town whose architecture still puzzles modern engineers',
      'The Himalayan route that was a secret trade path for centuries',
      'An underrated Indian destination worth visiting off-season',
      'The story behind a famous Indian landmark most visitors miss',
      'A natural wonder in India few people outside the region know about'
    ]
  },
  6: {
    name: 'Simple Indian Money Habits',
    pillarId: 'indian-money-simple',
    audience: 'Indian retail investors and young professionals building wealth',
    region: 'IN',
    accentColor: '#2a9d8f',
    searchQueries: [
      'India personal finance tips',
      'mutual fund SIP India explained',
      'India inflation salary news',
      'RBI policy impact middle class',
      'Indian tax saving investment'
    ],
    fallbackTopics: [
      'How to read an Indian company earnings report as a beginner',
      'What a P/E ratio actually tells you about an Indian stock',
      'FD vs debt funds in India when rates are changing',
      'The real cost of credit card minimum payments in India',
      'Why emergency funds matter more than the next hot IPO',
      'How gold still fits (or does not) in a modern Indian portfolio',
      'The difference between wealth creation and looking rich in India',
      'What Indian millennials get wrong about home loans'
    ]
  },
  0: {
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians — Sunday scroll audience',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'India food trending this week',
      'Indian cuisine news story',
      'street food India viral',
      'Indian recipe history story'
    ],
    fallbackTopics: [
      'This week\'s most interesting Indian food story, explained simply',
      'A regional Indian dish that went national without anyone noticing',
      'How a single spice shaped both Indian kitchens and global wars',
      'The restaurant trick behind India\'s most ordered delivery dish',
      'Why some Indian recipes were designed to survive long journeys',
      'A food tradition from one Indian state that confuses everyone else',
      'The origin story of a snack sold at every Indian railway platform'
    ]
  }
};

export function getTodayNiche(date = new Date()) {
  const niche = NICHE_BY_WEEKDAY[date.getDay()];
  if (!niche) throw new Error(`No niche configured for weekday ${date.getDay()}`);
  return niche;
}

/** Deterministic daily rotation through a niche's fallback topic bank or
 * search queries, so consecutive same-day runs don't repeat. */
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
