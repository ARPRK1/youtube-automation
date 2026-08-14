// Generates a 90-day content calendar from a CURATED, safety-screened topic
// pool. Every topic is run through the exact same filters the pipeline uses
// (NSFW_VISUAL_RE + isOffBrandTopic) so we can PROVE the plan contains no
// anatomical/explicit/off-brand topics before anything is produced. Output:
// a reviewable Markdown calendar (plan/90-day-content-plan.md) + a console
// safety report. Deliberately physical-world / object / place / logic topics
// only — nothing body/anatomy-adjacent, so even the VISUALS stay safe.
//
// Run: node scripts/plan-90-days.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NSFW_VISUAL_RE } from '../lib/script-writer.js';
import { isOffBrandTopic } from '../lib/growth.js';

// ~16 per pillar. All framed as curiosity hooks; all safe to VISUALIZE with
// objects/places/maps/diagrams (no bodies, no anatomy, no gore).
const POOL = {
  'world-facts': [
    'The country with no rivers that still keeps a navy',
    'The only national flag that is not a rectangle',
    'Why almost every airplane is painted white',
    'Istanbul, the city that sits on two continents',
    'Why we still use the QWERTY keyboard when better layouts exist',
    'The wood frog that freezes solid every winter and hops away in spring',
    'Point Nemo, the most remote spot in all the oceans',
    'Why an octopus has three hearts and blue blood',
    'The Dead Sea, and why you simply cannot sink in it',
    'Bir Tawil, the patch of land no country wants to own',
    'Lake Natron, the lake that turns animals to stone',
    'Why a day on Venus is longer than its year',
    'The Sargasso Sea, the only sea with no coastline',
    'Mauna Kea, the mountain taller than Everest if you measure from the base',
    'Why the Netherlands keeps building new land out of the sea',
    'The single road on Earth that it is illegal to walk on'
  ],
  'top-lists': [
    'Top 5 inventions discovered completely by accident',
    'Top 5 countries that moved their capital city',
    'Top 5 foods that were once banned',
    'Top 5 animals with senses humans will never have',
    'Top 5 languages with sounds English cannot make',
    'Top 5 places on Earth where GPS quietly fails',
    'Top 5 jobs that did not exist twenty years ago',
    'Top 5 historical myths almost everyone still believes',
    'Top 5 borders that make no sense on a map',
    'Top 5 everyday objects with a hidden second purpose',
    'Top 5 ancient structures we still cannot fully explain',
    'Top 5 islands that appear and vanish from maps',
    'Top 5 words that simply do not translate into English',
    'Top 5 rivers that flow the "wrong" way',
    'Top 5 abandoned places that nature completely reclaimed',
    'Top 5 tiny ideas that quietly changed the whole world'
  ],
  'history-twist': [
    'The shortest war in history that lasted under 40 minutes',
    'The shipping container redesign that remade global trade',
    'The invention that flopped for decades and then changed everything',
    'The phantom island that sat on world maps for a whole century',
    'The library fire that erased centuries of knowledge',
    'The Great Emu War that Australia lost to a flock of birds',
    'Wojtek, the bear that was enlisted as a real soldier',
    'Why old European maps drew California as an island',
    'The con man who "sold" the Eiffel Tower twice',
    'How a single weather forecast decided the timing of D-Day',
    'The richest person in history you have probably never heard of',
    'The message in a bottle that took a century to arrive',
    'The stamp worth more than a mansion',
    'The clock tower town that refused to change its time',
    'The lighthouse keepers who vanished without a trace',
    'The one overlooked detail that saved an entire city'
  ],
  'science-curiosity': [
    'Why ice is actually slippery, and the answer you were taught is wrong',
    'The Mpemba effect, where hot water can freeze faster than cold',
    'Why the sky is blue but sunsets turn red',
    'Why time seems to speed up as you get older',
    'Why mirrors seem to flip left and right but not up and down',
    'Why a coin flip is far less random than you think',
    'Why metal feels colder than wood at the same temperature',
    'Petrichor, the real reason rain has a smell',
    'Why popcorn actually pops',
    'Why the deep ocean looks blue instead of clear',
    'Why soap bubbles are always perfectly round',
    'Why lightning forks instead of going straight down',
    'Why rainbows are curved and never straight',
    'Why the Moon looks huge on the horizon',
    'Why honey crystallizes and how to fix it',
    'Why a spinning top refuses to fall over'
  ],
  'mind-quiz': [
    'The riddle that 80 percent of adults get wrong on the first try',
    'Guess the country from three impossible clues',
    'The logic puzzle that has only one honest answer',
    'Can you spot the hidden pattern before the reveal?',
    'A kilo of feathers or a kilo of steel, which is heavier?',
    'The two-doors, two-guards puzzle explained cleanly',
    'The birthday paradox, why the odds are smaller than you think',
    'The classic river-crossing puzzle with a clean twist',
    'Which line is longer? The illusion that fools everyone',
    'The missing-dollar riddle that breaks people',
    'Guess the invention from its original patent drawing',
    'The rope-bridge and one flashlight crossing puzzle',
    'The monk who walks up a mountain riddle',
    'The twelve coins and one balance-scale puzzle',
    'The three light switches and one bulb puzzle',
    'The lateral-thinking classic with a one-line answer'
  ],
  'food-story': [
    'Why a baker\'s dozen is thirteen, not twelve',
    'The accidental origin of the sandwich',
    'How ketchup started life as medicine',
    'Why carrots used to be purple, not orange',
    'How the croissant is not actually French',
    'The spice that was once worth more than gold',
    'How pizza margherita got its name',
    'Why some traditional cheeses are technically illegal',
    'The real story behind how butter chicken was invented',
    'Why chili peppers hurt, and why we crave them anyway'
  ]
};

