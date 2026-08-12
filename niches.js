// Day-of-week -> niche map. getDay(): 0=Sun ... 6=Sat.
// 2026-08-12: food-first only (money paused after weak post-pivot avg ~42 views).
// pillarId must match PROVEN_GROWTH_NICHES in lib/growth.js.

export const NICHE_BY_WEEKDAY = {
  1: {
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians and anyone who loves Indian cuisine stories',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'Indian food origin history',
      'street food India story',
      'Indian spice trade history',
      'dosa idli origin history',
      'butter chicken history Delhi'
    ],
    fallbackTopics: [
      'Why butter chicken was invented in a Delhi restaurant, not a royal kitchen',
      'Why dosa is a fermented science project, not just a breakfast crepe',
      'How vada pav became Mumbai\'s working-class burger',
      'The real story behind samosa traveling from Central Asia to every Indian street',
      'How black pepper from Kerala changed global trade routes forever',
      'Why chai is India\'s real national drink, not coffee or lassi',
      'How pickle (achar) was India\'s original food preservation tech',
      'The colonial accident that created Indian Chinese cuisine'
    ]
  },
  2: {
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians and anyone who loves Indian cuisine stories',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'Indian street food history',
      'regional Indian dish origin',
      'spice India world history',
      'Indian festival food tradition',
      'paneer curry origin India'
    ],
    fallbackTopics: [
      'How jalebi became festival gold from a simple batter accident',
      'Why filter coffee culture in South India never needed a cafe chain',
      'The railway snack that taught India how to eat on the move',
      'Why paneer shows up in North Indian restaurants but not the same way in the South',
      'The port that made Indian chili part of everyday cooking worldwide',
      'How idli was engineered for travel and temple kitchens',
      'Why mango pickle lasts months without a fridge — the real method',
      'The street cart trick behind India\'s most ordered delivery kebab'
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
      'Indian cooking technique history',
      'tandoor history India',
      'masala origin story India',
      'Indian Chinese food history',
      'Gujarati Rajasthani food origin'
    ],
    fallbackTopics: [
      'How one spice mix recipe traveled from royal kitchens to every packet today',
      'The dish British soldiers loved that Indians reinvented after independence',
      'The science of why a classic Indian cooking technique actually works',
      'How a regional Indian cuisine developed its signature flavors',
      'An Indian festival and the food traditions behind it',
      'How tandoor cooking traveled and changed restaurant menus worldwide',
      'The forgotten grain India almost abandoned and is now rediscovering',
      'Why some Indian recipes were designed to survive long journeys'
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
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians — weekend scroll audience',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'India food trending this week',
      'Indian cuisine news story',
      'street food India viral',
      'Indian recipe history story',
      'chaat pani puri origin'
    ],
    fallbackTopics: [
      'Why pani puri is India\'s most democratic street food',
      'How chaat turned leftover flavors into a national addiction',
      'A regional Indian dish that went national without anyone noticing',
      'How a single spice shaped both Indian kitchens and global wars',
      'The restaurant trick behind India\'s most ordered delivery dish',
      'A food tradition from one Indian state that confuses everyone else',
      'The origin story of a snack sold at every Indian railway platform',
      'Why South Indian filter coffee is a ritual, not a drink order'
    ]
  },
  0: {
    name: 'Indian Food Origin Stories',
    pillarId: 'indian-food-story',
    audience: 'Food-curious Indians — Sunday scroll audience',
    region: 'IN',
    accentColor: '#f77f00',
    searchQueries: [
      'India food weekend story',
      'Indian home cooking tradition',
      'Sunday Indian thali history',
      'Indian comfort food origin'
    ],
    fallbackTopics: [
      'What a real Indian thali was designed to do (not just look pretty)',
      'Why every Indian state argues about the "correct" way to make dal',
      'How comfort food in India is really a climate and crop story',
      'The home kitchen technique restaurants quietly copy',
      'Why ghee stayed sacred long after oil became cheaper',
      'How leftover rice became a national breakfast strategy',
      'The festival sweet that only appears once a year for a reason'
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
