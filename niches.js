// Day-of-week -> niche map. getDay(): 0=Sun ... 6=Sat.
// Niche pivot (2026-07-24): replaced the old India-only food/money/history/
// places rotation with a universal, sketch/diagram-friendly identity - AI &
// ML, history turning points, daily-life hacks, physics/logic paradoxes -
// so every day stays visually generatable without location-specific b-roll
// (see lib/ai-image.js's whiteboard/diagram styles) and the audience isn't
// region-locked. Distribution roughly follows lib/growth.js's pillar
// weights (AI/ML and history/hacks get 2 days each, physics gets 1).
//
// Depth pass (2026-07-28): the original fallbackTopics were 101-level
// explainers ("How large language models actually work", "A science-backed
// trick that makes a daily task easier") -- generic, already covered
// everywhere, and (confirmed live) the same handful kept winning the
// scoring pass run after run because they were the most search-familiar
// phrases, not the best topics. Rewritten to name specific mechanisms,
// documented events, and real findings that are advanced and under-covered
// but genuinely important, matching lib/growth.js's hooks and
// lib/research.js's scoring prompt (both updated the same day).
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
      'AI research breakthrough explained',
      'new AI interpretability research',
      'AI alignment research news',
      'machine learning research finding',
      'how do neural networks actually learn'
    ],
    fallbackTopics: [
      'How the 2017 "Attention Is All You Need" paper invented the Transformer and made ChatGPT possible',
      'Mechanistic interpretability: researchers who reverse-engineer what is actually inside a trained neural network',
      'Catastrophic forgetting: why neural networks erase old skills the moment they learn new ones',
      'The "bitter lesson": why brute-force compute keeps beating clever hand-engineered AI methods',
      'Mode collapse: why some AI image generators keep quietly producing the same few outputs',
      'RLHF: the human-feedback technique that turned raw language models into usable chatbots',
      'Why AI models hallucinate: the actual mechanism, not just "they guess"',
      'The "double descent" phenomenon that broke a rule statisticians trusted for decades'
    ]
  },
  2: {
    name: 'History Turning Points',
    pillarId: 'history-turning-point',
    audience: 'Curious learners who love a good "one decision changed everything" story',
    region: 'global',
    accentColor: '#9d4edd',
    searchQueries: [
      'overlooked history research finding',
      'historian new discovery archive',
      'forgotten history that shaped the world',
      'history research reassessment',
      'declassified history discovery'
    ],
    fallbackTopics: [
      'The administrative or logistics failure that quietly collapsed an empire, not the war everyone blames',
      'The invention that was a commercial flop but changed everything decades later',
      'The standardization fight that decided how the entire world measures something today',
      'The logistics problem that decided a war before a single major battle was fought',
      'A forgotten scientific rivalry that shaped an entire field more than any single discovery',
      'The accidental discovery that was dismissed for decades before anyone realized it mattered',
      'How one mapping decision at a 19th-century conference still shapes conflicts today',
      'A technology invented far earlier than history usually credits, and why it was forgotten'
    ]
  },
  3: {
    name: 'AI & ML Explained',
    pillarId: 'ai-ml-explained',
    audience: 'Students, builders, and tech-curious professionals worldwide',
    region: 'global',
    accentColor: '#4361ee',
    searchQueries: [
      'AI model architecture research',
      'AI safety research finding',
      'large language model limitation research',
      'AI reasoning research explained',
      'AI scaling law research'
    ],
    fallbackTopics: [
      'Mixture-of-experts: how modern AI models get bigger without getting proportionally slower',
      'Adversarial examples: why changing a few pixels can fool a state-of-the-art image classifier',
      'Quantization: how AI models get shrunk to run on a phone without losing much accuracy',
      'The vanishing gradient problem that stalled deep learning research for two decades',
      'Tokenization: the hidden step that explains why AI is oddly bad at arithmetic and spelling',
      'Emergent abilities in large language models: real discovery or a measurement artifact?',
      'Chain-of-thought prompting: the surprising reason asking AI to "think step by step" works',
      'The alignment problem: why making AI helpful turned out to be harder than making it capable'
    ]
  },
  4: {
    name: 'Daily Life Hacks',
    pillarId: 'daily-life-hack',
    audience: 'Anyone who wants evidence-based, high-leverage insight into everyday behavior',
    region: 'global',
    accentColor: '#f77f00',
    searchQueries: [
      'behavioral science research finding',
      'psychology research daily habits',
      'productivity science research',
      'decision making research finding',
      'cognitive science everyday life'
    ],
    fallbackTopics: [
      'Why willpower reliably fails, and what the actual research says replaces it',
      'Decision fatigue: the hidden mechanism behind your worst choices at the end of the day',
      'The Zeigarnik effect: why an unfinished task occupies more of your mind than a finished one',
      'Attention residue: the real cognitive-science reason switching tasks wrecks your focus',
      'Why "eat the frog" oversimplifies how prioritization actually works, and what works better',
      'The science of habit stacking, and the common way most people apply it wrong',
      'Cognitive load: why simplifying a decision beats trying to make a technically "better" one',
      'The planning fallacy: why you underestimate how long something takes, even knowing this bias exists'
    ]
  },
  5: {
    name: 'Physics & Logic Paradoxes',
    pillarId: 'physics-paradox',
    audience: 'Curious minds who want the real explanation behind "wait, what?" ideas',
    region: 'global',
    accentColor: '#06a77d',
    searchQueries: [
      'quantum mechanics research explained',
      'physics paradox research finding',
      'theoretical physics discovery explained',
      'unsolved physics problem research',
      'physics thought experiment explained'
    ],
    fallbackTopics: [
      'The measurement problem in quantum mechanics that still has no agreed-upon answer',
      'The black hole information paradox, and why it broke physics for fifty years',
      'Why entropy only increases: the actual reason time has a direction',
      'Bell\'s theorem: the experiment that ruled out an entire category of explanations for reality',
      'The Fermi paradox\'s least-known but most unsettling resolution',
      'Gödel\'s incompleteness theorems: what they actually prove, and what people wrongly think they prove',
      'The twin paradox resolved properly: the real reason one twin ages less',
      'Newcomb\'s paradox: the decision-theory problem that splits philosophers into two camps'
    ]
  },
  6: {
    name: 'History Turning Points',
    pillarId: 'history-turning-point',
    audience: 'Curious learners who love a good "one decision changed everything" story',
    region: 'global',
    accentColor: '#9d4edd',
    searchQueries: [
      'historical reassessment new evidence',
      'history overlooked figure research',
      'archive discovery history research',
      'historian reinterpretation finding',
      'history hidden cause research'
    ],
    fallbackTopics: [
      'The currency or trade decision that quietly triggered an empire\'s long decline',
      'The overlooked treaty clause that caused consequences nobody at the table intended',
      'A historical "near miss" where the outcome hinged on one overlooked detail',
      'The scientific idea that was correct but ridiculed for a generation before being proven',
      'How one bureaucratic rule change reshaped an entire society over decades',
      'A rivalry between two lesser-known figures that shaped a field more than any single event',
      'A pivotal historical decision made for reasons historians still cannot fully agree on',
      'The infrastructure project that changed a region\'s history more than any war fought over it'
    ]
  },
  0: {
    name: 'Daily Life Hacks',
    pillarId: 'daily-life-hack',
    audience: 'Anyone who wants evidence-based, high-leverage insight into everyday behavior',
    region: 'global',
    accentColor: '#f77f00',
    searchQueries: [
      'weekly behavioral science research roundup',
      'psychology research finding this week',
      'productivity science research explained',
      'decision science research finding'
    ],
    fallbackTopics: [
      'This week\'s most under-discussed habit-science finding, explained properly',
      'Why most productivity advice quietly falls apart once real life gets in the way',
      'The compounding-habit math: why small daily changes beat occasional big ones',
      'A counterintuitive research finding about motivation that contradicts popular advice',
      'The hidden cost of "just one more" that most people consistently underestimate',
      'Why willpower-based advice sets people up to fail, and what the evidence says works instead',
      'One overlooked psychological principle worth actually understanding, not just repeating'
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