// Weighted rotation (mirrors lib/growth.js priorities): curiosity engines
// (facts, lists) most often; food occasional seasoning.
const ROTATION = [
  'world-facts', 'top-lists', 'history-twist', 'science-curiosity', 'mind-quiz',
  'world-facts', 'top-lists', 'science-curiosity', 'history-twist', 'mind-quiz',
  'world-facts', 'top-lists', 'food-story', 'science-curiosity', 'history-twist'
];

function screen(topic) {
  const problems = [];
  if (NSFW_VISUAL_RE.test(topic)) problems.push('NSFW/anatomical term');
  if (isOffBrandTopic(topic)) problems.push('off-brand');
  return problems;
}

const STOP = new Set(['that', 'this', 'with', 'from', 'what', 'when', 'which', 'your', 'their', 'they', 'them', 'have', 'been', 'were', 'will', 'about', 'into', 'over', 'still', 'only', 'most', 'more', 'than', 'then', 'never', 'every', 'some', 'does']);
function keyWords(t) {
  return new Set(String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
}
/** Two topics are near-duplicates if they share >= 45% of their meaningful
 * words — catches "shortest war ... 40 minutes" style repeats and any two
 * topics that would read as the same Short. */
function findNearDuplicates(topics) {
  const pairs = [];
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = keyWords(topics[i]); const b = keyWords(topics[j]);
      if (a.size === 0 || b.size === 0) continue;
      const shared = [...a].filter((w) => b.has(w)).length;
      const ratio = shared / Math.min(a.size, b.size);
      if (ratio >= 0.45) pairs.push({ a: topics[i], b: topics[j], ratio: ratio.toFixed(2) });
    }
  }
  return pairs;
}

