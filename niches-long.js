// Long-form niche: "Amazing Places & Earth's Wonders" — Top-10 list videos.
// Chosen for the two levers that matter for long-form growth:
//   1. CTR — dramatic places/nature/animals make the strongest thumbnails.
//   2. Visuals — concrete places, landscapes, animals, and structures are what
//      our stock b-roll + AI (Flux) + concept-storyboard engine render best.
//      (No people-focus or abstract subjects, where the visual tools are weak.)
// Every topic is a Top-10 list so it sustains 5–8 min naturally and keeps the
// viewer watching to the reveal — good for watch-hours (the YPP path).
//
// Deliberately physical-world / no-anatomy so the visuals stay safe.

export const LONG_TOPICS = [
  // Impossible / surreal places
  'Top 10 places on Earth that look like another planet',
  'Top 10 natural wonders you won\'t believe are real',
  'Top 10 islands that don\'t seem real',
  'Top 10 lakes with impossible colors',
  'Top 10 places where the laws of physics seem to break',
  'Top 10 places that vanish and reappear from maps',
  // Extreme Earth
  'Top 10 most isolated places humans actually live',
  'Top 10 hottest and coldest places on Earth',
  'Top 10 places with the wildest weather on record',
  'Top 10 deserts that break every rule',
  'Top 10 volcanoes that changed the world',
  'Top 10 canyons carved by deep time',
  // Water & ice
  'Top 10 waterfalls that defy belief',
  'Top 10 caves that hide entire worlds',
  'Top 10 glaciers hiding ancient secrets',
  'Top 10 salt flats and mirror lakes',
  'Top 10 rivers that flow the "wrong" way',
  'Top 10 beaches that shouldn\'t exist',
  // Lost & abandoned
  'Top 10 lost cities rediscovered by accident',
  'Top 10 abandoned places nature completely reclaimed',
  'Top 10 shipwrecks frozen in time',
  'Top 10 abandoned megaprojects around the world',
  // Ancient & engineering
  'Top 10 ancient structures we still cannot explain',
  'Top 10 engineering marvels hidden in plain sight',
  'Top 10 bridges that pushed the limits of possibility',
  'Top 10 tunnels that redrew the map',
  'Top 10 monuments with buried secrets',
  'Top 10 ancient roads that built empires',
  // Animals
  'Top 10 animals with real superpowers',
  'Top 10 creatures that survive the impossible',
  'Top 10 deep-sea animals that look alien',
  'Top 10 animals that glow in the dark',
  'Top 10 fastest animals on Earth',
  'Top 10 animals with the strangest defenses',
  'Top 10 largest creatures ever to exist',
  'Top 10 animals that can regenerate their bodies',
  // Forests, mountains, land
  'Top 10 forests unlike anywhere else on Earth',
  'Top 10 mountains with deadly secrets',
  'Top 10 underground wonders beneath our feet',
  'Top 10 strangest borders on Earth',
  // Sky & space (AI-friendly visuals)
  'Top 10 places in the solar system stranger than fiction',
  'Top 10 moons more bizarre than planets',
  'Top 10 skies that do not look real',
  'Top 10 rarest weather events ever filmed',
  // Mysteries (visual)
  'Top 10 unexplained places scientists still study',
  'Top 10 phenomena Earth still cannot explain',
  'Top 10 places that appear on no official map',
  'Top 10 sounds and signals we still cannot explain',
  'Top 10 tallest structures through all of history',
  'Top 10 coincidences of geography that shaped history'
];

function dayIndex(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

/**
 * Deterministic long-topic pick for a given date, skipping any title used in
 * `recentTitles` (a Set/array of lowercased titles from history) so a run
 * never repeats a recent long. Alternate-day scheduling + 48 topics gives ~3
 * months before any repeat.
 */
export function pickLongTopic(date = new Date(), recentTitles = []) {
  const recent = new Set([...recentTitles].map((t) => String(t).toLowerCase()));
  const base = dayIndex(date) % LONG_TOPICS.length;
  for (let i = 0; i < LONG_TOPICS.length; i++) {
    const t = LONG_TOPICS[(base + i) % LONG_TOPICS.length];
    if (!recent.has(t.toLowerCase())) return t;
  }
  return LONG_TOPICS[base]; // all seen recently — fall back to the rotation pick
}