async function main() {
  // Safety screen — must be clean before we emit a plan.
  const all = Object.entries(POOL).flatMap(([pillar, list]) => list.map((t) => ({ pillar, topic: t })));
  const flagged = all.filter(({ topic }) => screen(topic).length > 0);
  console.log(`[plan] screened ${all.length} curated topics across ${Object.keys(POOL).length} pillars`);
  if (flagged.length > 0) {
    console.error(`[plan] SAFETY FAIL — ${flagged.length} topic(s) tripped a filter:`);
    for (const f of flagged) console.error(`  - [${f.pillar}] "${f.topic}" :: ${screen(f.topic).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[plan] SAFETY PASS — 0 anatomical/explicit/off-brand topics.');

  // No-repeat validation: every topic in the bank must be unique AND not a
  // near-duplicate of another (owner 2026-08-14: 'shortest war', 'ice is
  // slippery', 'country with a navy' were showing up twice).
  const titles = all.map((x) => x.topic);
  const exactDupes = titles.filter((t, i) => titles.indexOf(t) !== i);
  const nearDupes = findNearDuplicates(titles);
  if (exactDupes.length > 0 || nearDupes.length > 0) {
    console.error('[plan] DEDUPE FAIL:');
    for (const t of new Set(exactDupes)) console.error(`  exact duplicate: "${t}"`);
    for (const p of nearDupes) console.error(`  near-duplicate (${p.ratio}): "${p.a}"  <->  "${p.b}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`[plan] DEDUPE PASS — all ${titles.length} topics unique, no near-duplicates.`);

  // Schedule: place each UNIQUE topic exactly once, round-robin across pillars
  // for day-to-day variety. Because every topic is used at most once, the
  // 90-day schedule has ZERO repeats (previously a per-pillar wrap re-served
  // the same topic when a pillar was revisited more times than its pool size).
  const pillars = Object.keys(POOL);
  const cursors = Object.fromEntries(pillars.map((k) => [k, 0]));
  const start = new Date('2026-08-15T00:00:00Z'); // day after today
  const TARGET = Math.min(90, titles.length);
  const days = [];
  while (days.length < TARGET) {
    let placed = 0;
    for (const pillar of pillars) {
      if (days.length >= TARGET) break;
      if (cursors[pillar] < POOL[pillar].length) {
        const topic = POOL[pillar][cursors[pillar]++];
        const d = new Date(start.getTime() + days.length * 86400000);
        days.push({ day: days.length + 1, date: d.toISOString().slice(0, 10), pillar, topic });
        placed++;
      }
    }
    if (placed === 0) break; // every pool exhausted
  }
  const scheduledTitles = days.map((d) => d.topic);
  if (new Set(scheduledTitles).size !== scheduledTitles.length) {
    console.error('[plan] INTERNAL ERROR: schedule still contains a repeat'); process.exitCode = 1; return;
  }
  console.log(`[plan] scheduled ${days.length} days, every day a distinct topic (0 repeats).`);

  // Emit Markdown.
  const byPillar = {};
  for (const d of days) (byPillar[d.pillar] ||= []).push(d);
  const lines = [
    '# ModernMonk — 90-Day Content Plan (Shorts)',
    '',
    '_Auto-generated + safety-screened by `scripts/plan-90-days.mjs`. Every topic passed the pipeline\'s NSFW/anatomical and off-brand filters. Physical-world / object / place / logic topics only — no body/anatomy topics, so the visuals stay safe too._',
    '',
    '**One Short per topic.** Each topic below is worth exactly one Short — the pipeline no longer makes 5 near-identical Shorts from a single fact. At 5 distinct Shorts/day this 90-topic bank is ~18 days of non-repeating content; at 2–3/day it stretches to 4–6 weeks. Treat the dates as a suggested running order, not a hard schedule.',
    '',
    '## Daily schedule',
    '',
    '| Day | Date | Pillar | Topic |',
    '|----:|------|--------|-------|',
    ...days.map((d) => `| ${d.day} | ${d.date} | ${d.pillar} | ${d.topic} |`),
    '',
    '## Topic bank by pillar',
    '',
    ...Object.entries(POOL).flatMap(([pillar, list]) => [
      `### ${pillar} (${list.length})`,
      '',
      ...list.map((t) => `- ${t}`),
      ''
    ])
  ];
  const outDir = path.join(process.cwd(), 'plan');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, '90-day-content-plan.md');
  await writeFile(outPath, lines.join('\n'), 'utf-8');

  const htmlPath = path.join(outDir, '90-day-content-plan.html');
  await writeFile(htmlPath, renderHtml(days, byPillar), 'utf-8');
  console.log(`[plan] wrote ${outPath} + ${htmlPath} (${days.length} days, ${all.length} topics in the bank)`);
}

const PILLAR_META = {
  'world-facts': { label: 'World Facts', hue: '--p-teal' },
  'top-lists': { label: 'Top 5 / 10', hue: '--p-amber' },
  'history-twist': { label: 'History Twist', hue: '--p-violet' },
  'science-curiosity': { label: 'Science', hue: '--p-green' },
  'mind-quiz': { label: 'Riddles & Quiz', hue: '--p-coral' },
  'food-story': { label: 'Food Story', hue: '--p-orange' }
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHtml(days, byPillar) {
  const legend = Object.entries(PILLAR_META).map(([id, m]) =>
    `<span class="chip" style="--c:var(${m.hue})">${esc(m.label)} <b>${(byPillar[id] || []).length}</b></span>`).join('');

  const rows = days.map((d) => {
    const m = PILLAR_META[d.pillar];
    return `<tr>
      <td class="num">${d.day}</td>
      <td class="num muted">${esc(d.date)}</td>
      <td><span class="tag" style="--c:var(${m.hue})">${esc(m.label)}</span></td>
      <td class="topic">${esc(d.topic)}</td>
    </tr>`;
  }).join('');

  const cards = Object.entries(byPillar).map(([id, list]) => {
    const m = PILLAR_META[id];
    const seen = new Set();
    const uniq = list.map((d) => d.topic).filter((t) => (seen.has(t) ? false : seen.add(t)));
    return `<section class="card" style="--c:var(${m.hue})">
      <h3>${esc(m.label)} <span class="count">${uniq.length}</span></h3>
      <ul>${uniq.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </section>`;
  }).join('');

  return `<title>ModernMonk 90-Day Plan</title>
<style>
  :root{
    --bg:#f7f8f9; --surface:#ffffff; --ink:#16191d; --muted:#5b636e; --hair:#e4e7ea;
    --accent:#0e7c86;
    --p-teal:#1f9e9a; --p-amber:#b9791f; --p-violet:#7c56e0; --p-green:#2f9e44; --p-coral:#d9484a; --p-orange:#c96a10;
    --good-bg:#e7f6ec; --good-ink:#1c7a3a; --good-line:#bfe6cc;
    --serif:"Palatino Linotype",Palatino,"Iowan Old Style",Georgia,serif;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,monospace;
  }
  :root:not([data-theme="light"]){ @media (prefers-color-scheme:dark){
    --bg:#0f1214; --surface:#171b1f; --ink:#e9ebee; --muted:#98a1ab; --hair:#262c31; --accent:#3fc3ce;
    --p-teal:#38c2bd; --p-amber:#d69b45; --p-violet:#a389f0; --p-green:#54c46a; --p-coral:#ef6d6f; --p-orange:#e39044;
    --good-bg:#12271a; --good-ink:#5fd07f; --good-line:#1f4a2e;
  }}
  :root[data-theme="dark"]{
    --bg:#0f1214; --surface:#171b1f; --ink:#e9ebee; --muted:#98a1ab; --hair:#262c31; --accent:#3fc3ce;
    --p-teal:#38c2bd; --p-amber:#d69b45; --p-violet:#a389f0; --p-green:#54c46a; --p-coral:#ef6d6f; --p-orange:#e39044;
    --good-bg:#12271a; --good-ink:#5fd07f; --good-line:#1f4a2e;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;
    -webkit-font-smoothing:antialiased;padding:clamp(20px,5vw,64px)}
  .wrap{max-width:960px;margin:0 auto}
  header{border-bottom:1px solid var(--hair);padding-bottom:28px;margin-bottom:32px}
  .eyebrow{font:600 12px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
  h1{font-family:var(--serif);font-weight:600;font-size:clamp(30px,5.5vw,46px);line-height:1.05;
    margin:14px 0 10px;text-wrap:balance;letter-spacing:-.01em}
  .lede{color:var(--muted);max-width:60ch;margin:0 0 22px}
  .meta{display:flex;flex-wrap:wrap;gap:10px 26px;align-items:center}
  .safe{display:inline-flex;align-items:center;gap:8px;background:var(--good-bg);color:var(--good-ink);
    border:1px solid var(--good-line);border-radius:999px;padding:7px 14px;font-weight:600;font-size:14px}
  .safe svg{width:15px;height:15px}
  .stat{font-size:14px;color:var(--muted)} .stat b{color:var(--ink);font-variant-numeric:tabular-nums}
  .legend{display:flex;flex-wrap:wrap;gap:8px;margin:26px 0 8px}
  .chip{font-size:13px;padding:5px 11px;border-radius:999px;border:1px solid color-mix(in oklab,var(--c) 40%,var(--hair));
    color:var(--ink);background:color-mix(in oklab,var(--c) 12%,var(--surface))}
  .chip b{color:var(--c);font-variant-numeric:tabular-nums;margin-left:3px}
  h2{font-family:var(--serif);font-weight:600;font-size:22px;margin:40px 0 14px;letter-spacing:-.01em}
  .tablewrap{overflow-x:auto;border:1px solid var(--hair);border-radius:12px;background:var(--surface)}
  table{border-collapse:collapse;width:100%;min-width:520px;font-size:14.5px}
  thead th{position:sticky;top:0;background:var(--surface);text-align:left;font:600 11px/1 var(--sans);
    letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:13px 16px;border-bottom:1px solid var(--hair)}
  tbody td{padding:11px 16px;border-bottom:1px solid color-mix(in oklab,var(--hair) 60%,transparent);vertical-align:top}
  tbody tr:last-child td{border-bottom:none}
  tbody tr:hover td{background:color-mix(in oklab,var(--accent) 5%,transparent)}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
  .muted{color:var(--muted)} .topic{max-width:46ch}
  .tag{font-size:12px;font-weight:600;color:var(--c);white-space:nowrap;
    background:color-mix(in oklab,var(--c) 12%,transparent);border:1px solid color-mix(in oklab,var(--c) 32%,transparent);
    padding:2px 9px;border-radius:6px}
  .bank{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}
  .card{background:var(--surface);border:1px solid var(--hair);border-radius:12px;padding:18px 20px;
    border-top:3px solid var(--c)}
  .card h3{font-family:var(--serif);font-size:17px;margin:0 0 10px;display:flex;justify-content:space-between;align-items:baseline}
  .card .count{font:600 12px/1 var(--mono);color:var(--c);font-variant-numeric:tabular-nums}
  .card ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}
  .card li{font-size:13.5px;color:var(--ink);padding-left:14px;position:relative;line-height:1.4}
  .card li::before{content:"";position:absolute;left:0;top:8px;width:5px;height:5px;border-radius:1px;background:var(--c)}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--hair);color:var(--muted);font-size:13px}
  code{font-family:var(--mono);font-size:.9em;background:color-mix(in oklab,var(--accent) 10%,transparent);padding:1px 5px;border-radius:4px}
</style>
<div class="wrap">
  <header>
    <div class="eyebrow">ModernMonk · Curiosity Shorts</div>
    <h1>90-Day Content Plan</h1>
    <p class="lede">A screened, ready-to-run topic calendar. Every topic is deliberately physical-world — objects, places, maps, logic — so both the script and the on-screen visuals stay safe.</p>
    <div class="meta">
      <span class="safe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Safety pass · 0 anatomical / explicit / off-brand</span>
      <span class="stat"><b>${days.length}</b> days</span>
      <span class="stat"><b>${Object.values(byPillar).reduce((a, b) => a + new Set(b.map((d) => d.topic)).size, 0)}</b> unique topics</span>
      <span class="stat">${esc(days[0].date)} → ${esc(days[days.length - 1].date)}</span>
    </div>
    <div class="legend">${legend}</div>
  </header>

  <h2>Daily schedule</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>Day</th><th>Date</th><th>Pillar</th><th>Lead topic</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <h2>Topic bank by pillar</h2>
  <div class="bank">${cards}</div>

  <footer>Generated &amp; safety-screened by <code>scripts/plan-90-days.mjs</code> against the pipeline's own NSFW and off-brand filters. Regenerate anytime to reshuffle or extend. The pipeline still produces ~5 Shorts/day; this lists the lead topic per day.</footer>
</div>`;
}

main();
